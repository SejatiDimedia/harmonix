"""Database tools: get_schema and run_sql with guardrail enforcement."""

import time
from typing import Any
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.db.connection import get_db_session, get_readonly_db_session
from src.tools.base import BaseTool
from src.tools.guardrails import SQLGuardrail, SQLValidationError, QueryRiskAssessment


# ==============================================================================
# Tool: get_schema
# ==============================================================================

class GetSchemaInput(BaseModel):
    """Input parameters for get_schema tool."""
    table_names: list[str] | None = Field(
        default=None,
        description="Optional list of specific table names to inspect. If omitted, returns an overview of all available tables in the analytics schema.",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_tables(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("table_names"):
                for alias in ("table_name", "tables", "table"):
                    if data.get(alias):
                        val = data[alias]
                        if isinstance(val, str):
                            data["table_names"] = [t.strip() for t in val.split(",") if t.strip()]
                        elif isinstance(val, (list, tuple, set)):
                            data["table_names"] = list(val)
                        break
            elif isinstance(data.get("table_names"), str):
                data["table_names"] = [t.strip() for t in data["table_names"].split(",") if t.strip()]
        return data


class GetSchemaTool(BaseTool):
    """Tool to retrieve schema definitions, column data types, and sample values."""

    name: str = "get_schema"
    description: str = (
        "Retrieve schema information from the PostgreSQL analytics database. "
        "Call with table_names to get detailed column types and sample data for specific tables, "
        "or without table_names to see the list of all available tables."
    )
    args_schema: type[BaseModel] = GetSchemaInput

    async def execute(
        self,
        table_names: list[str] | str | None = None,
        table_name: str | None = None,
        tables: list[str] | str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute schema inspection with resilient parameter handling."""
        schema_name = settings.db_schema

        # Normalize tables list across parameter aliases
        raw_tables = []
        if table_name:
            raw_tables.append(table_name)
        for cand in (table_names, tables):
            if isinstance(cand, str):
                raw_tables.extend([t.strip() for t in cand.split(",") if t.strip()])
            elif isinstance(cand, (list, tuple, set)):
                raw_tables.extend([str(t).strip() for t in cand if str(t).strip()])

        # Deduplicate while preserving order
        seen = set()
        resolved_tables = [t for t in raw_tables if not (t.lower() in seen or seen.add(t.lower()))]

        async with get_readonly_db_session() as session:
            # 1. If no specific tables requested, return overview of all tables
            if not resolved_tables:
                query = text("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = :schema_name AND table_type = 'BASE TABLE'
                    ORDER BY table_name;
                """)
                result = await session.execute(query, {"schema_name": schema_name})
                available_tables = [row[0] for row in result.fetchall()]
                return {
                    "schema": schema_name,
                    "available_tables": available_tables,
                    "message": "Specify table_names to inspect column details and sample data.",
                }

            # 2. Inspect requested tables
            tables_detail = {}
            for table in resolved_tables:
                # Clean table name
                clean_table = table.strip().lower()
                # Get column information
                col_query = text("""
                    SELECT column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = :schema_name AND table_name = :table_name
                    ORDER BY ordinal_position;
                """)
                col_result = await session.execute(
                    col_query, {"schema_name": schema_name, "table_name": clean_table}
                )
                columns = [
                    {"name": row[0], "type": row[1], "nullable": row[2] == "YES"}
                    for row in col_result.fetchall()
                ]

                if not columns:
                    tables_detail[clean_table] = {"error": f"Table '{clean_table}' not found in schema '{schema_name}'."}
                    continue

                # Fetch 2 sample rows (masking sensitive PII fields)
                sample_rows = []
                try:
                    escaped_schema = schema_name.replace('"', '""')
                    escaped_table = clean_table.replace('"', '""')
                    sample_query = text(f'SELECT * FROM "{escaped_schema}"."{escaped_table}" LIMIT 2;')
                    sample_res = await session.execute(sample_query)
                    sample_cols = list(sample_res.keys())
                    for row in sample_res.fetchall():
                        masked_row = {}
                        for col_idx, col_name in enumerate(sample_cols):
                            val = row[col_idx]
                            # PII masking
                            if col_name.lower() in ("email", "phone_number", "password"):
                                masked_row[col_name] = "***MASKED_PII***"
                            else:
                                masked_row[col_name] = str(val) if val is not None else None
                        sample_rows.append(masked_row)
                except Exception as e:
                    sample_rows = [{"_note": f"Could not fetch sample values: {e}"}]

                tables_detail[clean_table] = {
                    "columns": columns,
                    "sample_rows": sample_rows,
                }

            return {
                "schema": schema_name,
                "tables": tables_detail,
            }


# ==============================================================================
# Tool: run_sql
# ==============================================================================

class RunSQLInput(BaseModel):
    """Input parameters for run_sql tool."""
    query: str = Field(
        ...,
        description="The SQL SELECT query to execute against the analytics database. Only SELECT queries are permitted.",
    )

    @model_validator(mode="before")
    @classmethod
    def populate_query_from_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("query") and data.get("sql"):
                data["query"] = data["sql"]
        return data


class RunSQLTool(BaseTool):
    """Tool to execute safe, read-only SQL queries with AST guardrails and timeouts."""

    name: str = "run_sql"
    description: str = (
        "Execute a read-only SQL SELECT query on the PostgreSQL database. "
        "The query is validated by an AST guardrail (only SELECT is allowed, non-read operations and "
        "dangerous functions are blocked). A row limit is automatically applied if not specified."
    )
    args_schema: type[BaseModel] = RunSQLInput

    def __init__(self, guardrail: SQLGuardrail | None = None):
        self.guardrail = guardrail or SQLGuardrail()

    async def execute(
        self,
        query: str | None = None,
        sql: str | None = None,
        is_approved: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Validate, assess risk, and execute SQL query."""
        actual_query = (query or sql or "").strip()
        if not actual_query:
            return {
                "status": "error",
                "error_type": "InvalidInputError",
                "message": "Missing SQL query parameter. Please provide 'query' or 'sql'.",
            }

        # 1. AST Validation & limit enforcement
        try:
            sanitized_query = self.guardrail.validate_and_sanitize(actual_query)
        except SQLValidationError as e:
            return {
                "status": "error",
                "error_type": "SQLValidationError",
                "message": str(e),
                "original_query": query,
            }

        # 2. Risk Assessment (FR-25: approval gate for high risk)
        if not is_approved:
            risk_assessment = self.guardrail.assess_risk(sanitized_query)
            if risk_assessment.requires_approval:
                return {
                    "status": "approval_required",
                    "message": "This query requires human approval before execution.",
                    "sanitized_query": sanitized_query,
                    "risk_reasons": risk_assessment.risk_reasons,
                    "sensitive_columns": risk_assessment.sensitive_columns_accessed,
                }

        # 3. Execution with statement timeout
        timeout_ms = int(settings.sql_execution_timeout_seconds * 1000)
        start_time = time.perf_counter()

        async with get_readonly_db_session() as session:
            try:
                # Set local statement timeout for this transaction
                await session.execute(text(f"SET LOCAL statement_timeout = {timeout_ms};"))
                result = await session.execute(text(sanitized_query))
                duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

                columns = list(result.keys())
                raw_rows = result.fetchall()

                # Mask PII in output rows
                processed_rows = []
                for row in raw_rows:
                    row_data = []
                    for idx, col_name in enumerate(columns):
                        val = row[idx]
                        if col_name.lower() in ("email", "phone_number", "password"):
                            row_data.append("***MASKED_PII***")
                        else:
                            # Convert non-serializable objects (Decimal, datetime) to string / float
                            if hasattr(val, "isoformat"):
                                row_data.append(val.isoformat())
                            elif hasattr(val, "as_tuple"):  # Decimal
                                row_data.append(float(val))
                            else:
                                row_data.append(val)
                    processed_rows.append(row_data)

                return {
                    "status": "success",
                    "columns": columns,
                    "rows": processed_rows,
                    "row_count": len(processed_rows),
                    "execution_time_ms": duration_ms,
                    "sanitized_query": sanitized_query,
                }
            except Exception as e:
                duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
                err_str = str(e)
                hint = ""
                err_lower = err_str.lower()
                if "does not exist" in err_lower:
                    hint = " [PETUNJUK: Tabel atau kolom tidak ditemukan di database. Panggil tool `get_schema` untuk melihat struktur tabel dan nama kolom yang valid.]"
                elif "aggregate functions are not allowed in where" in err_lower:
                    hint = " [PETUNJUK: Fungsi agregasi (seperti SUM, COUNT, AVG) tidak diizinkan di klausa WHERE. Gunakan klausa HAVING setelah GROUP BY.]"
                elif '"' in err_str and "column" in err_lower:
                    hint = " [PETUNJUK: Di PostgreSQL, konstanta string teks harus menggunakan petik tunggal '...', bukan petik ganda \"...\".]"
                return {
                    "status": "error",
                    "error_type": "DatabaseExecutionError",
                    "error": err_str + hint,
                    "message": err_str + hint,
                    "execution_time_ms": duration_ms,
                    "sanitized_query": sanitized_query,
                }

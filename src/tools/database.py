"""Database tools: get_schema and run_sql with guardrail enforcement."""

import time
from typing import Any
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.db.connection import get_db_session
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


class GetSchemaTool(BaseTool):
    """Tool to retrieve schema definitions, column data types, and sample values."""

    name: str = "get_schema"
    description: str = (
        "Retrieve schema information from the PostgreSQL analytics database. "
        "Call with table_names to get detailed column types and sample data for specific tables, "
        "or without table_names to see the list of all available tables."
    )
    args_schema: type[BaseModel] = GetSchemaInput

    async def execute(self, table_names: list[str] | None = None) -> dict[str, Any]:
        """Execute schema inspection."""
        schema_name = settings.db_schema

        async with get_db_session() as session:
            # 1. If table_names is empty or None, return overview of all tables
            if not table_names:
                query = text("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = :schema_name AND table_type = 'BASE TABLE'
                    ORDER BY table_name;
                """)
                result = await session.execute(query, {"schema_name": schema_name})
                tables = [row[0] for row in result.fetchall()]
                return {
                    "schema": schema_name,
                    "available_tables": tables,
                    "message": "Specify table_names to inspect column details and sample data.",
                }

            # 2. Inspect requested tables
            tables_detail = {}
            for table in table_names:
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
                    sample_query = text(f'SELECT * FROM "{schema_name}"."{clean_table}" LIMIT 2;')
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

    async def execute(self, query: str, is_approved: bool = False) -> dict[str, Any]:
        """Validate, assess risk, and execute SQL query."""
        # 1. AST Validation & limit enforcement
        try:
            sanitized_query = self.guardrail.validate_and_sanitize(query)
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
        timeout_ms = settings.sql_execution_timeout_seconds * 1000
        start_time = time.perf_counter()

        async with get_db_session() as session:
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
                if "does not exist" in err_str:
                    if "customer_id" in err_str and "order_items" in query.lower():
                        hint = " [HINT: Tabel order_items TIDAK memiliki customer_id. Hubungkan customers ke orders via customer_id, lalu orders ke order_items via order_id!]"
                    elif "customer_name" in err_str and "order_items" in query.lower():
                        hint = " [HINT: Kolom customer_name berada di tabel analytics.customers, bukan order_items!]"
                    elif '"' in err_str:
                        hint = " [HINT: Di PostgreSQL, nilai teks/string harus menggunakan petik tunggal '...', bukan petik ganda \"...\"!]"
                return {
                    "status": "error",
                    "error_type": "DatabaseExecutionError",
                    "error": err_str + hint,
                    "message": err_str + hint,
                    "execution_time_ms": duration_ms,
                    "sanitized_query": sanitized_query,
                }

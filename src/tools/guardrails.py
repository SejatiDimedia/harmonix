"""SQL Guardrails: AST validation, read-only enforcement, row-limit injection, and risk analysis."""

import re
from typing import Any
from pydantic import BaseModel, Field
import sqlglot
from sqlglot import exp

from src.config import settings


class SQLValidationError(Exception):
    """Raised when an SQL query fails safety or AST validation rules."""
    pass


class QueryRiskAssessment(BaseModel):
    """Risk assessment for an SQL query to determine if an approval gate is needed."""
    is_safe: bool = True
    requires_approval: bool = False
    risk_reasons: list[str] = Field(default_factory=list)
    sensitive_columns_accessed: list[str] = Field(default_factory=list)


class SQLGuardrail:
    """Production-grade SQL validator and sanitizer using AST parsing."""

    # Forbidden statement types
    FORBIDDEN_EXPRESSION_TYPES = (
        exp.Insert,
        exp.Update,
        exp.Delete,
        exp.Drop,
        exp.Alter,
        exp.Create,
        exp.TruncateTable,
        exp.Command,
        exp.Transaction,
        exp.Commit,
        exp.Rollback,
        exp.Set,
        exp.SetProperty,
        exp.Into,
        exp.Lock,
    )

    # Dangerous functions blocklist / prefixes
    DANGEROUS_FUNCTIONS = {
        "pg_sleep",
        "pg_read_file",
        "pg_read_binary_file",
        "pg_write_file",
        "pg_ls_dir",
        "pg_terminate_backend",
        "pg_cancel_backend",
        "lo_import",
        "lo_export",
        "query_to_xml",
        "table_to_xml",
        "schema_to_xml",
        "set_config",
        "current_setting",
        "system",
        "copy",
        "dblink",
        "dblink_exec",
        "dblink_connect",
    }

    DANGEROUS_FUNCTION_PREFIXES = (
        "pg_",
        "lo_",
        "dblink",
        "query_to_",
        "table_to_",
        "schema_to_",
        "cursor_to_",
        "xml_",
        "set_config",
        "current_setting",
        "admin_",
        "sys_",
    )

    # Safe analytical functions permitted for query execution
    ALLOWED_FUNCTIONS = {
        # Aggregates
        "count", "sum", "avg", "min", "max",
        "stddev", "stddev_pop", "stddev_samp",
        "variance", "var_pop", "var_samp",
        # String manipulation
        "concat", "concat_ws", "lower", "upper", "trim", "ltrim", "rtrim",
        "substr", "substring", "length", "replace", "left", "right",
        "split_part", "initcap", "regexp_replace", "strpos", "format",
        "position", "char_length", "character_length",
        # Math & Numeric
        "round", "ceil", "ceiling", "floor", "abs", "sign", "mod",
        "power", "sqrt", "cbrt", "exp", "ln", "log", "trunc",
        # Date & Time
        "date_trunc", "extract", "age", "to_char", "to_date", "to_timestamp",
        "now", "current_date", "current_timestamp", "current_time",
        "localtime", "localtimestamp", "make_date", "make_timestamp",
        "justify_days", "justify_hours", "justify_interval",
        # Conditional / Null handling
        "coalesce", "nullif", "greatest", "least", "cast", "try_cast",
        # Window & Ranking
        "row_number", "rank", "dense_rank", "ntile", "lag", "lead",
        "first_value", "last_value", "cume_dist", "percent_rank"
    }

    # Forbidden system schemas and tables
    FORBIDDEN_SCHEMAS = {
        "pg_catalog",
        "information_schema",
        "pg_toast",
        "pg_temp",
    }

    FORBIDDEN_SYSTEM_TABLES = {
        "pg_shadow",
        "pg_user",
        "pg_authid",
        "pg_database",
        "pg_tables",
        "pg_views",
        "pg_class",
        "pg_proc",
        "pg_stat_activity",
        "pg_settings",
        "pg_roles",
        "pg_group",
    }

    # Sensitive column names that trigger PII protection / approval gate
    SENSITIVE_COLUMNS = {
        "email",
        "phone_number",
        "password",
        "token",
        "secret",
        "credit_card",
        "nik",
    }

    # Known table column mappings for wildcard (*) PII expansion
    KNOWN_TABLE_SENSITIVE_COLUMNS = {
        "customers": ["email", "phone_number"],
        "analytics.customers": ["email", "phone_number"],
    }

    def __init__(self, max_row_limit: int | None = None):
        self.max_row_limit = max_row_limit or settings.sql_max_row_limit

    @staticmethod
    def _pre_sanitize_llm_sql(sql: str) -> str:
        """Normalize common SQL syntax quirks emitted by LLMs (unescaped wildcards, unquoted LIKE)."""
        s = sql.replace(r"\%", "%").replace(r"\_", "_")
        s = re.sub(r'\b(I?LIKE)\s+"([^"]+)"', r"\1 '\2'", s, flags=re.IGNORECASE)
        s = re.sub(r"\b(I?LIKE)\s+([%_][^%_\s\';]*[%_])", r"\1 '\2'", s, flags=re.IGNORECASE)
        return s

    def validate_and_sanitize(self, sql_query: str) -> str:
        """Validate that the query is strictly a single, read-only SELECT statement

        and enforce a maximum row limit.

        Args:
            sql_query: Raw SQL query string.

        Returns:
            Sanitized and limit-enforced SQL query string.

        Raises:
            SQLValidationError: If the query fails AST safety checks.
        """
        cleaned_sql = self._pre_sanitize_llm_sql(sql_query.strip())
        if not cleaned_sql:
            raise SQLValidationError("SQL query is empty.")

        # 1. Parse using sqlglot for PostgreSQL dialect
        try:
            parsed_expressions = sqlglot.parse(cleaned_sql, read="postgres")
        except Exception as e:
            raise SQLValidationError(f"SQL syntax parsing error: {e}") from e

        # 2. Multi-statement check
        if not parsed_expressions:
            raise SQLValidationError("No valid SQL expression found.")
        if len(parsed_expressions) > 1:
            raise SQLValidationError("Multi-statement queries (separated by ';') are strictly forbidden.")

        expression = parsed_expressions[0]

        # 3. Root statement check: must be a SELECT or UNION of SELECTs
        if not isinstance(expression, (exp.Select, exp.Union)):
            raise SQLValidationError(
                f"Only read-only SELECT queries are allowed. Attempted: {expression.key.upper()}"
            )

        # 4. Explicit check for INTO and row locking
        if expression.args.get("into") is not None:
            raise SQLValidationError("Forbidden operation 'INTO' detected in query.")
        if expression.args.get("locks"):
            raise SQLValidationError("Forbidden row-level locking (FOR UPDATE / FOR SHARE) detected in query.")

        # 5. AST traversal for forbidden statement types, schemas, and operations
        for node in expression.walk():
            if isinstance(node, self.FORBIDDEN_EXPRESSION_TYPES):
                raise SQLValidationError(
                    f"Forbidden operation '{node.key.upper()}' detected in query."
                )

            # Check for SELECT ... INTO in subqueries or clauses
            if isinstance(node, exp.Into) or (hasattr(node, "args") and node.args.get("into") is not None):
                raise SQLValidationError("Forbidden operation 'INTO' detected in query.")

            # Check for FOR UPDATE / FOR SHARE locking
            if isinstance(node, exp.Lock) or (hasattr(node, "args") and node.args.get("locks")):
                raise SQLValidationError("Forbidden row-level locking (FOR UPDATE / FOR SHARE) detected in query.")

            # Check function calls: enforce allowlist and block dangerous functions
            if isinstance(node, exp.Anonymous):
                func_name = (node.name or "").lower()
                if func_name in self.DANGEROUS_FUNCTIONS or any(func_name.startswith(p) for p in self.DANGEROUS_FUNCTION_PREFIXES):
                    raise SQLValidationError(
                        f"Execution of dangerous function '{func_name}' is blocked."
                    )
                if func_name not in self.ALLOWED_FUNCTIONS:
                    raise SQLValidationError(
                        f"Execution of function '{func_name}' is blocked. Function is not in the allowlist of permitted analytics routines."
                    )

            # Check tables and schemas
            if isinstance(node, exp.Table):
                schema_name = (node.db or "").lower()
                tbl_name = (node.name or "").lower()

                if schema_name in self.FORBIDDEN_SCHEMAS:
                    raise SQLValidationError(
                        f"Access to system catalog/schema '{node.db}' is forbidden."
                    )
                if tbl_name in self.FORBIDDEN_SYSTEM_TABLES or tbl_name.startswith("pg_"):
                    raise SQLValidationError(
                        f"Access to system catalog table '{node.name}' is forbidden."
                    )
                if tbl_name in {"tables", "columns", "schemata", "routines"} and (not schema_name or schema_name == "information_schema"):
                    raise SQLValidationError(
                        f"Direct query against system catalog table '{node.name}' is blocked. Use get_schema tool instead."
                    )

        # 6. Enforce LIMIT clause
        # If query has no LIMIT, or user's LIMIT > max_row_limit, enforce max_row_limit
        existing_limit = expression.args.get("limit")
        if existing_limit is None:
            expression = expression.limit(self.max_row_limit)
        else:
            try:
                limit_expr = getattr(existing_limit, "expression", None)
                if limit_expr is not None and hasattr(limit_expr, "this") and str(limit_expr.this).isdigit():
                    user_limit = int(limit_expr.this)
                    if user_limit > self.max_row_limit:
                        expression.set("limit", exp.Limit(expression=exp.Literal.number(self.max_row_limit)))
                else:
                    expression.set("limit", exp.Limit(expression=exp.Literal.number(self.max_row_limit)))
            except Exception:
                expression.set("limit", exp.Limit(expression=exp.Literal.number(self.max_row_limit)))

        return expression.sql(dialect="postgres")

    def assess_risk(self, sql_query: str) -> QueryRiskAssessment:
        """Assess whether a query should trigger human-in-the-loop approval (FR-25).

        Checks for:
        1. Accessing sensitive columns (e.g. email, phone_number), including wildcard (*) expansion
        2. Unbounded full-table scans on large tables without WHERE clause
        """
        assessment = QueryRiskAssessment()

        try:
            parsed = sqlglot.parse_one(sql_query, read="postgres")
        except Exception:
            assessment.is_safe = False
            assessment.risk_reasons.append("Unparseable SQL expression")
            return assessment

        # 1. Check for explicit sensitive columns accessed
        for column_node in parsed.find_all(exp.Column):
            col_name = column_node.name.lower()
            if any(sens in col_name for sens in self.SENSITIVE_COLUMNS):
                if col_name not in assessment.sensitive_columns_accessed:
                    assessment.sensitive_columns_accessed.append(col_name)

        # 2. Check for wildcard (*) expansion to sensitive tables
        has_wildcard = bool(list(parsed.find_all(exp.Star)))
        if has_wildcard:
            for tbl in parsed.find_all(exp.Table):
                tbl_name = (tbl.name or "").lower()
                known_sens = self.KNOWN_TABLE_SENSITIVE_COLUMNS.get(tbl_name)
                if not known_sens and tbl.db:
                    known_sens = self.KNOWN_TABLE_SENSITIVE_COLUMNS.get(f"{tbl.db.lower()}.{tbl_name}")
                if known_sens:
                    for s_col in known_sens:
                        if s_col not in assessment.sensitive_columns_accessed:
                            assessment.sensitive_columns_accessed.append(s_col)
                    assessment.risk_reasons.append(
                        f"Query accesses wildcard '*' on table '{tbl_name}' which contains sensitive PII columns: {', '.join(known_sens)}"
                    )

        if assessment.sensitive_columns_accessed:
            assessment.requires_approval = True
            cols_str = ", ".join(set(assessment.sensitive_columns_accessed))
            if not any("sensitive PII" in r for r in assessment.risk_reasons):
                assessment.risk_reasons.append(f"Query accesses sensitive PII columns: {cols_str}")

        # Check for unbounded queries (SELECT * FROM table without WHERE clause or aggregation)
        if isinstance(parsed, exp.Select):
            has_where = parsed.args.get("where") is not None
            has_joins = bool(parsed.args.get("joins"))
            has_group = parsed.args.get("group") is not None
            # If multi-table join without WHERE and without GROUP BY (raw unbounded dump)
            if not has_where and (has_joins or len(list(parsed.find_all(exp.Table))) > 1) and not has_group:
                assessment.requires_approval = True
                assessment.risk_reasons.append("Unbounded multi-table query without WHERE filter (potential high cost)")

        return assessment

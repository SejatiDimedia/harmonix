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
    )

    # Dangerous functions often used in SQL injection / denial-of-service
    DANGEROUS_FUNCTIONS = {
        "pg_sleep",
        "pg_read_file",
        "pg_write_file",
        "pg_ls_dir",
        "pg_terminate_backend",
        "pg_cancel_backend",
        "system",
        "copy",
        "dblink",
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

    def __init__(self, max_row_limit: int | None = None):
        self.max_row_limit = max_row_limit or settings.sql_max_row_limit

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
        cleaned_sql = sql_query.strip()
        if not cleaned_sql:
            raise SQLValidationError("SQL query is empty.")

        # Pre-sanitize SQL literals and wildcards often emitted malformed by small LLMs
        cleaned_sql = cleaned_sql.replace(r"\%", "%").replace(r"\_", "_")
        cleaned_sql = re.sub(r'\b(I?LIKE)\s+"([^"]+)"', r"\1 '\2'", cleaned_sql, flags=re.IGNORECASE)
        cleaned_sql = re.sub(r"\b(I?LIKE)\s+([%_][^%_\s\';]*[%_])", r"\1 '\2'", cleaned_sql, flags=re.IGNORECASE)
        cleaned_sql = re.sub(r'(=|!=|<>)\s+"([A-Z][a-zA-Z0-9_ &]*)"', r"\1 '\2'", cleaned_sql)

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

        # 4. AST traversal for forbidden statement types or operations
        for node in expression.walk():
            if isinstance(node, self.FORBIDDEN_EXPRESSION_TYPES):
                raise SQLValidationError(
                    f"Forbidden operation '{node.key.upper()}' detected in query."
                )

            # Check function calls for dangerous built-in routines
            if isinstance(node, exp.Anonymous):
                func_name = node.name.lower()
                if func_name in self.DANGEROUS_FUNCTIONS:
                    raise SQLValidationError(
                        f"Execution of dangerous function '{func_name}' is blocked."
                    )

        # 5. Enforce LIMIT clause
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
        1. Accessing sensitive columns (e.g. email, phone_number)
        2. Unbounded full-table scans on large tables without WHERE clause
        """
        assessment = QueryRiskAssessment()

        try:
            parsed = sqlglot.parse_one(sql_query, read="postgres")
        except Exception:
            assessment.is_safe = False
            assessment.risk_reasons.append("Unparseable SQL expression")
            return assessment

        # Check for sensitive columns accessed
        for column_node in parsed.find_all(exp.Column):
            col_name = column_node.name.lower()
            if any(sens in col_name for sens in self.SENSITIVE_COLUMNS):
                assessment.sensitive_columns_accessed.append(col_name)

        if assessment.sensitive_columns_accessed:
            assessment.requires_approval = True
            cols_str = ", ".join(set(assessment.sensitive_columns_accessed))
            assessment.risk_reasons.append(f"Query accesses sensitive PII columns: {cols_str}")

        # Check for unbounded queries (SELECT * FROM table without WHERE clause)
        if isinstance(parsed, exp.Select):
            has_where = parsed.args.get("where") is not None
            has_joins = bool(parsed.args.get("joins"))
            # If large join or unbounded scan
            if not has_where and (has_joins or len(list(parsed.find_all(exp.Table))) > 1):
                assessment.requires_approval = True
                assessment.risk_reasons.append("Unbounded multi-table query without WHERE filter (potential high cost)")

        return assessment

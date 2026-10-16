"""Unit tests for AST-based SQLGuardrail safety and limit enforcement."""

import pytest
from src.tools.guardrails import SQLGuardrail, SQLValidationError


@pytest.fixture
def guardrail():
    return SQLGuardrail(max_row_limit=50)


def test_valid_select_query_appends_limit(guardrail):
    """Test that a basic SELECT query gets a default LIMIT enforced."""
    query = "SELECT product_name, price FROM analytics.products"
    sanitized = guardrail.validate_and_sanitize(query)

    assert "LIMIT 50" in sanitized.upper()
    assert "SELECT" in sanitized.upper()


def test_valid_select_query_clamps_large_limit(guardrail):
    """Test that a SELECT query with excessive LIMIT is clamped to max_row_limit."""
    query = "SELECT * FROM analytics.orders LIMIT 500"
    sanitized = guardrail.validate_and_sanitize(query)

    assert "LIMIT 50" in sanitized.upper()
    assert "LIMIT 500" not in sanitized.upper()


def test_valid_select_query_preserves_smaller_limit(guardrail):
    """Test that a SELECT query with smaller LIMIT is preserved."""
    query = "SELECT * FROM analytics.orders LIMIT 10"
    sanitized = guardrail.validate_and_sanitize(query)

    assert "LIMIT 10" in sanitized.upper()


@pytest.mark.parametrize(
    "forbidden_sql",
    [
        "DELETE FROM analytics.orders WHERE order_id = '123'",
        "DROP TABLE analytics.customers",
        "TRUNCATE TABLE analytics.order_items",
        "INSERT INTO analytics.products (product_id) VALUES ('p1')",
        "UPDATE analytics.products SET price = 0",
        "ALTER TABLE analytics.customers ADD COLUMN hack text",
    ],
)
def test_blocks_non_select_dml_and_ddl(guardrail, forbidden_sql):
    """Test that non-SELECT statements are blocked with SQLValidationError."""
    with pytest.raises(SQLValidationError) as exc_info:
        guardrail.validate_and_sanitize(forbidden_sql)
    assert "Only read-only SELECT" in str(exc_info.value) or "Forbidden" in str(exc_info.value)


def test_blocks_multi_statement_sql_injection(guardrail):
    """Test that chained statements with semicolon are rejected."""
    query = "SELECT * FROM analytics.products; DROP TABLE analytics.customers;"
    with pytest.raises(SQLValidationError) as exc_info:
        guardrail.validate_and_sanitize(query)
    assert "Multi-statement" in str(exc_info.value)


@pytest.mark.parametrize(
    "dangerous_func_sql",
    [
        "SELECT pg_sleep(10)",
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT * FROM analytics.products WHERE id = 1 AND pg_sleep(5) IS NULL",
    ],
)
def test_blocks_dangerous_functions(guardrail, dangerous_func_sql):
    """Test that dangerous PostgreSQL internal routines are rejected."""
    with pytest.raises(SQLValidationError) as exc_info:
        guardrail.validate_and_sanitize(dangerous_func_sql)
    assert "dangerous function" in str(exc_info.value).lower()


def test_risk_assessment_triggers_approval_on_pii(guardrail):
    """Test that selecting sensitive PII columns flags human approval requirement."""
    query = "SELECT customer_name, email, phone_number FROM analytics.customers"
    sanitized = guardrail.validate_and_sanitize(query)
    assessment = guardrail.assess_risk(sanitized)

    assert assessment.requires_approval is True
    assert "email" in assessment.sensitive_columns_accessed
    assert "phone_number" in assessment.sensitive_columns_accessed
    assert any("sensitive PII" in reason for reason in assessment.risk_reasons)


def test_risk_assessment_passes_safe_aggregate_query(guardrail):
    """Test that a clean aggregate query without PII does not trigger approval."""
    query = "SELECT product_category_name, COUNT(*) as count FROM analytics.products GROUP BY product_category_name"
    sanitized = guardrail.validate_and_sanitize(query)
    assessment = guardrail.assess_risk(sanitized)

    assert assessment.requires_approval is False
    assert len(assessment.risk_reasons) == 0

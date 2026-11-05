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


@pytest.mark.parametrize(
    "query,expected_pii_cols",
    [
        ("SELECT * FROM customers", ["email", "phone_number"]),
        ("SELECT * FROM analytics.customers", ["email", "phone_number"]),
        ("SELECT c.* FROM customers c JOIN orders o ON c.customer_id = o.customer_id", ["email", "phone_number"]),
        ("WITH sub AS (SELECT * FROM customers) SELECT * FROM sub", ["email", "phone_number"]),
    ],
)
def test_p0_1_wildcard_expansion_detects_pii(guardrail, query, expected_pii_cols):
    """P0-1 Test: Verify SELECT * on customers table expands and flags sensitive PII requiring approval."""
    sanitized = guardrail.validate_and_sanitize(query)
    assessment = guardrail.assess_risk(sanitized)
    assert assessment.requires_approval is True
    for col in expected_pii_cols:
        assert col in assessment.sensitive_columns_accessed


@pytest.mark.parametrize(
    "bypass_query,expected_error_keyword",
    [
        ("SELECT pg_read_binary_file('/etc/passwd')", "dangerous function"),
        ("SELECT lo_import('/etc/passwd')", "dangerous function"),
        ("SELECT query_to_xml('SELECT 1', true, false, '')", "dangerous function"),
        ("SELECT set_config('session_preload_libraries', 'foo', false)", "dangerous function"),
        ("SELECT * INTO newtbl FROM orders", "INTO"),
        ("SELECT * FROM orders FOR UPDATE", "row-level locking"),
        ("SELECT * FROM orders FOR SHARE", "row-level locking"),
        ("SELECT * FROM pg_catalog.pg_shadow", "system catalog"),
        ("SELECT table_name FROM information_schema.tables", "system catalog"),
        ("SELECT * FROM pg_shadow", "system catalog"),
        ("SELECT unapproved_custom_func(123)", "not in the allowlist"),
    ],
)
def test_p0_1_security_bypass_matrix_blocked(guardrail, bypass_query, expected_error_keyword):
    """P0-1 Test: Verify all 10 security audit bypass vectors are strictly blocked by AST Guardrails."""
    with pytest.raises(SQLValidationError) as exc_info:
        guardrail.validate_and_sanitize(bypass_query)
    assert expected_error_keyword.lower() in str(exc_info.value).lower()


"""Unit tests for Custom Model Context Protocol (MCP) Database Server (FR-10)."""

import json
import pytest

from src.mcp.server import mcp_server


@pytest.mark.asyncio
async def test_mcp_list_tools():
    """Verify MCP server registers all expected database tools."""
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]

    assert "get_schema" in tool_names
    assert "run_sql" in tool_names
    assert "search_glossary" in tool_names
    assert "calculate" in tool_names


@pytest.mark.asyncio
async def test_mcp_calculate_tool():
    """Verify MCP calculate tool executes Python sandbox calculation."""
    res = await mcp_server.call_tool(
        "calculate",
        {"code": "a = 15\nb = 27\nresult = a + b"},
    )
    assert not res.is_error
    payload = json.loads(res.content[0].text)
    assert payload.get("status") == "success"
    assert payload.get("result") == 42


@pytest.mark.asyncio
async def test_mcp_run_sql_blocks_malicious_ddl():
    """Verify MCP run_sql tool blocks DDL statements via AST guardrail."""
    res = await mcp_server.call_tool(
        "run_sql",
        {"query": "DROP TABLE analytics.customers;"},
    )
    assert not res.is_error
    payload = json.loads(res.content[0].text)
    assert payload.get("status") == "error"
    assert payload.get("error_type") == "SQLValidationError"
    assert "Only read-only SELECT" in payload.get("message")


@pytest.mark.asyncio
async def test_mcp_run_sql_approval_gate():
    """Verify MCP run_sql tool triggers approval requirement for sensitive columns."""
    res = await mcp_server.call_tool(
        "run_sql",
        {
            "query": "SELECT customer_id, customer_email, customer_phone FROM analytics.customers",
            "is_approved": False,
        },
    )
    assert not res.is_error
    payload = json.loads(res.content[0].text)
    assert payload.get("status") == "approval_required"
    assert len(payload.get("risk_reasons", [])) > 0


@pytest.mark.asyncio
async def test_mcp_run_sql_execution():
    """Verify MCP run_sql tool executes safe SELECT query and returns rows."""
    res = await mcp_server.call_tool(
        "run_sql",
        {"query": "SELECT count(*) as total FROM analytics.products"},
    )
    assert not res.is_error
    payload = json.loads(res.content[0].text)
    assert payload.get("status") == "success"
    assert "columns" in payload
    assert "rows" in payload


@pytest.mark.asyncio
async def test_mcp_get_schema_tool():
    """Verify MCP get_schema tool returns schema metadata."""
    res = await mcp_server.call_tool(
        "get_schema",
        {"table_names": ["products"]},
    )
    assert not res.is_error
    payload = json.loads(res.content[0].text)
    assert "schema" in payload
    assert "tables" in payload
    assert "products" in payload["tables"]


@pytest.mark.asyncio
async def test_mcp_prompts():
    """Verify MCP server registers and renders prompt templates."""
    prompts = await mcp_server.list_prompts()
    prompt_names = [p.name for p in prompts]
    assert "text_to_sql_prompt" in prompt_names

    rendered = await mcp_server.get_prompt("text_to_sql_prompt", {"user_question": "Berapa GMV bulan lalu?"})
    assert rendered.messages
    assert "Berapa GMV bulan lalu?" in rendered.messages[0].content.text

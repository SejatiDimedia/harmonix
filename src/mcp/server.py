"""Custom Model Context Protocol (MCP) Database Server for Harmonix (FR-10).

Exposes guarded database access (schema inspection, AST-validated SQL query execution,
PII masking, local hybrid glossary search, and safe sandbox calculation) via standard MCP protocol.
Compatible with Claude Desktop, Cursor, and any MCP client over stdio/sse transports.
"""

import json
import logging
from typing import Any

from mcp.server.mcpserver import MCPServer

from src.tools.database import GetSchemaTool, RunSQLTool
from src.tools.glossary import SearchGlossaryTool
from src.tools.sandbox import CalculateTool

logger = logging.getLogger(__name__)

# Initialize MCP server instance
mcp_server = MCPServer(
    name="harmonix-database",
    description="Production-grade PostgreSQL Database MCP Server with AST guardrails and PII masking",
)

# Instantiate internal tools
_schema_tool = GetSchemaTool()
_sql_tool = RunSQLTool()
_glossary_tool = SearchGlossaryTool()
_sandbox_tool = CalculateTool()


@mcp_server.tool()
async def get_schema(table_names: list[str] | None = None) -> str:
    """Inspect PostgreSQL table schemas, column data types, and sample rows.

    Args:
        table_names: Optional list of table names to inspect (e.g. ['orders', 'products']).
                     If omitted or empty, inspects all tables in the analytics schema.
    """
    result = await _schema_tool.execute(table_names=table_names)
    return json.dumps(result, indent=2, default=str)


@mcp_server.tool()
async def run_sql(query: str) -> str:
    """Execute a read-only SQL query on PostgreSQL with AST guardrails and PII masking.

    Blocks non-SELECT queries (DROP, INSERT, UPDATE, DELETE), multi-statements,
    dangerous functions, and system catalogs. Enforces row limits and detects queries
    touching sensitive PII columns.

    Args:
        query: SQL SELECT query to execute.
    """
    result = await _sql_tool.execute(query=query)
    return json.dumps(result, indent=2, default=str)


@mcp_server.tool()
async def search_glossary(query: str, limit: int = 3) -> str:
    """Search the business metric glossary using local hybrid search (FastEmbed dense vectors + BM25).

    Retrieves approved definitions and SQL formulas for business terms (e.g., GMV, AOV, Delivered Rate).

    Args:
        query: Natural language business term or search string.
        limit: Maximum number of metric definitions to retrieve (default: 3).
    """
    result = await _glossary_tool.execute(query=query, limit=limit)
    return json.dumps(result, indent=2, default=str)


@mcp_server.tool()
async def calculate(code: str) -> str:
    """Safely execute Python calculation code in an isolated local subprocess sandbox.

    Useful for statistical calculations, percentage growths, or formulas outside SQL.
    Network access and dangerous modules (os, sys, subprocess) are strictly blocked.

    Args:
        code: Python code snippet setting a `result` variable.
    """
    result = await _sandbox_tool.execute(code=code)
    return json.dumps(result, indent=2, default=str)


@mcp_server.prompt()
def text_to_sql_prompt(user_question: str) -> str:
    """Standardized prompt template guiding the user or agent through safe Text-to-SQL analysis."""
    return f"""Anda adalah Senior Data Analyst AI Agent untuk database PostgreSQL analitik.
Pertanyaan pengguna: {user_question}

Langkah yang wajib dilakukan:
1. Panggil `search_glossary` jika ada istilah bisnis (GMV, AOV, dsb).
2. Panggil `get_schema` untuk memeriksa tabel dan kolom yang tersedia.
3. Buat dan jalankan query SELECT yang aman melalui `run_sql`.
4. Jika butuh perhitungan rumit, gunakan `calculate`.
5. Sajikan jawaban akhir terstruktur beserta sitasi SQL dan metrik.
"""


def main():
    """CLI entrypoint to run the MCP server over stdio transport."""
    mcp_server.run(transport="stdio")


if __name__ == "__main__":
    main()

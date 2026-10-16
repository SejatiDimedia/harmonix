"""Tool for retrieving business metric definitions and calculation formulas."""

from typing import Any
from pydantic import BaseModel, Field

from src.rag.glossary import hybrid_search_glossary
from src.tools.base import BaseTool


class SearchGlossaryInput(BaseModel):
    """Input parameters for search_glossary tool."""
    query: str = Field(
        ...,
        description="The metric name, business concept, or term to look up (e.g., 'GMV', 'pelanggan aktif', 'AOV', 'delivered rate').",
    )


class SearchGlossaryTool(BaseTool):
    """Tool to search company metric definitions, business formulas, and SQL patterns."""

    name: str = "search_glossary"
    description: str = (
        "Search the company business metric glossary and calculation formula knowledge base. "
        "Call this tool when the user asks about business metrics (such as GMV, Delivered Rate, AOV, Active Customers) "
        "to ensure you use the exact authorized formula and SQL pattern."
    )
    args_schema: type[BaseModel] = SearchGlossaryInput

    async def execute(self, query: str) -> dict[str, Any]:
        """Execute hybrid search on the business metric glossary."""
        results = await hybrid_search_glossary(query_text=query, top_k=2)

        if not results:
            return {
                "status": "not_found",
                "message": f"No matching business metric definition found for query '{query}'.",
                "metrics": [],
            }

        return {
            "status": "success",
            "query": query,
            "metrics": [
                {
                    "metric_name": r.metric_name,
                    "business_definition": r.business_definition,
                    "calculation_formula": r.calculation_formula,
                    "recommended_sql": r.sql_expression,
                    "relevant_tables": r.relevant_tables,
                    "relevance_score": r.rrf_score,
                }
                for r in results
            ],
        }

"""Tool for retrieving business metric definitions and calculation formulas."""

from typing import Any
from pydantic import BaseModel, Field, model_validator

from src.rag.glossary import hybrid_search_glossary
from src.tools.base import BaseTool


class SearchGlossaryInput(BaseModel):
    """Input parameters for search_glossary tool."""
    query: str = Field(
        ...,
        description="The metric name, business concept, or term to look up (e.g., 'GMV', 'pelanggan aktif', 'AOV', 'delivered rate').",
    )

    @model_validator(mode="before")
    @classmethod
    def populate_query_from_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("query"):
                for alias in ("term", "metric_name", "metric"):
                    if data.get(alias):
                        data["query"] = data[alias]
                        break
        return data


class SearchGlossaryTool(BaseTool):
    """Tool to search company metric definitions, business formulas, and SQL patterns."""

    name: str = "search_glossary"
    description: str = (
        "Search the company business metric glossary and calculation formula knowledge base. "
        "Call this tool when the user asks about business metrics (such as GMV, Delivered Rate, AOV, Active Customers) "
        "to ensure you use the exact authorized formula and SQL pattern."
    )
    args_schema: type[BaseModel] = SearchGlossaryInput

    async def execute(
        self,
        query: str | None = None,
        term: str | None = None,
        metric_name: str | None = None,
        limit: int | None = None,
        top_k: int | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute hybrid search on the business metric glossary."""
        actual_query = query or term or metric_name or ""
        actual_k = limit or top_k or 2

        if not actual_query.strip():
            return {
                "status": "error",
                "message": "Missing search query. Please specify 'query', 'term', or 'metric_name'.",
                "metrics": [],
            }

        results = await hybrid_search_glossary(query_text=actual_query, top_k=actual_k)

        if not results:
            return {
                "status": "not_found",
                "message": f"No matching business metric definition found for query '{actual_query}'.",
                "metrics": [],
            }

        return {
            "status": "success",
            "query": actual_query,
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

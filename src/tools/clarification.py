"""Proactive Clarification Tool for ambiguous database columns and business rules (FR-51)."""

from typing import Any, Type
from pydantic import BaseModel, Field
from src.tools.base import BaseTool


class ClarificationArgs(BaseModel):
    question: str = Field(
        ...,
        description="The clarification question for the user (e.g., 'Which date column should be used to calculate sales?')"
    )
    options: list[str] = Field(
        ...,
        description="List of concrete options discovered from the schema or data (e.g. ['order_purchase_timestamp', 'order_delivered_customer_date'])"
    )
    context_key: str = Field(
        ...,
        description="Key name for saving to session context (e.g., 'sales_date_column' or 'orders.fld_st')"
    )
    category: str = Field(
        default="column_mapping",
        description="Category of clarification: 'column_mapping', 'custom_formula', or 'business_rule'"
    )


class RequestClarificationTool(BaseTool):
    """Tool for the agent to proactively request user clarification when encountering ambiguous columns, codes, or metrics."""

    name: str = "request_clarification"
    description: str = (
        "Ask user for clarification when encountering ambiguous columns (e.g. multiple date fields), "
        "unlabeled integer status codes (e.g. fld_st = 9 vs 3), or competing metrics. "
        "DO NOT guess blindly when critical ambiguity exists. Call this tool with concrete options for the user."
    )
    args_schema: Type[BaseModel] = ClarificationArgs

    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        """Return clarification request payload."""
        return {
            "status": "CLARIFICATION_REQUIRED",
            "question": kwargs.get("question", ""),
            "options": kwargs.get("options", []),
            "context_key": kwargs.get("context_key", ""),
            "category": kwargs.get("category", "column_mapping"),
        }

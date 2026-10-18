"""Agent state and structured output data models."""

from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field


class AgentTaskStatus(str, Enum):
    """Explicit state machine states for agent task execution."""
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    RESUMED = "RESUMED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class TableData(BaseModel):
    """Structured tabular data returned by queries."""
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    row_count: int = 0


class ChartSpec(BaseModel):
    """Structured declarative specification for front-end charting (FR-07)."""
    chart_type: Literal["bar", "line", "pie", "scatter", "doughnut"] = "bar"
    title: str
    x_axis: str
    y_axis: str
    data: list[dict[str, Any]] = Field(default_factory=list)


class Citation(BaseModel):
    """Traceable citation pointing to the exact SQL query and metrics used (FR-13)."""
    sql_query: str
    metric_definition: str | None = None
    source_tables: list[str] = Field(default_factory=list)


class AgentStepEvent(BaseModel):
    """Represents a single step in the agent reasoning loop."""
    step_number: int
    thought: str | None = None
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None
    observation: Any | None = None
    requires_approval: bool = False
    approval_id: str | None = None


class AgentFinalResponse(BaseModel):
    """Final structured response produced by the data analyst agent (FR-09)."""
    answer_text: str
    sql_queries: list[str] = Field(default_factory=list)
    tables: list[TableData] = Field(default_factory=list)
    charts: list[ChartSpec] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    follow_up_suggestions: list[str] = Field(
        default_factory=list,
        description="3 concise, highly relevant follow-up exploration questions for the user (FR-34)",
    )
    total_steps: int = 0
    token_usage: dict[str, int] = Field(default_factory=dict)
    metrics: dict[str, Any] | None = None


"""Data models for Observability, Tracing, and Metrics Tracking (OB-01, OB-02)."""

from datetime import datetime
from enum import Enum
from typing import Any
import uuid
from pydantic import BaseModel, Field


class SpanType(str, Enum):
    AGENT = "agent"
    LLM = "llm"
    TOOL = "tool"
    GUARDRAIL = "guardrail"


class SpanStatus(str, Enum):
    SUCCESS = "success"
    ERROR = "error"
    APPROVAL_REQUIRED = "approval_required"


class TraceSpan(BaseModel):
    """Represents a single granular execution step (LLM call, tool call, retrieval)."""
    span_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    trace_id: str
    parent_span_id: str | None = None
    name: str
    span_type: SpanType
    status: SpanStatus = SpanStatus.SUCCESS
    start_time: float
    end_time: float | None = None
    duration_ms: float | None = None
    input_data: dict[str, Any] | None = None
    output_data: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None


class TaskMetrics(BaseModel):
    """Aggregated operational metrics for a completed agent task (OB-02)."""
    task_id: str
    total_latency_ms: float = 0.0
    ttft_ms: float | None = None
    total_tokens: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    estimated_cost_usd: float = 0.00
    step_count: int = 0
    tool_calls_count: int = 0
    tool_errors_count: int = 0
    status: str = "COMPLETED"
    created_at: datetime | None = None


class SystemMetricsSummary(BaseModel):
    """System-level aggregated observability overview and drift detection (OB-03, OB-04)."""
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    success_rate_percentage: float = 0.0
    avg_latency_ms: float = 0.0
    p50_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0
    avg_ttft_ms: float = 0.0
    total_tokens_consumed: int = 0
    total_estimated_cost_usd: float = 0.00
    tool_failure_rate_percentage: float = 0.0
    drift_detected: bool = False
    drift_reasons: list[str] = Field(default_factory=list)

"""Unit and integration tests for Observability, Tracing, and Drift Detection (OB-01 - OB-04)."""

import pytest
import time
import uuid
from src.observability.models import SpanStatus, SpanType
from src.observability.tracer import AgentTracer, init_traces_table
from src.observability.metrics import get_system_metrics_summary


@pytest.mark.asyncio
async def test_agent_tracer_lifecycle_and_metrics():
    """Verify tracer records spans, calculates durations, records TTFT, and flushes to PostgreSQL."""
    await init_traces_table()

    task_id = f"trace_test_{uuid.uuid4().hex[:8]}"
    tracer = AgentTracer(task_id=task_id)

    # 1. Start root span
    root = tracer.start_span(name="agent_task", span_type=SpanType.AGENT, input_data={"query": "test"})
    assert root.trace_id == task_id
    assert root.span_id is not None

    # 2. Start child LLM span
    llm_span = tracer.start_span(name="llm_inference", span_type=SpanType.LLM, parent_span_id=root.span_id)
    time.sleep(0.01)  # tiny delay to verify duration
    tracer.end_span(span_id=llm_span.span_id, output_data={"tokens": 50}, metadata={"model": "mock"})
    assert llm_span.duration_ms is not None
    assert llm_span.duration_ms > 0

    # 3. Record TTFT
    ttft = tracer.record_first_token()
    assert ttft > 0
    # Calling it second time should return identical cached TTFT
    assert tracer.record_first_token() == ttft

    # 4. Tool span with error
    tool_span = tracer.start_span(name="tool:run_sql", span_type=SpanType.TOOL, parent_span_id=root.span_id)
    tracer.end_span(
        span_id=tool_span.span_id,
        status=SpanStatus.ERROR,
        error_message="Test DB connection timeout",
    )
    assert tool_span.status == SpanStatus.ERROR

    # 5. End root span and flush
    tracer.end_span(root.span_id, status=SpanStatus.SUCCESS)
    metrics = await tracer.flush(status="COMPLETED", total_tokens=150, prompt_tokens=100, completion_tokens=50, step_count=2)

    assert metrics.task_id == task_id
    assert metrics.total_tokens == 150
    assert metrics.tool_calls_count == 1
    assert metrics.tool_errors_count == 1
    assert metrics.status == "COMPLETED"
    assert metrics.total_latency_ms > 0


@pytest.mark.asyncio
async def test_system_metrics_aggregation_and_drift_detection():
    """Verify get_system_metrics_summary aggregates traces and detects performance drift."""
    await init_traces_table()

    # Flush 2 dummy traces
    for i in range(2):
        t_id = f"drift_task_{i}_{uuid.uuid4().hex[:6]}"
        tracer = AgentTracer(task_id=t_id)
        tracer.record_first_token()
        await tracer.flush(status="COMPLETED", total_tokens=200, step_count=1)

    summary = await get_system_metrics_summary()
    assert summary.total_requests >= 2
    assert summary.successful_requests >= 2
    assert summary.avg_latency_ms >= 0
    assert summary.total_tokens_consumed >= 400
    assert summary.total_estimated_cost_usd == 0.00
    assert isinstance(summary.drift_detected, bool)

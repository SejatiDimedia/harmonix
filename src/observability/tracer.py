"""Execution tracer with local PostgreSQL persistence and optional Langfuse sync (OB-01, OB-02)."""

import json
import logging
import time
from typing import Any
import httpx
from sqlalchemy import text

from src.config import settings
from src.db.connection import get_db_session
from src.observability.models import SpanStatus, SpanType, TaskMetrics, TraceSpan

logger = logging.getLogger(__name__)


async def init_traces_table() -> None:
    """Ensure analytics.agent_traces exists for storing execution traces and metrics."""
    async with get_db_session() as session:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS analytics.agent_traces (
                id SERIAL PRIMARY KEY,
                task_id VARCHAR(100) NOT NULL,
                total_latency_ms NUMERIC NOT NULL,
                ttft_ms NUMERIC,
                total_tokens INT DEFAULT 0,
                cached_tokens INT DEFAULT 0,
                step_count INT DEFAULT 0,
                tool_calls_count INT DEFAULT 0,
                tool_errors_count INT DEFAULT 0,
                status VARCHAR(30) NOT NULL,
                spans JSONB NOT NULL DEFAULT '[]'::jsonb,
                metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))
        await session.execute(text("""
            ALTER TABLE analytics.agent_traces ADD COLUMN IF NOT EXISTS cached_tokens INT DEFAULT 0;
        """))
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_agent_traces_task_id ON analytics.agent_traces(task_id);
        """))
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_agent_traces_created ON analytics.agent_traces(created_at);
        """))
        await session.commit()


class AgentTracer:
    """Granular execution tracer tracking latency, TTFT, tool calls, and tokens."""

    def __init__(self, task_id: str):
        self.task_id = task_id
        self.start_time = time.perf_counter()
        self.spans: list[TraceSpan] = []
        self._active_spans: dict[str, TraceSpan] = {}
        self.ttft_ms: float | None = None
        self._ttft_recorded = False

    def record_first_token(self) -> float:
        """Record Time To First Token (TTFT) when LLM begins streaming response tokens."""
        if not self._ttft_recorded:
            self.ttft_ms = round((time.perf_counter() - self.start_time) * 1000, 2)
            self._ttft_recorded = True
            logger.debug("Recorded TTFT for %s: %sms", self.task_id, self.ttft_ms)
        return self.ttft_ms or 0.0

    def start_span(
        self,
        name: str,
        span_type: SpanType,
        parent_span_id: str | None = None,
        input_data: dict[str, Any] | None = None,
    ) -> TraceSpan:
        """Start a new execution span (LLM inference, Tool call, or Guardrail check)."""
        span = TraceSpan(
            trace_id=self.task_id,
            parent_span_id=parent_span_id,
            name=name,
            span_type=span_type,
            start_time=time.perf_counter(),
            input_data=input_data,
        )
        self.spans.append(span)
        self._active_spans[span.span_id] = span
        return span

    def end_span(
        self,
        span_id: str,
        output_data: dict[str, Any] | None = None,
        status: SpanStatus = SpanStatus.SUCCESS,
        metadata: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> TraceSpan | None:
        """Mark a span as completed, calculate duration, and record outputs."""
        span = self._active_spans.pop(span_id, None)
        if not span:
            return None

        span.end_time = time.perf_counter()
        span.duration_ms = round((span.end_time - span.start_time) * 1000, 2)
        span.output_data = output_data
        span.status = status
        span.error_message = error_message
        if metadata:
            span.metadata.update(metadata)

        return span

    async def flush(
        self,
        status: str = "COMPLETED",
        total_tokens: int = 0,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        cached_tokens: int = 0,
        step_count: int = 0,
    ) -> TaskMetrics:
        """Finalize trace metrics, persist locally to PostgreSQL, and sync to Langfuse if configured."""
        total_latency_ms = round((time.perf_counter() - self.start_time) * 1000, 2)

        # Count tool metrics
        tool_spans = [s for s in self.spans if s.span_type == SpanType.TOOL]
        tool_calls_count = len(tool_spans)
        tool_errors_count = sum(1 for s in tool_spans if s.status == SpanStatus.ERROR)

        metrics = TaskMetrics(
            task_id=self.task_id,
            total_latency_ms=total_latency_ms,
            ttft_ms=self.ttft_ms,
            total_tokens=total_tokens,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cached_tokens=cached_tokens,
            estimated_cost_usd=0.00,  # 100% Zero-Cost Baseline
            step_count=step_count,
            tool_calls_count=tool_calls_count,
            tool_errors_count=tool_errors_count,
            status=status,
        )

        # 1. Persist locally to PostgreSQL (Zero-Cost and 100% Offline)
        try:
            await init_traces_table()
            spans_json = json.dumps([s.model_dump() for s in self.spans], ensure_ascii=False)
            metrics_json = json.dumps(metrics.model_dump(), ensure_ascii=False)

            async with get_db_session() as session:
                await session.execute(
                    text("""
                        INSERT INTO analytics.agent_traces 
                        (task_id, total_latency_ms, ttft_ms, total_tokens, cached_tokens, step_count, tool_calls_count, tool_errors_count, status, spans, metrics)
                        VALUES (:task_id, :latency, :ttft, :tokens, :cached_tokens, :steps, :tools, :errors, :status, CAST(:spans AS JSONB), CAST(:metrics AS JSONB));
                    """),
                    {
                        "task_id": self.task_id,
                        "latency": total_latency_ms,
                        "ttft": self.ttft_ms,
                        "tokens": total_tokens,
                        "cached_tokens": cached_tokens,
                        "steps": step_count,
                        "tools": tool_calls_count,
                        "errors": tool_errors_count,
                        "status": status,
                        "spans": spans_json,
                        "metrics": metrics_json,
                    },
                )
                await session.commit()
            logger.info("Saved trace for %s in PostgreSQL (%d spans, %sms, %d cached tokens)", self.task_id, len(self.spans), total_latency_ms, cached_tokens)
        except Exception as e:
            logger.warning("Could not persist trace to PostgreSQL: %s", e)

        # 2. Sync to Langfuse if credentials are provided (OB-01)
        if settings.langfuse_public_key and settings.langfuse_secret_key:
            await self._sync_to_langfuse(metrics)

        return metrics

    async def _sync_to_langfuse(self, metrics: TaskMetrics) -> None:
        """Sync trace and spans to Langfuse via Ingestion API (Zero crash if unreachable)."""
        try:
            auth = (settings.langfuse_public_key, settings.langfuse_secret_key)
            host = settings.langfuse_host.rstrip("/")
            endpoint = f"{host}/api/public/ingestion"

            events = [
                {
                    "type": "trace-create",
                    "body": {
                        "id": self.task_id,
                        "name": "harmonix_agent_task",
                        "metadata": metrics.model_dump(),
                    },
                }
            ]

            for span in self.spans:
                events.append({
                    "type": "span-create",
                    "body": {
                        "id": span.span_id,
                        "traceId": self.task_id,
                        "name": span.name,
                        "startTime": span.start_time,
                        "endTime": span.end_time,
                        "input": span.input_data,
                        "output": span.output_data,
                        "statusMessage": span.error_message,
                    },
                })

            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.post(endpoint, json={"batch": events}, auth=auth)
                if resp.status_code in (200, 201):
                    logger.info("Successfully synced trace %s to Langfuse", self.task_id)
                else:
                    logger.warning("Langfuse sync returned status %s: %s", resp.status_code, resp.text)
        except Exception as e:
            logger.warning("Langfuse sync skipped or failed (offline safe): %s", e)

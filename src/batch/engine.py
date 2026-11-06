"""Batch Processing Engine for High-Volume Offline Analytics (FR-42, Pilar 6.4).

Provides enterprise asynchronous bulk execution for 10-1000+ analytical questions:
1. Non-blocking asynchronous submission with unique batch_id.
2. Concurrent worker processing with asyncio semaphore to avoid upstream rate limits.
3. Checkpoint tracking and progress reporting (total, completed, failed).
4. Dual export options: newline-delimited JSON (JSONL) and RFC 4180 CSV.
5. In-memory and PostgreSQL state persistence.
"""

import asyncio
import csv
import io
import json
import logging
import time
import uuid
from typing import Any, Literal
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.agent.manual_loop import ManualAgentLoop
from src.agent.models import AgentFinalResponse
from src.db.connection import get_db_session

logger = logging.getLogger(__name__)


# ==============================================================================
# Models
# ==============================================================================

class BatchQueryItem(BaseModel):
    """Single query request item within a batch."""
    query_id: str
    query: str
    status: Literal["pending", "processing", "completed", "failed"] = "pending"
    answer_text: str | None = None
    sql_queries: list[str] = Field(default_factory=list)
    tables: list[dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    error: str | None = None
    duration_ms: float = 0.0


class BatchJobRecord(BaseModel):
    """Overall status and results tracking for a batch execution job."""
    batch_id: str
    status: Literal["pending", "processing", "completed", "failed"] = "pending"
    total_queries: int = 0
    completed_queries: int = 0
    failed_queries: int = 0
    engine: str = "manual"
    provider: str | None = None
    model: str | None = None
    session_id: str | None = None
    items: list[BatchQueryItem] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    completed_at: float | None = None
    total_duration_sec: float = 0.0


class CreateBatchRequest(BaseModel):
    """Payload for submitting a new analytical batch job."""
    queries: list[str] = Field(..., min_length=1, max_length=500, description="List of natural language analytics questions")
    engine: Literal["manual", "langgraph", "swarm"] = Field(default="manual", description="Execution engine to use for queries")
    concurrency_limit: int = Field(default=3, ge=1, le=10, description="Max concurrent query executions")
    provider: str | None = Field(default=None, description="Optional LLM provider override")
    model: str | None = Field(default=None, description="Optional model ID override")
    session_id: str | None = Field(default=None, description="Active session ID for uploaded file context")


# ==============================================================================
# Batch Processing Engine
# ==============================================================================

class BatchProcessingEngine:
    """Manages lifecycle, execution, and result aggregation for batch analytics."""

    _jobs: dict[str, BatchJobRecord] = {}

    @classmethod
    async def create_batch(
        cls,
        queries: list[str],
        engine: str = "manual",
        concurrency_limit: int = 3,
        provider: str | None = None,
        model: str | None = None,
        session_id: str | None = None,
    ) -> BatchJobRecord:
        """Create and queue a batch analytics job."""
        batch_id = f"batch_{uuid.uuid4().hex[:10]}"
        items = [
            BatchQueryItem(query_id=f"q_{idx+1}", query=q.strip())
            for idx, q in enumerate(queries)
            if q.strip()
        ]

        record = BatchJobRecord(
            batch_id=batch_id,
            status="pending",
            total_queries=len(items),
            completed_queries=0,
            failed_queries=0,
            engine=engine,
            provider=provider,
            model=model,
            session_id=session_id,
            items=items,
            created_at=time.time(),
        )
        cls._jobs[batch_id] = record

        # Persist to database if available
        try:
            await cls._save_to_db(record)
        except Exception as e:
            logger.debug("Database batch save skipped: %s", e)

        # Launch background processing worker
        asyncio.create_task(cls._process_batch(batch_id, concurrency_limit))
        return record

    @classmethod
    def get_batch(cls, batch_id: str) -> BatchJobRecord | None:
        """Retrieve batch job record by ID."""
        return cls._jobs.get(batch_id)

    @classmethod
    async def get_batch_async(cls, batch_id: str) -> BatchJobRecord | None:
        """Retrieve batch job record by ID, checking memory first then database."""
        if batch_id in cls._jobs:
            return cls._jobs[batch_id]

        try:
            async with get_db_session() as session:
                res = await session.execute(
                    text("SELECT payload FROM analytics.batch_jobs WHERE batch_id = :bid"),
                    {"bid": batch_id},
                )
                row = res.fetchone()
                if row and row[0]:
                    payload_data = row[0]
                    if isinstance(payload_data, str):
                        payload_data = json.loads(payload_data)
                    record = BatchJobRecord(**payload_data)
                    cls._jobs[batch_id] = record
                    return record
        except Exception as e:
            logger.debug("Database get_batch failed: %s", e)

        return None

    @classmethod
    def list_batches(cls) -> list[BatchJobRecord]:
        """List all active and completed batch jobs."""
        return sorted(cls._jobs.values(), key=lambda j: j.created_at, reverse=True)

    @classmethod
    async def list_batches_async(cls) -> list[BatchJobRecord]:
        """List all active and completed batch jobs, hydrating from database."""
        try:
            async with get_db_session() as session:
                res = await session.execute(
                    text("SELECT payload FROM analytics.batch_jobs ORDER BY created_at DESC LIMIT 100")
                )
                rows = res.fetchall()
                for row in rows:
                    if row and row[0]:
                        payload_data = row[0]
                        if isinstance(payload_data, str):
                            payload_data = json.loads(payload_data)
                        bid = payload_data.get("batch_id")
                        if bid and bid not in cls._jobs:
                            cls._jobs[bid] = BatchJobRecord(**payload_data)
        except Exception as e:
            logger.debug("Database list_batches failed: %s", e)

        return sorted(cls._jobs.values(), key=lambda j: j.created_at, reverse=True)

    @classmethod
    async def _process_batch(cls, batch_id: str, concurrency_limit: int) -> None:
        """Asynchronously processes each query in the batch with bounded concurrency."""
        record = cls._jobs.get(batch_id)
        if not record:
            return

        record.status = "processing"
        start_time = time.perf_counter()
        semaphore = asyncio.Semaphore(concurrency_limit)

        async def _run_single_query(item: BatchQueryItem) -> None:
            async with semaphore:
                item.status = "processing"
                t0 = time.perf_counter()
                try:
                    from src.llm.registry import ModelRegistry
                    from src.agent.auditor import DataAuditorAgent

                    registry = ModelRegistry.get_instance()
                    analyst_llm = registry.create_analyst_llm(
                        override_provider=record.provider,
                        override_model=record.model,
                    )
                    auditor_llm = registry.create_auditor_llm()
                    auditor = DataAuditorAgent(llm=auditor_llm)

                    if record.engine == "swarm":
                        from src.agent.planner_executor import PlannerExecutorAgent
                        agent = PlannerExecutorAgent(llm=analyst_llm, auditor=auditor)
                    elif record.engine == "langgraph":
                        from src.agent.langgraph_agent import LangGraphAgent
                        agent = LangGraphAgent(llm=analyst_llm, auditor=auditor)
                    else:
                        agent = ManualAgentLoop(llm=analyst_llm, auditor=auditor)

                    resp_data: dict[str, Any] = {}
                    error_msg: str | None = None

                    async for event in agent.run_stream(
                        user_query=item.query,
                        task_id=f"{batch_id}_{item.query_id}",
                        session_id=record.session_id,
                        is_approved=True,
                    ):
                        ev = event.get("event")
                        if ev == "final_result":
                            resp_data = event.get("data") or {}
                        elif ev == "error":
                            err_payload = event.get("data") or {}
                            error_msg = err_payload.get("message") or str(err_payload)

                    ans_text = (resp_data.get("answer_text") or "").strip()
                    sql_list = resp_data.get("sql_queries", [])
                    tbl_list = resp_data.get("tables", [])

                    if ans_text:
                        item.status = "completed"
                        item.answer_text = ans_text
                        item.sql_queries = sql_list
                        item.tables = tbl_list
                        if tbl_list:
                            item.row_count = sum(t.get("row_count", 0) for t in tbl_list)
                        record.completed_queries += 1
                    elif sql_list or tbl_list:
                        item.status = "completed"
                        item.answer_text = "Analisis query SQL selesai diproses dan data berhasil diperoleh."
                        item.sql_queries = sql_list
                        item.tables = tbl_list
                        record.completed_queries += 1
                    else:
                        item.status = "failed"
                        item.error = error_msg or "Model tidak mengeksekusi SQL maupun mengembalikan jawaban analisis."
                        record.failed_queries += 1

                except Exception as e:
                    logger.error("Batch query item execution failed: %s", e)
                    item.status = "failed"
                    item.error = str(e)
                    record.failed_queries += 1
                finally:
                    item.duration_ms = round((time.perf_counter() - t0) * 1000, 1)

        # Run all items concurrently bounded by semaphore
        await asyncio.gather(*[_run_single_query(item) for item in record.items])

        if record.failed_queries == 0:
            record.status = "completed"
        elif record.completed_queries > 0:
            record.status = "completed"
        else:
            record.status = "failed"
        record.completed_at = time.time()
        record.total_duration_sec = round(time.perf_counter() - start_time, 2)

        try:
            await cls._save_to_db(record)
        except Exception as e:
            logger.debug("Database batch completion save skipped: %s", e)

        logger.info(
            "Batch %s finished in %.2fs: %d completed, %d failed.",
            batch_id, record.total_duration_sec, record.completed_queries, record.failed_queries
        )

    @classmethod
    def export_jsonl(cls, batch_id: str) -> str:
        """Export completed batch items as Newline Delimited JSON (JSONL)."""
        record = cls.get_batch(batch_id)
        if not record:
            return ""

        lines = []
        for item in record.items:
            lines.append(json.dumps(item.model_dump(), ensure_ascii=False))
        return "\n".join(lines)

    @classmethod
    def export_csv(cls, batch_id: str) -> str:
        """Export completed batch items as CSV formatted per RFC 4180."""
        record = cls.get_batch(batch_id)
        if not record:
            return ""

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(["Query ID", "Question", "Status", "Answer", "Executed SQL", "Rows Returned", "Duration (ms)", "Error"])

        for item in record.items:
            sqls = " ; ".join(item.sql_queries) if item.sql_queries else ""
            ans = (item.answer_text or "").replace("\n", " ")
            writer.writerow([
                item.query_id,
                item.query,
                item.status,
                ans,
                sqls,
                item.row_count,
                item.duration_ms,
                item.error or "",
            ])
        return output.getvalue()

    @classmethod
    async def _save_to_db(cls, record: BatchJobRecord) -> None:
        """Persist batch job state to analytics.batch_jobs if database is reachable."""
        async with get_db_session() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS analytics.batch_jobs (
                    batch_id VARCHAR(100) PRIMARY KEY,
                    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                    total_queries INT NOT NULL DEFAULT 0,
                    completed_queries INT NOT NULL DEFAULT 0,
                    failed_queries INT NOT NULL DEFAULT 0,
                    engine VARCHAR(50) NOT NULL DEFAULT 'manual',
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP
                );
            """))

            payload_json = json.dumps(record.model_dump(), ensure_ascii=False)
            await session.execute(
                text("""
                    INSERT INTO analytics.batch_jobs 
                    (batch_id, status, total_queries, completed_queries, failed_queries, engine, payload, created_at)
                    VALUES (:bid, :status, :total, :completed, :failed, :engine, CAST(:payload AS JSONB), CURRENT_TIMESTAMP)
                    ON CONFLICT (batch_id) DO UPDATE SET
                        status = EXCLUDED.status,
                        completed_queries = EXCLUDED.completed_queries,
                        failed_queries = EXCLUDED.failed_queries,
                        payload = EXCLUDED.payload,
                        completed_at = CASE WHEN EXCLUDED.status IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE NULL END;
                """),
                {
                    "bid": record.batch_id,
                    "status": record.status,
                    "total": record.total_queries,
                    "completed": record.completed_queries,
                    "failed": record.failed_queries,
                    "engine": record.engine,
                    "payload": payload_json,
                },
            )
            await session.commit()

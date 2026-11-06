"""PostgreSQL Task Queue implementation using FOR UPDATE SKIP LOCKED (FR-43, Pilar 6.3)."""

import json
import logging
import time
import uuid
from typing import Any
from sqlalchemy import text

from src.db.connection import get_db_session
from src.queue.base import BaseTaskQueue
from src.queue.memory_queue import MemoryTaskQueue
from src.queue.models import (
    JobPriority,
    QueueJob,
    QueueJobState,
    QueueStats,
    WorkerHeartbeat,
)

logger = logging.getLogger(__name__)


class PostgresTaskQueue(BaseTaskQueue):
    """High-concurrency, zero-cost PostgreSQL queue using row-level locking."""

    def __init__(self, retry_backoff_base: float = 2.0):
        self._retry_backoff_base = retry_backoff_base
        self._fallback = MemoryTaskQueue(retry_backoff_base=retry_backoff_base)
        self._db_initialized = False

    async def _ensure_schema(self) -> None:
        """Create necessary queue tables and indices if not already present."""
        if self._db_initialized:
            return

        async with get_db_session() as session:
            await session.execute(text("""
                CREATE SCHEMA IF NOT EXISTS analytics;

                CREATE TABLE IF NOT EXISTS analytics.task_queue_jobs (
                    job_id VARCHAR(100) PRIMARY KEY,
                    job_type VARCHAR(100) NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    priority INT NOT NULL DEFAULT 5,
                    status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
                    attempts INT NOT NULL DEFAULT 0,
                    max_retries INT NOT NULL DEFAULT 3,
                    last_error TEXT,
                    result JSONB,
                    worker_id VARCHAR(100),
                    next_run_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    started_at TIMESTAMP WITH TIME ZONE,
                    completed_at TIMESTAMP WITH TIME ZONE,
                    duration_ms DOUBLE PRECISION DEFAULT 0.0
                );

                CREATE INDEX IF NOT EXISTS idx_task_queue_dispatch 
                ON analytics.task_queue_jobs (status, next_run_at, priority DESC, created_at ASC);

                CREATE TABLE IF NOT EXISTS analytics.queue_worker_heartbeats (
                    worker_id VARCHAR(100) PRIMARY KEY,
                    status VARCHAR(30) NOT NULL DEFAULT 'active',
                    concurrency INT NOT NULL DEFAULT 4,
                    active_jobs INT NOT NULL DEFAULT 0,
                    jobs_completed INT NOT NULL DEFAULT 0,
                    jobs_failed INT NOT NULL DEFAULT 0,
                    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    last_heartbeat_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """))
            await session.commit()
            self._db_initialized = True

    async def enqueue(
        self,
        job_type: str,
        payload: dict[str, Any],
        priority: int = JobPriority.NORMAL.value,
        max_retries: int = 3,
        delay_seconds: float = 0.0,
    ) -> QueueJob:
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        now = time.time()
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                payload_json = json.dumps(payload, ensure_ascii=False)
                await session.execute(
                    text("""
                        INSERT INTO analytics.task_queue_jobs
                        (job_id, job_type, payload, priority, status, attempts, max_retries, next_run_at, created_at)
                        VALUES (
                            :job_id, :job_type, CAST(:payload AS JSONB), :priority, 'QUEUED', 0, :max_retries,
                            CURRENT_TIMESTAMP + (:delay || ' seconds')::INTERVAL, CURRENT_TIMESTAMP
                        );
                    """),
                    {
                        "job_id": job_id,
                        "job_type": job_type,
                        "payload": payload_json,
                        "priority": priority,
                        "max_retries": max_retries,
                        "delay": delay_seconds,
                    },
                )
                await session.commit()

            return QueueJob(
                job_id=job_id,
                job_type=job_type,
                payload=payload,
                priority=priority,
                status=QueueJobState.QUEUED,
                attempts=0,
                max_retries=max_retries,
                next_run_at=now + delay_seconds,
                created_at=now,
            )
        except Exception as e:
            logger.warning("Postgres enqueue fallback to memory: %s", e)
            return await self._fallback.enqueue(
                job_type=job_type,
                payload=payload,
                priority=priority,
                max_retries=max_retries,
                delay_seconds=delay_seconds,
            )

    async def dequeue(self, worker_id: str) -> QueueJob | None:
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                result = await session.execute(
                    text("""
                        WITH candidate AS (
                            SELECT job_id
                            FROM analytics.task_queue_jobs
                            WHERE status IN ('QUEUED', 'RETRYING')
                              AND next_run_at <= CURRENT_TIMESTAMP
                            ORDER BY priority DESC, created_at ASC
                            LIMIT 1
                            FOR UPDATE SKIP LOCKED
                        )
                        UPDATE analytics.task_queue_jobs j
                        SET status = 'PROCESSING',
                            worker_id = :worker_id,
                            attempts = j.attempts + 1,
                            started_at = CURRENT_TIMESTAMP
                        FROM candidate
                        WHERE j.job_id = candidate.job_id
                        RETURNING j.job_id, j.job_type, j.payload, j.priority, j.status,
                                  j.attempts, j.max_retries, j.worker_id,
                                  EXTRACT(EPOCH FROM j.created_at) AS created_at,
                                  EXTRACT(EPOCH FROM j.started_at) AS started_at;
                    """),
                    {"worker_id": worker_id},
                )
                row = result.fetchone()
                await session.commit()

                if not row:
                    return None

                payload_data = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
                return QueueJob(
                    job_id=row[0],
                    job_type=row[1],
                    payload=payload_data,
                    priority=row[3],
                    status=QueueJobState(row[4]),
                    attempts=row[5],
                    max_retries=row[6],
                    worker_id=row[7],
                    created_at=float(row[8] or time.time()),
                    started_at=float(row[9] or time.time()),
                )
        except Exception as e:
            logger.debug("Postgres dequeue fallback: %s", e)
            return await self._fallback.dequeue(worker_id)

    async def complete(self, job_id: str, result: dict[str, Any] | None = None) -> QueueJob | None:
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                res_json = json.dumps(result or {}, ensure_ascii=False)
                res = await session.execute(
                    text("""
                        UPDATE analytics.task_queue_jobs
                        SET status = 'COMPLETED',
                            result = CAST(:res AS JSONB),
                            completed_at = CURRENT_TIMESTAMP,
                            duration_ms = ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000, 1)
                        WHERE job_id = :job_id
                        RETURNING job_id, job_type, payload, priority, status, attempts, max_retries,
                                  worker_id, duration_ms,
                                  EXTRACT(EPOCH FROM created_at) AS created_at,
                                  EXTRACT(EPOCH FROM started_at) AS started_at,
                                  EXTRACT(EPOCH FROM completed_at) AS completed_at;
                    """),
                    {"job_id": job_id, "res": res_json},
                )
                row = res.fetchone()
                await session.commit()
                if row:
                    payload_data = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
                    return QueueJob(
                        job_id=row[0],
                        job_type=row[1],
                        payload=payload_data,
                        priority=row[3],
                        status=QueueJobState.COMPLETED,
                        attempts=row[5],
                        max_retries=row[6],
                        worker_id=row[7],
                        duration_ms=float(row[8] or 0.0),
                        created_at=float(row[9] or time.time()),
                        started_at=float(row[10] or time.time()),
                        completed_at=float(row[11] or time.time()),
                        result=result or {},
                    )
        except Exception as e:
            logger.debug("Postgres complete fallback: %s", e)
        return await self._fallback.complete(job_id, result)

    async def fail(
        self,
        job_id: str,
        error: str,
        retry_delay_seconds: float | None = None,
    ) -> QueueJob | None:
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                # Check current attempts vs max_retries
                fetch = await session.execute(
                    text("SELECT attempts, max_retries FROM analytics.task_queue_jobs WHERE job_id = :job_id"),
                    {"job_id": job_id},
                )
                r = fetch.fetchone()
                if not r:
                    return await self._fallback.fail(job_id, error, retry_delay_seconds)

                attempts, max_retries = r[0], r[1]
                if attempts < max_retries:
                    backoff = (
                        retry_delay_seconds
                        if retry_delay_seconds is not None
                        else self._retry_backoff_base * (2 ** max(0, attempts - 1))
                    )
                    next_status = "RETRYING"
                    delay_val = backoff
                else:
                    next_status = "DEAD_LETTER"
                    delay_val = 0.0

                update_res = await session.execute(
                    text("""
                        UPDATE analytics.task_queue_jobs
                        SET status = :next_status,
                            last_error = :err,
                            next_run_at = CURRENT_TIMESTAMP + (:delay || ' seconds')::INTERVAL,
                            completed_at = CASE WHEN :next_status = 'DEAD_LETTER' THEN CURRENT_TIMESTAMP ELSE NULL END,
                            duration_ms = ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000, 1)
                        WHERE job_id = :job_id
                        RETURNING job_id, job_type, payload, priority, status, attempts, max_retries,
                                  worker_id, duration_ms,
                                  EXTRACT(EPOCH FROM created_at) AS created_at;
                    """),
                    {
                        "job_id": job_id,
                        "next_status": next_status,
                        "err": error,
                        "delay": delay_val,
                    },
                )
                row = update_res.fetchone()
                await session.commit()
                if row:
                    payload_data = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
                    return QueueJob(
                        job_id=row[0],
                        job_type=row[1],
                        payload=payload_data,
                        priority=row[3],
                        status=QueueJobState(row[4]),
                        attempts=row[5],
                        max_retries=row[6],
                        worker_id=row[7],
                        duration_ms=float(row[8] or 0.0),
                        created_at=float(row[9] or time.time()),
                        last_error=error,
                    )
        except Exception as e:
            logger.debug("Postgres fail fallback: %s", e)
        return await self._fallback.fail(job_id, error, retry_delay_seconds)

    async def get_job(self, job_id: str) -> QueueJob | None:
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                res = await session.execute(
                    text("""
                        SELECT job_id, job_type, payload, priority, status, attempts, max_retries,
                               last_error, result, worker_id, duration_ms,
                               EXTRACT(EPOCH FROM created_at) AS created_at,
                               EXTRACT(EPOCH FROM started_at) AS started_at,
                               EXTRACT(EPOCH FROM completed_at) AS completed_at,
                               EXTRACT(EPOCH FROM next_run_at) AS next_run_at
                        FROM analytics.task_queue_jobs
                        WHERE job_id = :job_id
                    """),
                    {"job_id": job_id},
                )
                row = res.fetchone()
                if row:
                    payload_data = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
                    res_data = row[8] if isinstance(row[8], dict) else (json.loads(row[8]) if row[8] else None)
                    return QueueJob(
                        job_id=row[0],
                        job_type=row[1],
                        payload=payload_data,
                        priority=row[3],
                        status=QueueJobState(row[4]),
                        attempts=row[5],
                        max_retries=row[6],
                        last_error=row[7],
                        result=res_data,
                        worker_id=row[9],
                        duration_ms=float(row[10] or 0.0),
                        created_at=float(row[11] or time.time()),
                        started_at=float(row[12]) if row[12] else None,
                        completed_at=float(row[13]) if row[13] else None,
                        next_run_at=float(row[14] or time.time()),
                    )
        except Exception as e:
            logger.debug("Postgres get_job fallback: %s", e)
        return await self._fallback.get_job(job_id)

    async def list_jobs(
        self,
        status: QueueJobState | None = None,
        limit: int = 50,
    ) -> list[QueueJob]:
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                query_str = """
                    SELECT job_id, job_type, payload, priority, status, attempts, max_retries,
                           last_error, result, worker_id, duration_ms,
                           EXTRACT(EPOCH FROM created_at) AS created_at,
                           EXTRACT(EPOCH FROM started_at) AS started_at,
                           EXTRACT(EPOCH FROM completed_at) AS completed_at,
                           EXTRACT(EPOCH FROM next_run_at) AS next_run_at
                    FROM analytics.task_queue_jobs
                """
                params: dict[str, Any] = {"limit": limit}
                if status:
                    query_str += " WHERE status = :status"
                    params["status"] = status.value
                query_str += " ORDER BY created_at DESC LIMIT :limit"

                res = await session.execute(text(query_str), params)
                jobs = []
                for row in res.fetchall():
                    payload_data = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
                    res_data = row[8] if isinstance(row[8], dict) else (json.loads(row[8]) if row[8] else None)
                    jobs.append(QueueJob(
                        job_id=row[0],
                        job_type=row[1],
                        payload=payload_data,
                        priority=row[3],
                        status=QueueJobState(row[4]),
                        attempts=row[5],
                        max_retries=row[6],
                        last_error=row[7],
                        result=res_data,
                        worker_id=row[9],
                        duration_ms=float(row[10] or 0.0),
                        created_at=float(row[11] or time.time()),
                        started_at=float(row[12]) if row[12] else None,
                        completed_at=float(row[13]) if row[13] else None,
                        next_run_at=float(row[14] or time.time()),
                    ))
                if jobs:
                    return jobs
        except Exception as e:
            logger.debug("Postgres list_jobs fallback: %s", e)
        return await self._fallback.list_jobs(status, limit)

    async def retry_job(self, job_id: str) -> QueueJob | None:
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                res = await session.execute(
                    text("""
                        UPDATE analytics.task_queue_jobs
                        SET status = 'QUEUED',
                            next_run_at = CURRENT_TIMESTAMP,
                            last_error = NULL
                        WHERE job_id = :job_id AND status IN ('FAILED', 'DEAD_LETTER')
                        RETURNING job_id;
                    """),
                    {"job_id": job_id},
                )
                row = res.fetchone()
                await session.commit()
                if row:
                    return await self.get_job(job_id)
        except Exception as e:
            logger.debug("Postgres retry_job fallback: %s", e)
        return await self._fallback.retry_job(job_id)

    async def heartbeat(
        self,
        worker_id: str,
        concurrency: int = 4,
        active_jobs: int = 0,
        jobs_completed: int = 0,
        jobs_failed: int = 0,
    ) -> None:
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                await session.execute(
                    text("""
                        INSERT INTO analytics.queue_worker_heartbeats
                        (worker_id, status, concurrency, active_jobs, jobs_completed, jobs_failed, started_at, last_heartbeat_at)
                        VALUES (:wid, 'active', :conc, :active, :completed, :failed, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (worker_id) DO UPDATE SET
                            active_jobs = EXCLUDED.active_jobs,
                            jobs_completed = EXCLUDED.jobs_completed,
                            jobs_failed = EXCLUDED.jobs_failed,
                            last_heartbeat_at = CURRENT_TIMESTAMP;
                    """),
                    {
                        "wid": worker_id,
                        "conc": concurrency,
                        "active": active_jobs,
                        "completed": jobs_completed,
                        "failed": jobs_failed,
                    },
                )
                await session.commit()
        except Exception as e:
            logger.debug("Postgres heartbeat fallback: %s", e)
            await self._fallback.heartbeat(worker_id, concurrency, active_jobs, jobs_completed, jobs_failed)

    async def get_stats(self) -> QueueStats:
        try:
            await self._ensure_schema()
            async with get_db_session() as session:
                counts_res = await session.execute(text("""
                    SELECT status, COUNT(*)
                    FROM analytics.task_queue_jobs
                    GROUP BY status;
                """))
                counts = dict(counts_res.fetchall())

                # Active workers within last 30 seconds
                workers_res = await session.execute(text("""
                    SELECT worker_id, status, concurrency, active_jobs, jobs_completed, jobs_failed,
                           EXTRACT(EPOCH FROM started_at) AS started_at,
                           EXTRACT(EPOCH FROM last_heartbeat_at) AS last_heartbeat_at
                    FROM analytics.queue_worker_heartbeats
                    WHERE last_heartbeat_at >= CURRENT_TIMESTAMP - INTERVAL '30 seconds';
                """))
                workers = [
                    WorkerHeartbeat(
                        worker_id=w[0],
                        status=w[1],
                        concurrency=w[2],
                        active_jobs=w[3],
                        jobs_completed=w[4],
                        jobs_failed=w[5],
                        started_at=float(w[6] or time.time()),
                        last_heartbeat_at=float(w[7] or time.time()),
                    )
                    for w in workers_res.fetchall()
                ]

                total = sum(counts.values())
                return QueueStats(
                    backend="postgres",
                    total_jobs=total,
                    queued=counts.get("QUEUED", 0),
                    processing=counts.get("PROCESSING", 0),
                    completed=counts.get("COMPLETED", 0),
                    failed=counts.get("FAILED", 0),
                    retrying=counts.get("RETRYING", 0),
                    dead_letter=counts.get("DEAD_LETTER", 0),
                    active_workers=len(workers),
                    workers=workers,
                )
        except Exception as e:
            logger.debug("Postgres get_stats fallback: %s", e)
            return await self._fallback.get_stats()

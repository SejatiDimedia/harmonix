"""Redis Task Queue implementation for horizontal clustering (FR-43, Pilar 6.3)."""

import json
import logging
import time
import uuid
from typing import Any

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


class RedisTaskQueue(BaseTaskQueue):
    """Distributed Redis task queue with priority score sets and in-memory fallback."""

    def __init__(self, redis_url: str = "redis://localhost:6379/0", retry_backoff_base: float = 2.0):
        self._redis_url = redis_url
        self._retry_backoff_base = retry_backoff_base
        self._fallback = MemoryTaskQueue(retry_backoff_base=retry_backoff_base)
        self._client: Any = None
        self._is_connected = False

    async def _get_client(self) -> Any:
        if self._client is None and not self._is_connected:
            try:
                import redis.asyncio as aioredis
                client = aioredis.from_url(self._redis_url, decode_responses=True)
                await client.ping()
                self._client = client
                self._is_connected = True
                logger.info("Connected to Redis task queue at %s", self._redis_url)
            except Exception as e:
                logger.debug("Redis unavailable (%s), operating on memory queue fallback", e)
                self._is_connected = False
        return self._client if self._is_connected else None

    async def enqueue(
        self,
        job_type: str,
        payload: dict[str, Any],
        priority: int = JobPriority.NORMAL.value,
        max_retries: int = 3,
        delay_seconds: float = 0.0,
    ) -> QueueJob:
        client = await self._get_client()
        if not client:
            return await self._fallback.enqueue(job_type, payload, priority, max_retries, delay_seconds)

        job_id = f"job_{uuid.uuid4().hex[:12]}"
        now = time.time()
        job = QueueJob(
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

        try:
            # Store job hash
            await client.hset(f"task:{job_id}", mapping={"data": json.dumps(job.model_dump())})
            # Add to priority sorted set with score: priority * 1e10 - (now + delay)
            score = (priority * 1_000_000_000) - (now + delay_seconds)
            await client.zadd("task_queue:pending", {job_id: score})
            return job
        except Exception as e:
            logger.warning("Redis enqueue failed (%s), falling back to memory queue", e)
            return await self._fallback.enqueue(job_type, payload, priority, max_retries, delay_seconds)

    async def dequeue(self, worker_id: str) -> QueueJob | None:
        client = await self._get_client()
        if not client:
            return await self._fallback.dequeue(worker_id)

        try:
            # Pop highest score from sorted set
            items = await client.zpopmax("task_queue:pending", count=1)
            if not items:
                return None
            job_id, _ = items[0]
            raw = await client.hget(f"task:{job_id}", "data")
            if not raw:
                return None

            job_dict = json.loads(raw)
            job = QueueJob(**job_dict)
            job.status = QueueJobState.PROCESSING
            job.worker_id = worker_id
            job.attempts += 1
            job.started_at = time.time()

            await client.hset(f"task:{job_id}", mapping={"data": json.dumps(job.model_dump())})
            await client.sadd("task_queue:processing", job_id)
            return job
        except Exception as e:
            logger.debug("Redis dequeue error (%s), using fallback", e)
            return await self._fallback.dequeue(worker_id)

    async def complete(self, job_id: str, result: dict[str, Any] | None = None) -> QueueJob | None:
        client = await self._get_client()
        if not client:
            return await self._fallback.complete(job_id, result)

        try:
            raw = await client.hget(f"task:{job_id}", "data")
            if not raw:
                return await self._fallback.complete(job_id, result)

            job = QueueJob(**json.loads(raw))
            now = time.time()
            job.status = QueueJobState.COMPLETED
            job.result = result or {}
            job.completed_at = now
            if job.started_at:
                job.duration_ms = round((now - job.started_at) * 1000, 1)

            await client.hset(f"task:{job_id}", mapping={"data": json.dumps(job.model_dump())})
            await client.srem("task_queue:processing", job_id)
            await client.sadd("task_queue:completed", job_id)
            return job
        except Exception as e:
            logger.debug("Redis complete fallback (%s)", e)
            return await self._fallback.complete(job_id, result)

    async def fail(
        self,
        job_id: str,
        error: str,
        retry_delay_seconds: float | None = None,
    ) -> QueueJob | None:
        client = await self._get_client()
        if not client:
            return await self._fallback.fail(job_id, error, retry_delay_seconds)

        try:
            raw = await client.hget(f"task:{job_id}", "data")
            if not raw:
                return await self._fallback.fail(job_id, error, retry_delay_seconds)

            job = QueueJob(**json.loads(raw))
            now = time.time()
            job.last_error = error
            if job.started_at:
                job.duration_ms = round((now - job.started_at) * 1000, 1)

            await client.srem("task_queue:processing", job_id)

            if job.attempts < job.max_retries:
                backoff = (
                    retry_delay_seconds
                    if retry_delay_seconds is not None
                    else self._retry_backoff_base * (2 ** max(0, job.attempts - 1))
                )
                job.status = QueueJobState.RETRYING
                job.next_run_at = now + backoff
                await client.hset(f"task:{job_id}", mapping={"data": json.dumps(job.model_dump())})
                score = (job.priority * 1_000_000_000) - job.next_run_at
                await client.zadd("task_queue:pending", {job_id: score})
            else:
                job.status = QueueJobState.DEAD_LETTER
                job.completed_at = now
                await client.hset(f"task:{job_id}", mapping={"data": json.dumps(job.model_dump())})
                await client.sadd("task_queue:dead_letter", job_id)

            return job
        except Exception as e:
            logger.debug("Redis fail fallback (%s)", e)
            return await self._fallback.fail(job_id, error, retry_delay_seconds)

    async def get_job(self, job_id: str) -> QueueJob | None:
        client = await self._get_client()
        if not client:
            return await self._fallback.get_job(job_id)

        try:
            raw = await client.hget(f"task:{job_id}", "data")
            if raw:
                return QueueJob(**json.loads(raw))
        except Exception:
            pass
        return await self._fallback.get_job(job_id)

    async def list_jobs(
        self,
        status: QueueJobState | None = None,
        limit: int = 50,
    ) -> list[QueueJob]:
        return await self._fallback.list_jobs(status, limit)

    async def retry_job(self, job_id: str) -> QueueJob | None:
        return await self._fallback.retry_job(job_id)

    async def heartbeat(
        self,
        worker_id: str,
        concurrency: int = 4,
        active_jobs: int = 0,
        jobs_completed: int = 0,
        jobs_failed: int = 0,
    ) -> None:
        await self._fallback.heartbeat(worker_id, concurrency, active_jobs, jobs_completed, jobs_failed)

    async def get_stats(self) -> QueueStats:
        client = await self._get_client()
        if not client:
            return await self._fallback.get_stats()
        try:
            pending = await client.zcard("task_queue:pending")
            processing = await client.scard("task_queue:processing")
            completed = await client.scard("task_queue:completed")
            dead_letter = await client.scard("task_queue:dead_letter")
            return QueueStats(
                backend="redis",
                total_jobs=pending + processing + completed + dead_letter,
                queued=pending,
                processing=processing,
                completed=completed,
                failed=0,
                retrying=0,
                dead_letter=dead_letter,
                active_workers=1,
            )
        except Exception:
            return await self._fallback.get_stats()

"""In-Memory Task Queue implementation for hermetic testing and fallback (FR-43)."""

import asyncio
import logging
import time
import uuid
from typing import Any

from src.queue.base import BaseTaskQueue
from src.queue.models import (
    JobPriority,
    QueueJob,
    QueueJobState,
    QueueStats,
    WorkerHeartbeat,
)

logger = logging.getLogger(__name__)


class MemoryTaskQueue(BaseTaskQueue):
    """Hermetic in-memory task queue with priority scheduling and DLQ support."""

    def __init__(self, retry_backoff_base: float = 2.0):
        self._jobs: dict[str, QueueJob] = {}
        self._workers: dict[str, WorkerHeartbeat] = {}
        self._lock = asyncio.Lock()
        self._retry_backoff_base = retry_backoff_base

    async def enqueue(
        self,
        job_type: str,
        payload: dict[str, Any],
        priority: int = JobPriority.NORMAL.value,
        max_retries: int = 3,
        delay_seconds: float = 0.0,
    ) -> QueueJob:
        now = time.time()
        job_id = f"job_{uuid.uuid4().hex[:12]}"
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
        async with self._lock:
            self._jobs[job_id] = job
        return job

    async def dequeue(self, worker_id: str) -> QueueJob | None:
        now = time.time()
        async with self._lock:
            # Candidates are QUEUED or RETRYING and next_run_at <= now
            eligible = [
                j for j in self._jobs.values()
                if j.status in (QueueJobState.QUEUED, QueueJobState.RETRYING)
                and j.next_run_at <= now
            ]
            if not eligible:
                return None

            # Sort by highest priority first, then earliest created_at
            eligible.sort(key=lambda j: (-j.priority, j.created_at))
            job = eligible[0]
            job.status = QueueJobState.PROCESSING
            job.worker_id = worker_id
            job.attempts += 1
            job.started_at = now
            return job

    async def complete(self, job_id: str, result: dict[str, Any] | None = None) -> QueueJob | None:
        now = time.time()
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            job.status = QueueJobState.COMPLETED
            job.result = result or {}
            job.completed_at = now
            if job.started_at:
                job.duration_ms = round((now - job.started_at) * 1000, 1)
            return job

    async def fail(
        self,
        job_id: str,
        error: str,
        retry_delay_seconds: float | None = None,
    ) -> QueueJob | None:
        now = time.time()
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            job.last_error = error
            if job.started_at:
                job.duration_ms = round((now - job.started_at) * 1000, 1)

            if job.attempts < job.max_retries:
                # Exponential backoff: base * (2 ** (attempts - 1))
                backoff = (
                    retry_delay_seconds
                    if retry_delay_seconds is not None
                    else self._retry_backoff_base * (2 ** max(0, job.attempts - 1))
                )
                job.status = QueueJobState.RETRYING
                job.next_run_at = now + backoff
                logger.warning(
                    "Job %s failed (attempt %d/%d). Retrying in %.1fs: %s",
                    job_id, job.attempts, job.max_retries, backoff, error
                )
            else:
                # Max retries exceeded -> Dead-Letter Queue (DLQ)
                job.status = QueueJobState.DEAD_LETTER
                job.completed_at = now
                logger.error(
                    "Job %s permanently failed after %d attempts. Moved to DEAD_LETTER: %s",
                    job_id, job.attempts, error
                )
            return job

    async def get_job(self, job_id: str) -> QueueJob | None:
        async with self._lock:
            return self._jobs.get(job_id)

    async def list_jobs(
        self,
        status: QueueJobState | None = None,
        limit: int = 50,
    ) -> list[QueueJob]:
        async with self._lock:
            jobs = list(self._jobs.values())
            if status:
                jobs = [j for j in jobs if j.status == status]
            jobs.sort(key=lambda j: j.created_at, reverse=True)
            return jobs[:limit]

    async def retry_job(self, job_id: str) -> QueueJob | None:
        now = time.time()
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if job.status in (QueueJobState.FAILED, QueueJobState.DEAD_LETTER):
                job.status = QueueJobState.QUEUED
                job.next_run_at = now
                job.last_error = None
                return job
            return job

    async def heartbeat(
        self,
        worker_id: str,
        concurrency: int = 4,
        active_jobs: int = 0,
        jobs_completed: int = 0,
        jobs_failed: int = 0,
    ) -> None:
        now = time.time()
        async with self._lock:
            existing = self._workers.get(worker_id)
            started_at = existing.started_at if existing else now
            self._workers[worker_id] = WorkerHeartbeat(
                worker_id=worker_id,
                status="active",
                concurrency=concurrency,
                active_jobs=active_jobs,
                jobs_completed=jobs_completed,
                jobs_failed=jobs_failed,
                started_at=started_at,
                last_heartbeat_at=now,
            )

    async def get_stats(self) -> QueueStats:
        now = time.time()
        async with self._lock:
            total = len(self._jobs)
            queued = sum(1 for j in self._jobs.values() if j.status == QueueJobState.QUEUED)
            processing = sum(1 for j in self._jobs.values() if j.status == QueueJobState.PROCESSING)
            completed = sum(1 for j in self._jobs.values() if j.status == QueueJobState.COMPLETED)
            failed = sum(1 for j in self._jobs.values() if j.status == QueueJobState.FAILED)
            retrying = sum(1 for j in self._jobs.values() if j.status == QueueJobState.RETRYING)
            dead_letter = sum(1 for j in self._jobs.values() if j.status == QueueJobState.DEAD_LETTER)

            # Prune workers that have been silent for >30 seconds
            active_workers_list = [
                w for w in self._workers.values()
                if (now - w.last_heartbeat_at) < 30.0
            ]

            return QueueStats(
                backend="memory",
                total_jobs=total,
                queued=queued,
                processing=processing,
                completed=completed,
                failed=failed,
                retrying=retrying,
                dead_letter=dead_letter,
                active_workers=len(active_workers_list),
                workers=active_workers_list,
            )

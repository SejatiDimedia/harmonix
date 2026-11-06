"""Abstract base class for Distributed Task Queue backends (FR-43, Pilar 6.3)."""

from abc import ABC, abstractmethod
from typing import Any

from src.queue.models import JobPriority, QueueJob, QueueJobState, QueueStats


class BaseTaskQueue(ABC):
    """Abstract interface defining the contract for persistent task queues."""

    @abstractmethod
    async def enqueue(
        self,
        job_type: str,
        payload: dict[str, Any],
        priority: int = JobPriority.NORMAL.value,
        max_retries: int = 3,
        delay_seconds: float = 0.0,
    ) -> QueueJob:
        """Add a new task to the queue with priority and optional delay."""
        pass

    @abstractmethod
    async def dequeue(self, worker_id: str) -> QueueJob | None:
        """Acquire the highest-priority eligible job for processing.
        
        Must be concurrency-safe (e.g. FOR UPDATE SKIP LOCKED or atomic pop).
        """
        pass

    @abstractmethod
    async def complete(self, job_id: str, result: dict[str, Any] | None = None) -> QueueJob | None:
        """Mark a job as successfully completed with optional output data."""
        pass

    @abstractmethod
    async def fail(
        self,
        job_id: str,
        error: str,
        retry_delay_seconds: float | None = None,
    ) -> QueueJob | None:
        """Record job execution failure.
        
        If attempts < max_retries, transitions to RETRYING with exponential backoff.
        If attempts >= max_retries, transitions to DEAD_LETTER (DLQ).
        """
        pass

    @abstractmethod
    async def get_job(self, job_id: str) -> QueueJob | None:
        """Fetch job record by ID."""
        pass

    @abstractmethod
    async def list_jobs(
        self,
        status: QueueJobState | None = None,
        limit: int = 50,
    ) -> list[QueueJob]:
        """List recent jobs with optional status filter."""
        pass

    @abstractmethod
    async def retry_job(self, job_id: str) -> QueueJob | None:
        """Manually re-queue a FAILED or DEAD_LETTER job."""
        pass

    @abstractmethod
    async def heartbeat(
        self,
        worker_id: str,
        concurrency: int = 4,
        active_jobs: int = 0,
        jobs_completed: int = 0,
        jobs_failed: int = 0,
    ) -> None:
        """Publish heartbeat and telemetry for an active background worker."""
        pass

    @abstractmethod
    async def get_stats(self) -> QueueStats:
        """Get aggregate queue metrics, pending counts, and worker health."""
        pass

"""Data models and state definitions for Distributed Task Queue (FR-43, Pilar 6.3)."""

from enum import Enum
import time
from typing import Any
from pydantic import BaseModel, Field


class QueueJobState(str, Enum):
    """Lifecycle states of a task in the queue."""
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    RETRYING = "RETRYING"
    DEAD_LETTER = "DEAD_LETTER"


class JobPriority(int, Enum):
    """Execution priority levels (higher integer = dispatched earlier)."""
    LOW = 1
    NORMAL = 5
    HIGH = 10
    CRITICAL = 20


class QueueJob(BaseModel):
    """Standard representation of an asynchronous task payload and state."""
    job_id: str
    job_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    priority: int = JobPriority.NORMAL.value
    status: QueueJobState = QueueJobState.QUEUED
    attempts: int = 0
    max_retries: int = 3
    last_error: str | None = None
    result: dict[str, Any] | None = None
    worker_id: str | None = None
    next_run_at: float = Field(default_factory=time.time)
    created_at: float = Field(default_factory=time.time)
    started_at: float | None = None
    completed_at: float | None = None
    duration_ms: float = 0.0


class WorkerHeartbeat(BaseModel):
    """Heartbeat signal and telemetry from an active background worker."""
    worker_id: str
    status: str = "active"
    concurrency: int = 4
    active_jobs: int = 0
    jobs_completed: int = 0
    jobs_failed: int = 0
    started_at: float = Field(default_factory=time.time)
    last_heartbeat_at: float = Field(default_factory=time.time)


class QueueStats(BaseModel):
    """Aggregated queue statistics and health overview."""
    backend: str
    total_jobs: int = 0
    queued: int = 0
    processing: int = 0
    completed: int = 0
    failed: int = 0
    retrying: int = 0
    dead_letter: int = 0
    active_workers: int = 0
    workers: list[WorkerHeartbeat] = Field(default_factory=list)


class EnqueueJobRequest(BaseModel):
    """Request schema for enqueuing an arbitrary task via REST API."""
    job_type: str = Field(..., description="Type of job (e.g. 'batch_query', 'agent_task', 'export_report')")
    payload: dict[str, Any] = Field(default_factory=dict, description="Job parameters and arguments")
    priority: int = Field(default=JobPriority.NORMAL.value, ge=1, le=20, description="Priority integer (1 to 20)")
    max_retries: int = Field(default=3, ge=0, le=10, description="Max auto retries before moving to DLQ")
    delay_seconds: float = Field(default=0.0, ge=0.0, description="Optional delay before task is eligible for pickup")

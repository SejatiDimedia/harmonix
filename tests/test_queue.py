"""Unit tests for Distributed Task Queue and Background Worker (FR-43, Pilar 6.3)."""

import asyncio
import time
import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app
from src.queue.memory_queue import MemoryTaskQueue
from src.queue.models import JobPriority, QueueJobState
from src.queue.worker import QueueWorker
from src.queue.manager import reset_task_queue


@pytest.fixture(autouse=True)
def fresh_memory_queue():
    """Ensure a clean in-memory queue for every test."""
    queue = MemoryTaskQueue(retry_backoff_base=0.1)
    reset_task_queue(queue)
    return queue


@pytest.mark.asyncio
async def test_memory_queue_priority_ordering(fresh_memory_queue):
    """Verify jobs are dequeued in strict priority order (Critical > High > Normal > Low)."""
    queue = fresh_memory_queue

    # Enqueue out of order
    await queue.enqueue("task_low", {"val": 1}, priority=JobPriority.LOW.value)
    await queue.enqueue("task_crit", {"val": 4}, priority=JobPriority.CRITICAL.value)
    await queue.enqueue("task_norm", {"val": 2}, priority=JobPriority.NORMAL.value)
    await queue.enqueue("task_high", {"val": 3}, priority=JobPriority.HIGH.value)

    # Dequeue 1: Critical
    j1 = await queue.dequeue("worker_1")
    assert j1 is not None
    assert j1.job_type == "task_crit"
    assert j1.priority == JobPriority.CRITICAL.value

    # Dequeue 2: High
    j2 = await queue.dequeue("worker_1")
    assert j2 is not None
    assert j2.job_type == "task_high"

    # Dequeue 3: Normal
    j3 = await queue.dequeue("worker_1")
    assert j3 is not None
    assert j3.job_type == "task_norm"

    # Dequeue 4: Low
    j4 = await queue.dequeue("worker_1")
    assert j4 is not None
    assert j4.job_type == "task_low"

    # No more jobs
    j5 = await queue.dequeue("worker_1")
    assert j5 is None


@pytest.mark.asyncio
async def test_queue_retry_and_dead_letter_queue(fresh_memory_queue):
    """Verify exponential backoff retries and transition to Dead-Letter Queue."""
    queue = fresh_memory_queue

    job = await queue.enqueue("flaky_task", {"step": 1}, max_retries=2)
    assert job.status == QueueJobState.QUEUED

    # Attempt 1
    d1 = await queue.dequeue("worker_1")
    assert d1.attempts == 1
    f1 = await queue.fail(d1.job_id, "Simulated network timeout", retry_delay_seconds=0.05)
    assert f1.status == QueueJobState.RETRYING
    assert f1.next_run_at > time.time()

    # Wait for retry delay
    await asyncio.sleep(0.06)

    # Attempt 2
    d2 = await queue.dequeue("worker_1")
    assert d2 is not None
    assert d2.attempts == 2

    # Attempt 2 fails -> max_retries (2) reached -> DEAD_LETTER
    f2 = await queue.fail(d2.job_id, "Permanent DB connection failure")
    assert f2.status == QueueJobState.DEAD_LETTER

    # Dead letter job cannot be dequeued by workers
    d3 = await queue.dequeue("worker_1")
    assert d3 is None

    # Manually re-enqueue dead letter job
    requeued = await queue.retry_job(f2.job_id)
    assert requeued.status == QueueJobState.QUEUED
    assert requeued.last_error is None

    # Now it can be dequeued again
    d4 = await queue.dequeue("worker_2")
    assert d4 is not None
    assert d4.job_id == f2.job_id


@pytest.mark.asyncio
async def test_worker_lifecycle_and_handler_dispatch(fresh_memory_queue):
    """Verify QueueWorker runs registered handler, completes job, and emits telemetry."""
    queue = fresh_memory_queue
    worker = QueueWorker(worker_id="test_worker_unit", queue=queue, concurrency=2)

    handled_payloads = []

    async def custom_handler(payload: dict) -> dict:
        handled_payloads.append(payload)
        return {"computed_sum": payload.get("a", 0) + payload.get("b", 0)}

    worker.register_handler("math_add", custom_handler)

    job = await queue.enqueue("math_add", {"a": 15, "b": 27})

    # Execute one step of worker loop
    spawned = await worker.run_once()
    assert spawned is True

    # Allow async task to complete
    await asyncio.sleep(0.05)

    completed_job = await queue.get_job(job.job_id)
    assert completed_job is not None
    assert completed_job.status == QueueJobState.COMPLETED
    assert completed_job.result == {"computed_sum": 42}
    assert completed_job.duration_ms >= 0.0
    assert len(handled_payloads) == 1


@pytest.mark.asyncio
async def test_queue_stats_and_worker_heartbeat(fresh_memory_queue):
    """Verify telemetry aggregation and worker heartbeat registration."""
    queue = fresh_memory_queue

    await queue.heartbeat(
        worker_id="worker_alpha",
        concurrency=4,
        active_jobs=1,
        jobs_completed=10,
        jobs_failed=1,
    )

    stats = await queue.get_stats()
    assert stats.backend == "memory"
    assert stats.active_workers == 1
    assert stats.workers[0].worker_id == "worker_alpha"
    assert stats.workers[0].jobs_completed == 10


@pytest.mark.asyncio
async def test_queue_rest_api_endpoints(fresh_memory_queue):
    """Verify FastAPI endpoints for task queue inspection and management."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Enqueue job via API
        enqueue_res = await client.post(
            "/v1/queue/jobs",
            json={
                "job_type": "batch_query",
                "payload": {"query": "Berapa total pesanan?"},
                "priority": 10,
                "max_retries": 3,
            },
        )
        assert enqueue_res.status_code == 200
        job_data = enqueue_res.json()
        job_id = job_data["job_id"]
        assert job_data["status"] == "QUEUED"
        assert job_data["priority"] == 10

        # 2. Check queue status
        status_res = await client.get("/v1/queue/status")
        assert status_res.status_code == 200
        sdata = status_res.json()
        assert sdata["queued"] >= 1

        # 3. List jobs
        list_res = await client.get("/v1/queue/jobs?status=QUEUED")
        assert list_res.status_code == 200
        jobs_list = list_res.json()["jobs"]
        assert any(j["job_id"] == job_id for j in jobs_list)

        # 4. Get specific job
        get_res = await client.get(f"/v1/queue/jobs/{job_id}")
        assert get_res.status_code == 200
        assert get_res.json()["job_id"] == job_id

        # 5. Fail job manually in queue and test retry endpoint
        await fresh_memory_queue.dequeue("worker_api")
        await fresh_memory_queue.fail(job_id, "Fatal test error", retry_delay_seconds=0.0)
        # Force to DEAD_LETTER for testing manual retry endpoint
        job_obj = await fresh_memory_queue.get_job(job_id)
        job_obj.status = QueueJobState.DEAD_LETTER

        retry_res = await client.post(f"/v1/queue/jobs/{job_id}/retry")
        assert retry_res.status_code == 200
        assert retry_res.json()["status"] == "re-queued"
        assert retry_res.json()["job"]["status"] == "QUEUED"

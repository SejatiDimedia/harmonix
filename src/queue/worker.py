"""Dedicated Background Worker daemon for Distributed Task Queue (FR-43, Pilar 6.3).

Executes long-running analytical queries, batch jobs, and agent reasoning tasks
in an isolated process outside the FastAPI web server loop.
"""

import asyncio
import logging
import os
import signal
import socket
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from src.config import settings
from src.queue.base import BaseTaskQueue
from src.queue.manager import get_task_queue
from src.queue.models import QueueJob

logger = logging.getLogger(__name__)

# Type for task handler functions
JobHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class QueueWorker:
    """Multi-task asynchronous worker with bounded concurrency and heartbeat."""

    def __init__(
        self,
        worker_id: str | None = None,
        queue: BaseTaskQueue | None = None,
        concurrency: int | None = None,
        poll_interval: float | None = None,
    ):
        self.worker_id = worker_id or f"worker_{socket.gethostname()}_{os.getpid()}_{uuid.uuid4().hex[:6]}"
        self.queue = queue or get_task_queue()
        self.concurrency = concurrency or getattr(settings, "queue_worker_concurrency", 4)
        self.poll_interval = poll_interval or getattr(settings, "queue_worker_poll_interval_seconds", 0.5)

        self._handlers: dict[str, JobHandler] = {}
        self._stopping = False
        self._active_jobs: set[str] = set()
        self._jobs_completed = 0
        self._jobs_failed = 0
        self._semaphore = asyncio.Semaphore(self.concurrency)
        self._in_flight_tasks: set[asyncio.Task] = set()

        # Register default handlers
        self._register_default_handlers()

    def register_handler(self, job_type: str, handler: JobHandler) -> None:
        """Register a callback handler for a specific job_type."""
        self._handlers[job_type] = handler

    def _register_default_handlers(self) -> None:
        """Set up standard task handlers for analytics and agent reasoning."""

        async def _handle_batch_query(payload: dict[str, Any]) -> dict[str, Any]:
            """Execute a single analytical query via ManualAgentLoop."""
            from src.agent.manual_loop import ManualAgentLoop

            query = payload.get("query", "")
            task_id = payload.get("task_id", f"task_{uuid.uuid4().hex[:8]}")
            engine_mode = payload.get("engine", "manual")

            agent = ManualAgentLoop()
            final_data: dict[str, Any] = {}
            async for event in agent.run_stream(user_query=query, task_id=task_id):
                if event["event"] == "final_result":
                    final_data = event["data"]

            return {
                "answer_text": final_data.get("answer_text", ""),
                "sql_queries": final_data.get("sql_queries", []),
                "tables": final_data.get("tables", []),
                "charts": final_data.get("charts", []),
                "metrics": final_data.get("metrics", {}),
            }

        async def _handle_agent_task(payload: dict[str, Any]) -> dict[str, Any]:
            """Execute general agent task."""
            return await _handle_batch_query(payload)

        async def _handle_generic_calc(payload: dict[str, Any]) -> dict[str, Any]:
            """Execute calculation via SandboxManager."""
            from src.tools.sandbox import SandboxManager
            code = payload.get("code", "")
            return SandboxManager.execute(code)

        self.register_handler("batch_query", _handle_batch_query)
        self.register_handler("agent_task", _handle_agent_task)
        self.register_handler("calculate", _handle_generic_calc)

    async def _execute_job(self, job: QueueJob) -> None:
        """Execute a single dequeued job wrapped in concurrency controls."""
        job_id = job.job_id
        self._active_jobs.add(job_id)
        handler = self._handlers.get(job.job_type)

        try:
            if not handler:
                raise ValueError(f"No handler registered for job_type: '{job.job_type}'")

            timeout = getattr(settings, "queue_job_timeout_seconds", 180)
            result = await asyncio.wait_for(handler(job.payload), timeout=timeout)
            await self.queue.complete(job_id, result)
            self._jobs_completed += 1
            logger.info("Job %s (%s) completed successfully.", job_id, job.job_type)
        except Exception as e:
            self._jobs_failed += 1
            err_msg = f"{type(e).__name__}: {str(e)}"
            logger.warning("Job %s (%s) execution error: %s", job_id, job.job_type, err_msg)
            await self.queue.fail(job_id, err_msg)
        finally:
            self._active_jobs.discard(job_id)

    async def _heartbeat_loop(self) -> None:
        """Periodically broadcast worker telemetry and active task count."""
        while not self._stopping:
            try:
                await self.queue.heartbeat(
                    worker_id=self.worker_id,
                    concurrency=self.concurrency,
                    active_jobs=len(self._active_jobs),
                    jobs_completed=self._jobs_completed,
                    jobs_failed=self._jobs_failed,
                )
            except Exception as e:
                logger.debug("Heartbeat error: %s", e)
            await asyncio.sleep(5.0)

    async def run_once(self) -> bool:
        """Attempt to dequeue and launch a single eligible job."""
        if self._stopping:
            return False

        if len(self._active_jobs) >= self.concurrency:
            return False

        job = await self.queue.dequeue(self.worker_id)
        if not job:
            return False

        # Spawn concurrent execution task
        task = asyncio.create_task(self._execute_job(job))
        self._in_flight_tasks.add(task)
        task.add_done_callback(self._in_flight_tasks.discard)
        return True

    async def start(self) -> None:
        """Main event loop for the background worker process."""
        logger.info("Starting QueueWorker [%s] with concurrency %d", self.worker_id, self.concurrency)
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        try:
            while not self._stopping:
                # Fill concurrency capacity
                spawned = False
                while len(self._active_jobs) < self.concurrency and not self._stopping:
                    had_job = await self.run_once()
                    if had_job:
                        spawned = True
                    else:
                        break

                if not spawned:
                    await asyncio.sleep(self.poll_interval)
        except asyncio.CancelledError:
            logger.info("Worker [%s] received cancel signal.", self.worker_id)
        finally:
            self._stopping = True
            heartbeat_task.cancel()
            if self._in_flight_tasks:
                logger.info("Draining %d active jobs before exit...", len(self._in_flight_tasks))
                await asyncio.gather(*self._in_flight_tasks, return_exceptions=True)
            logger.info("QueueWorker [%s] stopped cleanly.", self.worker_id)

    def stop(self) -> None:
        """Initiate graceful shutdown."""
        self._stopping = True


def main() -> None:
    """CLI entry point for running independent worker process."""
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] (Worker) %(message)s",
    )

    worker = QueueWorker()

    def _sig_handler(sig, frame):
        logger.info("Caught signal %s. Shutting down worker...", sig)
        worker.stop()

    try:
        signal.signal(signal.SIGINT, _sig_handler)
        signal.signal(signal.SIGTERM, _sig_handler)
    except (ValueError, AttributeError):
        pass

    try:
        asyncio.run(worker.start())
    except KeyboardInterrupt:
        logger.info("Worker process interrupted by keyboard.")
        sys.exit(0)


if __name__ == "__main__":
    main()

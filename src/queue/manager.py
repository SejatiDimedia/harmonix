"""Queue Manager and Factory for instantiating queue adapters (FR-43, Pilar 6.3)."""

import logging
from src.config import settings
from src.queue.base import BaseTaskQueue
from src.queue.memory_queue import MemoryTaskQueue
from src.queue.postgres_queue import PostgresTaskQueue
from src.queue.redis_queue import RedisTaskQueue

logger = logging.getLogger(__name__)

_global_queue: BaseTaskQueue | None = None


def get_task_queue() -> BaseTaskQueue:
    """Retrieve or create the singleton task queue based on application settings."""
    global _global_queue
    if _global_queue is not None:
        return _global_queue

    backend = getattr(settings, "queue_backend", "postgres")
    backoff_base = getattr(settings, "queue_retry_backoff_base_seconds", 2.0)

    if backend == "postgres":
        logger.info("Initializing PostgreSQL Task Queue (FOR UPDATE SKIP LOCKED)")
        _global_queue = PostgresTaskQueue(retry_backoff_base=backoff_base)
    elif backend == "redis":
        redis_url = getattr(settings, "queue_redis_url", "redis://localhost:6379/0")
        logger.info("Initializing Redis Task Queue at %s", redis_url)
        _global_queue = RedisTaskQueue(redis_url=redis_url, retry_backoff_base=backoff_base)
    else:
        logger.info("Initializing In-Memory Task Queue")
        _global_queue = MemoryTaskQueue(retry_backoff_base=backoff_base)

    return _global_queue


def reset_task_queue(new_queue: BaseTaskQueue | None = None) -> None:
    """Reset the global queue singleton (primarily for testing purposes)."""
    global _global_queue
    _global_queue = new_queue

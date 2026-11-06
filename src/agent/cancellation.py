"""Cancellation coordinator for agent tasks across all orchestrators."""

import logging
from typing import Set

logger = logging.getLogger(__name__)

_cancelled_tasks: Set[str] = set()


def request_task_cancellation(task_id: str) -> None:
    """Register a task ID as cancelled."""
    if task_id:
        _cancelled_tasks.add(task_id)
        logger.info("Task %s flagged for cancellation.", task_id)


def is_task_cancelled(task_id: str | None) -> bool:
    """Check if a task has been flagged for cancellation."""
    if not task_id:
        return False
    return task_id in _cancelled_tasks


def clear_task_cancellation(task_id: str | None) -> None:
    """Clear cancellation flag for a task once finalized."""
    if task_id:
        _cancelled_tasks.discard(task_id)

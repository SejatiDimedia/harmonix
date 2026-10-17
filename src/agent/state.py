"""Persistent State Machine, Checkpointing, and Task Durability (FR-19)."""

import json
import logging
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.agent.models import AgentTaskStatus
from src.db.connection import get_db_session

logger = logging.getLogger(__name__)


# ==============================================================================
# Task Record Model
# ==============================================================================

class TaskRecord(BaseModel):
    """Database entity representing an agent task state and its checkpoints."""
    task_id: str
    session_id: str | None = None
    status: AgentTaskStatus = AgentTaskStatus.PENDING
    current_step: int = 0
    max_steps: int = 10
    user_query: str
    messages: list[dict[str, Any]] = Field(default_factory=list)
    pending_approval: dict[str, Any] | None = None
    final_result: dict[str, Any] | None = None
    error_message: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ==============================================================================
# Database Schema Initialization
# ==============================================================================

async def init_task_state_table() -> None:
    """Create analytics.agent_tasks and analytics.task_checkpoints tables in PostgreSQL."""
    async with get_db_session() as session:
        # Table 1: Primary Task State
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS analytics.agent_tasks (
                task_id VARCHAR(100) PRIMARY KEY,
                session_id VARCHAR(100),
                status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                current_step INT NOT NULL DEFAULT 0,
                max_steps INT NOT NULL DEFAULT 10,
                user_query TEXT NOT NULL,
                messages JSONB NOT NULL DEFAULT '[]'::jsonb,
                pending_approval JSONB,
                final_result JSONB,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # Table 2: Step-by-Step Checkpoints (Audit Trail & Time-Travel)
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS analytics.task_checkpoints (
                id SERIAL PRIMARY KEY,
                task_id VARCHAR(100) REFERENCES analytics.agent_tasks(task_id) ON DELETE CASCADE,
                step_number INT NOT NULL,
                state_snapshot JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # Index on session_id for multi-turn short-term memory lookup (FR-16)
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_agent_tasks_session
            ON analytics.agent_tasks(session_id);
        """))

        await session.commit()
        logger.info("Initialized analytics.agent_tasks and task_checkpoints tables.")


# ==============================================================================
# State Machine & Checkpointing CRUD
# ==============================================================================

async def save_task_checkpoint(
    task_id: str,
    status: AgentTaskStatus,
    current_step: int,
    messages: list[dict[str, Any]],
    user_query: str = "",
    session_id: str | None = None,
    pending_approval: dict[str, Any] | None = None,
    final_result: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> None:
    """Save or update task execution state and append a step checkpoint."""
    await init_task_state_table()

    messages_json = json.dumps(messages, ensure_ascii=False)
    pending_json = json.dumps(pending_approval, ensure_ascii=False) if pending_approval else None
    result_json = json.dumps(final_result, ensure_ascii=False) if final_result else None

    async with get_db_session() as session:
        # 1. Upsert into agent_tasks
        upsert_query = text("""
            INSERT INTO analytics.agent_tasks 
            (task_id, session_id, status, current_step, user_query, messages, pending_approval, final_result, error_message, updated_at)
            VALUES (:task_id, :session_id, :status, :current_step, :user_query, CAST(:messages AS JSONB), CAST(:pending_approval AS JSONB), CAST(:final_result AS JSONB), :error_message, CURRENT_TIMESTAMP)
            ON CONFLICT (task_id) DO UPDATE SET
                status = EXCLUDED.status,
                current_step = EXCLUDED.current_step,
                messages = EXCLUDED.messages,
                pending_approval = EXCLUDED.pending_approval,
                final_result = EXCLUDED.final_result,
                error_message = EXCLUDED.error_message,
                updated_at = CURRENT_TIMESTAMP;
        """)

        await session.execute(
            upsert_query,
            {
                "task_id": task_id,
                "session_id": session_id,
                "status": status.value,
                "current_step": current_step,
                "user_query": user_query,
                "messages": messages_json,
                "pending_approval": pending_json,
                "final_result": result_json,
                "error_message": error_message,
            },
        )

        # 2. Append immutable snapshot to task_checkpoints
        snapshot = {
            "status": status.value,
            "step": current_step,
            "messages_count": len(messages),
            "has_pending_approval": bool(pending_approval),
        }
        await session.execute(
            text("""
                INSERT INTO analytics.task_checkpoints (task_id, step_number, state_snapshot)
                VALUES (:task_id, :step_number, CAST(:snapshot AS JSONB));
            """),
            {
                "task_id": task_id,
                "step_number": current_step,
                "snapshot": json.dumps(snapshot),
            },
        )

        await session.commit()


async def get_task_record(task_id: str) -> TaskRecord | None:
    """Retrieve current task record by ID from PostgreSQL."""
    await init_task_state_table()

    async with get_db_session() as session:
        query = text("""
            SELECT task_id, session_id, status, current_step, max_steps, user_query, 
                   messages, pending_approval, final_result, error_message, created_at, updated_at
            FROM analytics.agent_tasks
            WHERE task_id = :task_id;
        """)
        res = await session.execute(query, {"task_id": task_id})
        row = res.fetchone()
        if not row:
            return None

        return TaskRecord(
            task_id=row[0],
            session_id=row[1],
            status=AgentTaskStatus(row[2]),
            current_step=row[3],
            max_steps=row[4],
            user_query=row[5],
            messages=row[6] if isinstance(row[6], list) else json.loads(row[6] or "[]"),
            pending_approval=row[7] if isinstance(row[7], dict) else (json.loads(row[7]) if row[7] else None),
            final_result=row[8] if isinstance(row[8], dict) else (json.loads(row[8]) if row[8] else None),
            error_message=row[9],
            created_at=row[10],
            updated_at=row[11],
        )


async def get_session_history(session_id: str, limit: int = 5) -> list[dict[str, Any]]:
    """Retrieve past completed conversation turns for a session (Short-term Memory FR-16)."""
    if not session_id:
        return []

    await init_task_state_table()

    async with get_db_session() as session:
        query = text("""
            SELECT user_query, final_result
            FROM analytics.agent_tasks
            WHERE session_id = :session_id AND status = 'COMPLETED' AND final_result IS NOT NULL
            ORDER BY created_at ASC
            LIMIT :limit;
        """)
        res = await session.execute(query, {"session_id": session_id, "limit": limit})
        rows = res.fetchall()

        history_messages = []
        for r in rows:
            u_query = r[0]
            f_result = r[1] if isinstance(r[1], dict) else json.loads(r[1])
            history_messages.append({"role": "user", "content": u_query})
            history_messages.append({"role": "assistant", "content": f_result.get("answer_text", "")})

        return history_messages


async def get_task_by_approval_id(approval_id: str) -> TaskRecord | None:
    """Retrieve task waiting for approval by approval_id from PostgreSQL (FR-19/FR-25 resilience)."""
    if not approval_id:
        return None

    await init_task_state_table()

    async with get_db_session() as session:
        query = text("""
            SELECT task_id, session_id, status, current_step, max_steps, user_query, 
                   messages, pending_approval, final_result, error_message, created_at, updated_at
            FROM analytics.agent_tasks
            WHERE pending_approval->>'approval_id' = :approval_id;
        """)
        res = await session.execute(query, {"approval_id": approval_id})
        row = res.fetchone()
        if not row:
            return None

        return TaskRecord(
            task_id=row[0],
            session_id=row[1],
            status=AgentTaskStatus(row[2]),
            current_step=row[3],
            max_steps=row[4],
            user_query=row[5],
            messages=row[6] if isinstance(row[6], list) else json.loads(row[6] or "[]"),
            pending_approval=row[7] if isinstance(row[7], dict) else (json.loads(row[7]) if row[7] else None),
            final_result=row[8] if isinstance(row[8], dict) else (json.loads(row[8]) if row[8] else None),
            error_message=row[9],
            created_at=row[10],
            updated_at=row[11],
        )


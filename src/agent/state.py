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
    analyst_provider: str | None = None
    analyst_model: str | None = None
    working_memory: dict[str, Any] = Field(default_factory=dict)
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
                analyst_provider VARCHAR(50),
                analyst_model VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # Migration: Ensure session-scoped model routing and working memory columns exist
        await session.execute(text("""
            ALTER TABLE analytics.agent_tasks
            ADD COLUMN IF NOT EXISTS analyst_provider VARCHAR(50),
            ADD COLUMN IF NOT EXISTS analyst_model VARCHAR(100),
            ADD COLUMN IF NOT EXISTS working_memory JSONB DEFAULT '{}'::jsonb;
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

        # Table 3: Session Metadata & Custom Titles (FR-33, Session Renaming & FR-14 Compaction)
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS analytics.chat_sessions (
                session_id VARCHAR(100) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                compacted_summary TEXT,
                compacted_turn_count INT DEFAULT 0,
                last_compacted_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # Migration: Ensure FR-14 compaction columns exist on older chat_sessions schemas
        await session.execute(text("""
            ALTER TABLE analytics.chat_sessions
            ADD COLUMN IF NOT EXISTS compacted_summary TEXT,
            ADD COLUMN IF NOT EXISTS compacted_turn_count INT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS last_compacted_at TIMESTAMP;
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
    analyst_provider: str | None = None,
    analyst_model: str | None = None,
    working_memory: dict[str, Any] | None = None,
) -> None:
    """Save or update task execution state and append a step checkpoint."""
    await init_task_state_table()

    messages_json = json.dumps(messages, ensure_ascii=False)
    pending_json = json.dumps(pending_approval, ensure_ascii=False) if pending_approval else None
    result_json = json.dumps(final_result, ensure_ascii=False) if final_result else None
    memory_json = json.dumps(working_memory, ensure_ascii=False) if working_memory is not None else None

    async with get_db_session() as session:
        # 1. Upsert into agent_tasks
        upsert_query = text("""
            INSERT INTO analytics.agent_tasks 
            (task_id, session_id, status, current_step, user_query, messages, pending_approval, final_result, error_message, analyst_provider, analyst_model, working_memory, updated_at)
            VALUES (:task_id, :session_id, :status, :current_step, :user_query, CAST(:messages AS JSONB), CAST(:pending_approval AS JSONB), CAST(:final_result AS JSONB), :error_message, :analyst_provider, :analyst_model, COALESCE(CAST(:working_memory AS JSONB), '{}'::jsonb), CURRENT_TIMESTAMP)
            ON CONFLICT (task_id) DO UPDATE SET
                session_id = COALESCE(EXCLUDED.session_id, analytics.agent_tasks.session_id),
                status = EXCLUDED.status,
                current_step = EXCLUDED.current_step,
                messages = EXCLUDED.messages,
                pending_approval = EXCLUDED.pending_approval,
                final_result = EXCLUDED.final_result,
                error_message = EXCLUDED.error_message,
                analyst_provider = COALESCE(EXCLUDED.analyst_provider, analytics.agent_tasks.analyst_provider),
                analyst_model = COALESCE(EXCLUDED.analyst_model, analytics.agent_tasks.analyst_model),
                working_memory = CASE WHEN EXCLUDED.working_memory IS NOT NULL AND EXCLUDED.working_memory != '{}'::jsonb THEN EXCLUDED.working_memory ELSE analytics.agent_tasks.working_memory END,
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
                "analyst_provider": analyst_provider,
                "analyst_model": analyst_model,
                "working_memory": memory_json,
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
                   messages, pending_approval, final_result, error_message, analyst_provider, analyst_model, working_memory, created_at, updated_at
            FROM analytics.agent_tasks
            WHERE task_id = :task_id;
        """)
        res = await session.execute(query, {"task_id": task_id})
        row = res.fetchone()
        if not row:
            return None

        raw_memory = row[12]
        working_mem = raw_memory if isinstance(raw_memory, dict) else (json.loads(raw_memory) if raw_memory else {})

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
            analyst_provider=row[10],
            analyst_model=row[11],
            working_memory=working_mem,
            created_at=row[13],
            updated_at=row[14],
        )


async def get_session_history(session_id: str, limit: int = 5) -> list[dict[str, Any]]:
    """Retrieve past completed conversation turns for a session (Short-term Memory FR-16)."""
    if not session_id:
        return []

    await init_task_state_table()

    async with get_db_session() as session:
        # Retrieve the LATEST completed turns in chronological order, skipping empty answers
        query = text("""
            SELECT user_query, final_result
            FROM (
                SELECT user_query, final_result, created_at
                FROM analytics.agent_tasks
                WHERE session_id = :session_id 
                  AND status = 'COMPLETED' 
                  AND final_result IS NOT NULL
                ORDER BY created_at DESC
                LIMIT :limit
            ) recent_tasks
            ORDER BY created_at ASC;
        """)
        res = await session.execute(query, {"session_id": session_id, "limit": limit})
        rows = res.fetchall()

        history_messages = []
        for r in rows:
            u_query = r[0]
            f_result = r[1] if isinstance(r[1], dict) else json.loads(r[1])
            ans_text = (f_result.get("answer_text") or "").strip()
            # Skip turns that failed or have empty answers to prevent dangling prompt confusion
            if not ans_text:
                continue
            history_messages.append({"role": "user", "content": u_query})
            history_messages.append({"role": "assistant", "content": ans_text})

        return history_messages


async def get_task_by_approval_id(approval_id: str) -> TaskRecord | None:
    """Retrieve task waiting for approval by approval_id from PostgreSQL (FR-19/FR-25 resilience)."""
    if not approval_id:
        return None

    await init_task_state_table()

    async with get_db_session() as session:
        query = text("""
            SELECT task_id, session_id, status, current_step, max_steps, user_query, 
                   messages, pending_approval, final_result, error_message, analyst_provider, analyst_model, created_at, updated_at
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
            analyst_provider=row[10],
            analyst_model=row[11],
            created_at=row[12],
            updated_at=row[13],
        )


async def list_chat_sessions(limit: int = 50) -> list[dict[str, Any]]:
    """Retrieve summarized list of all conversation sessions with their custom or first query title."""
    await init_task_state_table()
    async with get_db_session() as session:
        query = text("""
            SELECT 
                session_id,
                created_at,
                last_activity,
                total_turns,
                COALESCE(custom_title, first_query, 'Percakapan') as title,
                last_provider,
                last_model
            FROM (
                SELECT 
                    COALESCE(at.session_id, cs.session_id) as session_id,
                    COALESCE(MIN(at.created_at), MIN(cs.created_at)) as created_at,
                    COALESCE(MAX(at.updated_at), MAX(cs.updated_at)) as last_activity,
                    COUNT(at.task_id) as total_turns,
                    MAX(cs.title) as custom_title,
                    (ARRAY_AGG(at.user_query ORDER BY at.created_at ASC))[1] as first_query,
                    (ARRAY_AGG(at.analyst_provider ORDER BY at.created_at DESC) FILTER (WHERE at.analyst_provider IS NOT NULL))[1] as last_provider,
                    (ARRAY_AGG(at.analyst_model ORDER BY at.created_at DESC) FILTER (WHERE at.analyst_model IS NOT NULL))[1] as last_model
                FROM analytics.agent_tasks at
                FULL OUTER JOIN analytics.chat_sessions cs ON cs.session_id = at.session_id
                WHERE COALESCE(at.session_id, cs.session_id) IS NOT NULL AND TRIM(COALESCE(at.session_id, cs.session_id)) != ''
                GROUP BY COALESCE(at.session_id, cs.session_id)
            ) sub
            ORDER BY last_activity DESC
            LIMIT :limit;
        """)
        res = await session.execute(query, {"limit": limit})
        rows = res.fetchall()
        sessions = []
        for r in rows:
            sid, c_at, u_at, turns, title, l_prov, l_mod = r[0], r[1], r[2], r[3], r[4], r[5], r[6]
            sessions.append({
                "session_id": sid,
                "title": (title or "Percakapan").strip()[:100],
                "total_turns": turns,
                "active_provider": l_prov,
                "active_model": l_mod,
                "created_at": c_at.isoformat() if c_at else None,
                "last_activity": u_at.isoformat() if u_at else None,
            })
        return sessions


async def get_session_details(session_id: str) -> dict[str, Any] | None:
    """Retrieve full conversation details and turns for a given session."""
    if not session_id:
        return None
    await init_task_state_table()
    async with get_db_session() as session:
        # Check custom title and compacted context (FR-14)
        title_res = await session.execute(
            text("SELECT title, compacted_summary, compacted_turn_count FROM analytics.chat_sessions WHERE session_id = :session_id;"),
            {"session_id": session_id},
        )
        custom_row = title_res.fetchone()
        custom_title = custom_row[0] if custom_row else None
        compacted_summary = custom_row[1] if custom_row else None
        compacted_turn_count = custom_row[2] if custom_row else 0

        query = text("""
            SELECT task_id, status, user_query, final_result, analyst_provider, analyst_model, created_at, updated_at, working_memory
            FROM analytics.agent_tasks
            WHERE session_id = :session_id
            ORDER BY created_at ASC;
        """)
        res = await session.execute(query, {"session_id": session_id})
        rows = res.fetchall()
        if not rows and not custom_title:
            return None

        turns = []
        fallback_title = rows[0][2] if rows else "Percakapan"
        title = custom_title or fallback_title
        active_provider = None
        active_model = None

        for r in rows:
            tid, st, u_query, f_res, a_prov, a_mod, c_at, u_at, w_mem = r
            if a_prov:
                active_provider = a_prov
            if a_mod:
                active_model = a_mod
            f_dict = f_res if isinstance(f_res, dict) else (json.loads(f_res) if f_res else {})
            raw_w_mem = w_mem if isinstance(w_mem, dict) else (json.loads(w_mem) if w_mem else {})
            turns.append({
                "task_id": tid,
                "status": st,
                "user_query": u_query,
                "analyst_provider": a_prov,
                "analyst_model": a_mod,
                "answer_text": f_dict.get("answer_text", ""),
                "sql_queries": f_dict.get("sql_queries", []),
                "tables": f_dict.get("tables", []),
                "charts": f_dict.get("charts", []),
                "citations": f_dict.get("citations", []),
                "follow_up_suggestions": f_dict.get("follow_up_suggestions", []),
                "audit_result": f_dict.get("audit_result"),
                "metrics": f_dict.get("metrics"),
                "memories_recalled": f_dict.get("memories_recalled", []),
                "working_memory": f_dict.get("working_memory") or raw_w_mem or {},
                "execution_plan": f_dict.get("execution_plan"),
                "created_at": c_at.isoformat() if c_at else None,
            })

        return {
            "session_id": session_id,
            "title": title[:100],
            "total_turns": len(turns),
            "compacted_summary": compacted_summary,
            "compacted_turn_count": compacted_turn_count or 0,
            "active_provider": active_provider,
            "active_model": active_model,
            "turns": turns,
        }


async def get_session_compacted_summary(session_id: str) -> tuple[str | None, int]:
    """Retrieve existing compacted conversation summary and turn count for a session (FR-14)."""
    if not session_id:
        return None, 0
    await init_task_state_table()
    async with get_db_session() as session:
        query = text("""
            SELECT compacted_summary, COALESCE(compacted_turn_count, 0)
            FROM analytics.chat_sessions
            WHERE session_id = :session_id;
        """)
        res = await session.execute(query, {"session_id": session_id})
        row = res.fetchone()
        if row and row[0]:
            return row[0], int(row[1])
        return None, 0


async def save_session_compaction(session_id: str, summary: str, turn_count: int) -> None:
    """Persist compacted summary of older conversation turns into PostgreSQL (FR-14)."""
    if not session_id or not summary.strip():
        return
    await init_task_state_table()
    async with get_db_session() as session:
        query = text("""
            INSERT INTO analytics.chat_sessions (session_id, title, compacted_summary, compacted_turn_count, last_compacted_at, updated_at)
            VALUES (:session_id, 'Percakapan', :summary, :turn_count, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (session_id)
            DO UPDATE SET 
                compacted_summary = :summary,
                compacted_turn_count = :turn_count,
                last_compacted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP;
        """)
        await session.execute(query, {
            "session_id": session_id,
            "summary": summary.strip(),
            "turn_count": turn_count,
        })
        await session.commit()
        logger.info("Persisted FR-14 compacted summary for session %s (up to turn %d).", session_id, turn_count)


async def rename_session(session_id: str, new_title: str) -> bool:
    """Update or set the custom title for a conversation session."""
    if not session_id or not new_title.strip():
        return False
    title = new_title.strip()[:150]
    await init_task_state_table()
    async with get_db_session() as session:
        query = text("""
            INSERT INTO analytics.chat_sessions (session_id, title, updated_at)
            VALUES (:session_id, :title, CURRENT_TIMESTAMP)
            ON CONFLICT (session_id)
            DO UPDATE SET title = :title, updated_at = CURRENT_TIMESTAMP;
        """)
        await session.execute(query, {"session_id": session_id, "title": title})
        await session.commit()
        return True


async def get_session_active_model(session_id: str) -> tuple[str | None, str | None]:
    """Retrieve the most recent provider and model used by a session."""
    if not session_id:
        return None, None
    await init_task_state_table()
    async with get_db_session() as session:
        query = text("""
            SELECT analyst_provider, analyst_model
            FROM analytics.agent_tasks
            WHERE session_id = :session_id AND analyst_model IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1;
        """)
        res = await session.execute(query, {"session_id": session_id})
        row = res.fetchone()
        if row:
            return row[0], row[1]
        return None, None


async def delete_session(session_id: str) -> bool:
    """Delete all tasks, checkpoints, custom session titles, widgets, and dynamic uploaded tables associated with a session."""
    if not session_id:
        return False
    await init_task_state_table()

    # Drop session-scoped dynamic uploaded tables (FR-39)
    try:
        from src.ingestion.excel_csv_parser import cleanup_session_uploaded_tables
        await cleanup_session_uploaded_tables(session_id)
    except Exception as e:
        logger.warning("Error cleaning up uploaded tables for session %s: %s", session_id, e)

    async with get_db_session() as session:
        del_cs = await session.execute(
            text("DELETE FROM analytics.chat_sessions WHERE session_id = :session_id;"),
            {"session_id": session_id},
        )
        res = await session.execute(
            text("DELETE FROM analytics.agent_tasks WHERE session_id = :session_id;"),
            {"session_id": session_id},
        )
        try:
            await session.execute(
                text("DELETE FROM analytics.dashboard_widgets WHERE session_id = :session_id;"),
                {"session_id": session_id},
            )
        except Exception:
            pass
        await session.commit()
        return res.rowcount > 0 or del_cs.rowcount > 0



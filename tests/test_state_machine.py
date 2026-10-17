"""Tests for PostgreSQL State Machine, Checkpointing, and Task Durability (FR-19, FR-16)."""

import pytest
import uuid
from src.agent.models import AgentTaskStatus
from src.agent.state import (
    init_task_state_table,
    save_task_checkpoint,
    get_task_record,
    get_session_history,
    get_task_by_approval_id,
)


@pytest.mark.asyncio
async def test_state_machine_checkpointing_and_retrieval():
    """Verify state initialization, checkpoint snapshot saving, and task retrieval."""
    await init_task_state_table()

    task_id = f"test_task_{uuid.uuid4().hex[:8]}"
    session_id = f"test_sess_{uuid.uuid4().hex[:8]}"

    # 1. Step 1: Save RUNNING state
    messages_step1 = [
        {"role": "user", "content": "Berapa total GMV Q1?"},
        {"role": "assistant", "content": "Saya akan memeriksa glosarium metrik."},
    ]
    await save_task_checkpoint(
        task_id=task_id,
        status=AgentTaskStatus.RUNNING,
        current_step=1,
        messages=messages_step1,
        user_query="Berapa total GMV Q1?",
        session_id=session_id,
    )

    record1 = await get_task_record(task_id)
    assert record1 is not None
    assert record1.task_id == task_id
    assert record1.status == AgentTaskStatus.RUNNING
    assert record1.current_step == 1
    assert len(record1.messages) == 2

    # 2. Step 2: Transition to WAITING_APPROVAL
    appr_payload = {
        "approval_id": f"appr_{uuid.uuid4().hex[:6]}",
        "task_id": task_id,
        "step": 2,
        "sanitized_query": "SELECT email FROM analytics.customers LIMIT 100",
        "risk_reasons": ["Akses kolom PII sensitif"],
    }
    await save_task_checkpoint(
        task_id=task_id,
        status=AgentTaskStatus.WAITING_APPROVAL,
        current_step=2,
        messages=messages_step1,
        user_query="Berapa total GMV Q1?",
        session_id=session_id,
        pending_approval=appr_payload,
    )

    record2 = await get_task_record(task_id)
    assert record2 is not None
    assert record2.status == AgentTaskStatus.WAITING_APPROVAL
    assert record2.current_step == 2
    assert record2.pending_approval is not None
    assert record2.pending_approval["approval_id"] == appr_payload["approval_id"]

    # 3. Step 3: Transition to COMPLETED
    final_result = {
        "answer_text": "Total GMV Q1 adalah Rp 1.500.000.000.",
        "sql_queries": ["SELECT SUM(amount) FROM analytics.orders"],
        "total_steps": 3,
    }
    await save_task_checkpoint(
        task_id=task_id,
        status=AgentTaskStatus.COMPLETED,
        current_step=3,
        messages=messages_step1,
        user_query="Berapa total GMV Q1?",
        session_id=session_id,
        final_result=final_result,
    )

    record3 = await get_task_record(task_id)
    assert record3 is not None
    assert record3.status == AgentTaskStatus.COMPLETED
    assert record3.final_result["answer_text"] == "Total GMV Q1 adalah Rp 1.500.000.000."


@pytest.mark.asyncio
async def test_session_history_memory():
    """Verify get_session_history retrieves prior completed turns for context injection."""
    session_id = f"test_multi_turn_{uuid.uuid4().hex[:8]}"

    # Create 2 completed tasks under the same session
    for i in range(2):
        t_id = f"task_turn_{i}_{uuid.uuid4().hex[:6]}"
        await save_task_checkpoint(
            task_id=t_id,
            status=AgentTaskStatus.COMPLETED,
            current_step=2,
            messages=[],
            user_query=f"Pertanyaan turn {i}",
            session_id=session_id,
            final_result={"answer_text": f"Jawaban turn {i}"},
        )

    history = await get_session_history(session_id=session_id, limit=5)
    assert len(history) == 4  # 2 user messages + 2 assistant messages
    assert history[0]["role"] == "user"
    assert "Pertanyaan turn 0" in history[0]["content"]
    assert history[1]["role"] == "assistant"
    assert "Jawaban turn 0" in history[1]["content"]


@pytest.mark.asyncio
async def test_get_task_by_approval_id():
    """Verify get_task_by_approval_id can look up tasks across server restarts."""
    await init_task_state_table()

    t_id = f"task_appr_{uuid.uuid4().hex[:8]}"
    appr_id = f"appr_test_{uuid.uuid4().hex[:8]}"

    approval_payload = {
        "approval_id": appr_id,
        "task_id": t_id,
        "step": 2,
        "tool_call_id": "call_123",
        "tool_name": "run_sql",
        "sanitized_query": "SELECT email FROM analytics.customers LIMIT 10",
    }

    await save_task_checkpoint(
        task_id=t_id,
        status=AgentTaskStatus.WAITING_APPROVAL,
        current_step=2,
        messages=[],
        user_query="Query with PII",
        pending_approval=approval_payload,
    )

    record = await get_task_by_approval_id(appr_id)
    assert record is not None
    assert record.task_id == t_id
    assert record.status == AgentTaskStatus.WAITING_APPROVAL
    assert record.pending_approval["approval_id"] == appr_id


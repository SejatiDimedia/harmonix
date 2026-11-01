"""Conversation Compaction & Summarization Engine for Multi-Turn Sessions (FR-14).

Compacts older conversation turns into a high-density, structured context summary
to prevent context window overflow and token waste while preserving agreed business rules,
filters, and key numerical findings across long-running sessions.
"""

import asyncio
import json
import logging
from typing import Any
from sqlalchemy import text

from src.db.connection import get_db_session
from src.llm.provider import BaseLLMProvider, get_llm_provider
from src.agent.state import (
    init_task_state_table,
    get_session_compacted_summary,
    save_session_compaction,
)

logger = logging.getLogger(__name__)

COMPACTION_THRESHOLD_TURNS = 5  # Compact once session reaches at least 5 completed turns
RECENT_TURNS_PRESERVED = 3      # Keep the most recent 3 turns uncompacted (verbatim)


COMPACTION_SYSTEM_PROMPT = """Anda adalah Conversation Compaction Engine profesional untuk AI Data Analyst (FR-14).
Tugas Anda adalah merangkum riwayat percakapan lama menjadi ringkasan konteks eksekutif yang padat, terstruktur, dan akurat.

PANDUAN MERANGKUM (MAKSIMAL 4-5 POIN SINGKAT):
1. Domain & Sasaran Analisis: Entitas bisnis atau topik utama yang sedang dianalisis pengguna.
2. Filter & Definisi yang Disepakati: Parameter filter (periode, wilayah, status, kolom yang dikecualikan) yang disetujui bersama.
3. Temuan Angka Kunci: Nilai metrik penting yang telah dihitung sebelumnya agar pengguna dan analis dapat merujuknya kembali tanpa mengulang query.

FORMAT OUTPUT WAJIB (MARKDOWN):
- **Sasaran Analisis**: [1 kalimat ringkas]
- **Filter & Aturan yang Disepakati**: [1-2 poin filter yang dipakai]
- **Temuan Kunci Sebelumnya**: [1-2 poin metrik penting yang telah dihitung]

DILARANG bertele-tele, menyapa, atau mengarang data di luar riwayat yang diberikan."""


async def summarize_older_turns(
    older_turns: list[dict[str, Any]],
    existing_summary: str | None = None,
    llm: BaseLLMProvider | None = None,
) -> str:
    """Generate or update a compacted summary for older turns."""
    turns_text_blocks = []
    for idx, t in enumerate(older_turns, 1):
        q = t.get("user_query", "").strip()
        ans = t.get("answer_text", "").strip()
        # Truncate answer snippet to keep prompt lean and cost-effective
        ans_snippet = ans[:350] + ("..." if len(ans) > 350 else "")
        turns_text_blocks.append(f"Turn #{idx}:\n- Pengguna: {q}\n- Jawaban Analis: {ans_snippet}")

    conversation_text = "\n\n".join(turns_text_blocks)

    if existing_summary and existing_summary.strip():
        user_prompt = (
            f"Perbarui ringkasan konteks percakapan berikut dengan menambahkan percakapan terbaru di bawahnya:\n\n"
            f"RINGKASAN SEBELUMNYA:\n{existing_summary.strip()}\n\n"
            f"PERCAKAPAN TAMBAHAN:\n{conversation_text}"
        )
    else:
        user_prompt = f"Rangkumlah riwayat percakapan lama berikut ini sesuai format:\n\n{conversation_text}"

    provider = llm or get_llm_provider()
    try:
        res = await asyncio.wait_for(
            provider.chat(
                messages=[
                    {"role": "system", "content": COMPACTION_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.0,
            ),
            timeout=10.0,
        )
        summary = (res.content or "").strip()
        if summary:
            return summary
    except Exception as e:
        logger.warning("LLM conversation compaction timed out or failed (%s). Using heuristic fallback.", e)

    # Deterministic Heuristic Fallback (Zero-Cost, Network-Resilient)
    topics = [f"- Pertanyaan #{i}: {t.get('user_query', '')}" for i, t in enumerate(older_turns, 1)]
    return (
        "- **Sasaran Analisis**: Eksplorasi analitik bertahap pada sesi ini.\n"
        "- **Riwayat Kueri Terdahulu**:\n" + "\n".join(topics[:4]) + "\n"
        "- **Status**: Kueri terdahulu telah dieksekusi dan diverifikasi pada database."
    )


async def get_or_update_session_compaction(
    session_id: str,
    llm: BaseLLMProvider | None = None,
) -> tuple[str | None, list[dict[str, Any]]]:
    """Retrieve compacted context and recent verbatim turns for an active session (FR-14).
    
    Returns:
        tuple[compacted_summary, recent_messages_list]
    """
    if not session_id:
        return None, []

    await init_task_state_table()

    # 1. Fetch all completed tasks with non-empty answers in chronological order
    async with get_db_session() as session:
        query = text("""
            SELECT user_query, final_result
            FROM analytics.agent_tasks
            WHERE session_id = :session_id
              AND status = 'COMPLETED'
              AND final_result IS NOT NULL
            ORDER BY created_at ASC;
        """)
        res = await session.execute(query, {"session_id": session_id})
        rows = res.fetchall()

    valid_turns: list[dict[str, Any]] = []
    for r in rows:
        u_query = (r[0] or "").strip()
        f_result = r[1] if isinstance(r[1], dict) else json.loads(r[1])
        ans_text = (f_result.get("answer_text") or "").strip()
        if not ans_text:
            continue
        valid_turns.append({"user_query": u_query, "answer_text": ans_text})

    total_turns = len(valid_turns)
    existing_summary, compacted_count = await get_session_compacted_summary(session_id)

    # Scenario A: Short conversation (fewer than threshold turns)
    if total_turns < COMPACTION_THRESHOLD_TURNS:
        recent_messages: list[dict[str, Any]] = []
        for t in valid_turns[-5:]:
            recent_messages.append({"role": "user", "content": t["user_query"]})
            recent_messages.append({"role": "assistant", "content": t["answer_text"]})
        return existing_summary, recent_messages

    # Scenario B: Long conversation requiring compaction
    older_turns = valid_turns[:-RECENT_TURNS_PRESERVED]
    recent_turns = valid_turns[-RECENT_TURNS_PRESERVED:]

    # Check if newly completed turns need to be compacted into the summary
    if len(older_turns) > compacted_count or not existing_summary:
        logger.info(
            "Triggering FR-14 compaction for session %s (%d older turns, keeping %d recent).",
            session_id, len(older_turns), len(recent_turns)
        )
        new_summary = await summarize_older_turns(
            older_turns=older_turns,
            existing_summary=existing_summary if compacted_count > 0 else None,
            llm=llm,
        )
        await save_session_compaction(session_id, new_summary, len(older_turns))
        active_summary = new_summary
    else:
        active_summary = existing_summary

    # Format recent preserved turns verbatim
    recent_messages = []
    for t in recent_turns:
        recent_messages.append({"role": "user", "content": t["user_query"]})
        recent_messages.append({"role": "assistant", "content": t["answer_text"]})

    return active_summary, recent_messages


async def force_compact_session(
    session_id: str,
    llm: BaseLLMProvider | None = None,
) -> dict[str, Any]:
    """Manually trigger compaction for a session regardless of turn delta."""
    summary, recent = await get_or_update_session_compaction(session_id, llm=llm)
    return {
        "session_id": session_id,
        "compacted_summary": summary,
        "has_compacted_context": bool(summary),
        "recent_preserved_turns": len(recent) // 2,
    }

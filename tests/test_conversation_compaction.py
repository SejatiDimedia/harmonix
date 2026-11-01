"""Unit and integration tests for Conversation Compaction & Summarization (FR-14)."""

import pytest
from unittest.mock import AsyncMock, patch

from src.agent.compaction import (
    COMPACTION_THRESHOLD_TURNS,
    RECENT_TURNS_PRESERVED,
    summarize_older_turns,
    get_or_update_session_compaction,
)
from src.agent.prompts import build_analyst_system_prompt
from src.llm.provider import MockLLMProvider, LLMResponse


@pytest.mark.asyncio
async def test_compaction_constants_integrity():
    """Verify compaction thresholds conform to PRD specifications."""
    assert COMPACTION_THRESHOLD_TURNS == 5
    assert RECENT_TURNS_PRESERVED == 3
    assert COMPACTION_THRESHOLD_TURNS > RECENT_TURNS_PRESERVED


@pytest.mark.asyncio
async def test_summarize_older_turns_with_mock_llm():
    """Test LLM summarization of conversation turns."""
    mock_llm = MockLLMProvider()
    mock_summary = (
        "- **Sasaran Analisis**: Evaluasi penjualan cabang Bandung 2024.\n"
        "- **Filter & Aturan yang Disepakati**: Hanya pesanan selesai, diskon dihitung.\n"
        "- **Temuan Kunci Sebelumnya**: Total penjualan mencapai Rp 500.000.000."
    )
    mock_llm.chat = AsyncMock(return_value=LLMResponse(content=mock_summary))

    older_turns = [
        {"user_query": "Berapa total penjualan Bandung 2024?", "answer_text": "Total penjualan Bandung adalah Rp 500.000.000."},
        {"user_query": "Apakah sudah termasuk diskon?", "answer_text": "Ya, diskon sudah diperhitungkan."},
    ]

    summary = await summarize_older_turns(older_turns=older_turns, llm=mock_llm)
    assert "Sasaran Analisis" in summary
    assert "Rp 500.000.000" in summary
    assert mock_llm.chat.called


@pytest.mark.asyncio
async def test_summarize_older_turns_heuristic_fallback_on_error():
    """Test that summarizer gracefully falls back to deterministic heuristic when LLM fails."""
    mock_llm = MockLLMProvider()
    mock_llm.chat = AsyncMock(side_effect=RuntimeError("API Gateway Timeout"))

    older_turns = [
        {"user_query": "Analisis stok gudang Surabaya", "answer_text": "Stok tercatat 1.200 unit."},
    ]

    summary = await summarize_older_turns(older_turns=older_turns, llm=mock_llm)
    assert "- **Sasaran Analisis**" in summary
    assert "Analisis stok gudang Surabaya" in summary
    assert "- **Status**" in summary


@pytest.mark.asyncio
async def test_system_prompt_injects_compacted_context():
    """Test that build_analyst_system_prompt injects the compacted summary seamlessly."""
    test_summary = (
        "- **Sasaran Analisis**: Investigasi logistik Q3.\n"
        "- **Filter**: Status 'selesai'."
    )
    prompt = await build_analyst_system_prompt(
        session_id="test_sess_123",
        compacted_summary=test_summary,
    )

    assert "RINGKASAN KONTEKS PERCAKAPAN SEBELUMNYA DALAM SESI INI (FR-14 SESSION COMPACTION)" in prompt
    assert "Investigasi logistik Q3" in prompt
    assert "Status 'selesai'" in prompt
    assert "ATURAN KONTEKS SESI" in prompt


@pytest.mark.asyncio
async def test_empty_session_id_returns_clean_compaction():
    """Test get_or_update_session_compaction handles empty session safely."""
    summary, recent = await get_or_update_session_compaction(session_id="")
    assert summary is None
    assert recent == []

"""Unit tests for Data Auditor & Verification Agent (FR-35)."""

import pytest
from src.agent.auditor import DataAuditorAgent
from src.agent.models import AuditStatus, TableData
from src.config import settings
from src.llm.provider import LLMResponse, MockLLMProvider


@pytest.mark.asyncio
async def test_auditor_greeting_heuristic_pass():
    """Greeting questions without SQL pass audit immediately via heuristic."""
    auditor = DataAuditorAgent(llm=MockLLMProvider())
    verdict = await auditor.audit(
        user_query="Halo, siapa kamu?",
        answer_text="Halo! Saya Harnessly, AI Data Analyst.",
        executed_sqls=[],
        tables=[],
    )
    assert verdict.status == AuditStatus.PASSED
    assert verdict.confidence_score == 1.0
    assert "Verified" in verdict.badge
    assert verdict.model_used == "heuristic"


@pytest.mark.asyncio
async def test_auditor_missing_sql_heuristic_flag():
    """Analytical questions with 0 executed SQLs get flagged via heuristic."""
    auditor = DataAuditorAgent(llm=MockLLMProvider())
    verdict = await auditor.audit(
        user_query="Berapa total penjualan kategori elektronik bulan lalu?",
        answer_text="Total penjualan adalah Rp 100.000.000.",
        executed_sqls=[],
        tables=[],
    )
    assert verdict.status == AuditStatus.FLAGGED
    assert len(verdict.issues) > 0
    assert verdict.issues[0].category == "completeness"
    assert "Missing SQL" in verdict.badge


@pytest.mark.asyncio
async def test_auditor_llm_passed_verdict():
    """Test auditor correctly parses LLM response approving the analysis."""
    canned_json = """
    {
      "status": "PASSED",
      "confidence_score": 0.98,
      "badge": "Verified by Data Auditor",
      "critique": "Logika query SQL tepat, filter status delivered diterapkan, dan angka pendapatan sinkron.",
      "issues": []
    }
    """
    mock_llm = MockLLMProvider(canned_responses=[LLMResponse(content=canned_json)])
    auditor = DataAuditorAgent(llm=mock_llm)

    table = TableData(
        columns=["product_category_name", "total_revenue"],
        rows=[["Electronics", 45000000], ["Fashion", 25000000]],
        row_count=2,
    )

    verdict = await auditor.audit(
        user_query="Tampilkan total revenue per kategori",
        answer_text="Total revenue kategori Electronics adalah Rp 45.000.000 dan Fashion Rp 25.000.000.",
        executed_sqls=["SELECT product_category_name, SUM(price) FROM analytics.order_items GROUP BY 1"],
        tables=[table],
    )

    assert verdict.status == AuditStatus.PASSED
    assert verdict.confidence_score == 0.98
    assert "Verified by Data Auditor" in verdict.badge
    assert len(verdict.issues) == 0


@pytest.mark.asyncio
async def test_auditor_llm_flagged_verdict():
    """Test auditor identifies discrepancies flagged by the LLM."""
    canned_json = """
    {
      "status": "FLAGGED",
      "confidence_score": 0.92,
      "badge": "Auditor Flagged: Logic Discrepancy",
      "critique": "Ditemukan Cartesian product pada join orders dan order_items.",
      "issues": [
        {
          "category": "sql_logic",
          "severity": "high",
          "description": "Join berganda menyebabkan total order terhitung 3x lipat.",
          "suggested_fix": "Gunakan COUNT(DISTINCT orders.order_id) ketimbang COUNT(*)."
        }
      ]
    }
    """
    mock_llm = MockLLMProvider(canned_responses=[LLMResponse(content=canned_json)])
    auditor = DataAuditorAgent(llm=mock_llm)

    verdict = await auditor.audit(
        user_query="Hitung jumlah transaksi",
        answer_text="Jumlah transaksi adalah 300.",
        executed_sqls=["SELECT COUNT(*) FROM analytics.orders JOIN analytics.order_items ON orders.order_id = order_items.order_id"],
        tables=[TableData(columns=["count"], rows=[[300]], row_count=1)],
    )

    assert verdict.status == AuditStatus.FLAGGED
    assert len(verdict.issues) == 1
    assert verdict.issues[0].severity == "high"
    assert "Cartesian" in verdict.critique
    assert "3x lipat" in verdict.issues[0].description


@pytest.mark.asyncio
async def test_auditor_graceful_degradation_on_exception():
    """Test auditor returns fallback verdict when LLM fails without throwing an uncaught error."""
    class FailingLLM(MockLLMProvider):
        async def chat(self, messages, tools=None, temperature=0.0):
            raise ConnectionError("Groq API timeout / rate limit")

    auditor = DataAuditorAgent(llm=FailingLLM())
    table = TableData(columns=["status"], rows=[["delivered"]], row_count=1)

    verdict = await auditor.audit(
        user_query="Status order terbaru",
        answer_text="Status order adalah delivered.",
        executed_sqls=["SELECT order_status FROM analytics.orders LIMIT 1"],
        tables=[table],
    )

    # Fail-open: since query executed and returned rows, it gives a heuristic pass
    assert verdict.status == AuditStatus.PASSED
    assert "Heuristic" in verdict.badge or "Verified" in verdict.badge


@pytest.mark.asyncio
async def test_auditor_disabled_setting():
    """When auditor is disabled in settings, it returns SKIPPED verdict."""
    original = settings.auditor_enabled
    try:
        settings.auditor_enabled = False
        auditor = DataAuditorAgent()
        verdict = await auditor.audit(
            user_query="Berapa order?",
            answer_text="100",
            executed_sqls=[],
            tables=[],
        )
        assert verdict.status == AuditStatus.SKIPPED
        assert "Skipped" in verdict.badge
    finally:
        settings.auditor_enabled = original


@pytest.mark.asyncio
async def test_manual_loop_yields_audit_step_and_attaches_result():
    """ManualAgentLoop yields audit_step and includes audit_result in final_response (FR-35)."""
    from src.agent.manual_loop import ManualAgentLoop

    canned_audit = """
    {
      "status": "PASSED",
      "confidence_score": 0.99,
      "badge": "Verified by Data Auditor",
      "critique": "Data konsisten.",
      "issues": []
    }
    """
    mock_auditor_llm = MockLLMProvider(canned_responses=[LLMResponse(content=canned_audit)])
    custom_auditor = DataAuditorAgent(llm=mock_auditor_llm)

    analyst_llm = MockLLMProvider(canned_responses=[
        LLMResponse(content="Halo! Saya adalah AI Data Analyst Harnessly.")
    ])

    loop = ManualAgentLoop(llm=analyst_llm, auditor=custom_auditor)
    events = []
    async for event in loop.run(user_query="Halo, siapa kamu?"):
        events.append(event)

    event_names = [e["event"] for e in events]
    assert "audit_step" in event_names
    assert "final_result" in event_names

    final_result_event = next(e for e in events if e["event"] == "final_result")
    final_data = final_result_event["data"]
    assert "audit_result" in final_data
    assert final_data["audit_result"] is not None
    assert final_data["audit_result"]["status"] == "PASSED"

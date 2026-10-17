"""Unit and integration tests for Evaluation suite, Runner, and LLM Judge (EV-01 - EV-06)."""

import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app
from src.eval.judge import LLMJudge
from src.eval.runner import EvalRunner


def test_eval_dataset_integrity():
    """Verify evaluation dataset contains at least 40 valid cases across all required categories (EV-01)."""
    runner = EvalRunner(dataset_path="data/eval_dataset.json")
    cases = runner.load_dataset()

    assert len(cases) >= 40, f"Expected at least 40 cases, got {len(cases)}"

    categories = {c["category"] for c in cases}
    required_categories = {
        "simple", "medium", "complex",
        "adversarial_injection", "adversarial_pii", "adversarial_logic"
    }
    assert required_categories.issubset(categories), f"Missing categories: {required_categories - categories}"

    for case in cases:
        assert "id" in case
        assert "question" in case
        assert "category" in case
        assert "risk_level" in case


@pytest.mark.asyncio
async def test_eval_runner_adversarial_safety():
    """Verify eval runner enforces 100% safety pass rate on adversarial injection cases (EV-02)."""
    runner = EvalRunner(dataset_path="data/eval_dataset.json")
    cases = runner.load_dataset()
    adversarial_cases = [c for c in cases if c["category"] == "adversarial_injection"]

    assert len(adversarial_cases) >= 5

    for case in adversarial_cases:
        res = await runner.evaluate_single_case(case)
        assert res.safety_passed is True, f"Failed safety on case {case['id']}: {res.failure_reason}"


@pytest.mark.asyncio
async def test_llm_judge_evaluation():
    """Verify LLM-as-a-Judge returns structured grading on question and SQL output (EV-03)."""
    judge = LLMJudge()
    res = await judge.evaluate_response(
        query="Berapa total pesanan selesai?",
        sql_query="SELECT COUNT(*) FROM analytics.orders WHERE status = 'delivered';",
        table_data=[{"count": 1250}],
        answer_text="Berdasarkan data tabel pesanan, terdapat 1.250 pesanan yang berstatus selesai.",
    )
    assert 1 <= res.faithfulness_score <= 5
    assert 1 <= res.clarity_score <= 5
    assert res.passed is True
    assert len(res.rationale) > 0


@pytest.mark.asyncio
async def test_api_metrics_endpoint():
    """Verify GET /v1/metrics returns system-wide metrics and drift status (OB-03, OB-04)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_requests" in data
        assert "p50_latency_ms" in data
        assert "p95_latency_ms" in data
        assert "total_tokens_consumed" in data
        assert "drift_detected" in data
        assert "total_estimated_cost_usd" in data
        assert data["total_estimated_cost_usd"] == 0.0

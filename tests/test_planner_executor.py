"""Unit tests for FR-04 Sub-Agent Swarm & Planner-Executor Multi-Agent Architecture."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.agent.models import AgentFinalResponse, TableData
from src.agent.planner_executor import (
    ExecutionPlan,
    PlannerExecutorAgent,
    SubTaskSpec,
)
from src.llm.provider import LLMResponse, MockLLMProvider, ToolCall


def test_subtask_and_execution_plan_models():
    """Verify SubTaskSpec and ExecutionPlan models validate correctly."""
    task1 = SubTaskSpec(
        id=1,
        role="sql_specialist",
        title="Ambil Omzet Bulanan",
        instruction="SELECT date_trunc('month', order_purchase_timestamp), SUM(payment_value)...",
        expected_output="Tabel omzet per bulan",
    )
    task2 = SubTaskSpec(
        id=2,
        role="chart_specialist",
        title="Visualisasi Tren",
        instruction="Buat diagram garis omzet bulanan",
        expected_output="ChartSpec line",
    )

    plan = ExecutionPlan(
        goal="Analisis tren omzet bulanan dan visualisasi grafik",
        complexity_level="moderate",
        reasoning="Perlu kueri SQL diikuti visualisasi chart garis",
        tasks=[task1, task2],
    )

    assert len(plan.tasks) == 2
    assert plan.tasks[0].role == "sql_specialist"
    assert plan.tasks[1].role == "chart_specialist"
    assert plan.complexity_level == "moderate"


def test_heuristic_fallback_plan_decomposition():
    """Verify heuristic planner adapts plan based on user query intent."""
    agent = PlannerExecutorAgent(llm=MockLLMProvider())

    # 1. Simple query -> 1 task
    simple_plan = agent._heuristic_fallback_plan("Berapa total pesanan?")
    assert len(simple_plan.tasks) == 1
    assert simple_plan.tasks[0].role == "sql_specialist"
    assert simple_plan.complexity_level == "simple"

    # 2. Query with comparison and chart -> multi-task
    complex_plan = agent._heuristic_fallback_plan(
        "Bandingkan penjualan kategori Elektronik vs Fashion dan buatkan diagram garis trennya"
    )
    roles = [t.role for t in complex_plan.tasks]
    assert "sql_specialist" in roles
    assert "calc_specialist" in roles
    assert "chart_specialist" in roles
    assert complex_plan.complexity_level == "moderate"


@pytest.mark.asyncio
async def test_planner_llm_json_plan_generation():
    """Verify PlannerAgent correctly parses JSON plan from LLM response."""
    mock_llm = MagicMock(spec=MockLLMProvider)
    mock_plan_json = """
    Berikut rencana analisis:
    ```json
    {
      "goal": "Bandingkan performa penjualan 3 kategori teratas",
      "complexity_level": "moderate",
      "reasoning": "Dekomposisi menjadi ekstraksi data diikuti perancangan grafik",
      "tasks": [
        {
          "id": 1,
          "role": "sql_specialist",
          "title": "Kueri 3 Kategori Teratas",
          "instruction": "SELECT product_category_name, SUM(price) FROM ...",
          "expected_output": "3 baris data kategori"
        },
        {
          "id": 2,
          "role": "chart_specialist",
          "title": "Diagram Batang",
          "instruction": "Buat diagram batang untuk 3 kategori",
          "expected_output": "Bar chart"
        }
      ]
    }
    ```
    """
    mock_llm.chat = AsyncMock(return_value=LLMResponse(content=mock_plan_json))

    agent = PlannerExecutorAgent(llm=mock_llm)
    plan = await agent._generate_plan(user_query="Bandingkan 3 kategori teratas")

    assert plan.goal == "Bandingkan performa penjualan 3 kategori teratas"
    assert len(plan.tasks) == 2
    assert plan.tasks[0].role == "sql_specialist"
    assert plan.tasks[1].role == "chart_specialist"


@pytest.mark.asyncio
async def test_full_swarm_execution_stream():
    """Verify PlannerExecutorAgent streams swarm events and produces final response."""
    agent = PlannerExecutorAgent(llm=MockLLMProvider())
    agent.run_sql_tool.execute = AsyncMock(
        return_value={
            "status": "success",
            "sanitized_query": "SELECT SUM(payment_value) as total_sales FROM olist_order_payments;",
            "columns": ["total_sales"],
            "rows": [[274881200]],
            "row_count": 1,
        }
    )

    events = []
    async for event in agent.run_stream(
        user_query="Berapa total penjualan dan buat grafiknya?",
        task_id="test_swarm_task_1",
    ):
        events.append(event)

    event_types = [e["event"] for e in events]
    assert "step_start" in event_types
    assert "plan_created" in event_types
    assert "subagent_start" in event_types
    assert "subagent_complete" in event_types
    assert "final_result" in event_types

    # Validate final_result payload
    final_ev = next(e for e in events if e["event"] == "final_result")
    final_data = final_ev["data"]
    assert "answer_text" in final_data
    assert "execution_plan" in final_data
    assert final_data["execution_plan"]["goal"] != ""
    assert len(final_data["execution_plan"]["tasks"]) >= 1


@pytest.mark.asyncio
async def test_planner_executor_run_direct_call():
    """Verify run() returns AgentFinalResponse with execution_plan attached."""
    agent = PlannerExecutorAgent(llm=MockLLMProvider())
    agent.run_sql_tool.execute = AsyncMock(
        return_value={
            "status": "success",
            "sanitized_query": "SELECT AVG(payment_value) as avg_payment FROM olist_order_payments;",
            "columns": ["avg_payment"],
            "rows": [[154.2]],
            "row_count": 1,
        }
    )

    response = await agent.run(
        user_query="Berapa rata-rata nilai transaksi?",
        task_id="test_swarm_direct",
    )

    assert isinstance(response, AgentFinalResponse)
    assert response.execution_plan is not None
    assert "tasks" in response.execution_plan
    assert len(response.execution_plan["tasks"]) >= 1

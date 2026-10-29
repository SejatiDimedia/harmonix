"""Unit tests for the manual agent loop and safety constraints."""

import pytest
from src.agent.manual_loop import ManualAgentLoop
from src.agent.models import AgentFinalResponse
from src.llm.provider import MockLLMProvider


@pytest.mark.asyncio
async def test_manual_agent_loop_execution_flow():
    """Verify standard reasoning flow: step_start -> tool call -> final_result."""
    mock_llm = MockLLMProvider()
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5)

    events = []
    async for event in agent.run(user_query="Berapa total penjualan kategori Electronics?"):
        events.append(event)

    event_types = [e["event"] for e in events]
    assert "step_start" in event_types
    assert "token" in event_types
    assert "final_result" in event_types

    # Find final result event
    final_event = next(e for e in events if e["event"] == "final_result")
    final_data = final_event["data"]

    assert "answer_text" in final_data
    assert len(final_data["answer_text"]) > 0
    assert final_data["total_steps"] > 0
    assert "token_usage" in final_data


@pytest.mark.asyncio
async def test_manual_agent_loop_max_steps_limit():
    """Verify that loop terminates gracefully when max_steps limit is exceeded."""
    # A mock that keeps calling tools indefinitely
    from src.llm.provider import LLMResponse, ToolCall, LLMUsage

    looping_responses = [
        LLMResponse(
            content=f"Step {i}",
            tool_calls=[ToolCall(name="get_schema", arguments={"table_names": ["products"]})],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
        )
        for i in range(10)
    ]

    mock_llm = MockLLMProvider(canned_responses=looping_responses)
    agent = ManualAgentLoop(llm=mock_llm, max_steps=3)

    events = []
    async for event in agent.run(user_query="Tolong analisa tanpa henti"):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    assert final_event["data"]["total_steps"] == 3
    assert "Batas langkah" in final_event["data"]["answer_text"]


@pytest.mark.asyncio
async def test_manual_agent_loop_token_budget_limit():
    """Verify that loop aborts when total token budget is exhausted."""
    from src.llm.provider import LLMResponse, ToolCall, LLMUsage

    expensive_response = LLMResponse(
        content="Heavy prompt response",
        tool_calls=[ToolCall(name="get_schema", arguments={})],
        usage=LLMUsage(prompt_tokens=5000, completion_tokens=5000, total_tokens=10000),
    )

    mock_llm = MockLLMProvider(canned_responses=[expensive_response, expensive_response])
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5, max_token_budget=8000)

    events = []
    async for event in agent.run(user_query="Pertanyaan berat token"):
        events.append(event)

    error_events = [e for e in events if e["event"] == "error"]
    assert len(error_events) > 0
    assert "token budget" in error_events[0]["data"]["message"].lower()


@pytest.mark.asyncio
async def test_manual_agent_loop_meta_identity_query_does_not_force_sql():
    """Verify that identity or meta queries (e.g. asking who the model is, context window)
    do not trigger the premature finalization SQL nudge loop."""
    from src.llm.provider import LLMResponse, LLMUsage

    identity_response = LLMResponse(
        content="Saya adalah Gemini 3.8 Flash yang diciptakan oleh Google dengan context window 1 juta token.",
        tool_calls=[],
        usage=LLMUsage(prompt_tokens=20, completion_tokens=30, total_tokens=50),
    )

    mock_llm = MockLLMProvider(canned_responses=[identity_response])
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5)

    events = []
    async for event in agent.run(
        user_query="Sebutkan siapa kamu sebenarnya, siapa perusahaan yang menciptakanmu, dan berapa batas context window kamu?"
    ):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    # Must finish cleanly in 1 step without nudging or forcing SQL
    assert final_event["data"]["total_steps"] == 1
    assert "Gemini 3.8 Flash" in final_event["data"]["answer_text"]
    assert len(final_event["data"]["sql_queries"]) == 0


@pytest.mark.asyncio
async def test_manual_agent_loop_emergency_synthesis_on_step_limit():
    """Verify that when agent reaches max_steps with captured SQL/data,
    it executes emergency synthesis to produce a complete answer rather than an empty fallback."""
    from src.llm.provider import LLMResponse, ToolCall, LLMUsage

    # Step 1: run query
    resp1 = LLMResponse(
        content=None,
        tool_calls=[ToolCall(name="run_sql", arguments={"query": "SELECT 100 AS pendapatan;"})],
        usage=LLMUsage(prompt_tokens=20, completion_tokens=20, total_tokens=40),
    )
    # Step 2: run query again
    resp2 = LLMResponse(
        content=None,
        tool_calls=[ToolCall(name="run_sql", arguments={"query": "SELECT 200 AS pendapatan_bersih;"})],
        usage=LLMUsage(prompt_tokens=20, completion_tokens=20, total_tokens=40),
    )
    # Emergency synthesis response
    synth_resp = LLMResponse(
        content="Berdasarkan data yang diekstrak, total pendapatan bersih adalah Rp 200.",
        tool_calls=[],
        usage=LLMUsage(prompt_tokens=30, completion_tokens=30, total_tokens=60),
    )

    mock_llm = MockLLMProvider(canned_responses=[resp1, resp2, synth_resp])
    agent = ManualAgentLoop(llm=mock_llm, max_steps=2)

    events = []
    async for event in agent.run(user_query="Berapa total pendapatan bersih?"):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    assert final_event["data"]["total_steps"] == 2
    assert "Batas langkah" in final_event["data"]["answer_text"]
    assert "total pendapatan bersih adalah Rp 200" in final_event["data"]["answer_text"]
    assert len(final_event["data"]["sql_queries"]) >= 1



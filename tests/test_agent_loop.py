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

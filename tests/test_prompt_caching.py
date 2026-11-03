"""Unit tests for FR-15 Prompt Caching Engine."""

import pytest
from unittest.mock import MagicMock
from src.agent.caching import (
    apply_prompt_cache_control,
    calculate_cache_efficiency,
    extract_cached_tokens,
    get_cached_session_schema_prompt,
    invalidate_session_schema_cache,
)
from src.agent.prompts import BASE_ANALYST_SYSTEM_PROMPT, build_analyst_system_prompt
from src.agent.manual_loop import DataAnalystAgent
from src.llm.provider import MockLLMProvider, LLMResponse, ToolCall, LLMUsage


class DummyColumn:
    def __init__(self, name: str, data_type: str = "TEXT", sample_values: list = None):
        self.name = name
        self.data_type = data_type
        self.sample_values = sample_values or []


class DummyTable:
    def __init__(self, table_name: str, row_count: int = 100):
        self.table_name = table_name
        self.original_filename = "sales_2025.xlsx"
        self.sheet_name = "Sheet1"
        self.row_count = row_count
        self.columns = [
            DummyColumn("order_id", "VARCHAR"),
            DummyColumn("amount", "NUMERIC", ["150000", "200000"]),
        ]


@pytest.mark.asyncio
async def test_deterministic_prefix_ordering():
    """Verify static base prompt is strictly token prefix 0 and precedes dynamic context (FR-15)."""
    session_id = "test_session_prefix"
    compaction = "Sasaran: Analisis Q1. Filter: Delivered orders."
    memory_item = MagicMock()
    memory_item.question_text = "Berapa total pesanan?"
    memory_item.sql_query = "SELECT COUNT(*) FROM orders;"
    memory_item.explanation = "Gunakan tabel orders."
    memory_item.similarity = 0.92

    prompt = await build_analyst_system_prompt(
        session_id=session_id,
        recalled_memories=[memory_item],
        compacted_summary=compaction,
    )

    # 1. Base analyst prompt MUST start at index 0 (deterministic prefix)
    assert prompt.startswith(BASE_ANALYST_SYSTEM_PROMPT)

    # 2. Dynamic compaction context MUST appear AFTER the base prompt
    assert compaction in prompt
    assert prompt.index(compaction) > len(BASE_ANALYST_SYSTEM_PROMPT)


def test_schema_prompt_cache_and_invalidation():
    """Verify in-memory schema prompt caching produces bit-exact strings and evicts properly."""
    session_id = "session_cache_test_123"
    invalidate_session_schema_cache(session_id)

    tables = [DummyTable("upload_test_sales", row_count=250)]

    # 1. First call populates cache
    prompt_1 = get_cached_session_schema_prompt(session_id, tables)
    assert "upload_test_sales" in prompt_1
    assert "250 baris" in prompt_1

    # 2. Second call reuses cached prompt
    prompt_2 = get_cached_session_schema_prompt(session_id, tables)
    assert prompt_1 == prompt_2

    # 3. Invalidation clears cache
    invalidate_session_schema_cache(session_id)
    tables_updated = [DummyTable("upload_test_sales", row_count=500)]
    prompt_3 = get_cached_session_schema_prompt(session_id, tables_updated)
    assert "500 baris" in prompt_3


def test_extract_cached_tokens_various_formats():
    """Verify cached token extraction across OpenAI, OpenRouter, DeepSeek, and Gemini formats."""
    # 1. OpenAI / OpenRouter prompt_tokens_details
    resp_openai = {
        "usage": {
            "prompt_tokens": 1200,
            "completion_tokens": 150,
            "total_tokens": 1350,
            "prompt_tokens_details": {"cached_tokens": 1024},
        }
    }
    assert extract_cached_tokens(resp_openai) == 1024

    # 2. OpenRouter / 9Router top-level cached_tokens
    resp_openrouter = {
        "usage": {
            "prompt_tokens": 800,
            "completion_tokens": 100,
            "total_tokens": 900,
            "cached_tokens": 650,
        }
    }
    assert extract_cached_tokens(resp_openrouter) == 650

    # 3. DeepSeek prompt_cache_hit_tokens
    resp_deepseek = {
        "usage": {
            "prompt_tokens": 1500,
            "completion_tokens": 80,
            "total_tokens": 1580,
            "prompt_cache_hit_tokens": 1280,
        }
    }
    assert extract_cached_tokens(resp_deepseek) == 1280

    # 4. Anthropic / OpenRouter cache_read_input_tokens
    resp_anthropic = {
        "usage": {
            "prompt_tokens": 2000,
            "completion_tokens": 200,
            "total_tokens": 2200,
            "cache_read_input_tokens": 1800,
        }
    }
    assert extract_cached_tokens(resp_anthropic) == 1800

    # 5. Google Gemini native usageMetadata
    resp_gemini = {
        "usageMetadata": {
            "promptTokenCount": 3500,
            "candidatesTokenCount": 250,
            "totalTokenCount": 3750,
            "cachedContentTokenCount": 3000,
        }
    }
    assert extract_cached_tokens(resp_gemini) == 3000

    # 6. Empty / No cache
    assert extract_cached_tokens({}) == 0
    assert extract_cached_tokens({"usage": {"prompt_tokens": 100}}) == 0


def test_cache_control_injection_openrouter_anthropic():
    """Verify cache_control: {type: ephemeral} injection for Anthropic / OpenRouter Claude."""
    messages = [
        {"role": "system", "content": "You are a senior data analyst."},
        {"role": "user", "content": "Analyze total sales."},
    ]

    # For OpenRouter + Claude: should format system content into multi-part with cache_control
    formatted_claude = apply_prompt_cache_control(
        messages,
        provider="openrouter",
        model="anthropic/claude-3.5-sonnet",
    )
    assert isinstance(formatted_claude[0]["content"], list)
    assert formatted_claude[0]["content"][0]["type"] == "text"
    assert formatted_claude[0]["content"][0]["cache_control"] == {"type": "ephemeral"}

    # For standard Ollama / OpenAI: should leave content as clean string for exact prefix match
    formatted_ollama = apply_prompt_cache_control(
        messages,
        provider="ollama",
        model="qwen2.5-coder:7b",
    )
    assert isinstance(formatted_ollama[0]["content"], str)
    assert formatted_ollama[0]["content"] == "You are a senior data analyst."


def test_calculate_cache_efficiency():
    """Verify calculation of cache hit rate and token savings."""
    # 0% cache hit
    eff_zero = calculate_cache_efficiency(prompt_tokens=1000, cached_tokens=0)
    assert eff_zero["cache_hit_rate"] == 0.0
    assert eff_zero["status"] == "MISS"

    # Partial cache hit (500 / 1000 = 50%)
    eff_partial = calculate_cache_efficiency(prompt_tokens=1000, cached_tokens=500)
    assert eff_partial["cache_hit_rate"] == 50.0
    assert eff_partial["status"] == "PARTIAL_HIT"

    # Full/High cache hit (850 / 1000 = 85%)
    eff_high = calculate_cache_efficiency(prompt_tokens=1000, cached_tokens=850)
    assert eff_high["cache_hit_rate"] == 85.0
    assert eff_high["status"] == "FULL_HIT"


@pytest.mark.asyncio
async def test_manual_loop_accumulates_cached_tokens():
    """Verify that ManualAgentLoop accumulates cached_tokens throughout the agent loop."""
    canned = [
        LLMResponse(
            content="Mengecek skema tabel.",
            tool_calls=[ToolCall(id="c1", name="dummy_tool", arguments={})],
            usage=LLMUsage(prompt_tokens=200, completion_tokens=30, total_tokens=230, cached_tokens=0),
            model="mock-caching-test",
        ),
        LLMResponse(
            content="Menjalankan kueri SQL.",
            tool_calls=[ToolCall(id="c2", name="dummy_tool", arguments={})],
            usage=LLMUsage(prompt_tokens=300, completion_tokens=40, total_tokens=340, cached_tokens=180),
            model="mock-caching-test",
        ),
        LLMResponse(
            content="Total pesanan adalah 100.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=400, completion_tokens=50, total_tokens=450, cached_tokens=250),
            model="mock-caching-test",
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses=canned)
    
    # Create lightweight mock tool avoiding FastEmbed initialization
    from unittest.mock import AsyncMock, patch
    from src.observability.models import TaskMetrics
    from src.agent.models import AuditVerdict, AuditStatus

    mock_tool = MagicMock()
    mock_tool.name = "dummy_tool"
    mock_tool.to_openai_schema.return_value = {
        "type": "function",
        "function": {"name": "dummy_tool", "description": "dummy", "parameters": {}},
    }
    mock_tool.execute = AsyncMock(return_value={"status": "success", "data": "ok"})
    
    agent = DataAnalystAgent(llm=mock_llm, tools=[mock_tool], max_steps=5)
    agent.auditor.audit = AsyncMock(return_value=AuditVerdict(status=AuditStatus.PASSED, confidence_score=0.95, badge="Verified"))

    with patch("src.agent.manual_loop.save_task_checkpoint", new=AsyncMock()), \
         patch("src.agent.manual_loop.store_successful_query", new=AsyncMock()), \
         patch("src.agent.manual_loop.retrieve_relevant_memories", new=AsyncMock(return_value=[])), \
         patch("src.observability.tracer.AgentTracer.flush", new=AsyncMock(return_value=TaskMetrics(task_id="t1", total_tokens=1020, cached_tokens=430))):
        
        final_result = None
        async for event in agent.run(user_query="Berapa total pesanan?"):
            if event.get("event") == "final_result":
                final_result = event.get("data")

    assert final_result is not None
    # 0 + 180 + 250 = 430 cached tokens
    assert final_result.get("token_usage", {}).get("cached_tokens") == 430
    assert final_result.get("metrics", {}).get("cached_tokens") == 430

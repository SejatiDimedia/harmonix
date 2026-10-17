"""Unit tests for Model Routing and Automatic Fallback (FR-28)."""

import asyncio
from typing import Any, AsyncIterator
import httpx
import pytest

from src.llm.provider import (
    BaseLLMProvider,
    FallbackLLMProvider,
    LLMResponse,
    LLMUsage,
    MockLLMProvider,
    RoutedLLMProvider,
    create_single_provider,
)


class FailingLLMProvider(BaseLLMProvider):
    """Test provider that raises specific errors for testing resilience."""

    def __init__(self, error_to_raise: Exception, succeed_after_n_calls: int = 999):
        self.error_to_raise = error_to_raise
        self.succeed_after_n_calls = succeed_after_n_calls
        self.calls = 0

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        self.calls += 1
        if self.calls > self.succeed_after_n_calls:
            return LLMResponse(content="Recovered after retry", model="recovering-model")
        raise self.error_to_raise

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        self.calls += 1
        if self.calls > self.succeed_after_n_calls:
            yield "Recovered "
            yield "token"
            return
        raise self.error_to_raise


@pytest.mark.asyncio
async def test_fallback_primary_success():
    """Primary provider succeeds normally without triggering fallback."""
    primary = MockLLMProvider([LLMResponse(content="Primary Success", model="primary-mock")])
    fallback = MockLLMProvider([LLMResponse(content="Fallback Content", model="fallback-mock")])

    resilient = FallbackLLMProvider(primary=primary, fallback=fallback, max_retries=1, backoff_base_seconds=0.01)
    resp = await resilient.chat([{"role": "user", "content": "Halo"}])

    assert resp.content == "Primary Success"
    assert resilient.fallback_triggered is False
    assert resilient.last_used_provider == "primary-mock"


@pytest.mark.asyncio
async def test_fallback_on_rate_limit_429():
    """Primary provider hits 429 rate limit, triggers backoff and falls back to secondary."""
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    resp_429 = httpx.Response(status_code=429, text="Rate limit exceeded: TPM limit reached", request=req)
    err = httpx.HTTPStatusError("429 Too Many Requests", request=req, response=resp_429)

    primary = FailingLLMProvider(err)
    fallback = MockLLMProvider([LLMResponse(content="Fallback Response from Local Ollama", model="ollama-qwen")])

    resilient = FallbackLLMProvider(primary=primary, fallback=fallback, max_retries=1, backoff_base_seconds=0.01)
    resp = await resilient.chat([{"role": "user", "content": "Berapa total pesanan?"}])

    assert resp.content == "Fallback Response from Local Ollama"
    assert resilient.fallback_triggered is True
    assert resilient.last_used_provider == "ollama-qwen"
    assert primary.calls == 2  # Initial call + 1 retry before fallback


@pytest.mark.asyncio
async def test_fallback_on_timeout():
    """Primary provider times out, falls back to backup provider."""
    primary = FailingLLMProvider(httpx.ReadTimeout("Connection timed out after 30s"))
    fallback = MockLLMProvider([LLMResponse(content="Fallback on timeout", model="fallback-model")])

    resilient = FallbackLLMProvider(primary=primary, fallback=fallback, max_retries=0, backoff_base_seconds=0.01)
    resp = await resilient.chat([{"role": "user", "content": "Query"}])

    assert resp.content == "Fallback on timeout"
    assert resilient.fallback_triggered is True


@pytest.mark.asyncio
async def test_fallback_stream_chat():
    """Streaming fails on primary, streams smoothly from fallback provider."""
    primary = FailingLLMProvider(RuntimeError("429 Quota Exceeded"))
    fallback = MockLLMProvider([LLMResponse(content="Streaming from fallback Ollama")])

    resilient = FallbackLLMProvider(primary=primary, fallback=fallback, max_retries=1, backoff_base_seconds=0.01)
    tokens = []
    async for chunk in resilient.stream_chat([{"role": "user", "content": "Query"}]):
        tokens.append(chunk)

    joined = "".join(tokens)
    assert "Streaming from fallback Ollama" in joined
    assert resilient.fallback_triggered is True


@pytest.mark.asyncio
async def test_routed_llm_provider():
    """RoutedLLMProvider dynamically directs query to appropriate provider."""
    provider_simple = MockLLMProvider([LLMResponse(content="Simple result", model="fast-model")])
    provider_complex = MockLLMProvider([LLMResponse(content="Complex analytical result", model="heavy-model")])

    def route_by_query(messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None) -> str:
        text = messages[-1]["content"].lower()
        if "rumit" in text or "analisis mendalam" in text:
            return "complex"
        return "simple"

    router = RoutedLLMProvider(
        providers={"simple": provider_simple, "complex": provider_complex},
        default_route="simple",
        router_fn=route_by_query,
    )

    res1 = await router.chat([{"role": "user", "content": "Pertanyaan sederhana"}])
    assert res1.content == "Simple result"
    assert router.last_used_provider == "simple"

    res2 = await router.chat([{"role": "user", "content": "Pertanyaan dengan analisis mendalam"}])
    assert res2.content == "Complex analytical result"
    assert router.last_used_provider == "complex"


def test_create_single_provider():
    """Verify single provider factory builds supported zero-cost providers."""
    mock_p = create_single_provider("mock")
    assert isinstance(mock_p, MockLLMProvider)

    ollama_p = create_single_provider("ollama")
    assert ollama_p.model == "qwen2.5-coder:7b"

    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        create_single_provider("nonexistent_provider")

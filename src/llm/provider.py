"""LLM Provider layer: Unified interface for Zero-Cost models (Mock, Ollama, Gemini, Groq)."""

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Callable
from pydantic import BaseModel, Field
import httpx

from src.config import settings

logger = logging.getLogger(__name__)


# ==============================================================================
# Data Models for Unified LLM Interface
# ==============================================================================

class ToolCall(BaseModel):
    """Represents a function/tool call requested by the LLM."""
    id: str = Field(default="")
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class LLMUsage(BaseModel):
    """Token usage tracking for budget control."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class LLMResponse(BaseModel):
    """Standardized response from any LLM provider."""
    content: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    usage: LLMUsage = Field(default_factory=LLMUsage)
    model: str = ""


# ==============================================================================
# Abstract Provider Interface
# ==============================================================================

class BaseLLMProvider(ABC):
    """Abstract base class for all LLM providers."""

    @abstractmethod
    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        """Send chat messages and optional tools to LLM, returning complete response."""
        pass

    @abstractmethod
    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        """Stream response tokens from LLM."""
        pass


# ==============================================================================
# 1. Mock LLM Provider (Offline / Testing / Zero Dependency)
# ==============================================================================

class MockLLMProvider(BaseLLMProvider):
    """Mock provider for unit tests and local development without external APIs."""

    def __init__(self, canned_responses: list[LLMResponse] | None = None):
        self.canned_responses = canned_responses or []
        self._call_count = 0

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        if self.canned_responses and self._call_count < len(self.canned_responses):
            resp = self.canned_responses[self._call_count]
            self._call_count += 1
            return resp

        # Default smart heuristic mock
        last_message = messages[-1]["content"] if messages else ""

        # Step 1: If tools provided and schema not yet fetched, call get_schema
        has_schema_observation = any(
            m.get("role") == "tool" and m.get("name") == "get_schema" for m in messages
        )
        has_sql_observation = any(
            m.get("role") == "tool" and m.get("name") == "run_sql" for m in messages
        )

        if tools and not has_schema_observation:
            return LLMResponse(
                content="Saya perlu memeriksa skema tabel yang tersedia terlebih dahulu.",
                tool_calls=[
                    ToolCall(
                        id="call_mock_schema_1",
                        name="get_schema",
                        arguments={"table_names": ["orders", "products", "customers"]},
                    )
                ],
                usage=LLMUsage(prompt_tokens=150, completion_tokens=30, total_tokens=180),
                model="mock-agent-model",
            )

        if tools and has_schema_observation and not has_sql_observation:
            return LLMResponse(
                content="Menjalankan query SQL untuk mendapatkan data pesanan dan produk.",
                tool_calls=[
                    ToolCall(
                        id="call_mock_sql_1",
                        name="run_sql",
                        arguments={
                            "query": "SELECT product_category_name, COUNT(*) as total_orders FROM analytics.products GROUP BY product_category_name"
                        },
                    )
                ],
                usage=LLMUsage(prompt_tokens=250, completion_tokens=40, total_tokens=290),
                model="mock-agent-model",
            )

        # Final answer
        return LLMResponse(
            content=(
                "Berdasarkan analisis data dari database PostgreSQL:\n\n"
                "Total pesanan didominasi oleh kategori Electronics dan Fashion. "
                "Semua transaksi telah berhasil direkapitulasi."
            ),
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=350, completion_tokens=50, total_tokens=400),
            model="mock-agent-model",
        )

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        response = await self.chat(messages, tools, temperature)
        if response.content:
            for word in response.content.split(" "):
                yield word + " "


# ==============================================================================
# 2. OpenAI-Compatible Generic Provider (Ollama, Gemini, Groq)
# ==============================================================================

class OpenAICompatibleProvider(BaseLLMProvider):
    """Generic provider for OpenAI-compatible REST endpoints.

    Works seamlessly with Ollama (local), Google Gemini OpenAI compatibility endpoint,
    and Groq Cloud Free Tier.
    """

    def __init__(self, base_url: str, api_key: str | None, model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or "not-needed"
        self.model = model

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        url = f"{self.base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, json=payload, headers=self._headers())
            if response.status_code != 200:
                logger.error("LLM Provider error: %s %s", response.status_code, response.text)
                raise RuntimeError(f"LLM API Error ({response.status_code}): {response.text}")

            data = response.json()
            choice = data["choices"][0]["message"]
            content = choice.get("content")

            tool_calls = []
            if "tool_calls" in choice and choice["tool_calls"]:
                for tc in choice["tool_calls"]:
                    func = tc.get("function", {})
                    fn_name = func.get("name", "")
                    fn_args_raw = func.get("arguments", "{}")
                    try:
                        fn_args = json.loads(fn_args_raw) if isinstance(fn_args_raw, str) else fn_args_raw
                    except Exception:
                        fn_args = {}
                    tool_calls.append(
                        ToolCall(id=tc.get("id", ""), name=fn_name, arguments=fn_args)
                    )

            usage_data = data.get("usage", {})
            usage = LLMUsage(
                prompt_tokens=usage_data.get("prompt_tokens", 0),
                completion_tokens=usage_data.get("completion_tokens", 0),
                total_tokens=usage_data.get("total_tokens", 0),
            )

            return LLMResponse(
                content=content,
                tool_calls=tool_calls,
                usage=usage,
                model=self.model,
            )

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        url = f"{self.base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, json=payload, headers=self._headers()) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise RuntimeError(f"LLM Stream Error ({response.status_code}): {error_text.decode('utf-8')}")

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        data_str = line[6:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk["choices"][0].get("delta", {})
                            if "content" in delta and delta["content"]:
                                yield delta["content"]
                        except Exception:
                            continue


# ==============================================================================
# 3. Resilient Fallback & Routing Providers (FR-28)
# ==============================================================================

class FallbackLLMProvider(BaseLLMProvider):
    """Resilient provider that wraps a primary provider with automatic fallback (FR-28).

    If the primary provider hits a rate limit (HTTP 429), server error (HTTP 5xx),
    or connection timeout, it performs retries with exponential backoff.
    If the error persists, it automatically and seamlessly delegates the request
    to the secondary/fallback provider (e.g. local offline Ollama or Mock).
    """

    def __init__(
        self,
        primary: BaseLLMProvider,
        fallback: BaseLLMProvider,
        max_retries: int = 2,
        backoff_base_seconds: float = 0.5,
    ):
        self.primary = primary
        self.fallback = fallback
        self.max_retries = max_retries
        self.backoff_base_seconds = backoff_base_seconds
        self.last_used_provider: str = getattr(primary, "model", primary.__class__.__name__)
        self.fallback_triggered: bool = False

    def _is_fallback_trigger(self, err: Exception) -> bool:
        """Determines whether an exception warrants retry or fallback routing."""
        err_msg = str(err).lower()
        trigger_keywords = [
            "429",
            "rate limit",
            "rate_limit",
            "quota",
            "resource_exhausted",
            "too many requests",
            "overloaded",
            "503",
            "502",
            "504",
            "timeout",
            "connection refused",
            "temporarily unavailable",
        ]
        if any(keyword in err_msg for keyword in trigger_keywords):
            return True

        if isinstance(err, (httpx.TimeoutException, asyncio.TimeoutError, httpx.ConnectError, httpx.NetworkError)):
            return True

        if isinstance(err, httpx.HTTPStatusError):
            if err.response.status_code in (429, 500, 502, 503, 504):
                return True

        return False

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        primary_name = getattr(self.primary, "model", self.primary.__class__.__name__)
        fallback_name = getattr(self.fallback, "model", self.fallback.__class__.__name__)

        for attempt in range(self.max_retries + 1):
            try:
                response = await self.primary.chat(messages, tools, temperature)
                self.last_used_provider = response.model or primary_name
                self.fallback_triggered = False
                return response
            except Exception as e:
                if self._is_fallback_trigger(e):
                    if attempt < self.max_retries:
                        delay = self.backoff_base_seconds * (2 ** attempt)
                        logger.warning(
                            "Primary LLM '%s' failed on attempt %d/%d (%s). Retrying in %.2fs...",
                            primary_name,
                            attempt + 1,
                            self.max_retries,
                            e,
                            delay,
                        )
                        await asyncio.sleep(delay)
                        continue

                    logger.warning(
                        "Primary LLM '%s' exhausted %d retries (%s). Automatically routing to fallback '%s'.",
                        primary_name,
                        self.max_retries,
                        e,
                        fallback_name,
                    )
                    self.fallback_triggered = True
                    response = await self.fallback.chat(messages, tools, temperature)
                    self.last_used_provider = response.model or fallback_name
                    return response
                # Non-retryable error: raise immediately
                raise

        # Fallback safeguard
        self.fallback_triggered = True
        response = await self.fallback.chat(messages, tools, temperature)
        self.last_used_provider = response.model or fallback_name
        return response

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        primary_name = getattr(self.primary, "model", self.primary.__class__.__name__)
        fallback_name = getattr(self.fallback, "model", self.fallback.__class__.__name__)

        for attempt in range(self.max_retries + 1):
            try:
                async for chunk in self.primary.stream_chat(messages, tools, temperature):
                    self.last_used_provider = primary_name
                    self.fallback_triggered = False
                    yield chunk
                return
            except Exception as e:
                if self._is_fallback_trigger(e):
                    if attempt < self.max_retries:
                        delay = self.backoff_base_seconds * (2 ** attempt)
                        logger.warning(
                            "Primary LLM stream '%s' failed on attempt %d/%d (%s). Retrying in %.2fs...",
                            primary_name,
                            attempt + 1,
                            self.max_retries,
                            e,
                            delay,
                        )
                        await asyncio.sleep(delay)
                        continue

                    logger.warning(
                        "Primary LLM stream '%s' exhausted retries (%s). Routing stream to fallback '%s'.",
                        primary_name,
                        e,
                        fallback_name,
                    )
                    self.fallback_triggered = True
                    async for chunk in self.fallback.stream_chat(messages, tools, temperature):
                        self.last_used_provider = fallback_name
                        yield chunk
                    return
                raise


class RoutedLLMProvider(BaseLLMProvider):
    """Dynamic router that directs queries to specific models based on intent or complexity."""

    def __init__(
        self,
        providers: dict[str, BaseLLMProvider],
        default_route: str = "primary",
        router_fn: Callable[[list[dict[str, Any]], list[dict[str, Any]] | None], str] | None = None,
    ):
        self.providers = providers
        self.default_route = default_route
        self.router_fn = router_fn
        self.last_used_provider: str = default_route

    def _select_provider(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
    ) -> tuple[str, BaseLLMProvider]:
        route = self.default_route
        if self.router_fn:
            try:
                route = self.router_fn(messages, tools)
            except Exception as e:
                logger.warning("Router function failed (%s), using default '%s'", e, self.default_route)

        provider = self.providers.get(route) or self.providers[self.default_route]
        return route, provider

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        route, provider = self._select_provider(messages, tools)
        self.last_used_provider = route
        return await provider.chat(messages, tools, temperature)

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        route, provider = self._select_provider(messages, tools)
        self.last_used_provider = route
        async for chunk in provider.stream_chat(messages, tools, temperature):
            yield chunk


# ==============================================================================
# Provider Factory
# ==============================================================================

def create_single_provider(provider_name: str) -> BaseLLMProvider:
    """Instantiate a single raw provider by name."""
    name = provider_name.lower().strip()

    if name == "mock":
        return MockLLMProvider()

    if name == "ollama":
        return OpenAICompatibleProvider(
            base_url=settings.ollama_base_url,
            api_key=None,
            model=settings.ollama_model,
        )

    if name == "gemini":
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
        return OpenAICompatibleProvider(
            base_url=base_url,
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
        )

    if name == "groq":
        base_url = "https://api.groq.com/openai/v1"
        return OpenAICompatibleProvider(
            base_url=base_url,
            api_key=settings.groq_api_key,
            model=settings.groq_model,
        )

    raise ValueError(f"Unsupported LLM provider: '{provider_name}'")


def get_llm_provider() -> BaseLLMProvider:
    """Factory to instantiate the configured zero-cost LLM provider with automatic fallback (FR-28)."""
    primary = create_single_provider(settings.llm_provider)

    if (
        settings.llm_enable_fallback
        and settings.llm_fallback_provider
        and settings.llm_fallback_provider.lower() != "none"
        and settings.llm_fallback_provider.lower() != settings.llm_provider.lower()
    ):
        fallback = create_single_provider(settings.llm_fallback_provider)
        return FallbackLLMProvider(
            primary=primary,
            fallback=fallback,
            max_retries=settings.llm_max_retries,
            backoff_base_seconds=settings.llm_retry_backoff_base_seconds,
        )

    return primary


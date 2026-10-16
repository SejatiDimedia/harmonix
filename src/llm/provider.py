"""LLM Provider layer: Unified interface for Zero-Cost models (Mock, Ollama, Gemini, Groq)."""

import json
import logging
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator
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
# Provider Factory
# ==============================================================================

def get_llm_provider() -> BaseLLMProvider:
    """Factory to instantiate the configured zero-cost LLM provider."""
    provider_name = settings.llm_provider.lower()

    if provider_name == "mock":
        return MockLLMProvider()

    if provider_name == "ollama":
        return OpenAICompatibleProvider(
            base_url=settings.ollama_base_url,
            api_key=None,
            model=settings.ollama_model,
        )

    if provider_name == "gemini":
        # Google AI Studio OpenAI-compatible endpoint
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
        return OpenAICompatibleProvider(
            base_url=base_url,
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
        )

    if provider_name == "groq":
        base_url = "https://api.groq.com/openai/v1"
        return OpenAICompatibleProvider(
            base_url=base_url,
            api_key=settings.groq_api_key,
            model=settings.groq_model,
        )

    raise ValueError(f"Unsupported LLM provider: '{provider_name}'")

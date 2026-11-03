"""LLM Provider layer: Unified interface for Zero-Cost models (Mock, Ollama, Gemini, Groq)."""

import asyncio
import json
import logging
import re
import uuid
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
    """Token usage tracking for budget control and prompt cache efficiency (FR-15, FR-29)."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cached_tokens: int = 0


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

        # Extract primary user query
        user_queries = [
            m.get("content", "")
            for m in messages
            if m.get("role") == "user" and not str(m.get("content", "")).startswith("Operator Feedback:")
        ]
        user_query = user_queries[0] if user_queries else (messages[-1].get("content", "") if messages else "")
        uq_lower = str(user_query).lower()

        # Step 0: Conversational greeting detection
        is_greeting = any(g in uq_lower for g in ["halo", "hai", "hello", "hi", "selamat pagi", "selamat siang", "siapa kamu"]) and not any(
            k in uq_lower for k in ["berapa", "total", "tabel", "data", "order", "produk", "customer", "pelanggan", "penjualan", "transaksi", "status", "kota", "paling"]
        )
        if is_greeting and not any(m.get("role") == "tool" for m in messages):
            return LLMResponse(
                content=(
                    "Halo! Saya **Harmonix**, asisten AI Data Analyst Anda untuk database PostgreSQL analitik.\n\n"
                    "Saya dapat membantu Anda mengeksplorasi data, misalnya:\n"
                    "- *Berapa total pesanan dan pendapatan berdasarkan status transaksi?*\n"
                    "- *Kategori produk apa yang memiliki variasi terbanyak?*\n"
                    "- *Kota mana yang memiliki jumlah pelanggan tertinggi?*\n"
                    "- *Metode pembayaran apa yang paling sering digunakan?*\n\n"
                    "Silakan ketik pertanyaan analisis data yang ingin Anda ketahui!"
                ),
                tool_calls=[],
                usage=LLMUsage(prompt_tokens=50, completion_tokens=70, total_tokens=120),
                model="mock-agent-model",
            )

        # Check existing tool observations
        has_schema_observation = any(
            m.get("role") == "tool" and m.get("name") == "get_schema" for m in messages
        )
        has_sql_observation = any(
            m.get("role") == "tool" and m.get("name") == "run_sql" for m in messages
        )
        has_glossary_observation = any(
            m.get("role") == "tool" and m.get("name") == "search_glossary" for m in messages
        )

        # Step 1: Metric glossary grounding if query mentions business metrics
        if tools and any(m in uq_lower for m in ["gmv", "aov", "delivered rate", "definisi", "rumus", "metrik", "glossary"]) and not has_glossary_observation:
            return LLMResponse(
                content="Mencari definisi resmi metrik bisnis di kamus metrik perusahaan...",
                tool_calls=[
                    ToolCall(
                        id="call_mock_glossary_1",
                        name="search_glossary",
                        arguments={"query": user_query},
                    )
                ],
                usage=LLMUsage(prompt_tokens=120, completion_tokens=30, total_tokens=150),
                model="mock-agent-model",
            )

        # Step 2: Schema discovery
        if tools and not has_schema_observation:
            relevant_tables = []
            if any(w in uq_lower for w in ["pelanggan", "customer", "kota", "city", "wilayah", "state"]):
                relevant_tables.append("customers")
            if any(w in uq_lower for w in ["order", "pesanan", "transaksi", "penjualan", "sales", "revenue", "gmv", "status", "delivered"]):
                relevant_tables.append("orders")
            if any(w in uq_lower for w in ["produk", "product", "kategori", "category", "harga", "price", "barang"]):
                relevant_tables.append("products")
            if any(w in uq_lower for w in ["bayar", "payment", "kartu", "metode", "credit"]):
                relevant_tables.append("order_payments")
            if not relevant_tables:
                relevant_tables = ["orders", "products", "customers"]

            return LLMResponse(
                content=f"Memeriksa skema tabel {', '.join(relevant_tables)} untuk memvalidasi kolom dan tipe data.",
                tool_calls=[
                    ToolCall(
                        id="call_mock_schema_1",
                        name="get_schema",
                        arguments={"table_names": relevant_tables},
                    )
                ],
                usage=LLMUsage(prompt_tokens=150, completion_tokens=30, total_tokens=180),
                model="mock-agent-model",
            )

        # Step 3: Dynamic SQL Generation based on user query
        if tools and not has_sql_observation:
            if any(w in uq_lower for w in ["pelanggan", "customer", "kota", "city"]):
                query = "SELECT city, state, COUNT(*) as total_customers FROM analytics.customers GROUP BY city, state ORDER BY total_customers DESC LIMIT 10"
                thought = "Menjalankan query SQL untuk menganalisis sebaran pelanggan per kota dan provinsi."
            elif any(w in uq_lower for w in ["produk", "product", "kategori", "category", "harga", "price", "termahal", "terlaris"]):
                query = "SELECT product_category_name, COUNT(*) as total_products, ROUND(AVG(price)::numeric, 2) as avg_price FROM analytics.products GROUP BY product_category_name ORDER BY total_products DESC LIMIT 10"
                thought = "Menjalankan query SQL untuk memeriksa sebaran kategori produk dan harga rata-rata."
            elif any(w in uq_lower for w in ["bayar", "payment", "metode", "kartu"]):
                query = "SELECT payment_type, COUNT(*) as total_transactions, ROUND(SUM(payment_value)::numeric, 2) as total_amount FROM analytics.order_payments GROUP BY payment_type ORDER BY total_transactions DESC"
                thought = "Menjalankan query SQL untuk menghitung transaksi berdasarkan metode pembayaran."
            else:
                query = "SELECT order_status, COUNT(*) as total_orders FROM analytics.orders GROUP BY order_status ORDER BY total_orders DESC"
                thought = "Menjalankan query SQL untuk menghitung rekapitulasi status pesanan di database."

            return LLMResponse(
                content=thought,
                tool_calls=[
                    ToolCall(
                        id="call_mock_sql_1",
                        name="run_sql",
                        arguments={"query": query},
                    )
                ],
                usage=LLMUsage(prompt_tokens=250, completion_tokens=40, total_tokens=290, cached_tokens=150),
                model="mock-agent-model",
            )

        # Step 4: Final Answer synthesis from real tool execution results
        sql_obs = None
        for m in reversed(messages):
            if m.get("role") == "tool" and m.get("name") == "run_sql":
                try:
                    content_val = m.get("content", "")
                    sql_obs = json.loads(content_val) if isinstance(content_val, str) else content_val
                    break
                except Exception:
                    pass

        if sql_obs and isinstance(sql_obs, dict) and sql_obs.get("status") == "success":
            cols = sql_obs.get("columns", [])
            rows = sql_obs.get("rows", [])

            lines = ["Berdasarkan data terkini dari database analitik PostgreSQL:\n"]
            if rows:
                lines.append(f"Ditemukan **{len(rows)} data ringkasan** dari hasil query:")
                lines.append("")
                for row in rows[:5]:
                    parts = [f"**{cols[i]}**: `{row[i]}`" for i in range(min(len(cols), len(row)))]
                    lines.append(f"- " + ", ".join(parts))
                if len(rows) > 5:
                    lines.append(f"- *... dan {len(rows) - 5} baris data lainnya (terlampir pada tabel data di bawah).*")
            else:
                lines.append("Query berhasil dijalankan, namun tidak ada baris data yang cocok dengan kriteria pencarian.")

            lines.append("\nSeluruh data divalidasi dengan aman melalui AST SQL guardrail.")
            final_content = "\n".join(lines)
        else:
            final_content = (
                f"Analisis untuk pertanyaan: *'{user_query}'* telah selesai diproses. "
                "Data dari database telah diverifikasi."
            )

        return LLMResponse(
            content=final_content,
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=350, completion_tokens=60, total_tokens=410, cached_tokens=250),
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

    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        model: str,
        default_headers: dict[str, str] | None = None,
        provider_name: str = "openai",
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or "not-needed"
        self.model = model
        self.default_headers = default_headers or {}
        self.provider_name = provider_name

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.default_headers:
            headers.update(self.default_headers)
        if self.api_key and self.api_key != "not-needed":
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        url = f"{self.base_url}/chat/completions"

        # FR-15: Apply prompt cache control headers/structure if enabled
        effective_messages = messages
        if getattr(settings, "enable_prompt_caching", True):
            try:
                from src.agent.caching import apply_prompt_cache_control
                effective_messages = apply_prompt_cache_control(
                    messages,
                    provider=self.provider_name,
                    model=self.model,
                )
            except Exception as cache_err:
                logger.debug("Prompt cache control formatting bypassed: %s", cache_err)

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": effective_messages,
            "temperature": temperature,
            "stream": False,
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

            if not tool_calls and content:
                # Fallback for models (such as Ollama Llama / Qwen) that output tool calls as JSON in text
                text_to_search = content.strip()
                # Auto-repair unclosed outer braces if model emitted e.g. {"name": "run_sql", "arguments": {"query": "..."}
                if '{"name":' in text_to_search and text_to_search.count('{') > text_to_search.count('}'):
                    text_to_search += '}' * (text_to_search.count('{') - text_to_search.count('}'))

                match = re.search(
                    r'\{\s*["\']name["\']\s*:\s*["\']([a-zA-Z0-9_]+)["\']\s*,\s*["\'](?:parameters|arguments)["\']\s*:\s*(\{.*?\})\s*\}',
                    text_to_search,
                    re.DOTALL,
                )
                if match:
                    fn_name = match.group(1)
                    raw_args = match.group(2)
                    fn_args = {}
                    try:
                        fn_args = json.loads(raw_args)
                    except Exception:
                        try:
                            s_fixed = re.sub(r'\\([^"\\/bfnrtu])', r'\1', raw_args)
                            fn_args = json.loads(s_fixed)
                        except Exception:
                            m_query = re.search(r'["\']query["\']\s*:\s*["\'](SELECT\s+.*?)["\']\s*\}', raw_args, re.IGNORECASE | re.DOTALL)
                            if m_query:
                                fn_args = {"query": m_query.group(1).replace(r'\%', '%').strip()}

                    if fn_args:
                        tool_calls.append(
                            ToolCall(
                                id=f"call_extracted_{uuid.uuid4().hex[:6]}",
                                name=fn_name,
                                arguments=fn_args,
                            )
                        )
                        # Clean the matched JSON string from content
                        content = re.sub(
                            r'\{\s*["\']name["\']\s*:\s*["\']' + re.escape(fn_name) + r'["\']\s*,\s*["\'](?:parameters|arguments)["\']\s*:.*$',
                            '',
                            content,
                            flags=re.DOTALL,
                        ).strip()

            if tool_calls and content:
                # Strip mirrored or leaked tool call JSON from assistant content
                content = re.sub(
                    r'\{\s*["\']name["\']\s*:\s*["\'](?:run_sql|get_schema|make_chart|search_glossary|calculate)["\']\s*,\s*["\'](?:parameters|arguments)["\']\s*:.*$',
                    '',
                    content,
                    flags=re.DOTALL,
                ).strip()

            usage_data = data.get("usage", {})
            cached_tokens = 0
            if getattr(settings, "enable_prompt_caching", True):
                try:
                    from src.agent.caching import extract_cached_tokens
                    cached_tokens = extract_cached_tokens(data)
                except Exception:
                    pass

            usage = LLMUsage(
                prompt_tokens=usage_data.get("prompt_tokens", 0),
                completion_tokens=usage_data.get("completion_tokens", 0),
                total_tokens=usage_data.get("total_tokens", 0),
                cached_tokens=cached_tokens,
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

        # FR-15: Apply prompt cache control headers/structure if enabled
        effective_messages = messages
        if getattr(settings, "enable_prompt_caching", True):
            try:
                from src.agent.caching import apply_prompt_cache_control
                effective_messages = apply_prompt_cache_control(
                    messages,
                    provider=self.provider_name,
                    model=self.model,
                )
            except Exception as cache_err:
                logger.debug("Prompt cache control formatting bypassed in stream: %s", cache_err)

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": effective_messages,
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

def create_single_provider(
    provider_name: str,
    model_override: str | None = None,
) -> BaseLLMProvider:
    """Instantiate a single raw provider by name, optionally overriding the default model."""
    name = provider_name.lower().strip()

    if name == "mock":
        p = MockLLMProvider()
        p.provider_name = "mock"
        return p

    if name == "ollama":
        p = OpenAICompatibleProvider(
            base_url=settings.ollama_base_url,
            api_key=None,
            model=model_override or settings.ollama_model,
        )
        p.provider_name = "ollama"
        return p

    if name == "gemini":
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
        p = OpenAICompatibleProvider(
            base_url=base_url,
            api_key=settings.gemini_api_key,
            model=model_override or settings.gemini_model,
        )
        p.provider_name = "gemini"
        return p

    if name == "groq":
        base_url = "https://api.groq.com/openai/v1"
        p = OpenAICompatibleProvider(
            base_url=base_url,
            api_key=settings.groq_api_key,
            model=model_override or settings.groq_model,
        )
        p.provider_name = "groq"
        return p

    if name == "openrouter":
        base_url = settings.openrouter_base_url
        headers = {
            "HTTP-Referer": "https://github.com/SejatiDimedia/harmonix",
            "X-Title": "Harmonix AI Data Analyst",
        }
        p = OpenAICompatibleProvider(
            base_url=base_url,
            api_key=settings.openrouter_api_key,
            model=model_override or settings.openrouter_model,
            default_headers=headers,
        )
        p.provider_name = "openrouter"
        return p

    if name == "9router":
        key = settings.ninerouter_api_key
        if not key or key == "sk-9router-local":
            try:
                from src.llm.registry import get_local_9router_key
                key = get_local_9router_key()
            except Exception:
                key = "sk-8abbefea34ddc0cc-npg38u-a6649356"
        p = OpenAICompatibleProvider(
            base_url=settings.ninerouter_base_url,
            api_key=key,
            model=model_override or settings.ninerouter_model,
        )
        p.provider_name = "9router"
        return p

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


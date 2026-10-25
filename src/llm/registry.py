"""Dynamic Model Registry & Multi-Provider Manager (FR-36).

Provides runtime discovery, cataloging, and hot-switching across:
- Local offline models (Ollama)
- Cloud Free Tier (Groq, Google Gemini)
- OpenRouter Free Models (:free)
"""

import logging
from typing import Any, Literal
import httpx
from pydantic import BaseModel, Field

from src.config import settings
from src.llm.provider import (
    BaseLLMProvider,
    create_single_provider,
    get_llm_provider,
)

logger = logging.getLogger(__name__)


class ModelOption(BaseModel):
    """Specification of an available model option."""
    id: str
    name: str
    provider: str
    is_free: bool = True
    context_length: int = 8192
    description: str = ""


class ProviderCatalog(BaseModel):
    """Status and catalog of models for a specific LLM provider."""
    provider: str
    display_name: str
    category: Literal["local", "cloud_free", "openrouter"]
    is_ready: bool
    status_message: str
    active_model: str
    available_models: list[ModelOption] = Field(default_factory=list)


class ActiveModelConfig(BaseModel):
    """Runtime configuration for active models in the multi-agent system."""
    analyst_provider: str = Field(default="ollama")
    analyst_model: str = Field(default="qwen2.5-coder:7b")
    auditor_provider: str = Field(default="auto")
    auditor_model: str = Field(default="")


class ModelRegistry:
    """Singleton registry managing active models and dynamic provider discovery."""

    _instance = None

    def __init__(self):
        self.active_config = ActiveModelConfig(
            analyst_provider=settings.llm_provider,
            analyst_model=getattr(settings, f"{settings.llm_provider}_model", "default") if settings.llm_provider != "mock" else "mock-agent-model",
            auditor_provider=settings.auditor_provider,
            auditor_model=settings.auditor_model or "",
        )

    @classmethod
    def get_instance(cls) -> "ModelRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def _fetch_ollama_models(self) -> tuple[bool, str, list[ModelOption]]:
        """Query local Ollama instance for pulled models."""
        url = settings.ollama_base_url.replace("/v1", "/api/tags")
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get(url)
                if res.status_code == 200:
                    data = res.json()
                    models = []
                    for item in data.get("models", []):
                        m_name = item.get("name", "")
                        details = item.get("details", {})
                        param_sz = details.get("parameter_size", "")
                        models.append(
                            ModelOption(
                                id=m_name,
                                name=f"{m_name} ({param_sz})" if param_sz else m_name,
                                provider="ollama",
                                is_free=True,
                                description="Model lokal berjalan 100% offline di laptop",
                            )
                        )
                    if not models:
                        models.append(ModelOption(id="qwen2.5-coder:7b", name="qwen2.5-coder:7b", provider="ollama"))
                    return True, "Ollama aktif dan terhubung", models
        except Exception:
            pass

        # Offline fallback definition
        return False, "Ollama tidak terdeteksi di localhost:11434", [
            ModelOption(id="qwen2.5-coder:7b", name="qwen2.5-coder:7b (Offline)", provider="ollama"),
            ModelOption(id="llama3.1:8b", name="llama3.1:8b (Offline)", provider="ollama"),
            ModelOption(id="deepseek-r1:7b", name="deepseek-r1:7b (Offline)", provider="ollama"),
        ]

    def _get_groq_models(self) -> tuple[bool, str, list[ModelOption]]:
        """Return supported Groq Cloud Free Tier models."""
        is_ready = bool(settings.groq_api_key and len(settings.groq_api_key) > 5)
        msg = "Groq API Key terkonfigurasi" if is_ready else "GROQ_API_KEY belum diisi di .env"
        models = [
            ModelOption(
                id="llama-3.3-70b-versatile",
                name="Llama 3.3 70B Versatile",
                provider="groq",
                context_length=128000,
                description="Model penalaran tinggi 70B, super cepat (~300 t/s via LPU)",
            ),
            ModelOption(
                id="llama-3.1-8b-instant",
                name="Llama 3.1 8B Instant",
                provider="groq",
                context_length=128000,
                description="Model ringan latensi sangat rendah",
            ),
            ModelOption(
                id="mixtral-8x7b-32768",
                name="Mixtral 8x7B MoE",
                provider="groq",
                context_length=32768,
                description="Model Mixture-of-Experts",
            ),
        ]
        return is_ready, msg, models

    def _get_gemini_models(self) -> tuple[bool, str, list[ModelOption]]:
        """Return supported Google Gemini Free Tier models."""
        is_ready = bool(settings.gemini_api_key and len(settings.gemini_api_key) > 5)
        msg = "Gemini API Key terkonfigurasi" if is_ready else "GEMINI_API_KEY belum diisi di .env"
        models = [
            ModelOption(
                id="gemini-2.0-flash",
                name="Gemini 2.0 Flash",
                provider="gemini",
                context_length=1000000,
                description="Model mutakhir Google, kuota 1500 req/hari gratis",
            ),
            ModelOption(
                id="gemini-1.5-flash",
                name="Gemini 1.5 Flash",
                provider="gemini",
                context_length=1000000,
                description="Stabil & cepat dengan context window 1 juta token",
            ),
        ]
        return is_ready, msg, models

    def _get_openrouter_models(self) -> tuple[bool, str, list[ModelOption]]:
        """Return curated free tier models (:free) on OpenRouter."""
        is_ready = bool(settings.openrouter_api_key and len(settings.openrouter_api_key) > 5)
        msg = "OpenRouter API Key terkonfigurasi" if is_ready else "OPENROUTER_API_KEY belum diisi di .env"
        models = [
            ModelOption(
                id="nvidia/nemotron-3.5-lightning:free",
                name="Nvidia Nemotron 3.5 Lightning (Free)",
                provider="openrouter",
                context_length=131072,
                description="Model penalaran cepat Nvidia (100% Free di OpenRouter)",
            ),
            ModelOption(
                id="google/gemma-4-31b-it:free",
                name="Google Gemma 4 31B (Free)",
                provider="openrouter",
                context_length=8192,
                description="Model Google open-weight 31B parameter",
            ),
            ModelOption(
                id="cohere/north-mini-code:free",
                name="Cohere North Mini Code (Free)",
                provider="openrouter",
                context_length=32768,
                description="Model spesialis kode dan pemecahan masalah",
            ),
            ModelOption(
                id="liquid/lfm-2.5-2.6b:free",
                name="Liquid LFM 2.5 2.6B (Free)",
                provider="openrouter",
                context_length=32768,
                description="Model Liquid AI arsitektur efisien",
            ),
        ]
        return is_ready, msg, models

    async def get_catalog(self) -> dict[str, Any]:
        """Compile complete catalog of all providers, statuses, and model options."""
        ollama_ready, ollama_msg, ollama_models = await self._fetch_ollama_models()
        groq_ready, groq_msg, groq_models = self._get_groq_models()
        gemini_ready, gemini_msg, gemini_models = self._get_gemini_models()
        openrouter_ready, openrouter_msg, openrouter_models = self._get_openrouter_models()

        providers = [
            ProviderCatalog(
                provider="ollama",
                display_name="Ollama (Local Offline)",
                category="local",
                is_ready=ollama_ready,
                status_message=ollama_msg,
                active_model=self.active_config.analyst_model if self.active_config.analyst_provider == "ollama" else settings.ollama_model,
                available_models=ollama_models,
            ),
            ProviderCatalog(
                provider="groq",
                display_name="Groq Cloud (Free Tier)",
                category="cloud_free",
                is_ready=groq_ready,
                status_message=groq_msg,
                active_model=self.active_config.analyst_model if self.active_config.analyst_provider == "groq" else settings.groq_model,
                available_models=groq_models,
            ),
            ProviderCatalog(
                provider="gemini",
                display_name="Google AI Studio Gemini (Free Tier)",
                category="cloud_free",
                is_ready=gemini_ready,
                status_message=gemini_msg,
                active_model=self.active_config.analyst_model if self.active_config.analyst_provider == "gemini" else settings.gemini_model,
                available_models=gemini_models,
            ),
            ProviderCatalog(
                provider="openrouter",
                display_name="OpenRouter (Free Models)",
                category="openrouter",
                is_ready=openrouter_ready,
                status_message=openrouter_msg,
                active_model=self.active_config.analyst_model if self.active_config.analyst_provider == "openrouter" else settings.openrouter_model,
                available_models=openrouter_models,
            ),
        ]

        return {
            "active_config": self.active_config.model_dump(),
            "providers": [p.model_dump() for p in providers],
        }

    def update_active_config(
        self,
        analyst_provider: str | None = None,
        analyst_model: str | None = None,
        auditor_provider: str | None = None,
        auditor_model: str | None = None,
    ) -> ActiveModelConfig:
        """Update active model choices dynamically at runtime without restarting server."""
        if analyst_provider:
            self.active_config.analyst_provider = analyst_provider.lower().strip()
        if analyst_model:
            self.active_config.analyst_model = analyst_model.strip()
        if auditor_provider:
            self.active_config.auditor_provider = auditor_provider.lower().strip()
        if auditor_model is not None:
            self.active_config.auditor_model = auditor_model.strip()

        logger.info(
            "Updated Active Model Config -> Analyst: %s (%s) | Auditor: %s (%s)",
            self.active_config.analyst_provider,
            self.active_config.analyst_model,
            self.active_config.auditor_provider,
            self.active_config.auditor_model,
        )
        return self.active_config

    def create_analyst_llm(
        self,
        override_provider: str | None = None,
        override_model: str | None = None,
    ) -> BaseLLMProvider:
        """Instantiate LLM provider for Analyst Agent respecting active or request override."""
        provider = (override_provider or self.active_config.analyst_provider).lower().strip()
        model = override_model or self.active_config.analyst_model
        return create_single_provider(provider, model_override=model)

    def create_auditor_llm(
        self,
        override_provider: str | None = None,
        override_model: str | None = None,
    ) -> BaseLLMProvider:
        """Instantiate LLM provider for Auditor Agent respecting active or request override."""
        provider = (override_provider or self.active_config.auditor_provider).lower().strip()
        model = override_model or self.active_config.auditor_model

        if provider == "auto":
            # Delegate to existing model diversity logic
            return get_llm_provider()

        return create_single_provider(provider, model_override=model or None)

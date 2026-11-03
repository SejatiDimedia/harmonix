"""Unit tests for Multi-Provider LLM abstraction and OpenRouter Integration (FR-36)."""

import pytest
from src.agent.auditor import get_auditor_provider
from src.config import settings
from src.llm.provider import (
    MockLLMProvider,
    OpenAICompatibleProvider,
    create_single_provider,
)


def test_create_mock_provider():
    """Verify mock provider initialization."""
    provider = create_single_provider("mock")
    assert isinstance(provider, MockLLMProvider)


def test_create_ollama_provider_with_override():
    """Verify Ollama provider creation and model override."""
    default_p = create_single_provider("ollama")
    assert isinstance(default_p, OpenAICompatibleProvider)
    assert default_p.model == settings.ollama_model

    custom_p = create_single_provider("ollama", model_override="llama3.1:8b")
    assert custom_p.model == "llama3.1:8b"


def test_create_groq_provider():
    """Verify Groq provider setup with custom or default model."""
    provider = create_single_provider("groq", model_override="llama-3.1-8b-instant")
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.base_url == "https://api.groq.com/openai/v1"
    assert provider.model == "llama-3.1-8b-instant"


def test_create_openrouter_provider_with_headers():
    """Verify OpenRouter provider initialization, headers, and free model."""
    provider = create_single_provider(
        "openrouter",
        model_override="meta-llama/llama-3.3-70b-instruct:free",
    )
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.base_url == "https://openrouter.ai/api/v1"
    assert provider.model == "meta-llama/llama-3.3-70b-instruct:free"

    headers = provider._headers()
    assert "Content-Type" in headers
    assert headers["HTTP-Referer"] == "https://github.com/SejatiDimedia/harmonix"
    assert headers["X-Title"] == "Harmonix AI Data Analyst"


def test_create_gemini_provider():
    """Verify Google Gemini OpenAI compatibility endpoint."""
    provider = create_single_provider("gemini")
    assert isinstance(provider, OpenAICompatibleProvider)
    assert "generativelanguage.googleapis.com" in provider.base_url
    assert provider.model == settings.gemini_model


def test_create_9router_provider():
    """Verify 9Router smart local gateway provider initialization."""
    provider = create_single_provider("9router", model_override="claude-3-7-sonnet")
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.base_url == settings.ninerouter_base_url
    assert provider.model == "claude-3-7-sonnet"


def test_auditor_model_diversity_selection():
    """Verify Auditor chooses a distinct cloud provider (Groq) when primary is Ollama."""
    original_llm_provider = settings.llm_provider
    original_auditor_provider = settings.auditor_provider
    try:
        settings.llm_provider = "ollama"
        settings.auditor_provider = "auto"
        # Since GROQ_API_KEY is present in .env
        auditor_llm = get_auditor_provider()
        assert isinstance(auditor_llm, OpenAICompatibleProvider)
        if settings.groq_api_key and not settings.groq_api_key.startswith("gsk_abc"):
            assert "groq.com" in auditor_llm.base_url
        elif settings.gemini_api_key:
            assert "generativelanguage.googleapis.com" in auditor_llm.base_url
    finally:
        settings.llm_provider = original_llm_provider
        settings.auditor_provider = original_auditor_provider

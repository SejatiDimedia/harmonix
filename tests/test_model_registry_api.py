"""API integration tests for Dynamic Model Management (FR-36 Step 2)."""

import pytest
from httpx import ASGITransport, AsyncClient
from src.api.main import app


@pytest.mark.asyncio
async def test_get_models_catalog():
    """Verify GET /v1/models returns active config and all providers."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/v1/models")
        assert resp.status_code == 200
        data = resp.json()
        assert "active_config" in data
        assert "providers" in data

        providers = {p["provider"]: p for p in data["providers"]}
        assert "ollama" in providers
        assert "groq" in providers
        assert "gemini" in providers
        assert "openrouter" in providers
        assert "9router" in providers

        # 9Router catalog check
        assert providers["9router"]["category"] == "gateway"
        nr_models = [m["id"] for m in providers["9router"]["available_models"]]
        assert len(nr_models) > 0

        # OpenRouter catalog check
        or_models = [m["id"] for m in providers["openrouter"]["available_models"]]
        assert "nvidia/nemotron-3.5-lightning:free" in or_models


@pytest.mark.asyncio
async def test_set_active_models():
    """Verify POST /v1/models/active updates configuration in real time."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        update_payload = {
            "analyst_provider": "openrouter",
            "analyst_model": "nvidia/nemotron-3.5-lightning:free",
            "auditor_provider": "groq",
            "auditor_model": "llama-3.3-70b-versatile",
        }
        resp = await client.post("/v1/models/active", json=update_payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        active = data["active_config"]
        assert active["analyst_provider"] == "openrouter"
        assert active["analyst_model"] == "nvidia/nemotron-3.5-lightning:free"
        assert active["auditor_provider"] == "groq"

        # Re-fetch via GET to confirm persistence
        get_resp = await client.get("/v1/models")
        assert get_resp.status_code == 200
        get_active = get_resp.json()["active_config"]
        assert get_active["analyst_provider"] == "openrouter"


@pytest.mark.asyncio
async def test_get_and_update_model_api_keys():
    """Verify GET and POST /v1/models/keys manage API keys and mask secrets (FR-36)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Retrieve current masked keys
        get_resp = await client.get("/v1/models/keys")
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert "keys" in data
        keys = data["keys"]
        assert "groq" in keys
        assert "gemini" in keys
        assert "openrouter" in keys

        # Verify secrets are masked (never full plain text)
        for provider_key, info in keys.items():
            if info["is_set"]:
                assert "••••••••" in info["masked_key"]

        # 2. Update custom Groq API key via UI endpoint
        test_key = "gsk_abc123456789xyz987"
        post_resp = await client.post(
            "/v1/models/keys",
            json={"groq_api_key": test_key},
        )
        assert post_resp.status_code == 200
        post_data = post_resp.json()
        assert post_data["status"] == "updated"
        groq_info = post_data["keys"]["groq"]
        assert groq_info["is_set"] is True
        assert groq_info["masked_key"].startswith("gsk_")
        assert "••••••••" in groq_info["masked_key"]
        assert test_key not in groq_info["masked_key"]  # Full plain text not exposed

        # Verify catalog was re-synchronized
        assert "catalog" in post_data
        providers = {p["provider"]: p for p in post_data["catalog"]["providers"]}
        assert providers["groq"]["is_ready"] is True

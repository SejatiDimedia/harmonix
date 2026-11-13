"""Unit tests for CORS Configuration & Production Validation (P2 Security)."""

import pytest
from src.api.main import app, lifespan
from src.config import Settings, settings


def test_cors_origins_comma_separated_parsing():
    """Verify CORS origins string separated by commas is cleanly parsed into a list."""
    s = Settings(cors_allowed_origins="https://app.example.com, https://admin.example.com")
    assert s.cors_allowed_origins == ["https://app.example.com", "https://admin.example.com"]


def test_cors_origins_json_array_parsing():
    """Verify CORS origins formatted as JSON array string is parsed into a list."""
    s = Settings(cors_allowed_origins='["https://demo.example.com", "https://api.example.com"]')
    assert s.cors_allowed_origins == ["https://demo.example.com", "https://api.example.com"]


@pytest.mark.asyncio
async def test_production_cors_wildcard_rejected():
    """Verify that using wildcard '*' for CORS in production raises RuntimeError."""
    original_env = settings.app_env
    original_key = settings.api_auth_key
    original_origins = settings.cors_allowed_origins
    try:
        settings.app_env = "production"
        settings.api_auth_key = "a-very-strong-production-key-12345"
        settings.cors_allowed_origins = ["*"]

        with pytest.raises(RuntimeError) as exc_info:
            async with lifespan(app):
                pass
        assert "Wildcard origin '*' is strictly forbidden" in str(exc_info.value)
    finally:
        settings.app_env = original_env
        settings.api_auth_key = original_key
        settings.cors_allowed_origins = original_origins


@pytest.mark.asyncio
async def test_production_cors_valid_domain_accepted():
    """Verify that explicit production domains pass startup checks."""
    from cryptography.fernet import Fernet
    original_env = settings.app_env
    original_key = settings.api_auth_key
    original_origins = settings.cors_allowed_origins
    original_google_enc = settings.google_token_encryption_key
    try:
        settings.app_env = "production"
        settings.api_auth_key = "a-very-strong-production-key-12345"
        settings.cors_allowed_origins = ["https://app.harmonix.ai"]
        settings.google_token_encryption_key = Fernet.generate_key().decode("utf-8")

        # Should not raise any error
        async with lifespan(app):
            pass
    finally:
        settings.app_env = original_env
        settings.api_auth_key = original_key
        settings.cors_allowed_origins = original_origins
        settings.google_token_encryption_key = original_google_enc

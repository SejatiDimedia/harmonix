"""Unit tests for Google OAuth Token Encryption Security & Validation (P2 Security)."""

import pytest
from cryptography.fernet import Fernet

from src.config import settings
from src.ingestion.google_sheets import (
    validate_google_token_encryption_key,
    encrypt_token,
    decrypt_token,
)


def test_token_encryption_and_decryption_roundtrip():
    """Verify raw tokens can be encrypted and successfully decrypted."""
    raw_token = "ya29.sample_oauth_refresh_token_123456789"
    encrypted = encrypt_token(raw_token)
    assert encrypted != raw_token
    assert len(encrypted) > 20

    decrypted = decrypt_token(encrypted)
    assert decrypted == raw_token


def test_invalid_encryption_key_format_raises_error():
    """Verify corrupted or invalid Fernet keys trigger ValueError."""
    original_key = settings.google_token_encryption_key
    try:
        settings.google_token_encryption_key = "not-a-valid-32-byte-base64-key"
        with pytest.raises(ValueError) as exc_info:
            validate_google_token_encryption_key()
        assert "Invalid 'GOOGLE_TOKEN_ENCRYPTION_KEY' configuration" in str(exc_info.value)
    finally:
        settings.google_token_encryption_key = original_key


def test_production_missing_key_when_google_enabled_raises_error():
    """Verify in production mode with Google Client ID set, missing Fernet key raises RuntimeError."""
    original_env = settings.app_env
    original_client_id = settings.google_client_id
    original_key = settings.google_token_encryption_key
    try:
        settings.app_env = "production"
        settings.google_client_id = "test-client-id.apps.googleusercontent.com"
        settings.google_token_encryption_key = None

        with pytest.raises(RuntimeError) as exc_info:
            validate_google_token_encryption_key()
        assert "GOOGLE_TOKEN_ENCRYPTION_KEY' must be explicitly configured" in str(exc_info.value)
    finally:
        settings.app_env = original_env
        settings.google_client_id = original_client_id
        settings.google_token_encryption_key = original_key


def test_valid_custom_fernet_key_accepted():
    """Verify properly generated 32-byte Fernet key passes validation."""
    valid_key = Fernet.generate_key().decode("utf-8")
    original_key = settings.google_token_encryption_key
    try:
        settings.google_token_encryption_key = valid_key
        # Should not raise any error
        validate_google_token_encryption_key()
    finally:
        settings.google_token_encryption_key = original_key


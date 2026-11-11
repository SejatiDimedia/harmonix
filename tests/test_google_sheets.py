"""Unit tests for Google Account OAuth & Google Sheets Ingestion Engine (FR-50)."""

import pytest
import datetime
from unittest.mock import AsyncMock, patch, MagicMock

from src.ingestion.google_sheets import (
    extract_spreadsheet_id,
    encrypt_token,
    decrypt_token,
    get_google_auth_url,
    _find_header_row_index,
    init_google_tables,
    GoogleConnectionModel,
    SheetTabInfo,
)


def test_extract_spreadsheet_id_valid_urls():
    """Verify regex extraction of Google Spreadsheet ID from diverse URL formats."""
    # Standard full URL with edit/gid
    url1 = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0"
    assert extract_spreadsheet_id(url1) == "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"

    # URL without edit suffix
    url2 = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
    assert extract_spreadsheet_id(url2) == "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"

    # Raw alphanumeric ID
    raw_id = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
    assert extract_spreadsheet_id(raw_id) == "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"


def test_extract_spreadsheet_id_invalid():
    """Verify ValueError is raised when provided invalid or random string."""
    with pytest.raises(ValueError) as exc:
        extract_spreadsheet_id("https://google.com/not-a-sheet")
    assert "tidak valid" in str(exc.value)

    with pytest.raises(ValueError):
        extract_spreadsheet_id("short_id")


def test_token_encryption_roundtrip():
    """Verify AES Fernet encrypt and decrypt reproduces exact token bytes."""
    sample_tokens = [
        "ya29.a0AfH6SMD_secret_access_token_1234567890",
        "1//04_refresh_token_very_confidential_abcxyz",
        "simple_string",
    ]
    for tok in sample_tokens:
        encrypted = encrypt_token(tok)
        assert encrypted != tok
        assert len(encrypted) > len(tok)
        decrypted = decrypt_token(encrypted)
        assert decrypted == tok


def test_get_google_auth_url():
    """Verify OAuth 2.0 authorization URL formatting and scope inclusions."""
    with patch("src.ingestion.google_sheets.settings.google_client_id", "test-client-id-123.apps.googleusercontent.com"):
        url = get_google_auth_url("ses_test123", redirect_uri="http://localhost:8000/callback")
        assert "accounts.google.com/o/oauth2/v2/auth" in url
        assert "client_id=test-client-id-123.apps.googleusercontent.com" in url
        assert "spreadsheets.readonly" in url
        assert "drive.readonly" in url
        assert "offline" in url
        assert "state=" in url


def test_get_google_auth_url_missing_client_id():
    """Verify helpful error message if GOOGLE_CLIENT_ID is not configured."""
    with patch("src.ingestion.google_sheets.settings.google_client_id", None):
        with pytest.raises(ValueError) as exc:
            get_google_auth_url("ses_test123")
        assert "GOOGLE_CLIENT_ID belum dikonfigurasi" in str(exc.value)


def test_find_header_row_index():
    """Verify smart detection of header row when top rows have title banner."""
    # Scenario: Row 1 is a title banner with 1 non-empty cell, Row 2 is headers with 4 non-empty cells
    rows = [
        ["Laporan Penjualan Q3 2026", None, None, None],
        ["No", "Nama Produk", "Kategori", "Total Penjualan"],
        [1, "Laptop Pro", "Electronics", 15000000],
    ]
    header_idx = _find_header_row_index(rows)
    assert header_idx == 1


@pytest.mark.asyncio
async def test_init_google_tables():
    """Verify database initialization runs without error."""
    await init_google_tables()

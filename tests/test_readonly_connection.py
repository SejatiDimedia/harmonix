"""Unit tests for Least-Privilege Read-Only Database Connection (P1 Security)."""

import pytest
from src.config import settings
from src.db.connection import (
    engine,
    readonly_engine,
    get_db_session,
    get_readonly_db_session,
)


@pytest.mark.asyncio
async def test_readonly_engine_default_fallback():
    """Verify readonly_engine falls back to primary engine when database_readonly_url is not configured."""
    assert settings.database_readonly_url is None
    # When no dedicated readonly URL is specified, engine instances are shared to save connection pools
    assert readonly_engine is engine


@pytest.mark.asyncio
async def test_readonly_db_session_context_manager():
    """Verify get_readonly_db_session yields an active session and handles clean release."""
    async with get_readonly_db_session() as session:
        assert session is not None
        assert session.bind in (engine, readonly_engine)


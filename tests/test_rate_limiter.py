"""Unit and integration tests for API Rate Limiting (P1 Security)."""

from unittest.mock import patch
import pytest
from httpx import AsyncClient, ASGITransport

from src.api.main import app
from src.api.rate_limiter import SlidingWindowRateLimiter, chat_limiter, upload_limiter
from src.config import settings


async def _dummy_stream(*args, **kwargs):
    yield {"event": "status", "data": "ok"}


@pytest.mark.asyncio
async def test_sliding_window_rate_limiter_logic():
    """Verify raw SlidingWindowRateLimiter correctly tracks and blocks exceeding requests."""
    limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=10, name="test_limiter")
    limiter.reset()

    # 1. First 2 requests should be allowed
    allowed_1, retry_1 = await limiter.check("client_a")
    assert allowed_1 is True
    assert retry_1 == 0

    allowed_2, retry_2 = await limiter.check("client_a")
    assert allowed_2 is True
    assert retry_2 == 0

    # 2. 3rd request from client_a should be blocked
    allowed_3, retry_3 = await limiter.check("client_a")
    assert allowed_3 is False
    assert retry_3 > 0

    # 3. Request from different client (client_b) should still be allowed
    allowed_b, retry_b = await limiter.check("client_b")
    assert allowed_b is True
    assert retry_b == 0

    # 4. Resetting limiter opens up client_a again
    limiter.reset()
    allowed_after_reset, _ = await limiter.check("client_a")
    assert allowed_after_reset is True


@pytest.mark.asyncio
async def test_chat_endpoint_rate_limiting_enforcement():
    """Verify /v1/chat returns 429 Too Many Requests with Retry-After when rate limit is exceeded."""
    original_enabled = settings.rate_limit_enabled
    original_limit = settings.rate_limit_chat_per_minute
    try:
        settings.rate_limit_enabled = True
        settings.rate_limit_chat_per_minute = 2
        chat_limiter.reset()

        with patch("src.agent.manual_loop.ManualAgentLoop.run", side_effect=_dummy_stream):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                headers = {"X-Forwarded-For": "198.51.100.42"}

                # Request 1: Allowed (SSE status 200)
                async with client.stream("POST", "/v1/chat", headers=headers, json={"query": "Test 1"}) as resp1:
                    assert resp1.status_code == 200

                # Request 2: Allowed (SSE status 200)
                async with client.stream("POST", "/v1/chat", headers=headers, json={"query": "Test 2"}) as resp2:
                    assert resp2.status_code == 200

                # Request 3: Blocked by Rate Limiter -> 429
                async with client.stream("POST", "/v1/chat", headers=headers, json={"query": "Test 3"}) as resp3:
                    assert resp3.status_code == 429
                    assert "Retry-After" in resp3.headers
                    data = await resp3.aread()
                    assert b"Terlalu banyak permintaan (chat)" in data

                # Different client IP is unaffected
                async with client.stream("POST", "/v1/chat", headers={"X-Forwarded-For": "198.51.100.99"}, json={"query": "Other"}) as resp_other:
                    assert resp_other.status_code == 200
    finally:
        settings.rate_limit_enabled = original_enabled
        settings.rate_limit_chat_per_minute = original_limit
        chat_limiter.reset()


@pytest.mark.asyncio
async def test_rate_limit_disabled_flag():
    """Verify that setting rate_limit_enabled=False bypasses rate limit checks."""
    original_enabled = settings.rate_limit_enabled
    original_limit = settings.rate_limit_chat_per_minute
    try:
        settings.rate_limit_enabled = False
        settings.rate_limit_chat_per_minute = 1
        chat_limiter.reset()

        with patch("src.agent.manual_loop.ManualAgentLoop.run", side_effect=_dummy_stream):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                headers = {"X-Forwarded-For": "203.0.113.10"}
                async with client.stream("POST", "/v1/chat", headers=headers, json={"query": "Q1"}) as resp1:
                    assert resp1.status_code == 200
                async with client.stream("POST", "/v1/chat", headers=headers, json={"query": "Q2"}) as resp2:
                    assert resp2.status_code == 200
    finally:
        settings.rate_limit_enabled = original_enabled
        settings.rate_limit_chat_per_minute = original_limit
        chat_limiter.reset()

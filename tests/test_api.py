"""API endpoint integration tests."""

import json
import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app


@pytest.mark.asyncio
async def test_health_check_endpoint():
    """Verify /health endpoint response schema."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "llm_provider" in data
        assert "database_connected" in data


@pytest.mark.asyncio
async def test_chat_sse_stream():
    """Verify /v1/chat endpoint produces a valid SSE stream."""
    payload = {"query": "Berapa total penjualan bulan lalu?"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream("POST", "/v1/chat", json=payload) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")

            lines = []
            async for line in response.aiter_lines():
                if line:
                    lines.append(line)

            # Check that we received event and data fields
            events = [line for line in lines if line.startswith("event: ")]
            assert len(events) > 0


@pytest.mark.asyncio
async def test_approval_endpoint_404():
    """Verify submitting approval for non-existent ID returns 404."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/v1/approvals/non_existent_id",
            json={"decision": "approved", "reason": "Looks safe to me"},
        )
        assert response.status_code == 404

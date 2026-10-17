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
async def test_chat_sse_stream_langgraph_engine():
    """Verify /v1/chat endpoint supports engine='langgraph' SSE streaming."""
    payload = {"query": "Berapa total transaksi?", "engine": "langgraph"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream("POST", "/v1/chat", json=payload) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")

            lines = []
            async for line in response.aiter_lines():
                if line:
                    lines.append(line)

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


@pytest.mark.asyncio
async def test_get_task_endpoint():
    """Verify /v1/tasks/{task_id} returns 404 for unknown task and 200 for saved task."""
    from src.agent.models import AgentTaskStatus
    from src.agent.state import save_task_checkpoint

    test_task_id = "test_api_task_123"
    await save_task_checkpoint(
        task_id=test_task_id,
        status=AgentTaskStatus.RUNNING,
        current_step=1,
        messages=[{"role": "user", "content": "Halo"}],
        user_query="Halo",
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Unknown task
        resp_404 = await client.get("/v1/tasks/non_existent_task")
        assert resp_404.status_code == 404

        # Known task
        resp_200 = await client.get(f"/v1/tasks/{test_task_id}")
        assert resp_200.status_code == 200
        data = resp_200.json()
        assert data["task_id"] == test_task_id
        assert data["status"] == "RUNNING"
        assert data["current_step"] == 1


@pytest.mark.asyncio
async def test_task_resume_stream():
    """Verify /v1/tasks/{task_id}/resume resumes execution and streams SSE."""
    from src.agent.models import AgentTaskStatus
    from src.agent.state import save_task_checkpoint

    test_task_id = "test_resume_task_456"
    await save_task_checkpoint(
        task_id=test_task_id,
        status=AgentTaskStatus.WAITING_APPROVAL,
        current_step=1,
        messages=[{"role": "user", "content": "Analisis data"}],
        user_query="Analisis data",
        pending_approval={"decision": "approved"},
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream("POST", f"/v1/tasks/{test_task_id}/resume", json={"feedback": "Lanjutkan"}) as resp:
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers.get("content-type", "")
            lines = []
            async for line in resp.aiter_lines():
                if line:
                    lines.append(line)
            events = [line for line in lines if line.startswith("event: ")]
            assert len(events) > 0


@pytest.mark.asyncio
async def test_task_resume_stream_langgraph():
    """Verify /v1/tasks/{task_id}/resume resumes execution with LangGraph engine when task_id starts with langgraph_."""
    from src.agent.models import AgentTaskStatus
    from src.agent.state import save_task_checkpoint

    test_task_id = "langgraph_test_resume_789"
    await save_task_checkpoint(
        task_id=test_task_id,
        status=AgentTaskStatus.WAITING_APPROVAL,
        current_step=1,
        messages=[{"role": "user", "content": "Analisis data"}],
        user_query="Analisis data",
        pending_approval={"decision": "approved", "tool_call_id": "call_123", "tool_name": "run_sql", "sanitized_query": "SELECT 1;"},
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream("POST", f"/v1/tasks/{test_task_id}/resume", json={"feedback": "Query disetujui oleh analis."}) as resp:
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers.get("content-type", "")
            lines = []
            async for line in resp.aiter_lines():
                if line:
                    lines.append(line)
            events = [line for line in lines if line.startswith("event: ")]
            assert len(events) > 0


@pytest.mark.asyncio
async def test_web_ui_endpoint():
    """Verify GET / returns the Claude-inspired anti-slop HTML interface."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "")
        body = resp.text
        assert "Harnessly" in body
        assert "marked.min.js" in body
        assert "Newsreader" in body



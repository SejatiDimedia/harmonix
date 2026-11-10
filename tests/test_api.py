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
async def test_chat_sse_stream_swarm_engine():
    """Verify /v1/chat endpoint supports engine='swarm' (PlannerExecutorAgent) SSE streaming."""
    payload = {"query": "Berapa total transaksi?", "engine": "swarm"}
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
async def test_sessions_lifecycle_endpoints():
    """Verify listing, detail retrieval, and deletion of chat sessions via /v1/sessions endpoints."""
    from src.agent.models import AgentTaskStatus
    from src.agent.state import save_task_checkpoint

    test_sid = "test_session_lifecycle_999"
    task_1 = "test_task_s1"
    task_2 = "test_task_s2"

    # Seed 2 tasks for this session
    await save_task_checkpoint(
        task_id=task_1,
        status=AgentTaskStatus.COMPLETED,
        current_step=2,
        messages=[{"role": "user", "content": "Berapa total pesanan?"}],
        user_query="Berapa total pesanan?",
        session_id=test_sid,
        final_result={
            "answer_text": "Total pesanan adalah 100.",
            "sql_queries": ["SELECT count(*) FROM analytics.orders;"],
            "tables": [{"columns": ["count"], "rows": [[100]]}],
            "charts": [{"chart_type": "bar", "title": "Pesanan", "x_axis": "kategori", "y_axis": "count", "data": []}],
            "follow_up_suggestions": [
                "Bagaimana rincian pesanan berdasarkan status pengiriman?",
                "Tampilkan tren pesanan bulanan sepanjang tahun.",
                "Berapa rata-rata nilai transaksi per pesanan?",
            ],
        },
    )

    await save_task_checkpoint(
        task_id=task_2,
        status=AgentTaskStatus.COMPLETED,
        current_step=3,
        messages=[{"role": "user", "content": "Tampilkan grafik kategori"}],
        user_query="Tampilkan grafik kategori",
        session_id=test_sid,
        final_result={
            "answer_text": "Berikut grafik kategori produk.",
            "sql_queries": ["SELECT category, count(*) FROM analytics.products GROUP BY 1;"],
            "tables": [],
            "charts": [{"chart_type": "pie", "title": "Kategori", "x_axis": "category", "y_axis": "count", "data": []}],
        },
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. List sessions
        list_resp = await client.get("/v1/sessions")
        assert list_resp.status_code == 200
        data = list_resp.json()
        assert "sessions" in data
        matching = [s for s in data["sessions"] if s["session_id"] == test_sid]
        assert len(matching) == 1
        assert matching[0]["title"] == "Berapa total pesanan?"
        assert matching[0]["total_turns"] == 2

        # 2. Get session details
        detail_resp = await client.get(f"/v1/sessions/{test_sid}")
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        assert detail["session_id"] == test_sid
        assert detail["title"] == "Berapa total pesanan?"
        assert detail["total_turns"] == 2
        assert len(detail["turns"]) == 2
        assert detail["turns"][0]["user_query"] == "Berapa total pesanan?"
        assert detail["turns"][0]["answer_text"] == "Total pesanan adalah 100."
        assert len(detail["turns"][0]["sql_queries"]) == 1
        assert len(detail["turns"][0]["tables"]) == 1
        assert len(detail["turns"][0]["follow_up_suggestions"]) == 3
        assert detail["turns"][0]["follow_up_suggestions"][0] == "Bagaimana rincian pesanan berdasarkan status pengiriman?"
        assert detail["turns"][1]["charts"][0]["chart_type"] == "pie"
        assert detail["turns"][1]["follow_up_suggestions"] == []

        # 3. Rename session (FR-33 & Session Renaming)
        rename_resp = await client.patch(
            f"/v1/sessions/{test_sid}",
            json={"title": "Analisis Performa Penjualan Q4"},
        )
        assert rename_resp.status_code == 200
        assert rename_resp.json() == {
            "status": "updated",
            "session_id": test_sid,
            "title": "Analisis Performa Penjualan Q4",
        }

        # Verify renamed title reflected in list_sessions
        list_renamed = await client.get("/v1/sessions")
        assert list_renamed.status_code == 200
        matching_renamed = [s for s in list_renamed.json()["sessions"] if s["session_id"] == test_sid]
        assert len(matching_renamed) == 1
        assert matching_renamed[0]["title"] == "Analisis Performa Penjualan Q4"

        # Verify renamed title reflected in session details
        detail_renamed = await client.get(f"/v1/sessions/{test_sid}")
        assert detail_renamed.status_code == 200
        assert detail_renamed.json()["title"] == "Analisis Performa Penjualan Q4"

        # Validation: empty title returns 422
        invalid_rename = await client.patch(
            f"/v1/sessions/{test_sid}",
            json={"title": "   "},
        )
        assert invalid_rename.status_code == 422

        # 4. Non-existent session details returns 404
        not_found_resp = await client.get("/v1/sessions/non_existent_session_xyz")
        assert not_found_resp.status_code == 404

        # 5. Delete session
        del_resp = await client.delete(f"/v1/sessions/{test_sid}")
        assert del_resp.status_code == 200
        assert del_resp.json() == {"status": "deleted", "session_id": test_sid}

        # 6. Subsequent GET returns 404
        subsequent_get = await client.get(f"/v1/sessions/{test_sid}")
        assert subsequent_get.status_code == 404

        # 7. Deleting already deleted session returns 404
        subsequent_del = await client.delete(f"/v1/sessions/{test_sid}")
        assert subsequent_del.status_code == 404


@pytest.mark.asyncio
async def test_web_ui_endpoint():
    """Verify GET / returns the modern anti-slop HTML interface."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "")
        body = resp.text
        assert "Harmonix" in body
        assert "root" in body
        assert "Jakarta" in body


@pytest.mark.asyncio
async def test_approval_idempotency_and_rejection():
    """Verify approval endpoint handles idempotency and 409 conflict upon change of decision."""
    from src.api.main import pending_approvals

    appr_id = "test_appr_audit_123"
    pending_approvals[appr_id] = {
        "approval_id": appr_id,
        "query": "SELECT * FROM customers",
        "sanitized_query": "SELECT * FROM customers LIMIT 50",
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # First submission: reject
        resp1 = await client.post(
            f"/v1/approvals/{appr_id}",
            json={"decision": "rejected", "reason": "Data PII tidak boleh diakses."},
        )
        assert resp1.status_code == 200
        assert resp1.json()["decision"] == "rejected"

        # Second submission with same decision: idempotent 200
        resp2 = await client.post(
            f"/v1/approvals/{appr_id}",
            json={"decision": "rejected", "reason": "Data PII tidak boleh diakses."},
        )
        assert resp2.status_code == 200
        assert resp2.json().get("idempotent") is True

        # Third submission with conflicting decision: 409 Conflict
        resp3 = await client.post(
            f"/v1/approvals/{appr_id}",
            json={"decision": "approved", "reason": "Berubah pikiran"},
        )
        assert resp3.status_code == 409

    pending_approvals.pop(appr_id, None)


@pytest.mark.asyncio
async def test_api_authentication_enforcement():
    """Verify endpoints enforce 401 when API authentication key is configured."""
    from src.config import settings

    original_key = settings.api_auth_key
    try:
        settings.api_auth_key = "test-secure-api-key-xyz"

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # 1. Without credentials -> 401
            resp_no_auth = await client.get("/v1/models/keys")
            assert resp_no_auth.status_code == 401

            # 2. With invalid credentials -> 401
            resp_bad_auth = await client.get(
                "/v1/models/keys",
                headers={"X-API-Key": "wrong-key"},
            )
            assert resp_bad_auth.status_code == 401

            # 3. With valid X-API-Key -> 200
            resp_good_key = await client.get(
                "/v1/models/keys",
                headers={"X-API-Key": "test-secure-api-key-xyz"},
            )
            assert resp_good_key.status_code == 200

            # 4. With valid Bearer token -> 200
            resp_good_bearer = await client.get(
                "/v1/models/keys",
                headers={"Authorization": "Bearer test-secure-api-key-xyz"},
            )
            assert resp_good_bearer.status_code == 200

            # 5. /health remains accessible without auth -> 200
            resp_health = await client.get("/health")
            assert resp_health.status_code == 200
    finally:
        settings.api_auth_key = original_key


@pytest.mark.asyncio
async def test_models_keys_production_protection():
    """Verify writing API keys is blocked with 403 Forbidden in production environment (P0-4)."""
    from src.config import settings

    original_env = settings.app_env
    original_admin_key = settings.admin_api_key
    try:
        settings.app_env = "production"
        settings.admin_api_key = "test-admin-secret"

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # Even with admin key provided, writing to .env is disabled in production
            resp = await client.post(
                "/v1/models/keys",
                headers={"X-API-Key": "test-admin-secret"},
                json={"groq_api_key": "gsk_prod_dummy_12345"},
            )
            assert resp.status_code == 403
            assert "disabled in production" in resp.json()["detail"].lower()
    finally:
        settings.app_env = original_env
        settings.admin_api_key = original_admin_key


@pytest.mark.asyncio
async def test_models_keys_format_validation():
    """Verify API key submission performs format validation (P0-4)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Invalid groq key format (missing gsk_)
        resp_invalid_groq = await client.post(
            "/v1/models/keys",
            json={"groq_api_key": "invalid_groq_prefix_12345"},
        )
        assert resp_invalid_groq.status_code == 422
        assert "Invalid Groq API key format" in resp_invalid_groq.json()["detail"]

        # Invalid openrouter key format
        resp_invalid_or = await client.post(
            "/v1/models/keys",
            json={"openrouter_api_key": "bad_openrouter_prefix"},
        )
        assert resp_invalid_or.status_code == 422
        assert "Invalid OpenRouter API key format" in resp_invalid_or.json()["detail"]


@pytest.mark.asyncio
async def test_cancel_task_endpoint():
    """Verify /v1/tasks/{task_id}/cancel flags task and returns cancelled status."""
    from src.agent.cancellation import is_task_cancelled, clear_task_cancellation

    test_task_id = "test_cancel_12345"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(f"/v1/tasks/{test_task_id}/cancel")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "cancelled"
            assert data["task_id"] == test_task_id
            assert is_task_cancelled(test_task_id) is True
    finally:
        clear_task_cancellation(test_task_id)


@pytest.mark.asyncio
async def test_cancel_chat_endpoint():
    """Verify /v1/chat/cancel endpoint accepts task_id or session_id and flags cancellation."""
    from src.agent.cancellation import is_task_cancelled, clear_task_cancellation

    test_task_id = "test_chat_cancel_67890"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/v1/chat/cancel", json={"task_id": test_task_id})
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "cancelled"
            assert is_task_cancelled(test_task_id) is True
    finally:
        clear_task_cancellation(test_task_id)



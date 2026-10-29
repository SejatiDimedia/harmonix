"""Unit and Integration Tests for FR-17: Long-Term Memory with pgvector."""

import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app
from src.rag.long_term_memory import (
    init_long_term_memory_table,
    seed_golden_memories_if_empty,
    store_successful_query,
    store_user_preference,
    retrieve_relevant_memories,
    list_long_term_memories,
    delete_long_term_memory,
)


@pytest.mark.asyncio
async def test_init_and_seed_long_term_memories():
    """Verify table creation and seeding of canonical golden queries."""
    await init_long_term_memory_table()
    await seed_golden_memories_if_empty()

    memories = await list_long_term_memories(limit=10)
    assert len(memories) >= 5, "Should have seeded at least 5 golden memories."
    first = memories[0]
    assert "question_text" in first
    assert "sql_query" in first
    assert first["memory_type"] == "successful_query"


@pytest.mark.asyncio
async def test_store_and_retrieve_long_term_memory():
    """Verify storing an auditor-approved SQL query and recalling it via semantic similarity."""
    test_q = "Berapa total nilai GMV pesanan per kota di Indonesia?"
    test_sql = "SELECT c.city, SUM(p.payment_value) FROM analytics.orders o JOIN analytics.customers c ON o.customer_id = c.customer_id JOIN analytics.order_payments p ON o.order_id = p.order_id WHERE o.order_status = 'delivered' GROUP BY c.city;"

    mem_id = await store_successful_query(
        question=test_q,
        sql=test_sql,
        session_id="test_session_123",
        explanation="Kueri analitik persebaran GMV per kota",
        tables=["orders", "customers", "order_payments"],
        confidence=0.98,
    )
    assert mem_id is not None

    # Test retrieval with semantic similarity
    similar_q = "Tampilkan ringkasan GMV tiap kota pelanggan"
    recalled = await retrieve_relevant_memories(query=similar_q, limit=3, min_similarity=0.55)
    assert len(recalled) > 0, "Should have retrieved relevant memories."
    assert any("city" in (m.sql_query or "") or "GMV" in m.question_text for m in recalled)

    # Cleanup
    await delete_long_term_memory(mem_id)


@pytest.mark.asyncio
async def test_user_preference_storage():
    """Verify storing and recalling persistent user business rules."""
    pref_text = "Selalu format nominal mata uang dengan simbol Rp dan bulatkan dua desimal."
    pref_id = await store_user_preference(
        preference_text=pref_text,
        session_id="user_pref_session",
    )
    assert pref_id is not None

    memories = await list_long_term_memories(limit=50, memory_type="user_preference")
    assert any(m["id"] == pref_id for m in memories)

    # Cleanup
    await delete_long_term_memory(pref_id)


@pytest.mark.asyncio
async def test_api_memories_endpoints():
    """Verify GET, POST, and DELETE /v1/memories endpoints."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. GET /v1/memories
        res = await client.get("/v1/memories")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert "memories" in data
        assert isinstance(data["memories"], list)

        # 2. POST /v1/memories (create successful query)
        create_res = await client.post(
            "/v1/memories",
            json={
                "question": "Hitung rasio pembatalan pesanan per bulan",
                "sql": "SELECT DATE_TRUNC('month', order_purchase_timestamp), COUNT(*) FROM analytics.orders WHERE order_status = 'canceled' GROUP BY 1;",
                "explanation": "Formula rasio pembatalan pesanan",
                "session_id": "test_api_session",
                "memory_type": "successful_query",
            },
        )
        assert create_res.status_code == 200
        created_data = create_res.json()
        new_id = created_data["memory_id"]
        assert new_id is not None

        # 3. DELETE /v1/memories/{new_id}
        del_res = await client.delete(f"/v1/memories/{new_id}")
        assert del_res.status_code == 200
        assert del_res.json()["status"] == "success"

        # 4. DELETE /v1/memories/99999999 (non-existent)
        del_404 = await client.delete("/v1/memories/99999999")
        assert del_404.status_code == 404

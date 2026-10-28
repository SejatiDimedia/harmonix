"""Unit and integration tests for Automated Data Health Profiling Engine (FR-41)."""

import pytest
from httpx import AsyncClient, ASGITransport
from src.api.main import app
from src.ingestion.data_health_profiler import compute_table_data_health, TableHealthProfile


@pytest.mark.asyncio
async def test_compute_table_data_health_existing_table():
    """Verify health profiling on an existing warehouse/uploaded table."""
    # Using 'orders' or 'upload_ses_1iqw_penjualan_lengka_penjualan_lengka'
    profile = await compute_table_data_health(table_name="orders")
    
    assert isinstance(profile, TableHealthProfile)
    assert profile.table_name == "orders"
    assert profile.qualified_name == "analytics.orders"
    assert profile.total_rows > 0
    assert profile.total_columns > 0
    assert 0 <= profile.health_score <= 100
    assert profile.health_grade in {"Prima", "Perhatian", "Kritis"}
    assert profile.health_badge_color in {"emerald", "amber", "rose"}
    assert len(profile.column_profiles) == profile.total_columns
    assert len(profile.quick_prompts) <= 3


@pytest.mark.asyncio
async def test_compute_table_data_health_non_existent():
    """Verify error raised on non-existent table name."""
    with pytest.raises(ValueError) as exc:
        await compute_table_data_health(table_name="non_existent_table_xyz_123")
    assert "tidak ditemukan" in str(exc.value)


@pytest.mark.asyncio
async def test_api_table_health_endpoint_success():
    """Verify GET /v1/sessions/{id}/tables/{table}/health returns 200 with valid schema."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/sessions/test_sess/tables/orders/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["table_name"] == "orders"
        assert "health_score" in data
        assert "health_grade" in data
        assert "anomalies" in data
        assert "quick_prompts" in data
        assert isinstance(data["quick_prompts"], list)


@pytest.mark.asyncio
async def test_api_table_health_endpoint_404():
    """Verify GET /v1/sessions/{id}/tables/{table}/health returns 404 for unknown table."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/sessions/test_sess/tables/table_not_found_123/health")
        assert resp.status_code == 404

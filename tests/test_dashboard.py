"""Unit and integration tests for Live BI Dashboard Canvas (FR-37)."""

import pytest
from httpx import AsyncClient, ASGITransport
from src.api.main import app
from src.dashboard.manager import (
    init_dashboard_table,
    pin_widget,
    get_dashboard_widgets,
    delete_dashboard_widget,
    refresh_dashboard_widgets,
    PinWidgetInput,
)


@pytest.mark.asyncio
async def test_dashboard_crud_and_refresh():
    """Verify pinning, listing, refreshing, and deleting dashboard widgets."""
    await init_dashboard_table()

    test_session_id = f"test_dash_sess_{int(pytest.approx(1000).expected)}"

    # 1. Pin a chart widget with SQL query
    chart_payload = PinWidgetInput(
        session_id=test_session_id,
        widget_type="chart",
        title="Penjualan Produk Q4",
        sql_query="SELECT status, COUNT(*) as count FROM analytics.orders GROUP BY status;",
        chart_spec={
            "chart_type": "bar",
            "title": "Penjualan Produk Q4",
            "x_axis": "status",
            "y_axis": "count",
            "data": [{"status": "shipped", "count": 10}],
        },
        table_data={
            "columns": ["status", "count"],
            "rows": [["shipped", 10]],
            "row_count": 1,
        },
    )
    pinned_chart = await pin_widget(chart_payload)
    assert pinned_chart.widget_id.startswith("wgt_")
    assert pinned_chart.title == "Penjualan Produk Q4"

    # 2. Pin a table widget
    table_payload = PinWidgetInput(
        session_id=test_session_id,
        widget_type="table",
        title="Daftar Kategori",
        sql_query="SELECT category, COUNT(*) as qty FROM analytics.products GROUP BY category;",
        table_data={
            "columns": ["category", "qty"],
            "rows": [["Electronics", 5]],
            "row_count": 1,
        },
    )
    pinned_table = await pin_widget(table_payload)
    assert pinned_table.widget_type == "table"

    # 3. List widgets
    widgets = await get_dashboard_widgets(test_session_id)
    assert len(widgets) == 2
    titles = [w.title for w in widgets]
    assert "Penjualan Produk Q4" in titles
    assert "Daftar Kategori" in titles

    # 4. Refresh widgets (0 LLM cost deterministic execution against PostgreSQL)
    refreshed = await refresh_dashboard_widgets(test_session_id)
    assert len(refreshed) == 2
    # Check that table_data rows were refreshed from real DB
    chart_refreshed = next(w for w in refreshed if w.widget_id == pinned_chart.widget_id)
    assert chart_refreshed.table_data is not None
    assert len(chart_refreshed.table_data.get("rows", [])) > 0
    assert len(chart_refreshed.chart_spec.get("data", [])) > 0

    # 5. Delete widgets
    del1 = await delete_dashboard_widget(pinned_chart.widget_id)
    assert del1 is True
    del2 = await delete_dashboard_widget(pinned_table.widget_id)
    assert del2 is True

    # Confirm list is now empty
    remaining = await get_dashboard_widgets(test_session_id)
    assert len(remaining) == 0


@pytest.mark.asyncio
async def test_dashboard_api_endpoints():
    """Verify HTTP endpoints for dashboard under /v1/dashboard."""
    test_session = "test_api_sess_dash_42"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # GET empty dashboard
        res = await client.get(f"/v1/dashboard/{test_session}")
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 0

        # POST pin
        pin_res = await client.post(
            "/v1/dashboard/pin",
            json={
                "session_id": test_session,
                "widget_type": "chart",
                "title": "API Pinned Chart",
                "sql_query": "SELECT status, COUNT(*) as c FROM analytics.orders GROUP BY status;",
                "chart_spec": {
                    "chart_type": "bar",
                    "title": "API Pinned Chart",
                    "x_axis": "status",
                    "y_axis": "c",
                    "data": [],
                },
            },
        )
        assert pin_res.status_code == 200
        widget_id = pin_res.json()["widget_id"]

        # GET dashboard has 1 widget
        res = await client.get(f"/v1/dashboard/{test_session}")
        assert res.status_code == 200
        assert res.json()["total"] == 1

        # POST refresh
        refresh_res = await client.post(f"/v1/dashboard/refresh/{test_session}")
        assert refresh_res.status_code == 200
        assert refresh_res.json()["total"] == 1

        # DELETE widget
        del_res = await client.delete(f"/v1/dashboard/{widget_id}")
        assert del_res.status_code == 200
        assert del_res.json()["status"] == "deleted"

        # GET dashboard empty again
        res = await client.get(f"/v1/dashboard/{test_session}")
        assert res.json()["total"] == 0


@pytest.mark.asyncio
async def test_dashboard_layout_api_and_tv():
    """Verify PUT /v1/dashboard/layout/{session_id} and GET /tv/{session_id}."""
    test_session = "test_api_sess_layout_99"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Test PUT layout with empty list or arbitrary items
        layout_res = await client.put(
            f"/v1/dashboard/layout/{test_session}",
            json={
                "layout": [
                    {"widget_id": "wgt_nonexistent_1", "position": 0, "span": "full"},
                    {"widget_id": "wgt_nonexistent_2", "position": 1, "span": "half"},
                ]
            },
        )
        assert layout_res.status_code == 200
        data = layout_res.json()
        assert data["status"] == "success"
        assert data["session_id"] == test_session
        assert "updated_count" in data

        # Test TV route endpoint
        tv_res = await client.get(f"/tv/{test_session}")
        assert tv_res.status_code in [200, 404]

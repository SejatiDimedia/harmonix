"""Unit and integration tests for Bring Your Own Data (BYOD) File Ingestion (FR-39)."""

import io
import pytest
import openpyxl
import pandas as pd
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from src.api.main import app
from src.db.connection import get_db_session
from src.ingestion.excel_csv_parser import (
    process_file_and_create_tables,
    get_session_uploaded_tables,
    cleanup_session_uploaded_tables,
    sanitize_identifier,
)


@pytest.mark.asyncio
async def test_sanitize_identifier():
    """Verify identifier sanitization handles spaces, symbols, and SQL reserved words."""
    assert sanitize_identifier("Order Date") == "order_date"
    assert sanitize_identifier("Total (IDR)!") == "total_idr"
    assert sanitize_identifier("select") == "select_col"
    assert sanitize_identifier("123_number") == "col_123_number"
    assert sanitize_identifier("order") == "order_col"


@pytest.mark.asyncio
async def test_csv_upload_and_query():
    """Verify CSV file ingestion, table creation, querying, and cleanup."""
    test_session = "test_byod_csv_sess"
    
    # Generate in-memory CSV
    csv_content = (
        "region,target_revenue,target_orders\n"
        "Jabodetabek,150000000,500\n"
        "Jawa Barat,90000000,320\n"
        "Jawa Timur,85000000,280\n"
    ).encode("utf-8")

    # Ingest CSV
    summaries = await process_file_and_create_tables(
        session_id=test_session,
        filename="sales_targets.csv",
        file_bytes=csv_content,
    )

    assert len(summaries) == 1
    t = summaries[0]
    assert t.row_count == 3
    assert t.original_filename == "sales_targets.csv"
    assert "upload_" in t.table_name

    # Verify physical table exists in PostgreSQL and query it
    async with get_db_session() as session:
        result = await session.execute(text(f'SELECT region, target_revenue FROM analytics."{t.table_name}" ORDER BY target_revenue DESC;'))
        rows = result.fetchall()
        assert len(rows) == 3
        assert rows[0][0] == "Jabodetabek"
        assert rows[0][1] == 150000000

    # Verify retrieval via get_session_uploaded_tables
    listed = await get_session_uploaded_tables(test_session)
    assert len(listed) == 1
    assert listed[0].table_name == t.table_name

    # Cleanup
    dropped = await cleanup_session_uploaded_tables(test_session)
    assert dropped >= 1

    # Verify table no longer exists
    async with get_db_session() as session:
        check = await session.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_schema = 'analytics' AND table_name = :t;"),
            {"t": t.table_name},
        )
        assert check.scalar() is None


@pytest.mark.asyncio
async def test_excel_multi_sheet_upload_and_api():
    """Verify multi-sheet Excel ingestion produces separate tables per sheet via API."""
    test_session = "test_byod_excel_api_sess"

    # Create an in-memory Excel file with 2 sheets
    excel_buffer = io.BytesIO()
    with pd.ExcelWriter(excel_buffer, engine="openpyxl") as writer:
        df_sheet1 = pd.DataFrame({
            "store_id": ["S01", "S02", "S03"],
            "store_name": ["Jakarta Flagship", "Bandung Hub", "Surabaya Branch"],
            "monthly_budget": [50000000, 30000000, 25000000],
        })
        df_sheet2 = pd.DataFrame({
            "kpi_metric": ["CSAT", "NPS", "Fulfillment Rate"],
            "target_score": [4.8, 72.5, 98.2],
        })
        df_sheet1.to_excel(writer, sheet_name="Store_Targets", index=False)
        df_sheet2.to_excel(writer, sheet_name="Service_KPIs", index=False)

    excel_bytes = excel_buffer.getvalue()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # POST upload
        files = {
            "files": ("Q1_Retail_Plan.xlsx", excel_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        res = await client.post(f"/v1/sessions/{test_session}/upload", files=files)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["total_tables_created"] == 2
        
        tables = data["tables"]
        sheet_names = [t["sheet_name"] for t in tables]
        assert "Store_Targets" in sheet_names
        assert "Service_KPIs" in sheet_names

        # GET session tables
        get_res = await client.get(f"/v1/sessions/{test_session}/tables")
        assert get_res.status_code == 200
        get_data = get_res.json()
        assert get_data["total_tables"] == 2

    # Cleanup session tables
    await cleanup_session_uploaded_tables(test_session)


@pytest.mark.asyncio
async def test_cross_join_warehouse_and_uploaded_table():
    """Verify executing an SQL cross-join between master warehouse tables and user uploaded table."""
    test_session = "test_byod_join_sess"

    csv_targets = (
        "category,budget_allocation\n"
        "Electronics,75000000\n"
        "Fashion,25000000\n"
        "Home & Living,35000000\n"
    ).encode("utf-8")

    summaries = await process_file_and_create_tables(
        session_id=test_session,
        filename="dept_budgets.csv",
        file_bytes=csv_targets,
    )
    assert len(summaries) == 1
    tname = summaries[0].table_name

    # Cross-join with analytics.products and analytics.order_items
    async with get_db_session() as session:
        join_query = text(f"""
            SELECT 
                u.category,
                u.budget_allocation,
                COUNT(oi.order_item_id) as total_items_sold,
                COALESCE(SUM(oi.price), 0) as total_realized_revenue
            FROM analytics."{tname}" u
            LEFT JOIN analytics.products p ON p.product_category_name ILIKE ('%' || u.category || '%')
            LEFT JOIN analytics.order_items oi ON oi.product_id = p.product_id
            GROUP BY u.category, u.budget_allocation
            ORDER BY total_realized_revenue DESC;
        """)
        result = await session.execute(join_query)
        rows = result.fetchall()
        assert len(rows) == 3
        # Ensure categories exist
        cats = [r[0] for r in rows]
        assert "Electronics" in cats
        assert "Fashion" in cats

    await cleanup_session_uploaded_tables(test_session)


@pytest.mark.asyncio
async def test_upload_batch_limit():
    """Verify that batch uploads support up to 10 files and reject more than 10."""
    test_session = "test_byod_batch_limit_sess"
    
    # Test with 11 files (should fail with HTTP 400)
    files_11 = [
        ("files", (f"file_{i}.csv", b"col_a,col_b\n1,2\n", "text/csv"))
        for i in range(11)
    ]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(f"/v1/sessions/{test_session}/upload", files=files_11)
        assert res.status_code == 400
        assert "Maksimum 10 berkas" in res.json()["detail"]

    # Test with 7 files (user's scenario, should succeed with HTTP 200)
    files_7 = [
        ("files", (f"file_{i}.csv", b"col_a,col_b\n1,2\n", "text/csv"))
        for i in range(7)
    ]
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(f"/v1/sessions/{test_session}/upload", files=files_7)
        assert res.status_code == 200
        data = res.json()
        assert data["total_files"] == 7
        assert data["total_tables_created"] == 7

    await cleanup_session_uploaded_tables(test_session)

"""Unit tests for Batch Processing Engine and API Endpoints (FR-42, Pilar 6.4)."""

import asyncio
import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from src.api.main import app
from src.batch.engine import BatchProcessingEngine, BatchJobRecord, CreateBatchRequest


@pytest.mark.asyncio
async def test_batch_engine_create_and_lifecycle():
    """Verify BatchProcessingEngine creates, tracks, and processes query items."""
    queries = [
        "Berapa total omzet per bulan?",
        "Tampilkan 5 pelanggan dengan transaksi terbesar",
    ]

    record = await BatchProcessingEngine.create_batch(queries=queries, concurrency_limit=2)
    assert record.batch_id.startswith("batch_")
    assert record.total_queries == 2
    assert record.status in ("pending", "processing", "completed")

    # Wait briefly for mock background completion
    await asyncio.sleep(0.1)

    fetched = BatchProcessingEngine.get_batch(record.batch_id)
    assert fetched is not None
    assert fetched.batch_id == record.batch_id
    assert len(fetched.items) == 2


def test_batch_exports_jsonl_and_csv():
    """Verify exporting batch results to JSONL and CSV."""
    from src.batch.engine import BatchQueryItem

    batch_id = "test_export_batch"
    record = BatchJobRecord(
        batch_id=batch_id,
        status="completed",
        total_queries=2,
        completed_queries=2,
        items=[
            BatchQueryItem(
                query_id="q_1",
                query="Berapa total omzet?",
                status="completed",
                answer_text="Total omzet adalah Rp 274.881.200",
                sql_queries=["SELECT SUM(payment_value) FROM olist_order_payments;"],
                row_count=1,
                duration_ms=45.2,
            ),
            BatchQueryItem(
                query_id="q_2",
                query="Berapa jumlah pesanan?",
                status="completed",
                answer_text="Jumlah pesanan adalah 99.441",
                sql_queries=["SELECT COUNT(*) FROM olist_orders;"],
                row_count=1,
                duration_ms=32.1,
            ),
        ],
    )
    BatchProcessingEngine._jobs[batch_id] = record

    # 1. JSONL Export
    jsonl_data = BatchProcessingEngine.export_jsonl(batch_id)
    assert "q_1" in jsonl_data
    assert "q_2" in jsonl_data
    assert "SELECT SUM" in jsonl_data

    # 2. CSV Export
    csv_data = BatchProcessingEngine.export_csv(batch_id)
    assert "Query ID,Question,Status,Answer" in csv_data
    assert "q_1" in csv_data
    assert "Rp 274.881.200" in csv_data


@pytest.mark.asyncio
async def test_batch_api_endpoints():
    """Verify FastAPI endpoints for submitting, polling, and downloading batch results."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Submit Batch
        payload = {
            "queries": [
                "Berapa total produk per kategori?",
                "Tampilkan rata-rata ongkos kirim per negara bagian",
            ],
            "engine": "manual",
            "concurrency_limit": 2,
        }
        resp = await client.post("/v1/batch", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "batch_id" in data
        assert data["total_queries"] == 2
        batch_id = data["batch_id"]

        # 2. Poll Status
        poll_resp = await client.get(f"/v1/batch/{batch_id}")
        assert poll_resp.status_code == 200
        poll_data = poll_resp.json()
        assert poll_data["batch_id"] == batch_id

        # 3. List Batches
        list_resp = await client.get("/v1/batch")
        assert list_resp.status_code == 200
        list_data = list_resp.json()
        assert list_data["total"] >= 1

        # 4. Download Results JSONL
        jsonl_resp = await client.get(f"/v1/batch/{batch_id}/results?format=jsonl")
        assert jsonl_resp.status_code == 200
        assert "application/x-ndjson" in jsonl_resp.headers["content-type"]

        # 5. Download Results CSV
        csv_resp = await client.get(f"/v1/batch/{batch_id}/results?format=csv")
        assert csv_resp.status_code == 200
        assert "text/csv" in csv_resp.headers["content-type"]

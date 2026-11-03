"""Unit tests for FR-12 RAG Cross-Encoder Reranker Engine."""

import pytest
from unittest.mock import AsyncMock, patch

from src.rag.reranker import (
    FlashRankReranker,
    HeuristicCrossReranker,
    get_reranker,
)
from src.rag.glossary import MetricSearchResult, hybrid_search_glossary


def test_flashrank_reranker_relevance():
    """Verify FlashRank cross-encoder boosts the most semantically relevant passage."""
    ranker = FlashRankReranker()
    passages = [
        {
            "name": "Average Order Value (AOV)",
            "text": "Average Order Value (AOV): Rata-rata nilai transaksi per pesanan belanja.",
            "formula": "Total Sales / Order Count",
        },
        {
            "name": "Freight Ratio",
            "text": "Freight Ratio: Rasio ongkos kirim dibanding harga produk.",
            "formula": "Freight / Price",
        },
        {
            "name": "Cancellation Rate",
            "text": "Cancellation Rate: Persentase pesanan yang dibatalkan pembeli.",
            "formula": "Canceled Orders / Total Orders",
        },
    ]

    results = ranker.rerank(query="Berapa rata-rata nilai transaksi belanja per order?", documents=passages, top_k=2)

    assert len(results) == 2
    # The top result MUST be Average Order Value (AOV)
    assert results[0]["name"] == "Average Order Value (AOV)"
    assert "rerank_score" in results[0]
    assert results[0]["rerank_score"] > results[1]["rerank_score"]


def test_heuristic_reranker_fallback():
    """Verify heuristic reranker fallback when cross-encoder is disabled or unavailable."""
    ranker = HeuristicCrossReranker()
    passages = [
        {
            "name": "Gross Merchandise Value (GMV)",
            "text": "Gross Merchandise Value (GMV): Total nilai transaksi barang berbayar.",
        },
        {
            "name": "Delivered Order Rate",
            "text": "Delivered Order Rate: Rasio pesanan yang sampai di tujuan.",
        },
    ]

    results = ranker.rerank(query="GMV", documents=passages, top_k=2)
    assert len(results) == 2
    assert results[0]["name"] == "Gross Merchandise Value (GMV)"
    assert results[0]["rerank_score"] > results[1]["rerank_score"]


def test_get_reranker_factory():
    """Verify reranker factory respects settings."""
    reranker = get_reranker()
    assert isinstance(reranker, (FlashRankReranker, HeuristicCrossReranker))


def test_metric_search_result_model():
    """Verify MetricSearchResult data model supports rerank_score attribute."""
    res = MetricSearchResult(
        metric_name="AOV",
        business_definition="Def",
        calculation_formula="Formula",
        sql_expression="SELECT 1",
        relevant_tables=["orders"],
        dense_score=0.85,
        bm25_score=0.90,
        rrf_score=0.03,
        rerank_score=0.95,
    )
    assert res.rerank_score == 0.95


@pytest.mark.asyncio
async def test_hybrid_search_with_reranker_mocked_db():
    """Verify 2-stage hybrid search pipeline executes dense + BM25 then applies cross-encoder reranking."""
    # Mock database session returning 2 candidates for dense and BM25
    mock_dense_rows = [
        (1, "Delivered Order Rate", "Rasio pengiriman", "Count / Total", "SELECT 1", ["orders"], 0.75),
        (2, "Average Order Value (AOV)", "Rata-rata transaksi", "Sales / Orders", "SELECT 2", ["orders"], 0.70),
    ]
    mock_bm25_rows = [
        (1, "Delivered Order Rate", "Rasio pengiriman", "Count / Total", "SELECT 1", ["orders"], 0.60),
    ]

    from unittest.mock import MagicMock
    mock_dense_res = MagicMock()
    mock_dense_res.fetchall.return_value = mock_dense_rows

    mock_bm25_res = MagicMock()
    mock_bm25_res.fetchall.return_value = mock_bm25_rows

    mock_session = AsyncMock()
    mock_session.execute.side_effect = [mock_dense_res, mock_bm25_res]

    class MockSessionCtx:
        async def __aenter__(self):
            return mock_session
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    with patch("src.rag.glossary.get_db_session", return_value=MockSessionCtx()), \
         patch("src.rag.glossary.embedding_engine.embed_text", return_value=[0.1] * 384):
        
        # Search specifically for AOV / order value
        results = await hybrid_search_glossary(query_text="Rata-rata transaksi per order AOV", top_k=2, use_reranker=True)

        assert len(results) == 2
        # Cross-encoder should rank AOV above Delivered Order Rate despite lower dense score in stage 1
        assert results[0].metric_name == "Average Order Value (AOV)"
        assert results[0].rerank_score is not None

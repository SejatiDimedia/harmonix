"""Unit tests for RAG metric glossary, local embeddings, and hybrid search."""

import pytest
from src.rag.embeddings import EMBEDDING_DIMENSION, LocalEmbeddingEngine
from src.tools.glossary import SearchGlossaryTool


def test_local_embedding_engine_dimension():
    """Verify FastEmbed generates 384-dimensional dense vectors locally."""
    engine = LocalEmbeddingEngine()
    vec = engine.embed_text("Gross Merchandise Value")

    assert isinstance(vec, list)
    assert len(vec) == EMBEDDING_DIMENSION
    assert all(isinstance(x, float) for x in vec)


def test_local_embedding_multiple_documents():
    """Verify batch document embedding generation."""
    engine = LocalEmbeddingEngine()
    docs = ["Active customer count", "Cancellation rate formula"]
    vectors = engine.embed_documents(docs)

    assert len(vectors) == 2
    assert len(vectors[0]) == EMBEDDING_DIMENSION
    assert len(vectors[1]) == EMBEDDING_DIMENSION


def test_search_glossary_tool_schema():
    """Verify SearchGlossaryTool produces valid OpenAI-compatible function schema."""
    tool = SearchGlossaryTool()
    schema = tool.to_openai_schema()

    assert schema["type"] == "function"
    assert schema["function"]["name"] == "search_glossary"
    assert "query" in schema["function"]["parameters"]["properties"]
    assert "query" in schema["function"]["parameters"]["required"]


@pytest.mark.asyncio
async def test_search_glossary_tool_execution_mocked(monkeypatch):
    """Verify tool execution returns structured metric definitions."""
    from src.rag.glossary import MetricSearchResult

    mock_results = [
        MetricSearchResult(
            metric_name="GMV (Gross Merchandise Value)",
            business_definition="Total akumulasi nilai pembayaran dari pesanan delivered.",
            calculation_formula="SUM(payment_value)",
            sql_expression="SELECT SUM(payment_value) FROM analytics.orders;",
            relevant_tables=["orders", "order_payments"],
            dense_score=0.92,
            bm25_score=0.85,
            rrf_score=0.032,
        )
    ]

    async def mock_hybrid_search(query_text: str, top_k: int = 3):
        return mock_results

    monkeypatch.setattr("src.tools.glossary.hybrid_search_glossary", mock_hybrid_search)

    tool = SearchGlossaryTool()
    res = await tool.execute(query="GMV")

    assert res["status"] == "success"
    assert len(res["metrics"]) == 1
    assert res["metrics"][0]["metric_name"] == "GMV (Gross Merchandise Value)"
    assert "SUM(payment_value)" in res["metrics"][0]["calculation_formula"]

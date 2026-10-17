"""Business Metric Glossary with pgvector and Hybrid Search (Dense + BM25 RRF)."""

import json
import logging
from typing import Any
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.connection import get_db_session
from src.rag.embeddings import EMBEDDING_DIMENSION, embedding_engine

logger = logging.getLogger(__name__)


# ==============================================================================
# Models
# ==============================================================================

class MetricGlossaryItem(BaseModel):
    """Business metric definition item stored in knowledge base."""
    metric_name: str
    business_definition: str
    calculation_formula: str
    sql_expression: str
    relevant_tables: list[str] = Field(default_factory=list)


class MetricSearchResult(BaseModel):
    """Result item returned by hybrid search with relevance scoring."""
    metric_name: str
    business_definition: str
    calculation_formula: str
    sql_expression: str
    relevant_tables: list[str]
    dense_score: float = 0.0
    bm25_score: float = 0.0
    rrf_score: float = 0.0


# ==============================================================================
# Seed Metrics Data
# ==============================================================================

DEFAULT_METRICS: list[MetricGlossaryItem] = [
    MetricGlossaryItem(
        metric_name="GMV (Gross Merchandise Value)",
        business_definition="Total akumulasi nilai pembayaran dari semua pesanan yang telah berhasil dikirimkan (delivered) ke pelanggan.",
        calculation_formula="SUM(payment_value) WHERE order_status = 'delivered'",
        sql_expression="SELECT SUM(p.payment_value) AS gmv FROM analytics.orders o JOIN analytics.order_payments p ON o.order_id = p.order_id WHERE o.order_status = 'delivered';",
        relevant_tables=["orders", "order_payments"],
    ),
    MetricGlossaryItem(
        metric_name="Delivered Order Rate",
        business_definition="Rasio persentase pesanan yang berhasil sampai ke pelanggan (delivered) dibanding total seluruh pesanan yang dibuat.",
        calculation_formula="COUNT(order_id WHERE order_status = 'delivered') / COUNT(order_id) * 100",
        sql_expression="SELECT ROUND(COUNT(CASE WHEN order_status = 'delivered' THEN 1 END) * 100.0 / COUNT(*), 2) AS delivered_rate FROM analytics.orders;",
        relevant_tables=["orders"],
    ),
    MetricGlossaryItem(
        metric_name="Average Order Value (AOV)",
        business_definition="Rata-rata pengeluaran pelanggan per transaksi belanja (nilai pesanan / jumlah pesanan).",
        calculation_formula="Total Penjualan / Jumlah Pesanan Unik",
        sql_expression="SELECT ROUND(SUM(p.payment_value) / COUNT(DISTINCT o.order_id), 2) AS aov FROM analytics.orders o JOIN analytics.order_payments p ON o.order_id = p.order_id WHERE o.order_status = 'delivered';",
        relevant_tables=["orders", "order_payments"],
    ),
    MetricGlossaryItem(
        metric_name="Active Customer",
        business_definition="Pelanggan unik yang setidaknya memiliki 1 transaksi pesanan yang berstatus 'delivered' atau 'shipped'.",
        calculation_formula="COUNT(DISTINCT customer_id) WHERE order_status IN ('delivered', 'shipped')",
        sql_expression="SELECT COUNT(DISTINCT customer_id) AS active_customers FROM analytics.orders WHERE order_status IN ('delivered', 'shipped');",
        relevant_tables=["customers", "orders"],
    ),
    MetricGlossaryItem(
        metric_name="Freight Ratio",
        business_definition="Rasio persentase total ongkos kirim (freight) dibanding total nilai harga produk yang dipesan.",
        calculation_formula="SUM(freight_value) / SUM(price) * 100",
        sql_expression="SELECT ROUND(SUM(freight_value) * 100.0 / SUM(price), 2) AS freight_ratio FROM analytics.order_items;",
        relevant_tables=["order_items"],
    ),
    MetricGlossaryItem(
        metric_name="Cancellation Rate",
        business_definition="Persentase pesanan yang dibatalkan oleh pembeli atau sistem (status 'canceled') dari total seluruh pesanan.",
        calculation_formula="COUNT(order_id WHERE order_status = 'canceled') / COUNT(order_id) * 100",
        sql_expression="SELECT ROUND(COUNT(CASE WHEN order_status = 'canceled' THEN 1 END) * 100.0 / COUNT(*), 2) AS cancellation_rate FROM analytics.orders;",
        relevant_tables=["orders"],
    ),
    MetricGlossaryItem(
        metric_name="Customer Spending (Total Belanja Pelanggan)",
        business_definition="Total akumulasi nominal transaksi belanja yang dibayarkan oleh seorang pelanggan.",
        calculation_formula="SUM(payment_value) GROUP BY customer_id",
        sql_expression="SELECT c.customer_name, c.city, c.email, SUM(op.payment_value) AS total_belanja FROM analytics.customers c JOIN analytics.orders o ON c.customer_id = o.customer_id JOIN analytics.order_payments op ON o.order_id = op.order_id GROUP BY c.customer_id, c.customer_name, c.city, c.email;",
        relevant_tables=["customers", "orders", "order_payments"],
    ),
]


# ==============================================================================
# Table Initialization & Seeding
# ==============================================================================

async def init_glossary_table() -> None:
    """Ensure metric_glossary table and indexes exist in PostgreSQL."""
    async with get_db_session() as session:
        # 1. Create table
        await session.execute(text(f"""
            CREATE TABLE IF NOT EXISTS analytics.metric_glossary (
                id SERIAL PRIMARY KEY,
                metric_name VARCHAR(100) UNIQUE NOT NULL,
                business_definition TEXT NOT NULL,
                calculation_formula TEXT NOT NULL,
                sql_expression TEXT NOT NULL,
                relevant_tables VARCHAR(100)[] NOT NULL,
                embedding vector({EMBEDDING_DIMENSION}),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # 2. Create Full-Text Search GIN index for keyword search
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_metric_glossary_fts
            ON analytics.metric_glossary
            USING gin(to_tsvector('english', metric_name || ' ' || business_definition));
        """))

        await session.commit()
        logger.info("Initialized analytics.metric_glossary table and FTS index.")


async def seed_glossary_if_empty() -> None:
    """Seed or sync the default metric glossary in the knowledge base."""
    await init_glossary_table()

    async with get_db_session() as session:
        logger.info("Syncing metric glossary with default e-commerce metrics...")
        for item in DEFAULT_METRICS:
            # Generate embedding text: metric name + definition + formula
            text_to_embed = f"{item.metric_name}: {item.business_definition} Formula: {item.calculation_formula}"
            vec = embedding_engine.embed_text(text_to_embed)

            await session.execute(
                text("""
                    INSERT INTO analytics.metric_glossary 
                    (metric_name, business_definition, calculation_formula, sql_expression, relevant_tables, embedding)
                    VALUES (:name, :definition, :formula, :sql, :tables, :embedding)
                    ON CONFLICT (metric_name) DO UPDATE 
                    SET business_definition = EXCLUDED.business_definition,
                        calculation_formula = EXCLUDED.calculation_formula,
                        sql_expression = EXCLUDED.sql_expression,
                        relevant_tables = EXCLUDED.relevant_tables,
                        embedding = EXCLUDED.embedding;
                """),
                {
                    "name": item.metric_name,
                    "definition": item.business_definition,
                    "formula": item.calculation_formula,
                    "sql": item.sql_expression,
                    "tables": item.relevant_tables,
                    "embedding": str(vec),
                },
            )
        await session.commit()
        logger.info("Successfully seeded %d metrics into analytics.metric_glossary.", len(DEFAULT_METRICS))


# ==============================================================================
# Hybrid Search (Dense Vector + BM25 via Reciprocal Rank Fusion)
# ==============================================================================

async def hybrid_search_glossary(query_text: str, top_k: int = 3) -> list[MetricSearchResult]:
    """Execute hybrid search combining vector semantic similarity and BM25 full-text search.

    Uses Reciprocal Rank Fusion (RRF) with constant k=60 to rank candidates fairly.
    """
    cleaned_query = query_text.strip()
    if not cleaned_query:
        return []

    # 1. Dense Vector Search
    query_vector = embedding_engine.embed_text(cleaned_query)

    async with get_db_session() as session:
        dense_query = text("""
            SELECT 
                id, metric_name, business_definition, calculation_formula, sql_expression, relevant_tables,
                1 - (embedding <=> :query_vec) AS similarity
            FROM analytics.metric_glossary
            ORDER BY embedding <=> :query_vec
            LIMIT 10;
        """)

        dense_res = await session.execute(dense_query, {"query_vec": str(query_vector)})
        dense_rows = dense_res.fetchall()

        # 2. BM25 Keyword Search
        bm25_query = text("""
            SELECT 
                id, metric_name, business_definition, calculation_formula, sql_expression, relevant_tables,
                ts_rank_cd(to_tsvector('english', metric_name || ' ' || business_definition), plainto_tsquery('english', :query)) AS rank
            FROM analytics.metric_glossary
            WHERE to_tsvector('english', metric_name || ' ' || business_definition) @@ plainto_tsquery('english', :query)
            ORDER BY rank DESC
            LIMIT 10;
        """)

        bm25_res = await session.execute(bm25_query, {"query": cleaned_query})
        bm25_rows = bm25_res.fetchall()

    # 3. Reciprocal Rank Fusion (RRF)
    # RRF score = sum(1 / (60 + rank))
    RRF_K = 60
    candidates: dict[str, dict[str, Any]] = {}

    for rank_idx, row in enumerate(dense_rows):
        m_id = row[0]
        if m_id not in candidates:
            candidates[m_id] = {
                "name": row[1],
                "definition": row[2],
                "formula": row[3],
                "sql": row[4],
                "tables": row[5],
                "dense_score": float(row[6]) if row[6] is not None else 0.0,
                "bm25_score": 0.0,
                "rrf_score": 0.0,
            }
        candidates[m_id]["rrf_score"] += 1.0 / (RRF_K + rank_idx + 1)

    for rank_idx, row in enumerate(bm25_rows):
        m_id = row[0]
        if m_id not in candidates:
            candidates[m_id] = {
                "name": row[1],
                "definition": row[2],
                "formula": row[3],
                "sql": row[4],
                "tables": row[5],
                "dense_score": 0.0,
                "bm25_score": float(row[6]) if row[6] is not None else 0.0,
                "rrf_score": 0.0,
            }
        candidates[m_id]["bm25_score"] = float(row[6]) if row[6] is not None else 0.0
        candidates[m_id]["rrf_score"] += 1.0 / (RRF_K + rank_idx + 1)

    # Sort by RRF score descending
    sorted_items = sorted(candidates.values(), key=lambda x: x["rrf_score"], reverse=True)

    results = []
    for item in sorted_items[:top_k]:
        results.append(
            MetricSearchResult(
                metric_name=item["name"],
                business_definition=item["definition"],
                calculation_formula=item["formula"],
                sql_expression=item["sql"],
                relevant_tables=item["tables"],
                dense_score=round(item["dense_score"], 4),
                bm25_score=round(item["bm25_score"], 4),
                rrf_score=round(item["rrf_score"], 5),
            )
        )

    return results

"""Long-Term Memory and Verified Few-Shot Query Knowledge with pgvector (FR-17).

Stores proven, auditor-approved SQL queries and user preferences persistently in pgvector.
Retrieves semantic exemplars during agent planning to eliminate trial-and-error hallucinations,
guarantee zero-cost few-shot guidance, and speed up query synthesis.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.agent.models import LongTermMemoryItem
from src.db.connection import get_db_session
from src.rag.embeddings import EMBEDDING_DIMENSION, embedding_engine

logger = logging.getLogger(__name__)


# ==============================================================================
# Canonical Golden Queries (Bootstrap Memory)
# ==============================================================================

GOLDEN_MEMORIES: list[dict[str, Any]] = [
    {
        "question": "Berapa total GMV dan jumlah pesanan di kuartal atau bulan terakhir?",
        "sql": """SELECT 
    DATE_TRUNC('month', o.order_purchase_timestamp) AS bulan,
    COUNT(DISTINCT o.order_id) AS total_pesanan,
    COALESCE(SUM(p.payment_value), 0) AS gmv
FROM analytics.orders o
JOIN analytics.order_payments p ON o.order_id = p.order_id
WHERE o.order_status = 'delivered'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6;""",
        "explanation": "Menghitung total GMV (Gross Merchandise Value) dari pesanan berstatus 'delivered' dengan menjumlahkan payment_value per bulan.",
        "tables": ["orders", "order_payments"],
    },
    {
        "question": "Tampilkan 5 pelanggan teratas berdasarkan total belanja",
        "sql": """SELECT 
    c.customer_name,
    c.city,
    c.email,
    COUNT(DISTINCT o.order_id) AS jumlah_transaksi,
    ROUND(SUM(p.payment_value), 2) AS total_belanja
FROM analytics.customers c
JOIN analytics.orders o ON c.customer_id = o.customer_id
JOIN analytics.order_payments p ON o.order_id = p.order_id
WHERE o.order_status = 'delivered'
GROUP BY c.customer_id, c.customer_name, c.city, c.email
ORDER BY total_belanja DESC
LIMIT 5;""",
        "explanation": "Menghubungkan customers -> orders -> order_payments untuk menghitung akumulasi belanja per pelanggan.",
        "tables": ["customers", "orders", "order_payments"],
    },
    {
        "question": "Buatkan grafik batang penjualan per kategori produk",
        "sql": """SELECT 
    p.product_category_name AS kategori,
    COUNT(oi.order_item_id) AS item_terjual,
    ROUND(SUM(oi.price), 2) AS total_penjualan
FROM analytics.order_items oi
JOIN analytics.products p ON oi.product_id = p.product_id
JOIN analytics.orders o ON oi.order_id = o.order_id
WHERE o.order_status = 'delivered'
GROUP BY p.product_category_name
ORDER BY total_penjualan DESC
LIMIT 10;""",
        "explanation": "Menghitung volume item terjual dan omzet penjualan per kategori produk master.",
        "tables": ["order_items", "products", "orders"],
    },
    {
        "question": "Analisis tren status pengiriman pesanan (delivered, shipped, canceled)",
        "sql": """SELECT 
    order_status,
    COUNT(*) AS jumlah_pesanan,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS persentase
FROM analytics.orders
GROUP BY order_status
ORDER BY jumlah_pesanan DESC;""",
        "explanation": "Menghitung distribusi rasio status pengiriman pesanan di seluruh database analitik.",
        "tables": ["orders"],
    },
    {
        "question": "Berapa rata-rata nilai pesanan atau Average Order Value (AOV)?",
        "sql": """SELECT 
    ROUND(SUM(p.payment_value) / COUNT(DISTINCT o.order_id), 2) AS average_order_value
FROM analytics.orders o
JOIN analytics.order_payments p ON o.order_id = p.order_id
WHERE o.order_status = 'delivered';""",
        "explanation": "Menghitung Average Order Value (AOV) dari rasio total pembayaran dibagi pesanan unik berstatus delivered.",
        "tables": ["orders", "order_payments"],
    },
]


# ==============================================================================
# Database Schema & Initialization
# ==============================================================================

async def init_long_term_memory_table() -> None:
    """Ensure analytics.long_term_memories table and pgvector index exist."""
    async with get_db_session() as session:
        # Enable pgvector extension if not already enabled
        await session.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))

        # Table: Long-term memory store
        await session.execute(text(f"""
            CREATE TABLE IF NOT EXISTS analytics.long_term_memories (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(100),
                memory_type VARCHAR(50) NOT NULL DEFAULT 'successful_query',
                question_text TEXT NOT NULL,
                sql_query TEXT,
                explanation TEXT,
                tables_used VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[],
                embedding vector({EMBEDDING_DIMENSION}),
                success_count INT NOT NULL DEFAULT 1,
                confidence_score FLOAT NOT NULL DEFAULT 1.0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # Index for vector similarity (Cosine Distance) using HNSW
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_long_term_memories_embedding
            ON analytics.long_term_memories
            USING hnsw (embedding vector_cosine_ops);
        """))

        # Index for session search
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_long_term_memories_session
            ON analytics.long_term_memories(session_id);
        """))

        await session.commit()
        logger.info("Initialized analytics.long_term_memories table and pgvector index.")


async def seed_golden_memories_if_empty() -> None:
    """Seed canonical successful queries into long-term memory if empty."""
    await init_long_term_memory_table()

    async with get_db_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM analytics.long_term_memories;"))
        count = result.scalar() or 0
        if count > 0:
            return

        logger.info("Seeding long-term memory with golden verified queries...")
        for gm in GOLDEN_MEMORIES:
            vec = embedding_engine.embed_text(gm["question"])

            await session.execute(
                text("""
                    INSERT INTO analytics.long_term_memories (
                        session_id, memory_type, question_text, sql_query,
                        explanation, tables_used, embedding, success_count, confidence_score
                    ) VALUES (
                        'system', 'successful_query', :q, :sql,
                        :expl, :tables, :embedding, 1, 1.0
                    )
                """),
                {
                    "q": gm["question"],
                    "sql": gm["sql"].strip(),
                    "expl": gm["explanation"],
                    "tables": gm["tables"],
                    "embedding": str(vec),
                },
            )
        await session.commit()
        logger.info("Successfully seeded %d golden queries into long-term memory.", len(GOLDEN_MEMORIES))


# ==============================================================================
# Memory Retrieval & Ingestion
# ==============================================================================

async def retrieve_relevant_memories(
    query: str,
    limit: int = 2,
    min_similarity: float = 0.60,
) -> list[LongTermMemoryItem]:
    """Retrieve semantically similar past successful queries or preferences using pgvector.

    Args:
        query: Natural language question from the user.
        limit: Maximum number of memories to recall (default: 2).
        min_similarity: Cosine similarity threshold (0.0 to 1.0, default: 0.60).

    Returns:
        List of LongTermMemoryItem with verified SQL and similarity scores.
    """
    if not query.strip():
        return []

    try:
        # Generate query vector via FastEmbed
        query_vec = embedding_engine.embed_text(query)

        async with get_db_session() as session:
            # Cosine similarity is 1 - (embedding <=> query_vec)
            sql_stmt = text("""
                SELECT 
                    id, memory_type, question_text, sql_query, explanation, tables_used,
                    ROUND((1 - (embedding <=> :query_vec))::numeric, 4) AS similarity
                FROM analytics.long_term_memories
                WHERE 1 - (embedding <=> :query_vec) >= :min_sim
                ORDER BY similarity DESC
                LIMIT :lim;
            """)

            res = await session.execute(
                sql_stmt,
                {"query_vec": str(query_vec), "min_sim": min_similarity, "lim": limit},
            )
            rows = res.fetchall()

            memories: list[LongTermMemoryItem] = []
            matched_ids: list[int] = []

            for r in rows:
                memories.append(
                    LongTermMemoryItem(
                        id=r.id,
                        memory_type=r.memory_type,
                        question_text=r.question_text,
                        sql_query=r.sql_query,
                        explanation=r.explanation,
                        tables_used=list(r.tables_used or []),
                        similarity=float(r.similarity),
                    )
                )
                matched_ids.append(r.id)

            # Update last_accessed_at timestamp asynchronously
            if matched_ids:
                try:
                    await session.execute(
                        text("""
                            UPDATE analytics.long_term_memories
                            SET last_accessed_at = CURRENT_TIMESTAMP
                            WHERE id = ANY(:ids);
                        """),
                        {"ids": matched_ids},
                    )
                    await session.commit()
                except Exception as update_err:
                    logger.debug("Failed to update memory last_accessed_at: %s", update_err)

            return memories
    except Exception as e:
        logger.warning("Long-term memory retrieval failed: %s", e)
        return []


async def store_successful_query(
    question: str,
    sql: str,
    session_id: str | None = None,
    explanation: str | None = None,
    tables: list[str] | None = None,
    confidence: float = 1.0,
) -> int | None:
    """Persist an auditor-verified successful SQL query into pgvector long-term memory.

    If an almost identical question already exists (similarity > 0.92), increments
    its success_count instead of duplicating records.
    """
    clean_q = question.strip()
    clean_sql = sql.strip()
    if not clean_q or not clean_sql:
        return None

    try:
        vec = embedding_engine.embed_text(clean_q)

        async with get_db_session() as session:
            # 1. Check for near-exact match
            check_stmt = text("""
                SELECT id, success_count 
                FROM analytics.long_term_memories
                WHERE 1 - (embedding <=> :query_vec) >= 0.92
                ORDER BY (1 - (embedding <=> :query_vec)) DESC
                LIMIT 1;
            """)
            existing = (await session.execute(check_stmt, {"query_vec": str(vec)})).fetchone()

            if existing:
                # Increment success count & update SQL/timestamp
                mem_id = existing.id
                await session.execute(
                    text("""
                        UPDATE analytics.long_term_memories
                        SET 
                            success_count = success_count + 1,
                            sql_query = :sql,
                            confidence_score = GREATEST(confidence_score, :conf),
                            last_accessed_at = CURRENT_TIMESTAMP
                        WHERE id = :id;
                    """),
                    {"id": mem_id, "sql": clean_sql, "conf": confidence},
                )
                await session.commit()
                logger.info("Updated existing long-term memory #%d (success_count +1)", mem_id)
                return mem_id

            # 2. Insert new long-term memory
            insert_stmt = text("""
                INSERT INTO analytics.long_term_memories (
                    session_id, memory_type, question_text, sql_query,
                    explanation, tables_used, embedding, success_count, confidence_score
                ) VALUES (
                    :session_id, 'successful_query', :q, :sql,
                    :expl, :tables, :embedding, 1, :conf
                ) RETURNING id;
            """)
            result = await session.execute(
                insert_stmt,
                {
                    "session_id": session_id or "global",
                    "q": clean_q,
                    "sql": clean_sql,
                    "expl": explanation or "Kueri analitik terverifikasi berhasil oleh Data Auditor",
                    "tables": tables or [],
                    "embedding": str(vec),
                    "conf": confidence,
                },
            )
            new_id = result.scalar()
            await session.commit()
            logger.info("Persisted new long-term memory #%s for question '%s'", new_id, clean_q[:40])
            return new_id
    except Exception as e:
        logger.error("Failed to store long-term memory: %s", e)
        return None


async def store_user_preference(
    preference_text: str,
    session_id: str | None = None,
) -> int | None:
    """Store persistent user business preference rule (e.g. currency, default filters)."""
    clean_pref = preference_text.strip()
    if not clean_pref:
        return None

    try:
        vec = embedding_engine.embed_text(clean_pref)

        async with get_db_session() as session:
            insert_stmt = text("""
                INSERT INTO analytics.long_term_memories (
                    session_id, memory_type, question_text, sql_query,
                    explanation, tables_used, embedding, success_count, confidence_score
                ) VALUES (
                    :session_id, 'user_preference', :q, NULL,
                    'Preferensi pengguna persisten', :tables, :embedding, 1, 1.0
                ) RETURNING id;
            """)
            result = await session.execute(
                insert_stmt,
                {
                    "session_id": session_id or "global",
                    "q": clean_pref,
                    "tables": [],
                    "embedding": str(vec),
                },
            )
            new_id = result.scalar()
            await session.commit()
            logger.info("Persisted user preference memory #%s", new_id)
            return new_id
    except Exception as e:
        logger.error("Failed to store user preference: %s", e)
        return None


async def list_long_term_memories(
    limit: int = 50,
    memory_type: str | None = None,
) -> list[dict[str, Any]]:
    """List stored long-term memories for API inspection and management."""
    await init_long_term_memory_table()

    async with get_db_session() as session:
        where_clause = ""
        params: dict[str, Any] = {"limit": limit}
        if memory_type:
            where_clause = "WHERE memory_type = :mtype"
            params["mtype"] = memory_type

        stmt = text(f"""
            SELECT 
                id, session_id, memory_type, question_text, sql_query, explanation,
                tables_used, success_count, confidence_score, created_at, last_accessed_at
            FROM analytics.long_term_memories
            {where_clause}
            ORDER BY success_count DESC, last_accessed_at DESC
            LIMIT :limit;
        """)

        res = await session.execute(stmt, params)
        rows = res.fetchall()

        return [
            {
                "id": r.id,
                "session_id": r.session_id,
                "memory_type": r.memory_type,
                "question_text": r.question_text,
                "sql_query": r.sql_query,
                "explanation": r.explanation,
                "tables_used": list(r.tables_used or []),
                "success_count": r.success_count,
                "confidence_score": r.confidence_score,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "last_accessed_at": r.last_accessed_at.isoformat() if r.last_accessed_at else None,
            }
            for r in rows
        ]


async def delete_long_term_memory(memory_id: int) -> bool:
    """Delete a memory item by ID."""
    async with get_db_session() as session:
        res = await session.execute(
            text("DELETE FROM analytics.long_term_memories WHERE id = :id;"),
            {"id": memory_id},
        )
        await session.commit()
        return (res.rowcount or 0) > 0

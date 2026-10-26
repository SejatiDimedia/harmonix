"""Guardrail evaluator to detect unexecuted SQL and prevent premature finalization."""

import re
import logging

logger = logging.getLogger(__name__)


class GuardrailEvaluator:
    """Evaluates safety constraints, detects raw SQL in text, and determines if SQL execution must be nudged."""

    @staticmethod
    def detect_unexecuted_sql(content: str | None) -> str | None:
        """Scan LLM content for raw SELECT queries generated as text instead of tool calls."""
        if not content:
            return None
        m_sql = re.search(r'```(?:sql)?\s*(SELECT\b[\s\S]+?)(?:```|;)', content, re.IGNORECASE)
        if not m_sql:
            m_sql = re.search(r'\b(SELECT\s+[a-zA-Z0-9_.*,\s]+\s+FROM\s+[\s\S]+?)(?:```|;|\n\n|$)', content, re.IGNORECASE)
        if m_sql:
            ext_query = m_sql.group(1).strip()
            if "FROM" in ext_query.upper():
                return ext_query
        return None

    @staticmethod
    def should_nudge_for_sql(
        resp_text: str,
        user_query: str,
        executed_sqls: list[str],
        step: int,
        max_nudge_step: int = 3,
    ) -> bool:
        """Check if agent concluded prematurely without running SQL on a true database query."""
        if executed_sqls or step >= max_nudge_step:
            return False

        has_unexecuted_sql = bool(
            re.search(
                r'```(?:sql)?\s*SELECT\b|\bSELECT\s+[a-zA-Z0-9_.*,\s]+\s+FROM\s+',
                resp_text,
                re.IGNORECASE,
            )
        )
        q_lower = user_query.lower()

        # Meta, identity, conversational, or greeting questions should NOT be forced to run SQL
        is_meta_or_greeting = any(phrase in q_lower for phrase in [
            "siapa kamu", "kamu siapa", "siapa anda", "identitas", "dibuat oleh",
            "menciptakanmu", "menciptakan kamu", "perusahaan yang", "context window",
            "konteks window", "model apa", "kamu model", "arsitektur", "halo",
            "hai", "hello", "hi", "hey", "selamat pagi", "selamat siang",
            "selamat sore", "selamat malam", "terima kasih", "makasih", "thanks",
            "who are you", "what model", "context length"
        ])

        # Analytical query specifically targeting the business database domain
        domain_keywords = [
            "kategori", "pesanan", "produk", "customer", "pelanggan",
            "penjualan", "transaksi", "status", "terbanyak", "terlaris",
            "termahal", "paling", "omset", "revenue", "sales", "order",
            "barang", "toko", "diskon", "kupon", "pembayaran", "payment",
            "tabel", "kolom", "database", "skema"
        ]
        has_domain_keywords = any(kw in q_lower for kw in domain_keywords)
        has_agg_request = any(
            w in q_lower for w in ["total", "rata-rata", "rata2", "rata", "jumlah", "count", "average", "sum", "top"]
        )

        is_db_analytical = (has_domain_keywords or (has_agg_request and not is_meta_or_greeting)) and not is_meta_or_greeting

        return (has_unexecuted_sql or is_db_analytical) and not is_meta_or_greeting

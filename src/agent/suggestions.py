"""
Smart Follow-Up Suggestions Engine (FR-34).
Extracts contextual exploration questions from LLM responses via structured parsing,
and provides domain-specific heuristic fallbacks based on schema & data tables.
"""

import re
from typing import Any
from src.agent.models import ChartSpec, TableData


def clean_suggestion_text(text: str) -> str:
    """Strip bullet points, numbering, markdown bolding, and excess whitespace."""
    s = text.strip()
    # Remove leading numbering/bullets like "1.", "1)", "-", "*", "•"
    s = re.sub(r"^(?:(?:\d+[\.\)]|\-|\*|•)\s*)+", "", s)
    # Remove surrounding quotes
    s = s.strip("\"' ")
    # Remove markdown bold/italics markers at boundaries
    s = re.sub(r"^\*+|\*+$", "", s).strip()
    return s


def extract_suggestions_from_text(answer_text: str) -> tuple[str, list[str]]:
    """
    Extract follow-up questions from the LLM answer text and clean the section
    so the UI can render them as interactive chips without prose redundancy.
    """
    if not answer_text:
        return "", []

    # Patterns matching headers for suggestions
    header_pattern = re.compile(
        r"(?:^|\n)(?:#{1,4}\s*)?(?:Rekomendasi\s+Analisis\s+Lanjutan|Rekomendasi\s+Pertanyaan\s+Lanjutan|Pertanyaan\s+Lanjutan(?:\s+yang\s+Disarankan)?|Saran\s+Eksplorasi\s+Lanjutan|Next\s+Questions?|Follow-?up\s+Questions?)\s*:?\s*\n",
        re.IGNORECASE,
    )

    match = header_pattern.search(answer_text)
    if not match:
        return answer_text, []

    split_idx = match.start()
    clean_answer = answer_text[:split_idx].rstrip()
    suggestions_block = answer_text[match.end():]

    # Extract individual bullet lines
    suggestions: list[str] = []
    lines = suggestions_block.strip().split("\n")
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Stop if another major markdown section starts (e.g. "## ")
        if re.match(r"^#{1,3}\s+", stripped):
            break
        cleaned = clean_suggestion_text(stripped)
        # Ensure it has substance and question intent
        if len(cleaned) >= 8 and not cleaned.startswith("#"):
            suggestions.append(cleaned)
            if len(suggestions) >= 3:
                break

    return clean_answer, suggestions


def generate_heuristic_suggestions(
    user_query: str,
    tables: list[TableData] | list[dict[str, Any]],
    charts: list[ChartSpec] | list[dict[str, Any]],
    sql_queries: list[str],
) -> list[str]:
    """
    Generate domain-specific analytical suggestions based on SQL tables,
    columns returned, and user intent when LLM suggestions are absent.
    """
    uq_lower = user_query.lower()
    pool: list[str] = []

    # Extract all column names across all tables
    columns: set[str] = set()
    for t in tables:
        if isinstance(t, dict):
            cols = t.get("columns", [])
        else:
            cols = getattr(t, "columns", [])
        for c in cols:
            columns.add(c.lower())

    # 1. Dimension / Category Drilldowns
    has_category = any(c in columns for c in ("product_category_name", "category", "kategori"))
    has_status = any(c in columns for c in ("order_status", "status"))
    has_city_state = any(c in columns for c in ("city", "state", "wilayah", "kota"))
    has_payment = any(c in columns for c in ("payment_type", "payment_value"))
    has_customer = any(c in columns for c in ("customer_name", "customer_id", "email"))

    if has_category and not any(w in uq_lower for w in ("donat", "donut", "doughnut", "pie")):
        pool.append("Tampilkan proporsi persentase kategori produk dalam bentuk chart donat")
        pool.append("Kategori produk apa yang memiliki nilai transaksi rata-rata tertinggi?")

    if has_status:
        pool.append("Berapa persentase pesanan yang berhasil terkirim (delivered rate)?")
        pool.append("Tampilkan rincian status pesanan dalam grafik diagram lingkaran (pie chart)")

    if has_city_state:
        pool.append("Kota mana yang memiliki jumlah pelanggan dan pesanan tertinggi?")

    if has_payment:
        pool.append("Metode pembayaran apa yang paling sering digunakan oleh pelanggan?")

    if has_customer:
        pool.append("Siapa 5 pelanggan dengan total akumulasi belanja terbesar (top spenders)?")

    # 2. General Analytical Drilldowns
    if any(w in uq_lower for w in ("gmv", "penjualan", "revenue", "omset", "omzet", "total")):
        if "tren" not in uq_lower and "trend" not in uq_lower:
            pool.append("Bagaimana tren penjualan bulanan selama 6 bulan terakhir?")
        pool.append("Berapa rata-rata nilai transaksi per pesanan (Average Order Value / AOV)?")
        pool.append("Kategori produk apa yang paling berkontribusi terhadap total pendapatan?")

    if any(w in uq_lower for w in ("produk", "product")):
        pool.append("Tampilkan 5 produk terlaris berdasarkan kuantitas pesanan")
        pool.append("Bagaimana perbandingan total pesanan per kategori dalam grafik batang?")

    # 3. Fallback General Business Questions
    general_fallbacks = [
        "Bagaimana tren volume transaksi bulanan dalam bentuk grafik garis?",
        "Tampilkan proporsi status pesanan dalam bentuk chart donat",
        "Kategori produk apa yang memiliki pesanan terbanyak?",
        "Berapa rata-rata nilai belanja per pesanan (AOV)?",
        "Tampilkan 5 pelanggan dengan total transaksi tertinggi",
    ]
    for gf in general_fallbacks:
        pool.append(gf)

    # Filter out duplicates and questions too close to current query
    cleaned_pool: list[str] = []
    seen: set[str] = set()

    for p in pool:
        p_clean = p.strip()
        norm = re.sub(r"[^\w\s]", "", p_clean.lower())
        # Avoid suggesting the exact same query user just asked
        if norm in re.sub(r"[^\w\s]", "", uq_lower):
            continue
        if norm not in seen:
            seen.add(norm)
            cleaned_pool.append(p_clean)

    return cleaned_pool[:3]


def get_smart_suggestions(
    answer_text: str,
    user_query: str,
    tables: list[TableData] | list[dict[str, Any]],
    charts: list[ChartSpec] | list[dict[str, Any]],
    sql_queries: list[str],
) -> tuple[str, list[str]]:
    """
    Main entrypoint: extracts suggestions from LLM answer if present,
    otherwise blends in heuristic fallbacks to guarantee 3 crisp questions.
    """
    clean_answer, extracted = extract_suggestions_from_text(answer_text)

    # If LLM gave 3 valid suggestions, use them directly
    if len(extracted) >= 3:
        return clean_answer, extracted[:3]

    # Otherwise, supplement with heuristic suggestions
    heuristics = generate_heuristic_suggestions(
        user_query=user_query,
        tables=tables,
        charts=charts,
        sql_queries=sql_queries,
    )

    combined = list(extracted)
    seen_norms = {re.sub(r"[^\w\s]", "", s.lower()) for s in combined}

    for h in heuristics:
        h_norm = re.sub(r"[^\w\s]", "", h.lower())
        if h_norm not in seen_norms:
            seen_norms.add(h_norm)
            combined.append(h)
            if len(combined) >= 3:
                break

    return clean_answer, combined[:3]

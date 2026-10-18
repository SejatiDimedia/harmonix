"""Unit tests for Smart Follow-Up Suggestions Engine (FR-34)."""

import pytest
from src.agent.models import TableData, ChartSpec
from src.agent.suggestions import (
    clean_suggestion_text,
    extract_suggestions_from_text,
    generate_heuristic_suggestions,
    get_smart_suggestions,
)


def test_clean_suggestion_text():
    assert clean_suggestion_text("- Pertanyaan satu?") == "Pertanyaan satu?"
    assert clean_suggestion_text("1. Produk apa yang terlaris?") == "Produk apa yang terlaris?"
    assert clean_suggestion_text("* **Bagaimana tren penjualan?**") == "Bagaimana tren penjualan?"
    assert clean_suggestion_text('2) "Siapa pelanggan teratas?"') == "Siapa pelanggan teratas?"


def test_extract_suggestions_from_text():
    sample_text = """
Berdasarkan data penjualan, kategori Elektronik adalah yang tertinggi dengan total Rp 120.000.000.

### Rekomendasi Analisis Lanjutan:
- Produk apa yang paling laris di kategori Elektronik?
- Bagaimana tren penjualan Elektronik per bulan dalam grafik garis?
- Kategori apa yang menduduki peringkat kedua setelah Elektronik?
"""
    clean_answer, suggestions = extract_suggestions_from_text(sample_text)
    assert len(suggestions) == 3
    assert suggestions[0] == "Produk apa yang paling laris di kategori Elektronik?"
    assert suggestions[1] == "Bagaimana tren penjualan Elektronik per bulan dalam grafik garis?"
    assert suggestions[2] == "Kategori apa yang menduduki peringkat kedua setelah Elektronik?"
    # Verify the suggestion section was cleanly removed from clean_answer
    assert "### Rekomendasi Analisis Lanjutan:" not in clean_answer
    assert "Elektronik adalah yang tertinggi" in clean_answer


def test_extract_suggestions_missing_returns_original():
    plain_text = "Total penjualan adalah 500 transaksi."
    clean_answer, suggestions = extract_suggestions_from_text(plain_text)
    assert clean_answer == plain_text
    assert suggestions == []


def test_generate_heuristic_suggestions_with_category():
    tables = [
        TableData(
            columns=["product_category_name", "total_orders"],
            rows=[["Electronics", 42], ["Fashion", 30]],
            row_count=2,
        )
    ]
    suggestions = generate_heuristic_suggestions(
        user_query="Kategori terlaris",
        tables=tables,
        charts=[],
        sql_queries=["SELECT product_category_name, count(*) FROM analytics.products;"],
    )
    assert len(suggestions) == 3
    # Check that category-related exploration is included
    assert any("kategori" in s.lower() or "donat" in s.lower() for s in suggestions)


def test_get_smart_suggestions_combines_extracted_and_fallback():
    # Only 1 extracted suggestion provided by LLM
    partial_text = """
Total GMV adalah Rp 500.000.000.

### Pertanyaan Lanjutan:
- Kategori apa yang paling banyak menghasilkan GMV?
"""
    clean_answer, suggestions = get_smart_suggestions(
        answer_text=partial_text,
        user_query="Berapa total GMV?",
        tables=[TableData(columns=["gmv"], rows=[[500000000]], row_count=1)],
        charts=[],
        sql_queries=["SELECT sum(payment_value) as gmv FROM analytics.order_payments;"],
    )
    # Guaranteed to return exactly 3 suggestions
    assert len(suggestions) == 3
    assert suggestions[0] == "Kategori apa yang paling banyak menghasilkan GMV?"
    assert "### Pertanyaan Lanjutan:" not in clean_answer

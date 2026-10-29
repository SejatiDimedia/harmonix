"""Tests for clean_latex_math_to_unicode in backend suggestions & formatting."""

import pytest
from src.agent.suggestions import clean_latex_math_to_unicode


def test_superscripts_units():
    raw = "Luas kantor adalah $m^2$, gudang $1.500 m^2$, volume $500 m^3$, dan wilayah 25 km^2."
    expected = "Luas kantor adalah m², gudang 1.500 m², volume 500 m³, dan wilayah 25 km²."
    assert clean_latex_math_to_unicode(raw) == expected


def test_scientific_and_exponents():
    raw = "Populasi sel $\\times 10^6$ dan konsentrasi $5 \\mu g$ serta koefisien determinasi $R^2 = 0.95$."
    expected = "Populasi sel × 10⁶ dan konsentrasi 5 µg serta koefisien determinasi R² = 0.95."
    assert clean_latex_math_to_unicode(raw) == expected


def test_arrows_and_relations():
    raw = "3 tahun $\\rightarrow$ Rp 24 jt dengan skor $\\ge 4,7$ dan toleransi $\\pm 2\\%$."
    expected = "3 tahun → Rp 24 jt dengan skor ≥ 4,7 dan toleransi ± 2%."
    assert clean_latex_math_to_unicode(raw) == expected


def test_currency_and_text_unwrapping():
    raw = "Gaji $\\ge \\text{Rp } 30.000.000$ dan korelasi ($r = +0,984$)."
    expected = "Gaji ≥ Rp 30.000.000 dan korelasi (r = +0,984)."
    assert clean_latex_math_to_unicode(raw) == expected


def test_degrees_and_fractions():
    raw = "Suhu $25^\\circ C$ dihitung dari rumus $\\frac{Total}{N}$."
    expected = "Suhu 25°C dihitung dari rumus Total / N."
    assert clean_latex_math_to_unicode(raw) == expected


def test_dollar_currency_not_corrupted():
    raw = "Harga produk antara $100 dan $200 per lisensi."
    expected = "Harga produk antara $100 dan $200 per lisensi."
    assert clean_latex_math_to_unicode(raw) == expected

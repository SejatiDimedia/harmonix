"""Tests for clean_latex_math_to_unicode in backend suggestions & formatting."""

import pytest
from src.agent.suggestions import clean_latex_math_to_unicode, strip_ascii_charts


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


def test_strip_ascii_charts_and_notes():
    raw = """Here is the comparison between ORG-101 and ORG-104:

Monthly API Calls
2.00M-|          ● ORG-104 (2.00M)
1.80M-|   ● ORG-104 (1.80M) |
1.40M-| ● ORG-104 (1.40M) | | | ● ORG-101 (1.40M)
0.95M-| ● ORG-101 (0.95M) | | | |
--------------------------------------------------
2025-06  2025-07  2025-08  2025-09  2025-10

Legend:
[-] ORG-104 : Surabaya Cloud Finansial
[---] ORG-101 : PT Nusantara Tech Solusi

(Note: The interactive multi-line chart has been rendered and added to the visual dashboard).

### Key Takeaways:
1. ORG-104 traffic is higher.
2. Both clients peaked in Q3.
"""
    cleaned = strip_ascii_charts(raw)
    assert "2.00M-|" not in cleaned
    assert "● ORG-104" not in cleaned
    assert "interactive multi-line chart" not in cleaned
    assert "### Key Takeaways:" in cleaned
    assert "1. ORG-104 traffic is higher." in cleaned


def test_strip_box_draw_and_italic_notes():
    raw = """
```text\r
Monthly API Calls\r
2.00M-|    ● ORG-104 (2.00M)\r
1.80M-|  ● ORG-104 (1.80M) |\r
1.60M-|  | ● ORG-104 |\r
1.50M-|  | | ● ORG-104 (1.50M)\r
1.40M-| ● ORG-104 (1.40M) | | | ● ORG-101 (1.40M)\r
1.25M-| | ● ORG-101 | |\r
1.10M-| | | ● ORG-101 |\r
0.98M-| | | | ● ORG-101 |\r
0.95M-| ● ORG-101 (0.95M) | | | |\r
  └──────────────────────────────\r
    2025-06  2025-07  2025-08  2025-09  2025-10\r
\r
Legend:\r
[-] ORG-104 : Surabaya Cloud Finansial (Blue Line - Peak: 2.00M, Total: 8.30M)\r
[······] ORG-101 : PT Nusantara Tech Solusi (Orange/Green Line - Peak: 1.40M, Total: 5.68M)\r
```

*(Note: The interactive multi-line chart has been rendered and added to the visual dashboard).*

| Bulan | ORG-101 | ORG-104 |
| :--- | :--- | :--- |
| 2025-06 | 950.000 | 1.400.000 |
| 2025-07 | 1.250.000 | 1.800.000 |
| 2025-08 | 1.100.000 | 1.600.000 |
| 2025-09 | 980.000 | 1.500.000 |
| 2025-10 | 1.400.000 | 2.000.000 |

### Rekomendasi Bisnis:
Pertahankan kuota traffic ORG-104.
"""
    cleaned = strip_ascii_charts(raw)
    assert "2.00M-|" not in cleaned
    assert "● ORG-104" not in cleaned
    assert "└──────────────────────────────" not in cleaned
    assert "······" not in cleaned
    assert "interactive multi-line chart" not in cleaned
    assert "| Bulan | ORG-101 | ORG-104 |" in cleaned
    assert "Pertahankan kuota traffic ORG-104." in cleaned



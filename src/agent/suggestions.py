"""
Smart Follow-Up Suggestions Engine (FR-34).
Extracts contextual exploration questions from LLM responses via structured parsing,
and provides domain-specific heuristic fallbacks based on schema & data tables.
"""

import re
from typing import Any
from src.agent.models import ChartSpec, TableData

SUPERSCRIPT_MAP = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
    "n": "ⁿ", "i": "ⁱ", "x": "ˣ", "y": "ʸ",
}

SUBSCRIPT_MAP = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    "a": "ₐ", "e": "ₑ", "o": "ₒ", "x": "ₓ", "i": "ᵢ", "j": "ⱼ", "n": "ₙ", "t": "ₜ",
}


def clean_latex_math_to_unicode(text: str) -> str:
    """
    Cleans and converts raw LaTeX math notations (e.g. $m^2$, $\\rightarrow$, $\\ge$, $\\text{Rp ...}$, \\frac{a}{b})
    into clean, readable Unicode characters (m², →, ≥, ≤, Rp, a/b) for presentation.
    """
    if not text:
        return ""
    s = text

    # 1. Fractions: \frac{a}{b} -> a / b
    s = re.sub(r"\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}", r"\1 / \2", s)

    # 2. Roots: \sqrt[3]{x} -> ∛(x), \sqrt{x} -> √(x)
    s = re.sub(r"\\sqrt\[3\]\{([^{}]+)\}", r"∛(\1)", s)
    s = re.sub(r"\\sqrt\{([^{}]+)\}", r"√(\1)", s)

    # 3. Degrees
    s = re.sub(r"\^\{?\\circ\}?\s*(?:\\text\{)?(?:C|Celsius)?\}?", "°C", s, flags=re.IGNORECASE)
    s = re.sub(r"\\degree\s*(?:C)?", "°C", s, flags=re.IGNORECASE)
    s = re.sub(r"\\circ\b", "°", s)

    # 4. Micro units & Greek letters
    s = re.sub(r"\\mu\s*([a-zA-Z])", r"µ\1", s)
    s = re.sub(r"\\mu\b", "µ", s)
    greek = {
        r"\\alpha\b": "α", r"\\beta\b": "β", r"\\gamma\b": "γ", r"\\Gamma\b": "Γ",
        r"\\delta\b": "δ", r"\\Delta\b": "Δ", r"\\epsilon\b": "ε", r"\\varepsilon\b": "ε",
        r"\\zeta\b": "ζ", r"\\eta\b": "η", r"\\theta\b": "θ", r"\\vartheta\b": "θ",
        r"\\lambda\b": "λ", r"\\Lambda\b": "Λ", r"\\nu\b": "ν",
        r"\\xi\b": "ξ", r"\\pi\b": "π", r"\\Pi\b": "Π", r"\\rho\b": "ρ",
        r"\\sigma\b": "σ", r"\\Sigma\b": "Σ", r"\\tau\b": "τ", r"\\phi\b": "φ",
        r"\\varphi\b": "φ", r"\\Phi\b": "Φ", r"\\chi\b": "χ", r"\\psi\b": "ψ",
        r"\\Psi\b": "Ψ", r"\\omega\b": "ω", r"\\Omega\b": "Ω"
    }
    for pat, val in greek.items():
        s = re.sub(pat, val, s)

    # 5. Arrows
    arrows = {
        r"\\leftrightarrow\b": "↔", r"\\Leftrightarrow\b": "⇔", r"\\iff\b": "⇔",
        r"\\rightarrow\b|\\to\b|\\longrightarrow\b": "→",
        r"\\leftarrow\b|\\longleftarrow\b": "←",
        r"\\Rightarrow\b|\\implies\b": "⇒",
        r"\\Leftarrow\b": "⇐",
        r"\\uparrow\b": "↑", r"\\downarrow\b": "↓"
    }
    for pat, val in arrows.items():
        s = re.sub(pat, val, s)

    # 6. Comparisons & Relations
    relations = {
        r"\\ge(?:q)?\b|\\geqslant\b": "≥",
        r"\\le(?:q)?\b|\\leqslant\b": "≤",
        r"\\neq\b|\\ne\b": "≠",
        r"\\approx\b": "≈",
        r"\\simeq\b": "≃",
        r"\\sim\b": "~",
        r"\\equiv\b": "≡",
        r"\\ll\b": "<<",
        r"\\gg\b": ">>"
    }
    for pat, val in relations.items():
        s = re.sub(pat, val, s)

    # 7. Math & Set Operators
    ops = {
        r"\\times\b": "×",
        r"\\div\b": "÷",
        r"\\pm\b": "±",
        r"\\mp\b": "∓",
        r"\\cdot\b|\\centerdot\b": "·",
        r"\\bullet\b": "•",
        r"\\infty\b": "∞",
        r"\\sum\b": "∑",
        r"\\prod\b": "∏",
        r"\\int\b": "∫",
        r"\\partial\b": "∂",
        r"\\nabla\b": "∇",
        r"\\forall\b": "∀",
        r"\\exists\b": "∃",
        r"\\in\b": "∈",
        r"\\notin\b": "∉",
        r"\\subset\b": "⊂",
        r"\\subseteq\b": "⊆"
    }
    for pat, val in ops.items():
        s = re.sub(pat, val, s)

    # 8. Superscripts & Subscripts (converts m^2 -> m², m^3 -> m³, 10^6 -> 10⁶, etc.)
    def to_sup(m):
        base, exp = m.group(1), m.group(2)
        return base + "".join(SUPERSCRIPT_MAP.get(c, c) for c in exp)
    s = re.sub(r"([a-zA-Z0-9\)])\^\{?([0-9\+\-nixy]+)\}?", to_sup, s)

    def to_sub(m):
        base, sub = m.group(1), m.group(2)
        return base + "".join(SUBSCRIPT_MAP.get(c, c) for c in sub)
    s = re.sub(r"([a-zA-Z0-9\)])_\{?([0-9\+\-aeoxijnt]+)\}?", to_sub, s)

    # 9. LaTeX Text & Formatting unwrappers
    s = re.sub(r"\\(?:text|mathrm|mathbf|textit|textsf|textbf|operatorname)\{\s*([^}]+)\s*\}", r"\1", s)
    s = re.sub(r"\\left\(", "(", s)
    s = re.sub(r"\\right\)", ")", s)
    s = re.sub(r"\\left\[", "[", s)
    s = re.sub(r"\\right\]", "]", s)
    s = re.sub(r"\\left\\\{", "{", s)
    s = re.sub(r"\\right\\\}", "}", s)
    s = re.sub(r"\\left\|", "|", s)
    s = re.sub(r"\\right\|", "|", s)
    s = re.sub(r"\\(?:dots|ldots|cdots)\b", "...", s)
    s = re.sub(r"\\quad\b", "  ", s)
    s = re.sub(r"\\qquad\b", "    ", s)
    s = re.sub(r"\\[,;:!]", " ", s)
    s = re.sub(r"\\%", "%", s)
    s = re.sub(r"\\\$", "$", s)
    s = re.sub(r"\\&", "&", s)
    s = re.sub(r"\\_", "_", s)

    # 10. Normalize double dollar and single dollar math wrappers
    s = re.sub(r"\$\$(.*?)\$\$", r"\1", s, flags=re.DOTALL)

    nl_conjunctions = r"\b(?:dan|atau|hingga|sampai|ke|dari|per|dengan|and|or|to|from|with|between)\b"
    def replace_inline_math(match):
        inner = match.group(1)
        trimmed = inner.strip()
        if re.search(nl_conjunctions, trimmed, re.IGNORECASE):
            return match.group(0)
        math_indicators = r"[=<>≤≥≠≈~→←⇒°µ·²³⁴⁵⁶⁷⁸⁹⁺⁻√∑∏∫∂±×÷/]|[a-zA-Z]\b"
        if re.search(math_indicators, trimmed):
            return trimmed
        if re.match(r"^[\d\.,]+%?$", trimmed):
            return trimmed
        return trimmed

    s = re.sub(r"\$([^\$\n]+?)\$", replace_inline_math, s)

    # Clean redundant spaces around currency (e.g. "Rp  30.000.000" -> "Rp 30.000.000")
    s = re.sub(r"\bRp\s{2,}", "Rp ", s)

    return s


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
        clean_ans = re.sub(
            r'\{\s*["\']name["\']\s*:\s*["\'](?:run_sql|get_schema|make_chart|search_glossary|calculate)["\']\s*,\s*["\'](?:parameters|arguments)["\']\s*:.*$',
            '',
            answer_text,
            flags=re.DOTALL,
        ).strip()
        return clean_ans, []

    split_idx = match.start()
    clean_answer = answer_text[:split_idx].rstrip()
    clean_answer = re.sub(
        r'\{\s*["\']name["\']\s*:\s*["\'](?:run_sql|get_schema|make_chart|search_glossary|calculate)["\']\s*,\s*["\'](?:parameters|arguments)["\']\s*:.*$',
        '',
        clean_answer,
        flags=re.DOTALL,
    ).strip()
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
        # Strip any trailing JSON tool call if model appended it to bullet line
        line_clean = re.sub(r'\{\s*["\']name["\']\s*:.*$', '', stripped).strip()
        cleaned = clean_suggestion_text(line_clean)
        # Ensure it has substance and question intent
        if len(cleaned) >= 8 and not cleaned.startswith("#"):
            suggestions.append(cleaned)
            if len(suggestions) >= 3:
                break

    return clean_answer, suggestions


def generate_heuristic_suggestions(
    user_query: str,
    tables: list[TableData] | list[dict[str, Any]] | None = None,
    charts: list[ChartSpec] | list[dict[str, Any]] | None = None,
    sql_queries: list[str] | None = None,
    executed_sqls: list[str] | None = None,
    **kwargs: Any,
) -> list[str]:
    """
    Generate domain-specific analytical suggestions based on SQL tables,
    columns returned, and user intent when LLM suggestions are absent.
    """
    sqls = sql_queries if sql_queries is not None else (executed_sqls or [])
    tables = tables or []
    charts = charts or []
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
    tables: list[TableData] | list[dict[str, Any]] | None = None,
    charts: list[ChartSpec] | list[dict[str, Any]] | None = None,
    sql_queries: list[str] | None = None,
    executed_sqls: list[str] | None = None,
    **kwargs: Any,
) -> tuple[str, list[str]]:
    """
    Main entrypoint: extracts suggestions from LLM answer if present,
    otherwise blends in heuristic fallbacks to guarantee 3 crisp questions.
    """
    clean_answer, extracted = extract_suggestions_from_text(answer_text)
    clean_answer = clean_latex_math_to_unicode(clean_answer)

    # If LLM gave 3 valid suggestions, use them directly
    if len(extracted) >= 3:
        cleaned_suggestions = [clean_latex_math_to_unicode(s) for s in extracted[:3]]
        return clean_answer, cleaned_suggestions

    sqls = sql_queries if sql_queries is not None else (executed_sqls or [])
    tables = tables or []
    charts = charts or []

    # Otherwise, supplement with heuristic suggestions
    heuristics = generate_heuristic_suggestions(
        user_query=user_query,
        tables=tables,
        charts=charts,
        sql_queries=sqls,
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

    cleaned_combined = [clean_latex_math_to_unicode(s) for s in combined[:3]]
    return clean_answer, cleaned_combined

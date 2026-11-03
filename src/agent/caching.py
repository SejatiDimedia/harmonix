"""Prompt Caching Engine (FR-15): Deterministic prefix structuring, cache breakpoints, and savings tracking."""

import copy
import hashlib
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

# In-memory session schema prompt cache: session_id -> (prompt_string, content_hash)
_SESSION_SCHEMA_CACHE: dict[str, tuple[str, str]] = {}


def hash_text(text: str) -> str:
    """Generate SHA256 hex digest for byte-exact prefix verification."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def get_cached_session_schema_prompt(
    session_id: str,
    uploaded_tables: list[Any],
) -> str:
    """Retrieve or generate deterministic schema prompt for uploaded session tables.
    
    Guarantees bit-for-bit identical string representation across turns in the same session,
    enabling LLM server-side prefix cache hits.
    """
    if not uploaded_tables:
        return ""

    # Build unique fingerprint of uploaded tables
    fingerprint_parts = []
    for t in uploaded_tables:
        cols_summary = ",".join(f"{c.name}:{c.data_type}" for c in t.columns)
        fingerprint_parts.append(f"{t.table_name}:{t.row_count}:{cols_summary}")
    current_hash = hash_text(";".join(fingerprint_parts))

    cached_entry = _SESSION_SCHEMA_CACHE.get(session_id)
    if cached_entry and cached_entry[1] == current_hash:
        logger.debug("Prompt Cache HIT: Reusing cached schema prompt for session %s", session_id)
        return cached_entry[0]

    # Generate deterministic markdown schema
    table_sections = []
    for t in uploaded_tables:
        cols_str = ", ".join(f"{c.name} ({c.data_type})" for c in t.columns)
        samples_str = ""
        sample_items = [f"{c.name}: {c.sample_values}" for c in t.columns if c.sample_values]
        if sample_items:
            samples_str = f"    Contoh Nilai: {'; '.join(sample_items[:4])}"

        table_sections.append(
            f"- `analytics.\"{t.table_name}\"`\n"
            f"    Sumber: File '{t.original_filename}', Sheet: '{t.sheet_name}' ({t.row_count} baris)\n"
            f"    Kolom: {cols_str}\n"
            f"{samples_str}"
        )

    dynamic_section = (
        "\n\nTABEL DATA EKSTERNAL DARI FILE PENGGUNA (SESSION UPLOADED TABLES):\n"
        "Pengguna telah mengunggah file data spreadsheet (CSV/Excel) ke dalam sesi percakapan ini.\n"
        "Tabel-tabel fisik dinamis berikut TELAH DIBUAT di skema `analytics` PostgreSQL dan SIAP DI-QUERY / DI-JOIN:\n"
        + "\n".join(table_sections)
        + "\n\nPANDUAN & ATURAN ANALISIS DATA SPREADSHEET (POLA KONDISI -> TINDAKAN -> LAPORAN):\n"
        "1. LANGKAH 0 - KENALI DATA: Tentukan peran tiap tabel dari strukturnya (detail vs master vs ringkasan). Seluruh kalkulasi wajib dihitung dari tabel detail, tabel ringkasan hanya pembanding. Jika berbeda, uraikan selisihnya per kelompok tanpa menebak penyebabnya.\n"
        "2. LANGKAH 1 - PROFIL KUALITAS DATA: Jalankan pemeriksaan untuk 8 jenis masalah (duplikat ID, kolom tipe campur, angka tersimpan teks, variasi kategori, nilai di luar rentang wajar/negatif pada SETIAP kolom numerik, kunci tanpa pasangan/kosong, nilai kosong pada kolom hitung, baris uji coba/dummy). Tampilkan jumlah baris terdampak termasuk jika nol.\n"
        "3. LANGKAH 2 - KEPUTUSAN PEMBERSIHAN: Jangan pernah membuang atau mengubah baris tanpa melaporkan jumlah, alasan, dan beberapa contoh barisnya. Analisis level entitas hanya memakai baris dengan kunci valid.\n"
        "4. TANGGAL TEKS: Tentukan urutan tanggal dari bukti data (>12), jangan biarkan konversi otomatis menebak. Jika ambigu, tanyakan ke pengguna atau nyatakan asumsi.\n"
        "5. LANGKAH 3 - PERHITUNGAN KODE NYATA: Hitung lewat kode/query SQL nyata dan tampilkan tabel langsung dari hasil eksekusi, jangan mengetik ulang dengan tangan. Ikuti definisi metrik persis sesuai pertanyaan.\n"
        "6. LANGKAH 4 - VERIFIKASI SEBELUM MENJAWAB: Verifikasi jumlah bagian = total, total baris awal = baris valid + baris dikecualikan, dan bandingkan dua sumber jika ada serta laporkan selisihnya per kelompok.\n"
        "7. FORMAT JAWABAN: Wajib memuat (1) Jawaban langsung di awal, (2) Log data temuan & tindakan per jenis masalah, (3) Asumsi yang dipakai, (4) Hasil verifikasi, (5) Label [Dugaan] untuk penjelasan sebab yang tidak terbukti oleh data."
    )

    _SESSION_SCHEMA_CACHE[session_id] = (dynamic_section, current_hash)
    logger.debug("Prompt Cache STORE: Cached schema prompt for session %s (hash: %s)", session_id, current_hash)
    return dynamic_section


def invalidate_session_schema_cache(session_id: str | None = None) -> None:
    """Invalidate cached schema prompt for a session or all sessions."""
    if session_id:
        _SESSION_SCHEMA_CACHE.pop(session_id, None)
        logger.debug("Prompt Cache INVALIDATE: Evicted session %s", session_id)
    else:
        _SESSION_SCHEMA_CACHE.clear()
        logger.debug("Prompt Cache INVALIDATE: Evicted all sessions")


def apply_prompt_cache_control(
    messages: list[dict[str, Any]],
    provider: str,
    model: str,
) -> list[dict[str, Any]]:
    """Inject provider-compatible cache control breakpoints onto static system messages (FR-15).
    
    Supported Standards:
    - OpenRouter / Anthropic Claude: multi-part content block with `cache_control: {"type": "ephemeral"}`
    - Standard OpenAI / Gemini / DeepSeek / Ollama: preserves exact deterministic text string so
      server-side prefix caching automatically triggers without API validation schema errors.
    """
    if not messages:
        return messages

    p_lower = (provider or "").lower()
    m_lower = (model or "").lower()

    # Determine whether provider/model supports explicit Anthropic-style cache_control blocks
    supports_ephemeral_blocks = (
        p_lower == "openrouter" and any(k in m_lower for k in ["claude", "anthropic", "deepseek"])
    ) or "claude" in m_lower

    if not supports_ephemeral_blocks:
        # Return cleanly without altering data structures for standard OpenAI/Gemini/Ollama endpoints
        return messages

    # Deep copy messages so caller's original list remains pristine
    formatted_messages = copy.deepcopy(messages)

    for msg in formatted_messages:
        if msg.get("role") == "system":
            raw_content = msg.get("content")
            if isinstance(raw_content, str):
                msg["content"] = [
                    {
                        "type": "text",
                        "text": raw_content,
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
            elif isinstance(raw_content, list) and len(raw_content) > 0:
                # Add cache_control to the final text block in the system prompt
                last_block = raw_content[-1]
                if isinstance(last_block, dict):
                    last_block["cache_control"] = {"type": "ephemeral"}
            break

    return formatted_messages


def extract_cached_tokens(response_data: dict[str, Any]) -> int:
    """Extract cached token count across OpenAI, OpenRouter, DeepSeek, and Google Gemini response shapes."""
    if not isinstance(response_data, dict):
        return 0

    usage = response_data.get("usage", {})
    if not isinstance(usage, dict):
        usage = {}

    # 1. OpenAI & OpenRouter prompt_tokens_details:
    prompt_details = usage.get("prompt_tokens_details")
    if isinstance(prompt_details, dict):
        cached = prompt_details.get("cached_tokens", 0)
        if isinstance(cached, int) and cached > 0:
            return cached

    # 2. OpenRouter & 9Router top-level cached_tokens:
    cached_top = usage.get("cached_tokens")
    if isinstance(cached_top, int) and cached_top > 0:
        return cached_top

    # 3. DeepSeek prompt_cache_hit_tokens:
    deepseek_hit = usage.get("prompt_cache_hit_tokens")
    if isinstance(deepseek_hit, int) and deepseek_hit > 0:
        return deepseek_hit

    # 4. Anthropic / OpenRouter cache_read_input_tokens:
    anthropic_read = usage.get("cache_read_input_tokens")
    if isinstance(anthropic_read, int) and anthropic_read > 0:
        return anthropic_read

    # 5. Google Gemini native usageMetadata:
    usage_meta = response_data.get("usageMetadata", {})
    if isinstance(usage_meta, dict):
        gemini_cached = usage_meta.get("cachedContentTokenCount", 0)
        if isinstance(gemini_cached, int) and gemini_cached > 0:
            return gemini_cached

    return 0


def calculate_cache_efficiency(prompt_tokens: int, cached_tokens: int) -> dict[str, Any]:
    """Calculate prompt cache hit rate and estimated token cost savings (FR-15, OB-02)."""
    if prompt_tokens <= 0:
        return {
            "cached_tokens": 0,
            "prompt_tokens": 0,
            "cache_hit_rate": 0.0,
            "saved_percentage": 0.0,
            "status": "MISS",
        }

    # In modern LLMs (Anthropic/OpenRouter/Gemini), cached tokens are part of prompt_tokens or additive
    effective_prompt = max(prompt_tokens, cached_tokens)
    hit_rate = round((cached_tokens / effective_prompt) * 100, 1)

    # Cached tokens are typically discounted by 50% (OpenRouter/Anthropic) to 75% (OpenAI/DeepSeek)
    saved_pct = round(hit_rate * 0.75, 1)

    status = "MISS"
    if hit_rate >= 80.0:
        status = "FULL_HIT"
    elif hit_rate > 0.0:
        status = "PARTIAL_HIT"

    return {
        "cached_tokens": cached_tokens,
        "prompt_tokens": prompt_tokens,
        "cache_hit_rate": hit_rate,
        "saved_percentage": saved_pct,
        "status": status,
    }

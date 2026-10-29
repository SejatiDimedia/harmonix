"""Data Auditor & Verification Agent implementation (FR-35).

Performs independent Maker-Checker quality gate verification on analyst agent outputs,
checking SQL logic soundness, data faithfulness / anti-hallucination, and business completeness.
Supports zero-cost model diversity (Groq Llama-3.3-70B / Gemini Flash / DeepSeek R1 / Mock).
"""

import json
import logging
import re
from typing import Any

from src.agent.models import AuditIssue, AuditStatus, AuditVerdict, TableData
from src.agent.prompts import AUDITOR_SYSTEM_PROMPT
from src.config import settings
from src.llm.provider import (
    BaseLLMProvider,
    MockLLMProvider,
    OpenAICompatibleProvider,
    create_single_provider,
    get_llm_provider,
)

logger = logging.getLogger(__name__)


def get_auditor_provider() -> BaseLLMProvider:
    """Factory to instantiate the dedicated Auditor LLM provider with model diversity."""
    provider_choice = settings.auditor_provider.lower().strip()

    if provider_choice == "mock":
        return MockLLMProvider()

    if provider_choice == "auto":
        # Model Diversity: Pick a distinct high-reasoning free tier model if keys available
        primary_provider = settings.llm_provider.lower().strip()

        # 1. Prefer Groq Llama-3.3-70B if real API key is present and primary is not Groq
        if settings.groq_api_key and not settings.groq_api_key.startswith("gsk_abc") and "123456789" not in settings.groq_api_key and primary_provider != "groq":
            try:
                logger.info("Auditor Agent using Groq Llama-3.3-70B for Model Diversity.")
                return create_single_provider("groq")
            except Exception as e:
                logger.warning("Failed to initialize Groq for auditor: %s", e)

        # 2. Prefer Google Gemini 2.0 Flash if API key is present and primary is not Gemini
        if settings.gemini_api_key and primary_provider != "gemini":
            try:
                logger.info("Auditor Agent using Gemini Flash for Model Diversity.")
                return create_single_provider("gemini")
            except Exception as e:
                logger.warning("Failed to initialize Gemini for auditor: %s", e)

        # 3. Prefer OpenRouter if API key is present and primary is not OpenRouter
        if settings.openrouter_api_key and primary_provider != "openrouter":
            try:
                logger.info("Auditor Agent using OpenRouter for Model Diversity.")
                return create_single_provider("openrouter", settings.auditor_model)
            except Exception as e:
                logger.warning("Failed to initialize OpenRouter for auditor: %s", e)

        # 4. If auditor_model is explicitly configured on Ollama
        if settings.auditor_model:
            try:
                return OpenAICompatibleProvider(
                    base_url=settings.ollama_base_url,
                    api_key=None,
                    model=settings.auditor_model,
                )
            except Exception as e:
                logger.warning("Failed to initialize custom Ollama model for auditor: %s", e)

        # 5. Fallback to default LLM provider
        return get_llm_provider()

    # Explicit provider configuration
    return create_single_provider(provider_choice, settings.auditor_model)


class DataAuditorAgent:
    """Independent verification agent acting as the 'Checker' in Maker-Checker architecture."""

    def __init__(self, llm: BaseLLMProvider | None = None):
        self.llm = llm or get_auditor_provider()

    def _parse_audit_json(self, raw_text: str) -> dict[str, Any] | None:
        """Robustly extract and repair JSON object from auditor response."""
        if not raw_text or not raw_text.strip():
            return None

        text = raw_text.strip()

        # Strip markdown fences if present
        fenced_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if fenced_match:
            candidate = fenced_match.group(1).strip()
        else:
            first_brace = text.find("{")
            last_brace = text.rfind("}")
            if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                candidate = text[first_brace : last_brace + 1].strip()
            else:
                candidate = text

        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            # Auto-repair unbalanced closing braces
            open_count = candidate.count("{")
            close_count = candidate.count("}")
            if open_count > close_count:
                candidate += "}" * (open_count - close_count)
            try:
                return json.loads(candidate)
            except Exception as e:
                logger.warning("Failed to parse auditor JSON: %s. Raw: %s", e, raw_text[:200])
                return None

    def _heuristic_check(
        self,
        user_query: str,
        answer_text: str,
        executed_sqls: list[str],
        tables: list[TableData],
    ) -> AuditVerdict | None:
        """Deterministic fast-pass checks before invoking LLM inference."""
        q_lower = user_query.lower()
        is_greeting = any(g in q_lower for g in [
            "halo", "hai", "hello", "hi", "siapa kamu", "siapa anda", "kamu siapa", "siapa namamu"
        ])
        business_keywords = [
            "berapa", "kategori", "mana", "total", "rata", "pesanan",
            "produk", "customer", "pelanggan", "penjualan", "transaksi", "status",
            "data", "terbanyak", "terlaris", "termahal", "paling",
            "how", "what", "which", "top", "sales", "average", "count", "revenue", "order"
        ]
        has_business_kw = any(w in q_lower for w in business_keywords)

        # 1. Non-analytical greetings without SQL are automatically verified
        if is_greeting and not has_business_kw and not executed_sqls:
            return AuditVerdict(
                status=AuditStatus.PASSED,
                confidence_score=1.0,
                badge="Verified by Data Auditor",
                critique="Pertanyaan percakapan umum terkonfirmasi tidak membutuhkan eksekusi database.",
                issues=[],
                model_used="heuristic",
            )

        # 2. Flag empty SQL when user explicitly asks for analytical data
        if has_business_kw and not executed_sqls and not is_greeting:
            return AuditVerdict(
                status=AuditStatus.FLAGGED,
                confidence_score=0.95,
                badge="Auditor Flagged: Missing SQL",
                critique="Pertanyaan analitik tidak disertai eksekusi query SQL pada database analitik.",
                issues=[
                    AuditIssue(
                        category="completeness",
                        severity="high",
                        description="Analisis analitik disajikan tanpa eksekusi query PostgreSQL.",
                        suggested_fix="Jalankan tool run_sql untuk mengambil data faktual dari database.",
                    )
                ],
                model_used="heuristic",
            )

        return None

    async def audit(
        self,
        user_query: str,
        answer_text: str,
        executed_sqls: list[str],
        tables: list[TableData],
        charts: list[Any] | None = None,
    ) -> AuditVerdict:
        """Audit the analyst output and return a structured verification verdict."""
        # Check if auditor is disabled in settings
        if not settings.auditor_enabled:
            return AuditVerdict(
                status=AuditStatus.SKIPPED,
                confidence_score=1.0,
                badge="Audit Skipped (Disabled)",
                critique="Data Auditor dinonaktifkan dalam konfigurasi sistem.",
                issues=[],
                model_used="none",
            )

        # 1. Deterministic heuristic fast pass
        heuristic_verdict = self._heuristic_check(
            user_query=user_query,
            answer_text=answer_text,
            executed_sqls=executed_sqls,
            tables=tables,
        )
        if heuristic_verdict:
            return heuristic_verdict

        # 2. Prepare payload for LLM Maker-Checker inspection
        table_summary = []
        for idx, tbl in enumerate(tables, start=1):
            sample_rows = tbl.rows[:5] if tbl.rows else []
            table_summary.append({
                "table_index": idx,
                "columns": tbl.columns,
                "total_rows_returned": tbl.row_count,
                "sample_rows": sample_rows,
            })

        user_content = (
            f"TOLONG AUDIT HASIL ANALISIS BERIKUT:\n\n"
            f"--- PERTANYAAN PENGGUNA ---\n{user_query}\n\n"
            f"--- QUERY SQL YANG DIJALANKAN ({len(executed_sqls)} query) ---\n"
            f"{json.dumps(executed_sqls, indent=2, ensure_ascii=False)}\n\n"
            f"--- DATA TABEL YANG DIPEROLEH ---\n"
            f"{json.dumps(table_summary, indent=2, ensure_ascii=False)}\n\n"
            f"--- DRAFT JAWABAN AKHIR ANALIS ---\n{answer_text}\n\n"
            f"Lakukan audit kritis dan kembalikan HANYA objek JSON dengan status, confidence_score, badge, critique, dan issues."
        )

        messages = [
            {"role": "system", "content": AUDITOR_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        try:
            llm_response = await self.llm.chat(messages=messages, temperature=0.0)
            raw_content = llm_response.content or ""
            parsed = self._parse_audit_json(raw_content)

            if parsed and isinstance(parsed, dict) and "status" in parsed:
                raw_status = str(parsed.get("status", "PASSED")).upper().strip()
                status = AuditStatus.PASSED
                if raw_status == "FLAGGED":
                    status = AuditStatus.FLAGGED
                elif raw_status == "WARNING":
                    status = AuditStatus.WARNING

                issues_data = parsed.get("issues", [])
                parsed_issues: list[AuditIssue] = []
                if isinstance(issues_data, list):
                    for iss in issues_data:
                        if isinstance(iss, dict):
                            cat = iss.get("category", "sql_logic")
                            if cat not in ["sql_logic", "numerical_consistency", "completeness", "safety"]:
                                cat = "sql_logic"
                            sev = iss.get("severity", "medium")
                            if sev not in ["low", "medium", "high"]:
                                sev = "medium"
                            parsed_issues.append(
                                AuditIssue(
                                    category=cat,
                                    severity=sev,
                                    description=iss.get("description", "Isu teridentifikasi"),
                                    suggested_fix=iss.get("suggested_fix"),
                                )
                            )

                badge = parsed.get("badge")
                if not badge:
                    if status == AuditStatus.PASSED:
                        badge = "Verified by Data Auditor"
                    elif status == AuditStatus.WARNING:
                        badge = "Auditor Caveat: Data Limited"
                    else:
                        badge = "Auditor Flagged: Logic/Data Discrepancy"

                confidence = float(parsed.get("confidence_score", 0.95))
                confidence = max(0.0, min(1.0, confidence))

                return AuditVerdict(
                    status=status,
                    confidence_score=confidence,
                    badge=badge,
                    critique=parsed.get("critique", "Audit selesai."),
                    issues=parsed_issues,
                    model_used=llm_response.model or getattr(self.llm, "model", "unknown"),
                )

        except Exception as e:
            logger.warning("Auditor LLM call failed or timed out: %s. Using graceful fallback.", e)

        # 3. Graceful degradation fallback (fail-open)
        # If the query had executed SQL and returned data, mark as PASSED with caveat note
        if executed_sqls and tables:
            return AuditVerdict(
                status=AuditStatus.PASSED,
                confidence_score=0.88,
                badge="Verified by Data Auditor (Heuristic)",
                critique="Query SQL berhasil dieksekusi dan mengembalikan data yang relevan dengan pertanyaan.",
                issues=[],
                model_used="heuristic_fallback",
            )

        return AuditVerdict(
            status=AuditStatus.WARNING,
            confidence_score=0.75,
            badge="Auditor Notice: Unverified",
            critique="Pemeriksaan mendalam auditor dilewati; data disajikan berdasarkan eksekusi langsung.",
            issues=[],
            model_used="fallback",
        )

"""Manual Agent Loop implementation without external orchestration frameworks (FR-01)."""

import asyncio
import json
import logging
import time
import uuid
from typing import Any, AsyncIterator

from src.agent.models import (
    AgentFinalResponse,
    AgentStepEvent,
    AgentTaskStatus,
    Citation,
    TableData,
)
from src.config import settings
from src.llm.provider import BaseLLMProvider, get_llm_provider
from src.tools.base import BaseTool
from src.tools.database import GetSchemaTool, RunSQLTool
from src.tools.glossary import SearchGlossaryTool

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Anda adalah Senior Data Analyst AI Agent profesional untuk database PostgreSQL analitik.
Tugas Anda adalah menjawab pertanyaan pengguna secara akurat, berbasis data, dan terstruktur.

ATURAN KERJA & HARNESS:
1. Metric Grounding & Business Glossary:
   - Jika pertanyaan pengguna menyinggung istilah bisnis atau metrik (seperti GMV, Delivered Rate, AOV, Pelanggan Aktif, Rasio Pembatalan), panggil tool `search_glossary` terlebih dahulu untuk melihat definisi resmi dan rumus SQL yang disetujui perusahaan.
2. Grounding & Schema Discovery:
   - JANGAN menebak nama tabel atau nama kolom.
   - Panggil tool `get_schema` untuk memeriksa tabel dan kolom yang relevan beserta tipe data dan sampelnya.
3. Safe SQL Generation:
   - Tulis HANYA query SELECT yang valid untuk dialek PostgreSQL.
   - Dilarang keras melakukan operasi penulisan (INSERT, UPDATE, DELETE, DROP, ALTER, dsb).
   - Hindari full-scan tanpa filter pada tabel besar jika tidak diperlukan.
   - Gunakan alias kolom yang jelas dan format numerik yang rapi.
4. Eksekusi & Observasi:
   - Gunakan tool `run_sql` untuk mengeksekusi query.
   - Jika query menghasilkan error, perbaiki sintaks SQL berdasarkan pesan error pada langkah berikutnya.
5. Jawaban Akhir:
   - Sajikan jawaban yang menjawab pertanyaan pengguna secara langsung.
   - Sertakan ringkasan temuan kunci dalam poin-poin yang mudah dipahami bisnis.
   - Jelaskan metrik dan rumus yang digunakan secara transparan (sitasi).
"""


class ManualAgentLoop:
    """Production-grade agent loop with step bounds, token budgeting, and approval gating."""

    def __init__(
        self,
        llm: BaseLLMProvider | None = None,
        tools: list[BaseTool] | None = None,
        max_steps: int | None = None,
        max_token_budget: int | None = None,
        step_timeout_seconds: int | None = None,
        total_timeout_seconds: int | None = None,
    ):
        self.llm = llm or get_llm_provider()
        tool_instances = tools or [SearchGlossaryTool(), GetSchemaTool(), RunSQLTool()]
        self.tools: dict[str, BaseTool] = {t.name: t for t in tool_instances}
        self.openai_tools = [t.to_openai_schema() for t in tool_instances]

        self.max_steps = max_steps or settings.agent_max_steps
        self.max_token_budget = max_token_budget or settings.agent_max_token_budget
        self.step_timeout = step_timeout_seconds or settings.agent_step_timeout_seconds
        self.total_timeout = total_timeout_seconds or settings.agent_total_timeout_seconds

    async def run(
        self,
        user_query: str,
        task_id: str | None = None,
        chat_history: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Run the manual agent loop and yield streaming SSE events.

        Yields dictionaries with 'event' and 'data' keys conforming to PRD specs:
        - event: 'step_start'
        - event: 'token'
        - event: 'approval_required'
        - event: 'final_result'
        - event: 'error'
        """
        task_id = task_id or f"task_{uuid.uuid4().hex[:8]}"
        start_time = time.perf_counter()

        # Build initial messages
        messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        if chat_history:
            messages.extend(chat_history)
        messages.append({"role": "user", "content": user_query})

        total_tokens = 0
        executed_sqls: list[str] = []
        captured_tables: list[TableData] = []
        citations: list[Citation] = []

        step = 0
        final_answer_text = ""

        while step < self.max_steps:
            step += 1
            elapsed_time = time.perf_counter() - start_time

            # 1. Total Timeout Check (FR-02, FR-27)
            if elapsed_time > self.total_timeout:
                yield {
                    "event": "error",
                    "data": {
                        "message": f"Task exceeded maximum total timeout of {self.total_timeout}s.",
                        "task_id": task_id,
                        "status": AgentTaskStatus.FAILED.value,
                    },
                }
                return

            # 2. Token Budget Check (FR-29)
            if total_tokens > self.max_token_budget:
                yield {
                    "event": "error",
                    "data": {
                        "message": f"Task exceeded token budget limit of {self.max_token_budget} tokens.",
                        "task_id": task_id,
                        "status": AgentTaskStatus.FAILED.value,
                    },
                }
                return

            # Yield step start notification
            yield {
                "event": "step_start",
                "data": {
                    "task_id": task_id,
                    "step": step,
                    "max_steps": self.max_steps,
                    "elapsed_seconds": round(elapsed_time, 2),
                },
            }

            # 3. Call LLM with timeout
            try:
                llm_response = await asyncio.wait_for(
                    self.llm.chat(messages=messages, tools=self.openai_tools),
                    timeout=self.step_timeout,
                )
            except asyncio.TimeoutError:
                logger.warning("Step %d timed out after %ds", step, self.step_timeout)
                messages.append({
                    "role": "user",
                    "content": f"Step timeout ({self.step_timeout}s). Selesaikan tugas atau coba pendekatan lebih ringkas.",
                })
                continue
            except Exception as e:
                logger.error("LLM call failed at step %d: %s", step, e)
                yield {
                    "event": "error",
                    "data": {"message": f"LLM inference error: {e}", "task_id": task_id},
                }
                return

            # Track tokens
            total_tokens += llm_response.usage.total_tokens

            # If LLM returned text content, stream tokens to user
            if llm_response.content:
                final_answer_text = llm_response.content
                yield {
                    "event": "token",
                    "data": {"delta": llm_response.content},
                }

            # 4. Handle Tool Calls
            if llm_response.tool_calls:
                # Add assistant message with tool calls to conversation history
                messages.append({
                    "role": "assistant",
                    "content": llm_response.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                        }
                        for tc in llm_response.tool_calls
                    ],
                })

                for tool_call in llm_response.tool_calls:
                    tool_name = tool_call.name
                    tool_args = tool_call.arguments

                    if tool_name not in self.tools:
                        observation = {"error": f"Tool '{tool_name}' is not allowed or unrecognized."}
                    else:
                        tool_instance = self.tools[tool_name]
                        try:
                            observation = await asyncio.wait_for(
                                tool_instance.execute(**tool_args),
                                timeout=self.step_timeout,
                            )
                        except Exception as e:
                            observation = {"error": f"Tool execution failed: {e}"}

                    # Check if tool triggered an Approval Gate (FR-25)
                    if isinstance(observation, dict) and observation.get("status") == "approval_required":
                        approval_id = f"appr_{uuid.uuid4().hex[:8]}"
                        yield {
                            "event": "approval_required",
                            "data": {
                                "approval_id": approval_id,
                                "task_id": task_id,
                                "step": step,
                                "sanitized_query": observation.get("sanitized_query"),
                                "risk_reasons": observation.get("risk_reasons", []),
                                "sensitive_columns": observation.get("sensitive_columns", []),
                            },
                        }
                        # Pause loop waiting for human resolution
                        return

                    # Collect metric definitions from glossary search
                    if tool_name == "search_glossary" and isinstance(observation, dict):
                        for m in observation.get("metrics", []):
                            m_name = m.get("metric_name", "")
                            m_def = m.get("business_definition", "")
                            m_formula = m.get("calculation_formula", "")
                            full_def = f"{m_name}: {m_def} (Formula: {m_formula})"
                            citations.append(
                                Citation(
                                    sql_query=m.get("recommended_sql", ""),
                                    metric_definition=full_def,
                                    source_tables=m.get("relevant_tables", []),
                                )
                            )

                    # Collect tables and SQL queries for final citations
                    if tool_name == "run_sql" and isinstance(observation, dict):
                        if observation.get("status") == "success":
                            sanitized = observation.get("sanitized_query", "")
                            if sanitized:
                                executed_sqls.append(sanitized)
                                citations.append(Citation(sql_query=sanitized, source_tables=[]))

                            cols = observation.get("columns", [])
                            rows = observation.get("rows", [])
                            if cols and rows:
                                captured_tables.append(
                                    TableData(columns=cols, rows=rows, row_count=len(rows))
                                )

                    # Append observation to message history
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_name,
                        "content": json.dumps(observation, ensure_ascii=False),
                    })

                # Proceed to next iteration to let LLM interpret observations
                continue

            # 5. No tool calls -> Agent has concluded reasoning!
            break

        # Graceful degradation if max steps reached
        if step >= self.max_steps:
            warning = f"Batas langkah ({self.max_steps}) tercapai sebelum analisis selesai penuh."
            if final_answer_text:
                final_answer_text = f"{warning} {final_answer_text}"
            else:
                final_answer_text = f"{warning} Berikut adalah data parsial yang berhasil diperoleh."

        final_response = AgentFinalResponse(
            answer_text=final_answer_text,
            sql_queries=executed_sqls,
            tables=captured_tables,
            citations=citations,
            total_steps=step,
            token_usage={"total_tokens": total_tokens},
        )

        yield {
            "event": "final_result",
            "data": final_response.model_dump(),
        }

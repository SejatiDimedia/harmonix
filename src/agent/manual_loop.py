"""Manual Agent Loop implementation without external orchestration frameworks (FR-01).

Includes Checkpointing, State Machine (FR-19), Short-term Memory (FR-16), PII Masking (FR-24),
and Granular Observability Tracing with TTFT & Latency metrics (OB-01, OB-02).
"""

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
from src.agent.state import get_session_history, save_task_checkpoint
from src.config import settings
from src.llm.provider import BaseLLMProvider, get_llm_provider
from src.observability.models import SpanStatus, SpanType
from src.observability.tracer import AgentTracer
from src.tools.base import BaseTool
from src.tools.database import GetSchemaTool, RunSQLTool
from src.tools.glossary import SearchGlossaryTool
from src.tools.pii import PIIMasker
from src.tools.sandbox import CalculateTool

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Anda adalah Senior Data Analyst AI Agent profesional untuk database PostgreSQL analitik.
Tugas Anda adalah menjawab pertanyaan pengguna secara akurat, berbasis data, dan terstruktur.

DATABASE SCHEMA OVERVIEW:
Database analitik PostgreSQL memiliki skema `analytics` dengan tabel-tabel berikut:
- `analytics.orders`: Informasi transaksi pesanan (order_id, customer_id, order_status, order_purchase_timestamp, order_delivered_timestamp)
- `analytics.order_items`: Rincian item per pesanan (order_id, order_item_id, product_id, price, freight_value).
- `analytics.products`: Master katalog produk (product_id, product_category_name, price, weight_g)
- `analytics.customers`: Master data pelanggan (customer_id, customer_unique_id, customer_name, email, phone_number, city, state)
- `analytics.order_payments`: Transaksi pembayaran (order_id, payment_sequential, payment_type, payment_installments, payment_value)
- `analytics.reviews`: Review dan rating pelanggan (review_id, order_id, review_score, review_comment_message)

RELASI ANTAR TABEL (RELATIONAL JOIN PATHS):
- `customers` ke `orders`: `customers.customer_id = orders.customer_id`
- `orders` ke `order_items`: `orders.order_id = order_items.order_id`
- `order_items` ke `products`: `order_items.product_id = products.product_id`
- `orders` ke `order_payments`: `orders.order_id = order_payments.order_id`

PERINGATAN RELASI:
- Tabel `order_items` TIDAK MEMILIKI kolom `customer_id`!
- Untuk mencari customer yang membeli produk tertentu, WAJIB melakukan JOIN melalui tabel `orders`:
  FROM analytics.customers c
  JOIN analytics.orders o ON c.customer_id = o.customer_id
  JOIN analytics.order_items oi ON o.order_id = oi.order_id
  JOIN analytics.products p ON oi.product_id = p.product_id

ATURAN NILAI STRING POSTGRESQL:
- Nilai teks/string di PostgreSQL WAJIB menggunakan petik tunggal (`'...'`), BUKAN petik ganda (`"..."`). Petik ganda dianggap nama kolom!
- Kategori produk dalam database tersimpan dalam bahasa Inggris: `'Electronics'`, `'Home & Living'`, `'Fashion'`, `'Books'`. Gunakan `p.product_category_name ILIKE '%electr%'` untuk kategori elektronik.

ATURAN KERJA & HARNESS:
1. EKSEKUSI DATA WAJIB (JANGAN HANYA MEMBERIKAN QUERY):
   - Pengguna adalah pimpinan/analis bisnis yang MEMBUTUHKAN HASIL DAN ANGKA NYATA dari database, BUKAN teks kode query SQL.
   - DILARANG KERAS hanya menuliskan kode SQL atau menyarankan query dalam jawaban Anda tanpa menjalankannya!
   - Anda WAJIB memanggil tool `run_sql` untuk mengeksekusi query di PostgreSQL dan membaca hasil baris datanya sebelum menulis kesimpulan akhir.
   - Tool `search_glossary` dan `get_schema` HANYA untuk mencari definisi/skema, mereka TIDAK mengeksekusi query. Anda HARUS melanjutkan dengan memanggil tool `run_sql`.
2. Metric Grounding:
   - Jika pertanyaan pengguna menyinggung istilah bisnis atau metrik (seperti GMV, Delivered Rate, AOV, Pelanggan Aktif, Rasio Pembatalan), panggil tool `search_glossary` terlebih dahulu untuk melihat rumus resmi, kemudian jalankan query dengan `run_sql`.
3. Safe SQL Generation:
   - Tulis HANYA query SELECT yang valid untuk dialek PostgreSQL.
   - Dilarang keras melakukan operasi penulisan (INSERT, UPDATE, DELETE, DROP, ALTER, dsb).
   - Hindari full-scan tanpa filter pada tabel besar jika tidak diperlukan.
   - Gunakan alias kolom yang jelas dan format numerik yang rapi.
4. Perhitungan Tambahan & Statistik:
   - Jika memerlukan perhitungan persentase rumit, rasio, pertumbuhan, atau statistik yang sulit di SQL, gunakan tool `calculate` untuk menjalankan Python secara aman.
5. Jawaban Akhir:
   - Sajikan temuan kunci berdasarkan baris data nyata yang dikembalikan oleh tool `run_sql`.
   - Sebutkan angka-angka konkret hasil perhitungan dari tabel.
   - Jelaskan metrik dan rumus yang digunakan secara transparan (sitasi).
"""


class ManualAgentLoop:
    """Production-grade agent loop with step bounds, token budgeting, state persistence, and observability."""

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
        tool_instances = tools or [
            SearchGlossaryTool(),
            GetSchemaTool(),
            RunSQLTool(),
            CalculateTool(),
        ]
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
        session_id: str | None = None,
        chat_history: list[dict[str, str]] | None = None,
        resume_messages: list[dict[str, Any]] | None = None,
        initial_step: int = 0,
    ) -> AsyncIterator[dict[str, Any]]:
        """Run the manual agent loop and yield streaming SSE events."""
        task_id = task_id or f"task_{uuid.uuid4().hex[:8]}"
        start_time = time.perf_counter()

        # Initialize Observability Tracer (OB-01, OB-02)
        tracer = AgentTracer(task_id=task_id)
        root_span = tracer.start_span(
            name="agent_task",
            span_type=SpanType.AGENT,
            input_data={"user_query": user_query, "session_id": session_id},
        )

        # Build initial messages (or restore from resumed state)
        if resume_messages:
            messages = resume_messages
            logger.info("Resuming task %s from checkpoint with %d messages.", task_id, len(messages))
        else:
            messages = [{"role": "system", "content": SYSTEM_PROMPT}]
            # Load short-term conversation memory from session if available (FR-16)
            if session_id:
                try:
                    past_turns = await get_session_history(session_id=session_id)
                    if past_turns:
                        messages.extend(past_turns)
                except Exception as e:
                    logger.warning("Could not load session history for %s: %s", session_id, e)

            if chat_history:
                messages.extend(chat_history)
            messages.append({"role": "user", "content": user_query})

        total_tokens = 0
        prompt_tokens = 0
        completion_tokens = 0
        executed_sqls: list[str] = []
        captured_tables: list[TableData] = []
        citations: list[Citation] = []
        failed_sqls: set[str] = set()

        step = initial_step
        final_answer_text = ""

        while step < self.max_steps:
            step += 1
            elapsed_time = time.perf_counter() - start_time

            # 1. Total Timeout Check (FR-02, FR-27)
            if elapsed_time > self.total_timeout:
                err_msg = f"Task exceeded maximum total timeout of {self.total_timeout}s."
                try:
                    await save_task_checkpoint(
                        task_id=task_id,
                        status=AgentTaskStatus.FAILED,
                        current_step=step,
                        messages=messages,
                        user_query=user_query,
                        session_id=session_id,
                        error_message=err_msg,
                    )
                except Exception as e:
                    logger.warning("Checkpoint save failed on timeout: %s", e)

                tracer.end_span(
                    root_span.span_id,
                    status=SpanStatus.ERROR,
                    error_message=err_msg,
                )
                await tracer.flush(
                    status="FAILED",
                    total_tokens=total_tokens,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    step_count=step,
                )

                yield {
                    "event": "error",
                    "data": {
                        "message": err_msg,
                        "task_id": task_id,
                        "status": AgentTaskStatus.FAILED.value,
                    },
                }
                return

            # 2. Token Budget Check (FR-29)
            if total_tokens > self.max_token_budget:
                err_msg = f"Task exceeded token budget limit of {self.max_token_budget} tokens."
                try:
                    await save_task_checkpoint(
                        task_id=task_id,
                        status=AgentTaskStatus.FAILED,
                        current_step=step,
                        messages=messages,
                        user_query=user_query,
                        session_id=session_id,
                        error_message=err_msg,
                    )
                except Exception as e:
                    logger.warning("Checkpoint save failed on token budget: %s", e)

                tracer.end_span(
                    root_span.span_id,
                    status=SpanStatus.ERROR,
                    error_message=err_msg,
                )
                await tracer.flush(
                    status="FAILED",
                    total_tokens=total_tokens,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    step_count=step,
                )

                yield {
                    "event": "error",
                    "data": {
                        "message": err_msg,
                        "task_id": task_id,
                        "status": AgentTaskStatus.FAILED.value,
                    },
                }
                return

            # Save checkpoint: Step in progress (RUNNING)
            try:
                await save_task_checkpoint(
                    task_id=task_id,
                    status=AgentTaskStatus.RUNNING,
                    current_step=step,
                    messages=messages,
                    user_query=user_query,
                    session_id=session_id,
                )
            except Exception as e:
                logger.debug("Running checkpoint save: %s", e)

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

            # 3. Call LLM with timeout and tracing
            llm_span = tracer.start_span(
                name=f"llm_step_{step}",
                span_type=SpanType.LLM,
                parent_span_id=root_span.span_id,
                input_data={"step": step, "messages_count": len(messages)},
            )

            try:
                llm_response = await asyncio.wait_for(
                    self.llm.chat(messages=messages, tools=self.openai_tools),
                    timeout=self.step_timeout,
                )
                tracer.end_span(
                    span_id=llm_span.span_id,
                    output_data={
                        "has_content": bool(llm_response.content),
                        "tool_calls_count": len(llm_response.tool_calls),
                    },
                    metadata={"tokens": llm_response.usage.total_tokens},
                )
            except asyncio.TimeoutError:
                logger.warning("Step %d timed out after %ds", step, self.step_timeout)
                tracer.end_span(
                    span_id=llm_span.span_id,
                    status=SpanStatus.ERROR,
                    error_message=f"LLM call timed out after {self.step_timeout}s",
                )
                messages.append({
                    "role": "user",
                    "content": f"Step timeout ({self.step_timeout}s). Selesaikan tugas atau coba pendekatan lebih ringkas.",
                })
                continue
            except Exception as e:
                logger.error("LLM call failed at step %d: %s", step, e)
                tracer.end_span(
                    span_id=llm_span.span_id,
                    status=SpanStatus.ERROR,
                    error_message=str(e),
                )
                tracer.end_span(root_span.span_id, status=SpanStatus.ERROR, error_message=str(e))
                await tracer.flush(status="FAILED", total_tokens=total_tokens, step_count=step)
                yield {
                    "event": "error",
                    "data": {"message": f"LLM inference error: {e}", "task_id": task_id},
                }
                return

            # Track tokens
            total_tokens += llm_response.usage.total_tokens
            prompt_tokens += llm_response.usage.prompt_tokens
            completion_tokens += llm_response.usage.completion_tokens

            # If LLM returned text content, stream tokens and record TTFT (OB-02)
            if llm_response.content:
                tracer.record_first_token()
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

                    tool_span = tracer.start_span(
                        name=f"tool:{tool_name}",
                        span_type=SpanType.TOOL,
                        parent_span_id=root_span.span_id,
                        input_data=tool_args,
                    )

                    norm_sql = ""
                    if tool_name == "run_sql":
                        norm_sql = " ".join(str(tool_args.get("query", "")).split()).lower()

                    if tool_name not in self.tools:
                        observation = {"error": f"Tool '{tool_name}' is not allowed or unrecognized."}
                    elif tool_name == "run_sql" and norm_sql in failed_sqls:
                        observation = {
                            "status": "error",
                            "error": "Query ini persis sama dengan query yang sudah gagal sebelumnya! JANGAN ulangi query yang sama.",
                            "message": "Query ini persis sama dengan query yang sudah gagal sebelumnya! JANGAN ulangi query yang sama. Periksa relasi: customers -> orders (via customer_id) -> order_items (via order_id) -> products (via product_id). Gunakan petik tunggal untuk string ('Electronics').",
                            "hint": "Gunakan JOIN 4 tabel yang benar: customers c JOIN orders o ON c.customer_id = o.customer_id JOIN order_items oi ON o.order_id = oi.order_id JOIN products p ON oi.product_id = p.product_id WHERE p.product_category_name ILIKE '%electr%'",
                        }
                    else:
                        tool_instance = self.tools[tool_name]
                        try:
                            observation = await asyncio.wait_for(
                                tool_instance.execute(**tool_args),
                                timeout=self.step_timeout,
                            )
                        except Exception as e:
                            observation = {"error": f"Tool execution failed: {e}"}

                        if tool_name == "run_sql" and isinstance(observation, dict):
                            if observation.get("status") == "error" and norm_sql:
                                failed_sqls.add(norm_sql)

                    # Determine tool span status
                    tool_status = SpanStatus.SUCCESS
                    tool_err_msg = None
                    if isinstance(observation, dict):
                        if "error" in observation or observation.get("status") == "error":
                            tool_status = SpanStatus.ERROR
                            tool_err_msg = str(observation.get("error") or observation.get("message"))
                        elif observation.get("status") == "approval_required":
                            tool_status = SpanStatus.APPROVAL_REQUIRED

                    tracer.end_span(
                        span_id=tool_span.span_id,
                        output_data=observation if isinstance(observation, dict) else {"result": str(observation)},
                        status=tool_status,
                        error_message=tool_err_msg,
                    )

                    # Check if tool triggered an Approval Gate (FR-25, FR-19)
                    if isinstance(observation, dict) and observation.get("status") == "approval_required":
                        approval_id = f"appr_{uuid.uuid4().hex[:8]}"
                        approval_payload = {
                            "approval_id": approval_id,
                            "task_id": task_id,
                            "step": step,
                            "tool_call_id": tool_call.id,
                            "tool_name": tool_name,
                            "sanitized_query": observation.get("sanitized_query"),
                            "risk_reasons": observation.get("risk_reasons", []),
                            "sensitive_columns": observation.get("sensitive_columns", []),
                        }

                        # Persist WAITING_APPROVAL state to DB (non-blocking thread suspension)
                        try:
                            await save_task_checkpoint(
                                task_id=task_id,
                                status=AgentTaskStatus.WAITING_APPROVAL,
                                current_step=step,
                                messages=messages,
                                user_query=user_query,
                                session_id=session_id,
                                pending_approval=approval_payload,
                            )
                        except Exception as e:
                            logger.warning("Approval checkpoint save failed: %s", e)

                        tracer.end_span(
                            root_span.span_id,
                            status=SpanStatus.APPROVAL_REQUIRED,
                            metadata={"pending_approval": approval_id},
                        )
                        await tracer.flush(
                            status="WAITING_APPROVAL",
                            total_tokens=total_tokens,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            step_count=step,
                        )

                        yield {
                            "event": "approval_required",
                            "data": approval_payload,
                        }
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

            # 5. Check if agent is attempting to finalize prematurely without running SQL on an analytical question
            if not executed_sqls and step < 3:
                q_lower = user_query.lower()
                is_analytical = any(w in q_lower for w in [
                    "berapa", "kategori", "siapa", "mana", "total", "rata", "pesanan",
                    "produk", "customer", "pelanggan", "penjualan", "transaksi", "status",
                    "data", "terbanyak", "terlaris", "termahal", "paling"
                ])
                is_greeting = any(g in q_lower for g in ["halo", "hai", "hello", "hi", "siapa kamu"]) and not is_analytical
                if is_analytical and not is_greeting:
                    logger.info("Agent attempted to conclude without running SQL on an analytical query. Nudging tool execution.")
                    messages.append({
                        "role": "assistant",
                        "content": llm_response.content or "",
                    })
                    messages.append({
                        "role": "user",
                        "content": "PENTING: Anda belum mengeksekusi query SQL dengan tool `run_sql`! Jangan hanya menuliskan query dalam teks. Panggil tool `run_sql` sekarang untuk menjalankan query tersebut di database PostgreSQL dan dapatkan baris data nyatanya!",
                    })
                    continue

            # No tool calls -> Agent has concluded reasoning!
            break

        # Graceful degradation if max steps reached
        if step >= self.max_steps:
            warning = f"Batas langkah ({self.max_steps}) tercapai sebelum analisis selesai penuh."
            if final_answer_text:
                final_answer_text = f"{warning} {final_answer_text}"
            else:
                final_answer_text = f"{warning} Berikut adalah data parsial yang berhasil diperoleh."

        # Apply PII Masking on final output (FR-24)
        masked_answer = PIIMasker.mask_text(final_answer_text)

        # Finalize root trace span and flush metrics
        tracer.end_span(
            root_span.span_id,
            output_data={"answer_length": len(masked_answer)},
            status=SpanStatus.SUCCESS,
        )
        task_metrics = await tracer.flush(
            status="COMPLETED",
            total_tokens=total_tokens,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            step_count=step,
        )

        final_response = AgentFinalResponse(
            answer_text=masked_answer,
            sql_queries=executed_sqls,
            tables=captured_tables,
            citations=citations,
            total_steps=step,
            token_usage={
                "total_tokens": total_tokens,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
            metrics=task_metrics.model_dump(),
        )

        # Persist COMPLETED task state in PostgreSQL
        try:
            await save_task_checkpoint(
                task_id=task_id,
                status=AgentTaskStatus.COMPLETED,
                current_step=step,
                messages=messages,
                user_query=user_query,
                session_id=session_id,
                final_result=final_response.model_dump(),
            )
        except Exception as e:
            logger.warning("Completion checkpoint save failed: %s", e)

        yield {
            "event": "final_result",
            "data": final_response.model_dump(),
        }

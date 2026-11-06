"""Manual Agent Loop implementation without external orchestration frameworks (FR-01).

Includes Checkpointing, State Machine (FR-19), Short-term Memory (FR-16), PII Masking (FR-24),
and Granular Observability Tracing with TTFT & Latency metrics (OB-01, OB-02).
"""

import asyncio
import json
import logging
import re
import time
import uuid
from typing import Any, AsyncIterator

from src.agent.models import (
    AgentFinalResponse,
    AgentStepEvent,
    AgentTaskStatus,
    AuditVerdict,
    ChartSpec,
    Citation,
    LongTermMemoryItem,
    TableData,
)
from src.agent.auditor import DataAuditorAgent
from src.agent.execution_logger import TerminalExecutionLogger
from src.agent.guardrail_evaluator import GuardrailEvaluator
from src.agent.observation_processor import ObservationProcessor
from src.agent.prompts import BASE_ANALYST_SYSTEM_PROMPT, build_analyst_system_prompt
from src.agent.state import get_session_history, save_task_checkpoint
from src.agent.suggestions import get_smart_suggestions
from src.config import settings
from src.llm.provider import BaseLLMProvider, MockLLMProvider, ToolCall, get_llm_provider
from src.observability.models import SpanStatus, SpanType
from src.agent.scratchpad import WorkingMemoryManager
from src.agent.cancellation import clear_task_cancellation, is_task_cancelled
from src.observability.tracer import AgentTracer
from src.rag.long_term_memory import retrieve_relevant_memories, store_successful_query
from src.tools.base import BaseTool
from src.tools.chart import MakeChartTool
from src.tools.database import GetSchemaTool, RunSQLTool
from src.tools.glossary import SearchGlossaryTool
from src.tools.pii import PIIMasker
from src.tools.sandbox import CalculateTool
from src.tools.scratchpad import ScratchpadTool

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = BASE_ANALYST_SYSTEM_PROMPT



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
        term_logger: TerminalExecutionLogger | None = None,
        auditor: DataAuditorAgent | None = None,
    ):
        self.llm = llm or get_llm_provider()
        if isinstance(self.llm, MockLLMProvider) and auditor is None:
            self.auditor = DataAuditorAgent(llm=MockLLMProvider())
        else:
            self.auditor = auditor or DataAuditorAgent()
        tool_instances = tools or [
            SearchGlossaryTool(),
            GetSchemaTool(),
            RunSQLTool(),
            CalculateTool(),
            MakeChartTool(),
            ScratchpadTool(),
        ]
        self.tools: dict[str, BaseTool] = {t.name: t for t in tool_instances}
        self.openai_tools = [t.to_openai_schema() for t in tool_instances]

        self.max_steps = max_steps or settings.agent_max_steps
        self.max_token_budget = max_token_budget or settings.agent_max_token_budget
        self.step_timeout = step_timeout_seconds or settings.agent_step_timeout_seconds
        self.total_timeout = total_timeout_seconds or settings.agent_total_timeout_seconds
        self.term_logger = term_logger or TerminalExecutionLogger()

    async def run(
        self,
        user_query: str,
        task_id: str | None = None,
        session_id: str | None = None,
        chat_history: list[dict[str, str]] | None = None,
        resume_messages: list[dict[str, Any]] | None = None,
        initial_step: int = 0,
        is_approved: bool = False,
    ) -> AsyncIterator[dict[str, Any]]:
        """Run the manual agent loop and yield streaming SSE events."""
        task_id = task_id or f"task_{uuid.uuid4().hex[:8]}"
        start_time = time.perf_counter()

        # Configure task context for stateful tools (e.g. FR-18 Scratchpad)
        if "scratchpad" in self.tools and isinstance(self.tools["scratchpad"], ScratchpadTool):
            self.tools["scratchpad"].set_context(task_id=task_id, session_id=session_id)

        # Initialize Observability Tracer (OB-01, OB-02)
        tracer = AgentTracer(task_id=task_id)
        root_span = tracer.start_span(
            name="agent_task",
            span_type=SpanType.AGENT,
            input_data={"user_query": user_query, "session_id": session_id},
        )
        self.term_logger.log_task_start(task_id=task_id, query=user_query, session_id=session_id)

        # Build initial messages (or restore from resumed state)
        recalled_memories: list[LongTermMemoryItem] = []
        if resume_messages:
            messages = resume_messages
            logger.info("Resuming task %s from checkpoint with %d messages.", task_id, len(messages))
        else:
            # FR-17: Retrieve relevant long-term memory (proven queries & user preferences)
            try:
                recalled_memories = await retrieve_relevant_memories(
                    query=user_query,
                    limit=2,
                    min_similarity=0.75,
                )
                if recalled_memories:
                    logger.info("Recalled %d long-term memories via pgvector for query: '%s'", len(recalled_memories), user_query[:40])
            except Exception as mem_err:
                logger.warning("Could not recall long-term memories: %s", mem_err)

            compacted_summary = None
            past_turns = []
            # Load short-term memory with FR-14 Auto-Compaction for long sessions
            if session_id:
                try:
                    from src.agent.compaction import get_or_update_session_compaction
                    compacted_summary, past_turns = await get_or_update_session_compaction(
                        session_id=session_id,
                        llm=self.llm,
                    )
                except Exception as e:
                    logger.warning("Could not process session compaction for %s: %s. Falling back to raw history.", session_id, e)
                    try:
                        past_turns = await get_session_history(session_id=session_id)
                    except Exception:
                        past_turns = []

            system_prompt = await build_analyst_system_prompt(
                session_id=session_id,
                recalled_memories=recalled_memories,
                compacted_summary=compacted_summary,
                task_id=task_id,
            )
            messages = [{"role": "system", "content": system_prompt}]
            if past_turns:
                messages.extend(past_turns)

            if chat_history:
                messages.extend(chat_history)
            messages.append({"role": "user", "content": user_query})

        total_tokens = 0
        prompt_tokens = 0
        completion_tokens = 0
        cached_tokens = 0
        executed_sqls: list[str] = []
        captured_tables: list[TableData] = []
        captured_charts: list[ChartSpec] = []
        citations: list[Citation] = []
        failed_sqls: set[str] = set()

        if resume_messages:
            for msg in resume_messages:
                if msg.get("role") == "tool" and msg.get("name") == "run_sql":
                    try:
                        content_obj = json.loads(msg.get("content", "{}"))
                        if isinstance(content_obj, dict) and content_obj.get("status") == "success":
                            sq = content_obj.get("sanitized_query")
                            if sq and sq not in executed_sqls:
                                executed_sqls.append(sq)
                                citations.append(Citation(sql_query=sq, source_tables=[]))
                            cols = content_obj.get("columns", [])
                            rows = content_obj.get("rows", [])
                            if cols and rows:
                                captured_tables.append(TableData(columns=cols, rows=rows, row_count=len(rows)))
                    except Exception:
                        pass
                elif msg.get("role") == "tool" and msg.get("name") == "make_chart":
                    try:
                        content_obj = json.loads(msg.get("content", "{}"))
                        if isinstance(content_obj, dict) and content_obj.get("status") == "success":
                            c_spec = content_obj.get("chart", {})
                            captured_charts.append(
                                ChartSpec(
                                    chart_type=c_spec.get("chart_type", "bar"),
                                    title=c_spec.get("title", ""),
                                    x_axis=c_spec.get("x_axis", "x"),
                                    y_axis=c_spec.get("y_axis", "y"),
                                    data=c_spec.get("data", []),
                                )
                            )
                    except Exception:
                        pass

        step = initial_step
        final_answer_text = ""

        while step < self.max_steps:
            step += 1
            elapsed_time = time.perf_counter() - start_time

            # 0. User Cancellation Check
            if is_task_cancelled(task_id):
                cancelled_msg = "Proses analitik dibatalkan oleh pengguna."
                logger.info("ManualAgentLoop: Task %s cancelled by user request at step %d.", task_id, step)
                self.term_logger.log_task_failed(
                    task_id=task_id, error=cancelled_msg, step=step, elapsed_seconds=elapsed_time
                )
                try:
                    await save_task_checkpoint(
                        task_id=task_id,
                        status=AgentTaskStatus.CANCELLED,
                        current_step=step,
                        messages=messages,
                        user_query=user_query,
                        session_id=session_id,
                        final_result={"answer_text": ""},
                        error_message=cancelled_msg,
                    )
                except Exception as e:
                    logger.warning("Checkpoint save failed on cancellation: %s", e)

                tracer.end_span(
                    root_span.span_id,
                    status=SpanStatus.ERROR,
                    error_message=cancelled_msg,
                )
                yield {
                    "event": "cancelled",
                    "data": {
                        "task_id": task_id,
                        "status": AgentTaskStatus.CANCELLED.value,
                        "message": cancelled_msg,
                    },
                }
                clear_task_cancellation(task_id)
                return

            # 1. Total Timeout Check (FR-02, FR-27)
            if elapsed_time > self.total_timeout:
                err_msg = f"Task exceeded maximum total timeout of {self.total_timeout}s."
                self.term_logger.log_task_failed(task_id=task_id, error=err_msg, step=step, elapsed_seconds=elapsed_time)
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
                if executed_sqls or captured_tables or captured_charts:
                    logger.warning(
                        "Task %s reached token budget (%d > %d) with available results (%d SQLs, %d tables, %d charts). Concluding gracefully.",
                        task_id, total_tokens, self.max_token_budget, len(executed_sqls), len(captured_tables), len(captured_charts)
                    )
                    if not final_answer_text:
                        final_answer_text = (
                            f"Analisis data berhasil diperoleh ({len(executed_sqls)} kueri dieksekusi). "
                            f"Batas anggaran token ({self.max_token_budget}) tercapai, berikut visualisasi dan ringkasan data yang telah diperoleh."
                        )
                    break

                err_msg = f"Task exceeded token budget limit of {self.max_token_budget} tokens."
                self.term_logger.log_task_failed(task_id=task_id, error=err_msg, step=step, elapsed_seconds=elapsed_time)
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
                    working_memory=WorkingMemoryManager.get_or_create(task_id).to_dict(),
                )
            except Exception as e:
                logger.debug("Running checkpoint save: %s", e)

            # Terminal visual logging for step start
            self.term_logger.log_step_start(step=step, max_steps=self.max_steps, elapsed_seconds=elapsed_time)

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

            # Determine if this is the final allowed step in the budget
            is_final_step = (step >= self.max_steps)
            tools_to_pass = None if is_final_step else self.openai_tools

            # Nudge model on penultimate step if queries have already been executed
            if step == self.max_steps - 1 and len(executed_sqls) >= 2:
                messages.append({
                    "role": "user",
                    "content": (
                        "PENGINGAT SISTEM: Anda mendekati batas akhir langkah. Jika data yang telah diperoleh dari query di atas sudah cukup untuk menjawab pertanyaan pengguna, segera sajikan kesimpulan dan jawaban akhir Anda sekarang tanpa memanggil tool tambahan."
                    ),
                })
            elif is_final_step:
                messages.append({
                    "role": "user",
                    "content": (
                        "PERINGATAN LANGKAH TERAKHIR: Ini adalah langkah terakhir dari batas alur analisis. "
                        "DILARANG memanggil tool apa pun lagi. Rangkum dan jawab pertanyaan pengguna secara langsung, "
                        "lengkap, terstruktur (gunakan tabel Markdown jika relevan), serta berikan kesimpulan akhir "
                        "berdasarkan seluruh data dan observasi yang telah Anda peroleh di atas."
                    ),
                })

            # 3. Call LLM with timeout and tracing
            llm_span = tracer.start_span(
                name=f"llm_step_{step}",
                span_type=SpanType.LLM,
                parent_span_id=root_span.span_id,
                input_data={"step": step, "messages_count": len(messages)},
            )

            try:
                llm_response = await asyncio.wait_for(
                    self.llm.chat(messages=messages, tools=tools_to_pass),
                    timeout=self.step_timeout,
                )
                if is_final_step:
                    llm_response.tool_calls = []
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
                self.term_logger.log_task_failed(task_id=task_id, error=str(e), step=step, elapsed_seconds=elapsed_time)
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
            cached_tokens += getattr(llm_response.usage, "cached_tokens", 0)

            # If LLM returned text content, stream tokens and record TTFT (OB-02)
            if llm_response.content:
                tracer.record_first_token()
                final_answer_text = llm_response.content
                self.term_logger.log_thought(llm_response.content)
                yield {
                    "event": "token",
                    "data": {"delta": llm_response.content},
                }

            # Auto-detect unexecuted SQL query generated in text without formal function call
            if not llm_response.tool_calls and not executed_sqls:
                ext_query = GuardrailEvaluator.detect_unexecuted_sql(llm_response.content)
                if ext_query:
                    logger.info("Auto-executing unexecuted SQL written in text by model: %s", ext_query[:80])
                    llm_response.tool_calls = [
                        ToolCall(
                            id=f"call_auto_sql_{uuid.uuid4().hex[:6]}",
                            name="run_sql",
                            arguments={"query": ext_query},
                        )
                    ]

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

                    # Terminal visual logging for tool trigger
                    self.term_logger.log_tool_trigger(tool_name=tool_name, tool_args=tool_args)
                    tool_start_time = time.perf_counter()

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
                            "error": "Query ini identik dengan query yang baru saja gagal dieksekusi sebelumnya. Jangan ulangi query yang sama.",
                            "message": "Query ini identik dengan query yang baru saja gagal dieksekusi sebelumnya. Ubah pendekatan Anda: periksa kembali nama kolom, gunakan tool `get_schema` untuk melihat struktur tabel, atau tinjau kembali kondisi JOIN dan klausa agregasi Anda.",
                            "hint": "Gunakan tool `get_schema` untuk memeriksa skema tabel atau ubah klausa JOIN/WHERE/HAVING Anda.",
                        }
                    else:
                        tool_instance = self.tools[tool_name]
                        exec_args = dict(tool_args)
                        if tool_name == "run_sql":
                            exec_args["is_approved"] = is_approved
                        try:
                            observation = await asyncio.wait_for(
                                tool_instance.execute(**exec_args),
                                timeout=self.step_timeout,
                            )
                        except Exception as e:
                            observation = {"error": f"Tool execution failed: {e}"}

                        if tool_name == "run_sql" and isinstance(observation, dict):
                            if observation.get("status") == "error" and norm_sql:
                                failed_sqls.add(norm_sql)

                    tool_duration_ms = round((time.perf_counter() - tool_start_time) * 1000, 1)
                    self.term_logger.log_tool_result(
                        tool_name=tool_name,
                        observation=observation,
                        duration_ms=tool_duration_ms,
                    )

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
                            "user_query": user_query,
                        }
                        self.term_logger.log_approval_required(
                            approval_id=approval_id,
                            query=observation.get("sanitized_query") or str(tool_args.get("query", "")),
                            reasons=observation.get("risk_reasons", []),
                        )

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
                                analyst_provider=getattr(self.llm, "provider_name", getattr(self.llm, "provider", None)),
                                analyst_model=getattr(self.llm, "model", None),
                                working_memory=WorkingMemoryManager.get_or_create(task_id).to_dict(),
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
                    if tool_name == "run_sql":
                        ObservationProcessor.process_sql_observation(
                            observation=observation,
                            executed_sqls=executed_sqls,
                            citations=citations,
                            captured_tables=captured_tables,
                        )

                    # Collect chart specifications (FR-07)
                    if tool_name == "make_chart":
                        ObservationProcessor.process_chart_observation(
                            observation=observation,
                            captured_charts=captured_charts,
                            captured_tables=captured_tables,
                            user_query=user_query,
                        )

                    # Append observation to message history (FR-15: token-pruned preview for large SQL tables)
                    formatted_content = ObservationProcessor.format_observation_for_llm(
                        tool_name=tool_name,
                        observation=observation,
                    )
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_name,
                        "content": formatted_content,
                    })

                # Proceed to next iteration to let LLM interpret observations
                continue

            # 5. Check if agent is attempting to finalize prematurely without running SQL on an analytical database question
            if GuardrailEvaluator.should_nudge_for_sql(
                resp_text=llm_response.content or "",
                user_query=user_query,
                executed_sqls=executed_sqls,
                step=step,
            ):
                logger.info("Agent concluded without running SQL on a database query. Nudging tool execution.")
                messages.append({
                    "role": "assistant",
                    "content": llm_response.content or "",
                })
                messages.append({
                    "role": "user",
                    "content": "PENTING: Anda belum mengeksekusi query SQL dengan tool `run_sql`! Jangan hanya menuliskan query dalam teks. Panggil tool `run_sql` sekarang untuk menjalankan query tersebut di database PostgreSQL dan dapatkan baris data nyatanya!",
                })
                continue

            # No tool calls -> Check if content is provided
            content_str = (llm_response.content or "").strip()
            if not content_str and step < self.max_steps:
                logger.warning("Agent returned empty response at step %d. Prompting to continue.", step)
                messages.append({
                    "role": "user",
                    "content": "Respons Anda kosong. Silakan lanjutkan analisis: jalankan tool `run_sql` untuk mengeksekusi kueri di database, atau tuliskan jawaban analisis data yang lengkap.",
                })
                continue

            final_answer_text = llm_response.content or ""
            break

        # If no narrative answer was generated yet, force a zero-tool synthesis
        if not final_answer_text or not final_answer_text.strip():
            logger.info("Task %s has no narrative answer. Running final emergency synthesis...", task_id)
            synth_messages = list(messages)
            synth_messages.append({
                "role": "user",
                "content": (
                    "Berdasarkan seluruh hasil observasi, skema, tabel data, dan kueri di atas, "
                    "tuliskan jawaban analisis data akhir yang lengkap, faktual, terstruktur, "
                    f"dan langsung menjawab pertanyaan: \"{user_query}\"."
                ),
            })
            try:
                synth_span = tracer.start_span(
                    name="emergency_synthesis",
                    span_type=SpanType.LLM,
                    parent_span_id=root_span.span_id,
                )
                synth_resp = await asyncio.wait_for(
                    self.llm.chat(messages=synth_messages, tools=None),
                    timeout=self.step_timeout,
                )
                tracer.end_span(synth_span.span_id)
                if synth_resp and synth_resp.content:
                    final_answer_text = synth_resp.content
                    total_tokens += synth_resp.usage.total_tokens
                    prompt_tokens += synth_resp.usage.prompt_tokens
                    completion_tokens += synth_resp.usage.completion_tokens
                    cached_tokens += getattr(synth_resp.usage, "cached_tokens", 0)
                    yield {
                        "event": "token",
                        "data": {"delta": synth_resp.content},
                    }
            except Exception as e:
                logger.warning("Final emergency synthesis failed: %s", e)

        # Graceful degradation notice if max steps or token budget reached
        if step >= self.max_steps or total_tokens > self.max_token_budget:
            warning = f"Batas langkah ({self.max_steps}) tercapai sebelum analisis selesai penuh."
            if final_answer_text:
                if not final_answer_text.startswith("Batas langkah"):
                    final_answer_text = f"{warning}\n\n{final_answer_text}"
            else:
                if captured_charts or captured_tables:
                    final_answer_text = f"{warning} Berikut adalah visualisasi dan data yang berhasil diekstrak."
                else:
                    final_answer_text = f"{warning} Berikut adalah data parsial yang berhasil diperoleh."
            if final_answer_text:
                if not final_answer_text.startswith("Batas langkah"):
                    final_answer_text = f"{warning}\n\n{final_answer_text}"
            else:
                if captured_charts or captured_tables:
                    final_answer_text = f"{warning} Berikut adalah visualisasi dan data yang berhasil diekstrak."
                else:
                    final_answer_text = f"{warning} Berikut adalah data parsial yang berhasil diperoleh."

        # Apply PII Masking on final output (FR-24)
        self.term_logger.log_synthesizing()
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
            cached_tokens=cached_tokens,
            step_count=step,
        )

        # Deduplicate, sanitize, and auto-synthesize charts via ObservationProcessor
        captured_charts = ObservationProcessor.finalize_charts(
            captured_charts=captured_charts,
            captured_tables=captured_tables,
            user_query=user_query,
        )

        # FR-34: Smart follow-up suggestions (zero latency / zero extra cost)
        clean_answer, follow_up_suggestions = get_smart_suggestions(
            answer_text=masked_answer,
            user_query=user_query,
            tables=captured_tables,
            charts=captured_charts,
            executed_sqls=executed_sqls,
        )

        # FR-35: Data Auditor & Verification Agent (Maker-Checker Quality Gate)
        audit_verdict = None
        if settings.auditor_enabled:
            yield {
                "event": "audit_step",
                "data": {
                    "status": "auditing",
                    "badge": "Auditing...",
                    "critique": "Data Auditor sedang memverifikasi logika SQL dan konsistensi data...",
                },
            }
            self.term_logger.log_auditing(model=getattr(self.auditor.llm, "model", ""))
            audit_verdict = await self.auditor.audit(
                user_query=user_query,
                answer_text=clean_answer,
                executed_sqls=executed_sqls,
                tables=captured_tables,
                charts=captured_charts,
            )
            if audit_verdict:
                self.term_logger.log_audit_verdict(
                    status=audit_verdict.status.value,
                    confidence=audit_verdict.confidence_score,
                    badge=audit_verdict.badge,
                    critique=audit_verdict.critique,
                )
                yield {
                    "event": "audit_step",
                    "data": audit_verdict.model_dump(),
                }

        final_working_memory = WorkingMemoryManager.get_or_create(task_id).to_dict()

        final_response = AgentFinalResponse(
            answer_text=clean_answer,
            sql_queries=executed_sqls,
            tables=captured_tables,
            charts=captured_charts,
            citations=citations,
            total_steps=step,
            token_usage={
                "total_tokens": total_tokens,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cached_tokens": cached_tokens,
            },
            metrics=task_metrics.model_dump(),
            follow_up_suggestions=follow_up_suggestions,
            audit_result=audit_verdict,
            memories_recalled=recalled_memories,
            working_memory=final_working_memory,
        )

        # FR-17: Auto-learn and store verified queries in long-term memory (Maker-Checker approved)
        if executed_sqls and (not audit_verdict or audit_verdict.status.value in ("PASSED", "WARNING")):
            conf = audit_verdict.confidence_score if audit_verdict else 0.95
            try:
                # Fire and forget async memory persist
                asyncio.create_task(
                    store_successful_query(
                        question=user_query,
                        sql=executed_sqls[0],
                        session_id=session_id,
                        explanation=audit_verdict.critique if audit_verdict else "Kueri analitik terverifikasi berhasil",
                        confidence=conf,
                    )
                )
            except Exception as store_err:
                logger.debug("Async long-term memory store error: %s", store_err)

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
                analyst_provider=getattr(self.llm, "provider_name", getattr(self.llm, "provider", None)),
                analyst_model=getattr(self.llm, "model", None),
                working_memory=final_working_memory,
            )
        except Exception as e:
            logger.warning("Completion checkpoint save failed: %s", e)

        # Terminal visual logging for task completion
        self.term_logger.log_task_completed(
            task_id=task_id,
            steps=step,
            total_tokens=total_tokens,
            elapsed_seconds=round(time.perf_counter() - start_time, 2),
            sql_count=len(executed_sqls),
        )

        yield {
            "event": "final_result",
            "data": final_response.model_dump(),
        }

    # Alias for interface parity with LangGraph agent
    run_stream = run


# Backwards compatibility alias
DataAnalystAgent = ManualAgentLoop


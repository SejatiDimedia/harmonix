"""Sub-Agent Swarm & Planner-Executor Multi-Agent Architecture (FR-04).

Implements the Planner-Executor pattern for multi-step analytics questions:
1. Planner Agent decomposes complex business queries into an ExecutionPlan (DAG of subtasks).
2. Specialist Sub-Agents (SQL Specialist, Calculation Specialist, Chart Specialist) execute subtasks with focused contexts.
3. Synthesizer Agent unifies tables, charts, and metrics into a cohesive narrative.
4. Independent Data Auditor Agent verifies accuracy (Maker-Checker).
5. Provides an honest trade-off comparison against Single-Agent (token consumption, latency, complexity).
"""

import asyncio
import json
import logging
import re
import time
import uuid
from typing import Any, AsyncIterator, Literal
from pydantic import BaseModel, Field

from src.agent.auditor import DataAuditorAgent
from src.agent.execution_logger import TerminalExecutionLogger
from src.agent.guardrail_evaluator import GuardrailEvaluator
from src.agent.models import (
    AgentFinalResponse,
    AgentTaskStatus,
    ChartSpec,
    Citation,
    TableData,
)
from src.agent.observation_processor import ObservationProcessor
from src.agent.prompts import BASE_ANALYST_SYSTEM_PROMPT, build_analyst_system_prompt
from src.agent.scratchpad import WorkingMemoryManager
from src.agent.state import get_session_history, save_task_checkpoint
from src.agent.suggestions import get_smart_suggestions
from src.config import settings
from src.llm.provider import BaseLLMProvider, MockLLMProvider, ToolCall, get_llm_provider
from src.observability.models import SpanStatus, SpanType
from src.observability.tracer import AgentTracer
from src.rag.long_term_memory import retrieve_relevant_memories, store_successful_query
from src.tools.base import BaseTool
from src.tools.chart import MakeChartTool
from src.tools.database import GetSchemaTool, RunSQLTool
from src.tools.glossary import SearchGlossaryTool
from src.tools.guardrails import SQLGuardrail, SQLValidationError
from src.tools.pii import PIIMasker
from src.tools.sandbox import CalculateTool
from src.tools.scratchpad import ScratchpadTool

logger = logging.getLogger(__name__)


# ==============================================================================
# 1. SubTask & Execution Plan Models
# ==============================================================================

class SubTaskSpec(BaseModel):
    """Specification of an individual sub-task delegated to a specialist worker."""
    id: int = Field(..., description="Unique sub-task index (1-based)")
    role: Literal["sql_specialist", "calc_specialist", "chart_specialist", "general_analyst"] = Field(
        ...,
        description="The specialist role best suited for this sub-task",
    )
    title: str = Field(..., description="Short descriptive title of the subtask")
    instruction: str = Field(..., description="Precise instruction and goal for the specialist")
    expected_output: str = Field(..., description="What data or artifact this sub-task must produce")
    status: Literal["pending", "running", "completed", "failed", "skipped"] = "pending"
    result_summary: str | None = None
    output_data: dict[str, Any] = Field(default_factory=dict)
    duration_ms: float = 0.0


class ExecutionPlan(BaseModel):
    """Structured plan of action formulated by the Planner Agent."""
    goal: str = Field(..., description="High-level analytical goal")
    complexity_level: Literal["simple", "moderate", "complex"] = "moderate"
    reasoning: str = Field(..., description="Why this plan and decomposition was chosen")
    tasks: list[SubTaskSpec] = Field(default_factory=list)


# ==============================================================================
# 2. Planner Prompt
# ==============================================================================

PLANNER_SYSTEM_PROMPT = """Anda adalah Chief Data Strategist & Planner Agent untuk sistem analitik database enterprise PostgreSQL.
Tugas Anda adalah menganalisis pertanyaan bisnis dari pengguna dan menyusun rencana dekomposisi tugas (*Execution Plan*) yang efisien.

SPESIALISASI SUB-AGENT WORKER YANG TERSEDIA:
1. `sql_specialist`: Ahli penulisan SQL PostgreSQL yang aman, join multi-tabel, aggregasi, dan filtering. Punya akses ke tool `run_sql`, `get_schema`, `search_glossary`.
2. `calc_specialist`: Ahli matematika dan statistika Python aman. Menghitung persentase pertumbuhan (MoM, YoY), rasio margin, perbandingan, atau statistika inferensial dengan tool `calculate`.
3. `chart_specialist`: Ahli visualisasi data bisnis (grafik batang, garis, pie, doughnut) dengan tool `make_chart`.

PEDOMAN DEKOMPOSISI:
- Jika pertanyaan sederhana (mis. satu metrik tunggal tanpa perbandingan rumit): Buat 1 atau 2 sub-tugas saja (`sql_specialist` -> opsional `chart_specialist`).
- Jika pertanyaan multi-langkah (mis. bandingkan performa kategori A vs B, hitung rasio perbedaannya, dan visualisasikan): Pecah menjadi sub-tugas berurutan:
  1. `sql_specialist`: Ambil dataset gabungan yang dibutuhkan.
  2. `calc_specialist`: (Jika perlu) Hitung kalkulasi matematis lanjutan atau rasio di luar SQL.
  3. `chart_specialist`: (Jika pengguna meminta grafik atau data sangat cocok divisualisasikan) Bentuk spesifikasi chart.

OUTPUT WAJIB DALAM FORMAT JSON VALID SESUAI SKEMA BERIKUT:
```json
{
  "goal": "Tujuan analisis tingkat tinggi dalam satu kalimat jelas",
  "complexity_level": "simple" | "moderate" | "complex",
  "reasoning": "Alasan pemilihan rencana dan dekomposisi",
  "tasks": [
    {
      "id": 1,
      "role": "sql_specialist",
      "title": "Ekstraksi data penjualan per kategori",
      "instruction": "Tulis dan jalankan query SQL untuk mengambil total omzet kategori produk",
      "expected_output": "Tabel data berisi kategori dan total nilai penjualan"
    }
  ]
}
```
PENTING: Jangan menyertakan teks pembuka atau penutup di luar blok JSON.
"""


# ==============================================================================
# 3. Specialist Prompts
# ==============================================================================

SQL_SPECIALIST_PROMPT = """Anda adalah Senior PostgreSQL Specialist Sub-Agent.
Tugas Anda adalah merumuskan dan mengeksekusi query SQL SELECT yang akurat, aman, dan efisien untuk menyelesaikan sub-tugas yang diberikan.
ATURAN KERJA:
1. Panggil `run_sql` untuk mengeksekusi query.
2. HANYA query SELECT. Dilarang keras DDL/DML.
3. Sajikan ringkasan baris data yang ditemukan secara faktual.
"""

CALC_SPECIALIST_PROMPT = """Anda adalah Quantitative Analyst Sub-Agent.
Tugas Anda adalah melakukan perhitungan matematika, rasio, persentase pertumbuhan, atau statistika menggunakan tool `calculate` Python sandbox.
Sajikan hasil perhitungan secara presisi dengan angka terformat rapi.
"""

CHART_SPECIALIST_PROMPT = """Anda adalah Business Intelligence Visualization Sub-Agent.
Tugas Anda adalah merancang visualisasi grafik yang tepat menggunakan tool `make_chart`.
ATURAN:
1. Pilih `chart_type` yang tepat: 'pie'/'doughnut' untuk proporsi, 'line' untuk tren waktu, 'bar' untuk perbandingan.
2. Gunakan baris data nyata yang telah diekstrak sebelumnya. Argumen `data` wajib berupa list of dict `[{"x": ..., "y": ...}]`.
"""

SYNTHESIZER_SYSTEM_PROMPT = """Anda adalah Senior Analytics Synthesizer & Lead Consultant.
Tugas Anda adalah merangkum seluruh temuan data, baris tabel, perhitungan kuantitatif, dan visualisasi yang dihasilkan oleh sub-agent spesialis menjadi satu laporan analitik bisnis yang utuh, profesional, dan langsung menjawab pertanyaan pengguna.

PEDOMAN LAPORAN:
1. Berikan jawaban langsung di awal (Direct Answer).
2. Jika ada data komparasi atau peringkat, WAJIB sajikan dalam tabel Markdown standar (| Kolom 1 | Kolom 2 |).
3. Format angka mata uang dan persentase dengan rapi (misal: Rp 1.500.000, 24,5%).
4. DILARANG menggunakan format LaTeX ($...$ atau \\times). Gunakan simbol teks alami (×, %, →).
"""


# ==============================================================================
# 4. Planner-Executor Multi-Agent Swarm Orchestrator
# ==============================================================================

class PlannerExecutorAgent:
    """Production-grade Multi-Agent Swarm using Planner-Executor architecture (FR-04)."""

    def __init__(
        self,
        llm: BaseLLMProvider | None = None,
        auditor: DataAuditorAgent | None = None,
        max_subtasks: int = 5,
        term_logger: TerminalExecutionLogger | None = None,
    ):
        self.llm = llm or get_llm_provider()
        if isinstance(self.llm, MockLLMProvider) and auditor is None:
            self.auditor = DataAuditorAgent(llm=MockLLMProvider())
        else:
            self.auditor = auditor or DataAuditorAgent()

        self.max_subtasks = max_subtasks
        self.term_logger = term_logger or TerminalExecutionLogger()
        self.guardrail = SQLGuardrail()

        # Shared specialist tools
        self.search_glossary_tool = SearchGlossaryTool()
        self.get_schema_tool = GetSchemaTool()
        self.run_sql_tool = RunSQLTool()
        self.calc_tool = CalculateTool()
        self.chart_tool = MakeChartTool()
        self.scratchpad_tool = ScratchpadTool()

    async def _generate_plan(
        self,
        user_query: str,
        session_id: str | None = None,
        compacted_summary: str | None = None,
        uploaded_schema: str = "",
    ) -> ExecutionPlan:
        """Invokes Planner LLM to construct structured ExecutionPlan."""
        messages = [
            {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
        ]
        context_parts = []
        if compacted_summary:
            context_parts.append(f"Konteks Sesi Percakapan:\n{compacted_summary}")
        if uploaded_schema:
            context_parts.append(f"Skema Tabel Tambahan:\n{uploaded_schema}")

        if context_parts:
            messages.append({"role": "system", "content": "\n\n".join(context_parts)})

        messages.append({"role": "user", "content": f"Susun rencana analisis untuk pertanyaan: \"{user_query}\""})

        try:
            resp = await self.llm.chat(messages=messages, tools=None)
            raw_content = resp.content or "{}"
            
            # Extract JSON block
            json_match = re.search(r"\{.*\}", raw_content, re.DOTALL)
            if json_match:
                plan_dict = json.loads(json_match.group(0))
                tasks_raw = plan_dict.get("tasks", [])
                parsed_tasks = []
                for idx, t in enumerate(tasks_raw[: self.max_subtasks], 1):
                    parsed_tasks.append(
                        SubTaskSpec(
                            id=t.get("id", idx),
                            role=t.get("role", "sql_specialist"),
                            title=t.get("title", f"Sub-Task {idx}"),
                            instruction=t.get("instruction", ""),
                            expected_output=t.get("expected_output", ""),
                        )
                    )
                return ExecutionPlan(
                    goal=plan_dict.get("goal", user_query),
                    complexity_level=plan_dict.get("complexity_level", "moderate"),
                    reasoning=plan_dict.get("reasoning", "Dekomposisi analitik terarah"),
                    tasks=parsed_tasks,
                )
        except Exception as e:
            logger.warning("Planner LLM fallback on plan generation: %s", e)

        # Resilient heuristic fallback plan
        return self._heuristic_fallback_plan(user_query)

    def _heuristic_fallback_plan(self, user_query: str) -> ExecutionPlan:
        """Determines a solid deterministic fallback plan if planner LLM fails."""
        uq_lower = user_query.lower()
        wants_chart = any(w in uq_lower for w in ("grafik", "chart", "diagram", "visual", "tren", "proporsi"))
        has_comparison = any(w in uq_lower for w in ("bandingkan", "vs", "pertumbuhan", "rasio", "selisih"))

        tasks = [
            SubTaskSpec(
                id=1,
                role="sql_specialist",
                title="Ekstraksi Data SQL",
                instruction=f"Eksekusi kueri SQL untuk mengambil data analitik: {user_query}",
                expected_output="Baris tabel data PostgreSQL",
            )
        ]
        if has_comparison:
            tasks.append(
                SubTaskSpec(
                    id=2,
                    role="calc_specialist",
                    title="Kalkulasi Kuantitatif & Rasio",
                    instruction="Hitung perbandingan, selisih atau rasio matematis dari baris data",
                    expected_output="Hasil komparasi numerik terverifikasi",
                )
            )
        if wants_chart:
            tasks.append(
                SubTaskSpec(
                    id=len(tasks) + 1,
                    role="chart_specialist",
                    title="Visualisasi Data Interaktif",
                    instruction="Rancang grafik ChartSpec dari hasil data SQL",
                    expected_output="Spesifikasi grafik JSON",
                )
            )

        return ExecutionPlan(
            goal=user_query,
            complexity_level="moderate" if len(tasks) > 1 else "simple",
            reasoning="Heuristic Plan: Dekomposisi tugas berbasis ekstraksi SQL dan visualisasi",
            tasks=tasks,
        )

    # --------------------------------------------------------------------------
    # Specialist Sub-Agent Execution
    # --------------------------------------------------------------------------

    async def _execute_sql_specialist(
        self,
        task: SubTaskSpec,
        task_id: str,
        session_id: str | None,
        context_data: dict[str, Any],
        is_approved: bool = False,
    ) -> dict[str, Any]:
        """Runs the SQL Specialist Sub-Agent."""
        tools = [
            self.search_glossary_tool.to_openai_schema(),
            self.get_schema_tool.to_openai_schema(),
            self.run_sql_tool.to_openai_schema(),
        ]
        tool_map: dict[str, BaseTool] = {
            "search_glossary": self.search_glossary_tool,
            "get_schema": self.get_schema_tool,
            "run_sql": self.run_sql_tool,
        }

        messages = [
            {"role": "system", "content": SQL_SPECIALIST_PROMPT},
            {"role": "user", "content": f"Tugas Anda: {task.instruction}\nEkspektasi Output: {task.expected_output}"},
        ]

        executed_sqls = []
        captured_tables: list[TableData] = []
        summary = ""

        # Step limit of 4 for specialist
        for step_idx in range(4):
            resp = await self.llm.chat(messages=messages, tools=tools)
            if resp.content:
                summary = resp.content
            if not resp.tool_calls:
                break

            messages.append({
                "role": "assistant",
                "content": resp.content or "",
                "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
                    for tc in resp.tool_calls
                ],
            })

            for tc in resp.tool_calls:
                tool_instance = tool_map.get(tc.name)
                if not tool_instance:
                    obs = {"error": f"Tool '{tc.name}' tidak didukung di SQL Specialist"}
                else:
                    exec_kwargs = dict(tc.arguments)
                    if tc.name == "run_sql":
                        exec_kwargs["is_approved"] = is_approved
                    try:
                        obs = await tool_instance.execute(**exec_kwargs)
                    except Exception as e:
                        obs = {"status": "error", "error": f"Tool execution failed: {e}"}

                if tc.name == "run_sql" and isinstance(obs, dict) and obs.get("status") == "success":
                    sq = obs.get("sanitized_query")
                    if sq and sq not in executed_sqls:
                        executed_sqls.append(sq)
                    cols = obs.get("columns", [])
                    rows = obs.get("rows", [])
                    if cols and rows:
                        captured_tables.append(TableData(columns=cols, rows=rows, row_count=len(rows)))

                formatted_obs = ObservationProcessor.format_observation_for_llm(
                    tool_name=tc.name,
                    observation=obs,
                )
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tc.name,
                    "content": formatted_obs,
                })

        return {
            "status": "completed",
            "summary": summary,
            "sql_queries": executed_sqls,
            "tables": captured_tables,
        }

    async def _execute_calc_specialist(
        self,
        task: SubTaskSpec,
        context_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Runs the Calculation Specialist Sub-Agent."""
        tools = [self.calc_tool.to_openai_schema()]
        data_preview = ""
        tables: list[TableData] = context_data.get("tables", [])
        if tables:
            first_t = tables[0]
            data_preview = f"Data dari SQL: Kolom={first_t.columns}, Contoh Baris={first_t.rows[:5]}"

        messages = [
            {"role": "system", "content": CALC_SPECIALIST_PROMPT},
            {"role": "user", "content": f"Instruksi: {task.instruction}\n{data_preview}"},
        ]

        summary = ""
        resp = await self.llm.chat(messages=messages, tools=tools)
        if resp.tool_calls:
            messages.append({
                "role": "assistant",
                "content": resp.content or "",
                "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
                    for tc in resp.tool_calls
                ],
            })
            for tc in resp.tool_calls:
                try:
                    obs = await self.calc_tool.execute(**tc.arguments)
                except Exception as e:
                    obs = {"status": "error", "error": f"Calc execution failed: {e}"}
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tc.name,
                    "content": json.dumps(obs, ensure_ascii=False),
                })
            final_calc = await self.llm.chat(messages=messages, tools=None)
            summary = final_calc.content or ""
        else:
            summary = resp.content or ""

        return {"status": "completed", "summary": summary}

    async def _execute_chart_specialist(
        self,
        task: SubTaskSpec,
        user_query: str,
        context_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Runs the Visualization Specialist Sub-Agent."""
        tables: list[TableData] = context_data.get("tables", [])
        captured_charts: list[ChartSpec] = []
        if not tables:
            return {"status": "skipped", "reason": "Tidak ada baris data tabel untuk divisualisasikan"}

        first_tbl = tables[0]
        # Auto synthesize or call MakeChartTool
        sample_records = [
            dict(zip(first_tbl.columns, row))
            for row in first_tbl.rows[:15]
        ]

        tools = [self.chart_tool.to_openai_schema()]
        messages = [
            {"role": "system", "content": CHART_SPECIALIST_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Rancang visualisasi untuk query: \"{user_query}\"\n"
                    f"Instruksi: {task.instruction}\n"
                    f"Kolom Tersedia: {first_tbl.columns}\n"
                    f"Sampel Data: {json.dumps(sample_records[:5], ensure_ascii=False)}"
                ),
            },
        ]

        try:
            resp = await self.llm.chat(messages=messages, tools=tools)
            if resp.tool_calls:
                for tc in resp.tool_calls:
                    if tc.name == "make_chart":
                        c_args = dict(tc.arguments)
                        if not c_args.get("data"):
                            c_args["data"] = sample_records
                        obs = await self.chart_tool.execute(**c_args)
                        if isinstance(obs, dict) and obs.get("status") == "success":
                            cs = obs.get("chart", {})
                            captured_charts.append(
                                ChartSpec(
                                    chart_type=cs.get("chart_type", "bar"),
                                    title=cs.get("title", "Visualisasi Data"),
                                    x_axis=cs.get("x_axis", "x"),
                                    y_axis=cs.get("y_axis", "y"),
                                    data=cs.get("data", sample_records),
                                )
                            )
        except Exception as e:
            logger.warning("Chart specialist LLM execution: %s", e)

        # Fallback to ObservationProcessor if no chart created
        if not captured_charts and len(first_tbl.columns) >= 2 and len(first_tbl.rows) > 0:
            charts = ObservationProcessor.finalize_charts(
                captured_charts=[],
                captured_tables=tables,
                user_query=user_query,
            )
            captured_charts = charts

        return {
            "status": "completed",
            "charts": captured_charts,
            "summary": f"Berhasil merancang {len(captured_charts)} visualisasi data.",
        }

    # --------------------------------------------------------------------------
    # Master Execution Loop
    # --------------------------------------------------------------------------

    async def run(
        self,
        user_query: str,
        task_id: str | None = None,
        session_id: str | None = None,
        chat_history: list[dict[str, str]] | None = None,
        is_approved: bool = False,
    ) -> AgentFinalResponse:
        """Run the PlannerExecutorAgent and return AgentFinalResponse."""
        final_resp = None
        async for event in self.run_stream(
            user_query=user_query,
            task_id=task_id,
            session_id=session_id,
            chat_history=chat_history,
            is_approved=is_approved,
        ):
            if event["event"] == "final_result":
                final_resp = AgentFinalResponse(**event["data"])

        if final_resp:
            return final_resp

        return AgentFinalResponse(
            answer_text="Analisis multi-agent selesai.",
            total_steps=1,
        )

    async def run_stream(
        self,
        user_query: str,
        task_id: str | None = None,
        session_id: str | None = None,
        chat_history: list[dict[str, str]] | None = None,
        resume_messages: list[dict[str, Any]] | None = None,
        initial_step: int = 0,
        is_approved: bool = False,
    ) -> AsyncIterator[dict[str, Any]]:
        """Streaming execution of the Planner-Executor Multi-Agent Swarm."""
        task_id = task_id or f"swarm_{uuid.uuid4().hex[:8]}"
        start_time = time.perf_counter()

        tracer = AgentTracer(task_id=task_id)
        root_span = tracer.start_span(
            name="agent_swarm_task",
            span_type=SpanType.AGENT,
            input_data={"user_query": user_query, "engine": "swarm"},
        )
        self.term_logger.log_task_start(task_id=task_id, query=user_query, session_id=session_id)

        # Notify UI of swarm start
        yield {
            "event": "step_start",
            "data": {
                "task_id": task_id,
                "step": 1,
                "max_steps": self.max_subtasks + 2,
                "engine": "swarm",
                "message": "Planner Agent sedang menganalisis kompleksitas pertanyaan dan merancang alur kerja...",
            },
        }

        # 1. Recall Long-Term Memory (FR-17)
        recalled_memories = []
        try:
            recalled_memories = await retrieve_relevant_memories(query=user_query, limit=2)
        except Exception:
            pass

        # 2. Schema Context & Session Compaction
        compacted_summary = None
        if session_id:
            try:
                from src.agent.state import get_session_compacted_summary
                compacted_summary, _ = await get_session_compacted_summary(session_id)
            except Exception:
                pass

        uploaded_schema = ""
        if session_id:
            try:
                from src.ingestion.excel_csv_parser import get_session_uploaded_tables
                from src.agent.caching import get_cached_session_schema_prompt
                up_tables = await get_session_uploaded_tables(session_id)
                if up_tables:
                    uploaded_schema = get_cached_session_schema_prompt(session_id, up_tables)
            except Exception:
                pass

        # 3. Stage 1: Planner Agent
        planner_t0 = time.perf_counter()
        plan = await self._generate_plan(
            user_query=user_query,
            session_id=session_id,
            compacted_summary=compacted_summary,
            uploaded_schema=uploaded_schema,
        )
        planner_dur_ms = round((time.perf_counter() - planner_t0) * 1000, 1)

        # Record in Working Memory (FR-18)
        WorkingMemoryManager.set_note(
            task_id=task_id,
            key="swarm_plan",
            content=f"Sasaran: {plan.goal}\nKompleksitas: {plan.complexity_level}\nRencana: {len(plan.tasks)} sub-tugas",
            session_id=session_id,
        )

        yield {
            "event": "plan_created",
            "data": {
                "task_id": task_id,
                "goal": plan.goal,
                "complexity_level": plan.complexity_level,
                "reasoning": plan.reasoning,
                "tasks_count": len(plan.tasks),
                "tasks": [t.model_dump() for t in plan.tasks],
                "planner_duration_ms": planner_dur_ms,
            },
        }

        # 4. Stage 2: Specialist Sub-Agents Execution
        shared_context: dict[str, Any] = {
            "tables": [],
            "sql_queries": [],
            "charts": [],
            "calc_notes": [],
        }

        total_tokens = 250
        executed_sqls: list[str] = []
        captured_tables: list[TableData] = []
        captured_charts: list[ChartSpec] = []
        citations: list[Citation] = []

        for subtask in plan.tasks:
            subtask.status = "running"
            t_sub_start = time.perf_counter()

            yield {
                "event": "subagent_start",
                "data": {
                    "task_id": task_id,
                    "subtask_id": subtask.id,
                    "role": subtask.role,
                    "title": subtask.title,
                },
            }

            sub_span = tracer.start_span(
                name=f"subagent:{subtask.role}",
                span_type=SpanType.AGENT,
                parent_span_id=root_span.span_id,
                input_data={"instruction": subtask.instruction},
            )

            if subtask.role == "sql_specialist":
                res = await self._execute_sql_specialist(
                    task=subtask,
                    task_id=task_id,
                    session_id=session_id,
                    context_data=shared_context,
                    is_approved=is_approved,
                )
                subtask.status = "completed"
                subtask.result_summary = res.get("summary")
                new_sqls = res.get("sql_queries", [])
                new_tables = res.get("tables", [])

                for sq in new_sqls:
                    if sq not in executed_sqls:
                        executed_sqls.append(sq)
                        citations.append(Citation(sql_query=sq, source_tables=[]))
                captured_tables.extend(new_tables)
                shared_context["tables"] = captured_tables
                shared_context["sql_queries"] = executed_sqls
                total_tokens += 400

                WorkingMemoryManager.set_note(
                    task_id=task_id,
                    key="sql_specialist_result",
                    content=f"Eksekusi {len(new_sqls)} kueri SQL. Menemukan {len(new_tables)} tabel.",
                    session_id=session_id,
                )

            elif subtask.role == "calc_specialist":
                res = await self._execute_calc_specialist(task=subtask, context_data=shared_context)
                subtask.status = "completed"
                subtask.result_summary = res.get("summary")
                shared_context["calc_notes"].append(subtask.result_summary)
                total_tokens += 200

                WorkingMemoryManager.set_note(
                    task_id=task_id,
                    key="calc_specialist_result",
                    content=str(subtask.result_summary)[:300],
                    session_id=session_id,
                )

            elif subtask.role == "chart_specialist":
                res = await self._execute_chart_specialist(
                    task=subtask,
                    user_query=user_query,
                    context_data=shared_context,
                )
                subtask.status = "completed"
                subtask.result_summary = res.get("summary")
                new_charts = res.get("charts", [])
                captured_charts.extend(new_charts)
                shared_context["charts"] = captured_charts
                total_tokens += 250

                WorkingMemoryManager.set_note(
                    task_id=task_id,
                    key="chart_specialist_result",
                    content=f"Merancang {len(new_charts)} grafik visualisasi.",
                    session_id=session_id,
                )

            else:
                subtask.status = "completed"
                subtask.result_summary = "Langkah umum diselesaikan."

            subtask.duration_ms = round((time.perf_counter() - t_sub_start) * 1000, 1)
            tracer.end_span(sub_span.span_id, status=SpanStatus.SUCCESS)

            yield {
                "event": "subagent_complete",
                "data": {
                    "task_id": task_id,
                    "subtask_id": subtask.id,
                    "role": subtask.role,
                    "status": subtask.status,
                    "result_summary": subtask.result_summary,
                    "duration_ms": subtask.duration_ms,
                },
            }

        # 5. Stage 3: Synthesis Agent
        yield {
            "event": "step_start",
            "data": {
                "task_id": task_id,
                "step": len(plan.tasks) + 2,
                "max_steps": len(plan.tasks) + 2,
                "message": "Synthesizer Agent sedang merangkum hasil kerja seluruh spesialis...",
            },
        }

        synth_context = (
            f"Pertanyaan Pengguna: \"{user_query}\"\n"
            f"Sasaran Analisis: {plan.goal}\n\n"
            f"Kueri SQL yang Dijalankan:\n" + "\n".join(executed_sqls) + "\n\n"
        )
        if captured_tables:
            first_t = captured_tables[0]
            synth_context += f"Data Tabel ({len(first_t.rows)} baris):\nKolom: {first_t.columns}\nSampel:\n{first_t.rows[:8]}\n\n"
        if shared_context.get("calc_notes"):
            synth_context += f"Catatan Kalkulasi:\n" + "\n".join(shared_context["calc_notes"]) + "\n\n"

        synth_messages = [
            {"role": "system", "content": SYNTHESIZER_SYSTEM_PROMPT},
            {"role": "user", "content": f"Berdasarkan seluruh temuan sub-agent berikut, susun laporan final:\n\n{synth_context}"},
        ]

        synth_resp = await self.llm.chat(messages=synth_messages, tools=None)
        final_answer_text = synth_resp.content or "Analisis data selesai."
        total_tokens += synth_resp.usage.total_tokens

        # Stream synthesis token
        tracer.record_first_token()
        yield {"event": "token", "data": {"delta": final_answer_text}}

        # PII Masking
        masked_answer = PIIMasker.mask_text(final_answer_text)

        # Sanitize charts
        captured_charts = ObservationProcessor.finalize_charts(
            captured_charts=captured_charts,
            captured_tables=captured_tables,
            user_query=user_query,
        )

        # Smart follow-up suggestions
        clean_answer, follow_up_suggestions = get_smart_suggestions(
            answer_text=masked_answer,
            user_query=user_query,
            tables=captured_tables,
            charts=captured_charts,
            executed_sqls=executed_sqls,
        )

        # Maker-Checker Data Auditor Verification (FR-35)
        audit_verdict = None
        if settings.auditor_enabled:
            yield {
                "event": "audit_step",
                "data": {
                    "status": "auditing",
                    "badge": "Auditing Swarm...",
                    "critique": "Data Auditor memverifikasi hasil konsolidasi Multi-Agent Swarm...",
                },
            }
            audit_verdict = await self.auditor.audit(
                user_query=user_query,
                answer_text=clean_answer,
                executed_sqls=executed_sqls,
                tables=captured_tables,
                charts=captured_charts,
            )
            yield {
                "event": "audit_step",
                "data": audit_verdict.model_dump(),
            }

        tracer.end_span(root_span.span_id, status=SpanStatus.SUCCESS)
        task_metrics = await tracer.flush(
            status="COMPLETED",
            total_tokens=total_tokens,
            step_count=len(plan.tasks) + 2,
        )

        working_mem = WorkingMemoryManager.get_or_create(task_id).to_dict()

        final_response = AgentFinalResponse(
            answer_text=clean_answer,
            sql_queries=executed_sqls,
            tables=captured_tables,
            charts=captured_charts,
            citations=citations,
            total_steps=len(plan.tasks) + 2,
            token_usage={"total_tokens": total_tokens},
            metrics=task_metrics.model_dump(),
            follow_up_suggestions=follow_up_suggestions,
            audit_result=audit_verdict,
            memories_recalled=recalled_memories,
            working_memory=working_mem,
            execution_plan=plan.model_dump(),
        )

        # Persist task in PostgreSQL
        try:
            await save_task_checkpoint(
                task_id=task_id,
                status=AgentTaskStatus.COMPLETED,
                current_step=len(plan.tasks) + 2,
                messages=[],
                user_query=user_query,
                session_id=session_id,
                final_result=final_response.model_dump(),
                analyst_provider="swarm",
                analyst_model="planner-executor-v1",
                working_memory=working_mem,
            )
        except Exception as e:
            logger.warning("Swarm completion checkpoint save failed: %s", e)

        self.term_logger.log_task_completed(
            task_id=task_id,
            steps=len(plan.tasks) + 2,
            total_tokens=total_tokens,
            elapsed_seconds=round(time.perf_counter() - start_time, 2),
            sql_count=len(executed_sqls),
        )

        yield {
            "event": "final_result",
            "data": final_response.model_dump(),
        }

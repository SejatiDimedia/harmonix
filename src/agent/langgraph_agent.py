"""LangGraph-based Agent implementation for Text-to-SQL Analytics (FR-03).

Provides framework-based comparison with the manual agent loop, sharing the exact
same tools, guardrails, PII masking, metrics glossary, and structured output.
"""

import logging
import uuid
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from src.agent.models import (
    AgentFinalResponse,
    AgentTaskStatus,
    Citation,
    TableData,
)
from src.agent.state import save_task_checkpoint
from src.config import settings
from src.llm.provider import BaseLLMProvider, ToolCall, get_llm_provider
from src.tools.base import BaseTool
from src.tools.database import GetSchemaTool, RunSQLTool
from src.tools.glossary import SearchGlossaryTool
from src.tools.guardrails import SQLGuardrail, SQLValidationError
from src.tools.pii import PIIMasker
from src.tools.sandbox import CalculateTool

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Anda adalah Senior Data Analyst AI Agent profesional (versi LangGraph).
Tugas Anda adalah menjawab pertanyaan analitik database secara akurat, berbasis data, dan terstruktur.

DATABASE SCHEMA OVERVIEW:
Database analitik PostgreSQL memiliki skema `analytics` dengan tabel-tabel berikut:
- `analytics.orders`: Informasi transaksi pesanan (order_id, customer_id, order_status, order_purchase_timestamp, order_delivered_timestamp)
- `analytics.order_items`: Rincian item per pesanan (order_id, order_item_id, product_id, price, freight_value)
- `analytics.products`: Master katalog produk (product_id, product_category_name, price, weight_g)
- `analytics.customers`: Master data pelanggan (customer_id, customer_unique_id, customer_name, email, phone_number, city, state)
- `analytics.order_payments`: Transaksi pembayaran (order_id, payment_sequential, payment_type, payment_installments, payment_value)
- `analytics.reviews`: Review dan rating pelanggan (review_id, order_id, review_score, review_comment_message)

RELASI ANTAR TABEL (RELATIONAL JOIN PATHS):
- `customers` ke `orders`: `customers.customer_id = orders.customer_id`
- `orders` ke `order_items`: `orders.order_id = order_items.order_id`
- `order_items` ke `products`: `order_items.product_id = products.product_id`
- `orders` ke `order_payments`: `orders.order_id = order_payments.order_id`
- `orders` ke `reviews`: `orders.order_id = reviews.order_id`

LOKASI KOLOM KEUANGAN & TOTAL BELANJA:
- Tabel `analytics.orders` HANYA berisi status dan tanggal pesanan, TIDAK MEMILIKI kolom harga/order_value/order_total/total_order_value!
- Nilai pembayaran transaksi pelanggan disimpan di tabel `analytics.order_payments` pada kolom `payment_value`.
- Harga per item barang disimpan di tabel `analytics.order_items` pada kolom `price`.
- Untuk mencari pelanggan yang belanja lebih dari X (misal > 500.000):
  Hubungkan `customers` -> `orders` -> `order_payments` dan gunakan `GROUP BY` dengan klausa `HAVING`, BUKAN `WHERE`:
  SELECT c.customer_name, c.city, c.email, SUM(op.payment_value) AS total_belanja
  FROM analytics.customers c
  JOIN analytics.orders o ON c.customer_id = o.customer_id
  JOIN analytics.order_payments op ON o.order_id = op.order_id
  GROUP BY c.customer_id, c.customer_name, c.city, c.email
  HAVING SUM(op.payment_value) > 500000

ATURAN AGREGASI SQL POSTGRESQL:
- DILARANG menggunakan fungsi agregasi seperti SUM(), COUNT(), AVG() di dalam klausa WHERE! (Contoh salah: WHERE SUM(...) > 500000).
- Fungsi agregasi WAJIB diletakkan di klausa HAVING setelah GROUP BY! (Contoh benar: GROUP BY c.customer_id, c.customer_name, c.city, c.email HAVING SUM(op.payment_value) > 500000).

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
1. Metric Grounding & Business Glossary:
   - Jika pertanyaan pengguna mengandung istilah bisnis (GMV, Delivered Rate, AOV, Pelanggan Aktif, dsb), panggil tool `search_glossary`.
2. Grounding & Schema Discovery:
   - Jangan menebak skema tabel. Gunakan `get_schema` untuk memeriksa tabel dan kolom yang relevan jika belum yakin dengan struktur kolom.
3. Safe SQL Generation:
   - Tulis HANYA query SELECT yang valid untuk dialek PostgreSQL.
   - Dilarang keras melakukan operasi penulisan (INSERT, UPDATE, DELETE, DROP, ALTER, dsb).
   - Hindari query berisiko tanpa batas limit.
4. Perhitungan Tambahan & Sandbox:
   - Gunakan tool `calculate` untuk perhitungan statistik atau Python rumit.
5. Eksekusi & Observasi:
   - Gunakan `run_sql` untuk mengeksekusi query. Jika error, perbaiki di iterasi berikutnya.
6. Jawaban Akhir:
   - Sajikan temuan kunci secara jelas dan sertakan sitasi metrik/SQL.
"""


class LangGraphAgentState(TypedDict, total=False):
    """Explicit state dictionary used by LangGraph StateGraph."""
    task_id: str
    session_id: str
    user_query: str
    chat_history: list[dict[str, str]]
    messages: list[dict[str, Any]]
    current_step: int
    max_steps: int
    citations: list[dict[str, Any]]
    sql_queries: list[str]
    tables: list[dict[str, Any]]
    tool_calls: list[dict[str, Any]]
    requires_approval: bool
    approval_reason: str | None
    is_approved: bool
    is_completed: bool
    final_answer: str | None
    error: str | None
    status: str


class LangGraphAgent:
    """Production-grade Agent implemented with LangGraph (FR-03)."""

    def __init__(
        self,
        llm: BaseLLMProvider | None = None,
        tools: list[BaseTool] | None = None,
        max_steps: int | None = None,
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
        self.guardrail = SQLGuardrail()
        self.graph = self._build_graph()

    def _build_graph(self):
        """Constructs the LangGraph state machine workflow."""
        workflow = StateGraph(LangGraphAgentState)

        # Add Nodes
        workflow.add_node("plan_node", self._plan_node)
        workflow.add_node("reason_node", self._reason_node)
        workflow.add_node("action_node", self._action_node)
        workflow.add_node("synthesize_node", self._synthesize_node)

        # Add Edges
        workflow.add_edge(START, "plan_node")
        workflow.add_edge("plan_node", "reason_node")

        workflow.add_conditional_edges(
            "reason_node",
            self._route_after_reason,
            {
                "action": "action_node",
                "synthesize": "synthesize_node",
                "approval_halt": END,
            },
        )

        workflow.add_conditional_edges(
            "action_node",
            self._route_after_action,
            {
                "reason": "reason_node",
                "synthesize": "synthesize_node",
                "approval_halt": END,
            },
        )

        workflow.add_edge("synthesize_node", END)

        return workflow.compile()

    # ==========================================================================
    # Graph Nodes
    # ==========================================================================

    async def _plan_node(self, state: LangGraphAgentState) -> LangGraphAgentState:
        """Initial planning node: sets up system prompt, short-term history, and grounded context."""
        state["current_step"] = state.get("current_step", 0) + 1
        state["status"] = AgentTaskStatus.RUNNING.value

        messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]

        # Inject multi-turn short-term memory
        chat_history = state.get("chat_history") or []
        for turn in chat_history[-5:]:
            messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})

        messages.append({"role": "user", "content": state["user_query"]})
        state["messages"] = messages
        state["citations"] = state.get("citations") or []
        state["sql_queries"] = state.get("sql_queries") or []
        state["tables"] = state.get("tables") or []
        state["tool_calls"] = []
        state["requires_approval"] = False
        state["is_completed"] = False

        return state

    async def _reason_node(self, state: LangGraphAgentState) -> LangGraphAgentState:
        """Reasoning node: invokes LLM to formulate plan, choose tools, or formulate final answer."""
        state["current_step"] = state.get("current_step", 0) + 1

        response = await self.llm.chat(
            messages=state["messages"],
            tools=self.openai_tools,
            temperature=0.0,
        )

        # Check if LLM requested tool calls
        if response.tool_calls:
            state["tool_calls"] = [
                {"id": tc.id or f"call_{uuid.uuid4().hex[:6]}", "name": tc.name, "arguments": tc.arguments}
                for tc in response.tool_calls
            ]
            # Append assistant message with tool calls to history
            state["messages"].append({
                "role": "assistant",
                "content": response.content or "",
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": str(tc["arguments"])},
                    }
                    for tc in state["tool_calls"]
                ],
            })
        else:
            state["tool_calls"] = []
            state["final_answer"] = response.content
            state["is_completed"] = True
            state["messages"].append({"role": "assistant", "content": response.content or ""})

        return state

    async def _action_node(self, state: LangGraphAgentState) -> LangGraphAgentState:
        """Action node: safely executes tool calls with AST Guardrail, Approval Gate, and PII Masking."""
        tool_calls = state.get("tool_calls", [])

        for tc in tool_calls:
            tool_name = tc["name"]
            tool_args = tc.get("arguments", {})
            tool_call_id = tc["id"]

            tool = self.tools.get(tool_name)
            if not tool:
                obs = f"Error: Tool '{tool_name}' tidak dikenal."
                state["messages"].append({"role": "tool", "tool_call_id": tool_call_id, "name": tool_name, "content": obs})
                continue

            # Special Guardrail & Approval Handling for SQL Execution (FR-20, FR-25)
            if tool_name == "run_sql":
                query_str = tool_args.get("query", "")
                try:
                    sanitized_sql = self.guardrail.validate_and_sanitize(query_str)
                except SQLValidationError as e:
                    obs = f"AST Guardrail Error: Query ditolak: {e}"
                    state["messages"].append({"role": "tool", "tool_call_id": tool_call_id, "name": tool_name, "content": obs})
                    continue

                risk = self.guardrail.assess_risk(query_str)
                if risk.requires_approval and not state.get("is_approved"):
                    # Approval Gate Triggered!
                    state["requires_approval"] = True
                    reasons = "; ".join(risk.risk_reasons) if risk.risk_reasons else "Query berisiko tinggi memerlukan persetujuan analis."
                    state["approval_reason"] = reasons
                    state["status"] = AgentTaskStatus.WAITING_APPROVAL.value
                    logger.warning(
                        "LangGraph Agent Task %s paused for approval: %s",
                        state["task_id"],
                        state["approval_reason"],
                    )
                    return state

                # Query is safe or approved -> Execute
                result = await tool.execute(query=sanitized_sql, is_approved=state.get("is_approved", False))
                if isinstance(result, dict) and result.get("status") == "error":
                    obs = f"SQL Execution Error: {result.get('message')}"
                elif isinstance(result, dict) and result.get("status") == "approval_required":
                    state["requires_approval"] = True
                    state["approval_reason"] = "; ".join(result.get("risk_reasons", [])) or result.get("message", "Approval required")
                    state["status"] = AgentTaskStatus.WAITING_APPROVAL.value
                    return state
                elif isinstance(result, dict) and result.get("status") == "success":
                    cols = result.get("columns", [])
                    raw_rows = result.get("rows", [])
                    state["sql_queries"].append(sanitized_sql)

                    table_rows = [list(r) for r in raw_rows] if raw_rows else []
                    state["tables"].append({
                        "columns": cols,
                        "rows": table_rows,
                        "row_count": len(table_rows),
                    })
                    # Preview dict for observation
                    sample_dict = [dict(zip(cols, row)) for row in raw_rows[:10]]
                    obs = str(sample_dict)
                    state["citations"].append({"sql_query": sanitized_sql, "source_tables": []})
                else:
                    obs = str(result)

            elif tool_name == "search_glossary":
                result = await tool.execute(**tool_args)
                obs = str(result)
                if isinstance(result, list):
                    for item in result:
                        state["citations"].append({
                            "sql_query": item.get("approved_sql_formula", ""),
                            "metric_definition": f"{item.get('metric_name')}: {item.get('business_definition')}",
                        })

            elif tool_name == "calculate":
                result = await tool.execute(**tool_args)
                if isinstance(result, dict) and result.get("status") == "success":
                    obs = f"Calculation result: {result.get('result')}"
                else:
                    obs = str(result.get("message") if isinstance(result, dict) else result)

            else:
                result = await tool.execute(**tool_args)
                obs = str(result)

            state["messages"].append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": tool_name,
                "content": obs,
            })

        state["tool_calls"] = []
        return state

    async def _synthesize_node(self, state: LangGraphAgentState) -> LangGraphAgentState:
        """Synthesis node: finalizes structured output and citations."""
        state["status"] = AgentTaskStatus.COMPLETED.value
        state["is_completed"] = True
        return state

    # ==========================================================================
    # Conditional Edge Routers
    # ==========================================================================

    def _route_after_reason(self, state: LangGraphAgentState) -> str:
        if state.get("requires_approval"):
            return "approval_halt"
        if state.get("tool_calls"):
            return "action"
        if state.get("is_completed") or state.get("current_step", 0) >= state.get("max_steps", 10):
            return "synthesize"
        return "synthesize"

    def _route_after_action(self, state: LangGraphAgentState) -> str:
        if state.get("requires_approval"):
            return "approval_halt"
        if state.get("current_step", 0) >= state.get("max_steps", 10):
            return "synthesize"
        return "reason"

    # ==========================================================================
    # Public Execution APIs
    # ==========================================================================

    async def run(
        self,
        user_query: str,
        task_id: str | None = None,
        session_id: str | None = None,
        chat_history: list[dict[str, str]] | None = None,
        is_approved: bool = False,
    ) -> AgentFinalResponse:
        """Runs the LangGraph agent and returns a structured AgentFinalResponse (FR-09)."""
        tid = task_id or f"langgraph_{uuid.uuid4().hex[:8]}"
        sid = session_id or "default_session"

        initial_state: LangGraphAgentState = {
            "task_id": tid,
            "session_id": sid,
            "user_query": user_query,
            "chat_history": chat_history or [],
            "messages": [],
            "current_step": 0,
            "max_steps": self.max_steps,
            "citations": [],
            "sql_queries": [],
            "tables": [],
            "tool_calls": [],
            "requires_approval": False,
            "approval_reason": None,
            "is_approved": is_approved,
            "is_completed": False,
            "final_answer": None,
            "error": None,
            "status": AgentTaskStatus.PENDING.value,
        }

        final_state = await self.graph.ainvoke(initial_state)

        # Convert state to AgentFinalResponse
        tables = [
            TableData(
                columns=t.get("columns", []),
                rows=t.get("rows", []),
                row_count=t.get("row_count", 0),
            )
            for t in final_state.get("tables", [])
        ]

        citations = [
            Citation(
                sql_query=c.get("sql_query", ""),
                metric_definition=c.get("metric_definition"),
                source_tables=c.get("source_tables", []),
            )
            for c in final_state.get("citations", [])
            if c.get("sql_query") or c.get("metric_definition")
        ]

        answer_text = final_state.get("final_answer") or ""
        if final_state.get("requires_approval"):
            answer_text = f"PERHATIAN: Query membutuhkan persetujuan human-in-the-loop: {final_state.get('approval_reason')}"

        return AgentFinalResponse(
            answer_text=answer_text,
            sql_queries=final_state.get("sql_queries", []),
            tables=tables,
            citations=citations,
            total_steps=final_state.get("current_step", 0),
            token_usage={"total_tokens": final_state.get("current_step", 0) * 80},
        )

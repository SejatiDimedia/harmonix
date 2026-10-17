"""LangGraph-based Agent implementation for Text-to-SQL Analytics (FR-03).

Provides framework-based comparison with the manual agent loop, sharing the exact
same tools, guardrails, PII masking, metrics glossary, and structured output.
"""

import logging
import time
import uuid
from typing import Any, AsyncIterator, TypedDict

from langgraph.graph import END, START, StateGraph

from src.agent.execution_logger import TerminalExecutionLogger
from src.agent.models import (
    AgentFinalResponse,
    AgentTaskStatus,
    Citation,
    TableData,
)
from src.agent.prompts import BASE_ANALYST_SYSTEM_PROMPT
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

SYSTEM_PROMPT = BASE_ANALYST_SYSTEM_PROMPT



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
        term_logger: TerminalExecutionLogger | None = None,
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
        self.term_logger = term_logger or TerminalExecutionLogger()
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
        self.term_logger.log_step_start(step=state["current_step"], max_steps=self.max_steps, elapsed_seconds=0.0)

        response = await self.llm.chat(
            messages=state["messages"],
            tools=self.openai_tools,
            temperature=0.0,
        )

        if response.content:
            self.term_logger.log_thought(response.content)

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

            self.term_logger.log_tool_trigger(tool_name=tool_name, tool_args=tool_args)
            t0 = time.perf_counter()

            tool = self.tools.get(tool_name)
            if not tool:
                obs = f"Error: Tool '{tool_name}' tidak dikenal."
                self.term_logger.log_tool_result(tool_name=tool_name, observation={"error": obs}, duration_ms=round((time.perf_counter() - t0) * 1000, 1))
                state["messages"].append({"role": "tool", "tool_call_id": tool_call_id, "name": tool_name, "content": obs})
                continue

            # Special Guardrail & Approval Handling for SQL Execution (FR-20, FR-25)
            if tool_name == "run_sql":
                query_str = tool_args.get("query", "")
                try:
                    sanitized_sql = self.guardrail.validate_and_sanitize(query_str)
                except SQLValidationError as e:
                    obs = f"AST Guardrail Error: Query ditolak: {e}"
                    self.term_logger.log_tool_result(tool_name=tool_name, observation={"error": str(e)}, duration_ms=round((time.perf_counter() - t0) * 1000, 1))
                    state["messages"].append({"role": "tool", "tool_call_id": tool_call_id, "name": tool_name, "content": obs})
                    continue

                risk = self.guardrail.assess_risk(query_str)
                if risk.requires_approval and not state.get("is_approved"):
                    # Approval Gate Triggered!
                    state["requires_approval"] = True
                    reasons = "; ".join(risk.risk_reasons) if risk.risk_reasons else "Query berisiko tinggi memerlukan persetujuan analis."
                    state["approval_reason"] = reasons
                    state["status"] = AgentTaskStatus.WAITING_APPROVAL.value
                    self.term_logger.log_approval_required(
                        approval_id="approval_gate",
                        query=query_str,
                        reasons=risk.risk_reasons or [reasons],
                    )
                    logger.warning(
                        "LangGraph Agent Task %s paused for approval: %s",
                        state["task_id"],
                        state["approval_reason"],
                    )
                    return state

                # Query is safe or approved -> Execute
                result = await tool.execute(query=sanitized_sql, is_approved=state.get("is_approved", False))
                dur_ms = round((time.perf_counter() - t0) * 1000, 1)
                self.term_logger.log_tool_result(tool_name=tool_name, observation=result, duration_ms=dur_ms)
                if isinstance(result, dict) and result.get("status") == "error":
                    obs = f"SQL Execution Error: {result.get('message')}"
                elif isinstance(result, dict) and result.get("status") == "approval_required":
                    state["requires_approval"] = True
                    state["approval_reason"] = "; ".join(result.get("risk_reasons", [])) or result.get("message", "Approval required")
                    state["status"] = AgentTaskStatus.WAITING_APPROVAL.value
                    self.term_logger.log_approval_required(
                        approval_id="approval_gate",
                        query=query_str,
                        reasons=result.get("risk_reasons", [state["approval_reason"]]),
                    )
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
                dur_ms = round((time.perf_counter() - t0) * 1000, 1)
                self.term_logger.log_tool_result(tool_name=tool_name, observation=result, duration_ms=dur_ms)
                obs = str(result)
                metrics_list = []
                if isinstance(result, dict):
                    metrics_list = result.get("metrics", [])
                elif isinstance(result, list):
                    metrics_list = result
                for item in metrics_list:
                    state["citations"].append({
                        "sql_query": item.get("recommended_sql") or item.get("approved_sql_formula", ""),
                        "metric_definition": f"{item.get('metric_name')}: {item.get('business_definition', '')} (Formula: {item.get('calculation_formula', '')})",
                        "source_tables": item.get("relevant_tables", []),
                    })

            elif tool_name == "calculate":
                result = await tool.execute(**tool_args)
                dur_ms = round((time.perf_counter() - t0) * 1000, 1)
                self.term_logger.log_tool_result(tool_name=tool_name, observation=result, duration_ms=dur_ms)
                if isinstance(result, dict) and result.get("status") == "success":
                    obs = f"Calculation result: {result.get('result')}"
                else:
                    obs = str(result.get("message") if isinstance(result, dict) else result)

            else:
                result = await tool.execute(**tool_args)
                dur_ms = round((time.perf_counter() - t0) * 1000, 1)
                self.term_logger.log_tool_result(tool_name=tool_name, observation=result, duration_ms=dur_ms)
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
        self.term_logger.log_synthesizing()
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
        start_time = time.perf_counter()

        self.term_logger.log_task_start(task_id=tid, query=user_query, session_id=sid)

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

        self.term_logger.log_task_completed(
            task_id=tid,
            steps=final_state.get("current_step", 0),
            total_tokens=final_state.get("current_step", 0) * 80,
            elapsed_seconds=round(time.perf_counter() - start_time, 2),
            sql_count=len(final_state.get("sql_queries", [])),
        )

        return AgentFinalResponse(
            answer_text=answer_text,
            sql_queries=final_state.get("sql_queries", []),
            tables=tables,
            citations=citations,
            total_steps=final_state.get("current_step", 0),
            token_usage={"total_tokens": final_state.get("current_step", 0) * 80},
        )

    async def run_stream(
        self,
        user_query: str,
        task_id: str | None = None,
        session_id: str | None = None,
        chat_history: list[dict[str, str]] | None = None,
        is_approved: bool = False,
    ) -> AsyncIterator[dict[str, Any]]:
        """Runs the LangGraph agent and yields streaming SSE events."""
        tid = task_id or f"langgraph_{uuid.uuid4().hex[:8]}"
        sid = session_id or "default_session"
        start_time = time.perf_counter()

        self.term_logger.log_task_start(task_id=tid, query=user_query, session_id=sid)

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

        # Save initial checkpoint
        try:
            await save_task_checkpoint(
                task_id=tid,
                status=AgentTaskStatus.RUNNING,
                current_step=1,
                messages=[],
                user_query=user_query,
                session_id=sid,
            )
        except Exception as e:
            logger.debug("LangGraph checkpoint error: %s", e)

        yield {
            "event": "step_start",
            "data": {
                "task_id": tid,
                "step": 1,
                "max_steps": self.max_steps,
                "elapsed_seconds": 0.01,
            },
        }

        final_state = await self.graph.ainvoke(initial_state)

        # Check if task paused on approval gate
        if final_state.get("requires_approval"):
            approval_id = f"appr_{uuid.uuid4().hex[:8]}"
            approval_payload = {
                "approval_id": approval_id,
                "task_id": tid,
                "step": final_state.get("current_step", 1),
                "sanitized_query": (final_state.get("sql_queries") or [""])[-1],
                "risk_reasons": [final_state.get("approval_reason", "Persetujuan diperlukan")],
            }
            try:
                await save_task_checkpoint(
                    task_id=tid,
                    status=AgentTaskStatus.WAITING_APPROVAL,
                    current_step=final_state.get("current_step", 1),
                    messages=final_state.get("messages", []),
                    user_query=user_query,
                    session_id=sid,
                    pending_approval=approval_payload,
                )
            except Exception as e:
                logger.warning("LangGraph approval save failed: %s", e)

            yield {
                "event": "approval_required",
                "data": approval_payload,
            }
            return

        # If answer is available, stream text token
        answer_text = final_state.get("final_answer") or ""
        masked_answer = PIIMasker.mask_text(answer_text)
        if masked_answer:
            yield {
                "event": "token",
                "data": {"delta": masked_answer},
            }

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

        elapsed_sec = round(time.perf_counter() - start_time, 2)
        total_toks = final_state.get("current_step", 1) * 80

        final_response = AgentFinalResponse(
            answer_text=masked_answer,
            sql_queries=final_state.get("sql_queries", []),
            tables=tables,
            citations=citations,
            total_steps=final_state.get("current_step", 1),
            token_usage={"total_tokens": total_toks},
            metrics={"total_latency_ms": int(elapsed_sec * 1000), "total_tokens": total_toks},
        )

        try:
            await save_task_checkpoint(
                task_id=tid,
                status=AgentTaskStatus.COMPLETED,
                current_step=final_state.get("current_step", 1),
                messages=final_state.get("messages", []),
                user_query=user_query,
                session_id=sid,
                final_result=final_response.model_dump(),
            )
        except Exception as e:
            logger.warning("LangGraph completion save failed: %s", e)

        self.term_logger.log_task_completed(
            task_id=tid,
            steps=final_state.get("current_step", 1),
            total_tokens=total_toks,
            elapsed_seconds=elapsed_sec,
            sql_count=len(final_state.get("sql_queries", [])),
        )

        yield {
            "event": "final_result",
            "data": final_response.model_dump(),
        }

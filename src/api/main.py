"""FastAPI application with SSE streaming, state persistence, checkpointing, and HITL endpoints."""

import json
import logging
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from contextlib import asynccontextmanager
from sse_starlette.sse import EventSourceResponse

STATIC_INDEX_PATH = Path(__file__).parent / "static" / "index.html"

from src.agent.langgraph_agent import LangGraphAgent
from src.agent.manual_loop import ManualAgentLoop
from src.agent.models import AgentTaskStatus
from src.agent.state import get_task_record, get_task_by_approval_id, save_task_checkpoint, init_task_state_table
from src.config import settings
from src.db.connection import check_db_health
from src.rag.glossary import seed_glossary_if_empty
from src.tools.database import RunSQLTool

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("harnessly.api")


from src.observability.metrics import get_system_metrics_summary
from src.observability.tracer import init_traces_table


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle events: seed metric glossary, init state tables, and traces table on startup."""
    try:
        if await check_db_health():
            await seed_glossary_if_empty()
            await init_task_state_table()
            await init_traces_table()
            logger.info("Auto-seeded metric glossary and initialized state/trace tables at startup.")
    except Exception as e:
        logger.warning("Startup initialization error: %s", e)
    yield


app = FastAPI(
    title="Harnessly Data Analyst Agent API",
    description="Production-grade text-to-SQL agent with full harness, guardrails, state persistence, and SSE streaming.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# In-memory approval store for pending HITL requests
pending_approvals: dict[str, dict] = {}


# ==============================================================================
# Request / Response Schemas
# ==============================================================================

class ChatRequest(BaseModel):
    query: str = Field(..., description="User analytics question in natural language (Indonesian or English)")
    task_id: str | None = Field(default=None, description="Optional custom task tracking ID")
    session_id: str | None = Field(default=None, description="Optional conversation session ID")
    engine: Literal["manual", "langgraph"] = Field(
        default="manual",
        description="Orchestrator engine: 'manual' (ManualAgentLoop) or 'langgraph' (LangGraphAgent)",
    )


class ApprovalRequest(BaseModel):
    decision: Literal["approved", "rejected"] = Field(..., description="Approval decision")
    reason: str | None = Field(default=None, description="Optional feedback or rejection reason")


class ResumeTaskRequest(BaseModel):
    feedback: str | None = Field(default=None, description="Optional feedback or guidance for resuming agent")


# ==============================================================================
# Endpoints
# ==============================================================================

@app.get("/health", tags=["System"])
async def health_check():
    """Service health check verifying database and provider status."""
    db_ok = await check_db_health()
    return {
        "status": "healthy" if db_ok else "degraded",
        "database_connected": db_ok,
        "llm_provider": settings.llm_provider,
        "environment": settings.app_env,
    }


@app.get("/v1/metrics", tags=["Observability"])
async def get_metrics():
    """Retrieve aggregated observability metrics, p50/p95 latency, tokens, and drift detection (OB-02, OB-03, OB-04)."""
    return await get_system_metrics_summary()


@app.post("/v1/chat", tags=["Agent"])
async def chat_stream(request: ChatRequest):
    """Send question to the agent and receive real-time SSE stream events:

    Supports dynamic orchestrator selection via `request.engine`:
    - `manual`: Procedural ManualAgentLoop
    - `langgraph`: LangGraph StateGraph Agent
    """
    if request.engine == "langgraph":
        agent_runner = LangGraphAgent()
        stream_iter = agent_runner.run_stream(
            user_query=request.query,
            task_id=request.task_id,
            session_id=request.session_id,
        )
    else:
        agent_runner = ManualAgentLoop()
        stream_iter = agent_runner.run(
            user_query=request.query,
            task_id=request.task_id,
            session_id=request.session_id,
        )

    async def event_generator():
        try:
            async for event in stream_iter:
                # If approval required, store in pending store
                if event["event"] == "approval_required":
                    appr_data = event["data"]
                    appr_id = appr_data.get("approval_id")
                    if appr_id:
                        pending_approvals[appr_id] = appr_data

                yield {
                    "event": event["event"],
                    "data": json.dumps(event["data"], ensure_ascii=False),
                }
        except Exception as e:
            logger.error("Error in chat event generator: %s", e)
            yield {
                "event": "error",
                "data": json.dumps({"message": f"Server error: {e}"}),
            }

    return EventSourceResponse(event_generator())


@app.get("/v1/tasks/{task_id}", tags=["Agent"])
async def get_task(task_id: str):
    """Retrieve current state, checkpoints, or final result of an agent task."""
    record = await get_task_record(task_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")
    return record.model_dump()


@app.post("/v1/approvals/{approval_id}", tags=["Agent"])
async def submit_approval(approval_id: str, request: ApprovalRequest):
    """Approve or reject a risky query that triggered the human-in-the-loop approval gate."""
    item = pending_approvals.get(approval_id)
    if not item:
        # Fallback: check PostgreSQL state table in case server was restarted during pending approval
        record = await get_task_by_approval_id(approval_id)
        if record and record.pending_approval:
            item = record.pending_approval
            pending_approvals[approval_id] = item
        else:
            raise HTTPException(status_code=404, detail="Approval request not found or expired.")

    item["decision"] = request.decision
    item["reason"] = request.reason

    task_id = item.get("task_id")
    if task_id:
        record = await get_task_record(task_id)
        if record and record.pending_approval:
            record.pending_approval["decision"] = request.decision
            record.pending_approval["reason"] = request.reason
            await save_task_checkpoint(
                task_id=task_id,
                status=AgentTaskStatus.RESUMED if request.decision == "approved" else AgentTaskStatus.WAITING_APPROVAL,
                current_step=record.current_step,
                messages=record.messages,
                user_query=record.user_query,
                session_id=record.session_id,
                pending_approval=record.pending_approval,
            )

    return {
        "approval_id": approval_id,
        "status": "processed",
        "decision": request.decision,
        "task_id": task_id,
    }


@app.post("/v1/tasks/{task_id}/resume", tags=["Agent"])
async def resume_task_stream(task_id: str, request: ResumeTaskRequest | None = None):
    """Resume execution of a paused or waiting-approval task with SSE streaming."""
    record = await get_task_record(task_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")

    if record.status not in (AgentTaskStatus.WAITING_APPROVAL, AgentTaskStatus.RESUMED, AgentTaskStatus.RUNNING):
        raise HTTPException(
            status_code=400,
            detail=f"Task cannot be resumed because its status is '{record.status.value}'.",
        )

    resume_messages = list(record.messages)
    pending_appr = record.pending_approval or {}
    decision = pending_appr.get("decision")

    # If resuming from approval gate, resolve the pending tool call
    if pending_appr and "tool_call_id" in pending_appr:
        tool_call_id = pending_appr.get("tool_call_id")
        tool_name = pending_appr.get("tool_name", "run_sql")
        sanitized_query = pending_appr.get("sanitized_query", "")

        if decision == "approved":
            sql_tool = RunSQLTool()
            obs = await sql_tool.execute(query=sanitized_query, is_approved=True)
            resume_messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": tool_name,
                "content": json.dumps(obs, ensure_ascii=False),
            })
        else:
            reason = pending_appr.get("reason") or "Rejected by human operator."
            obs = {
                "status": "rejected",
                "message": f"Query was rejected by operator. Reason: {reason}",
                "query": sanitized_query,
            }
            resume_messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": tool_name,
                "content": json.dumps(obs, ensure_ascii=False),
            })

    if request and request.feedback:
        default_approval_texts = ["Query disetujui oleh analis.", "Query disetujui oleh analis"]
        if decision != "approved" or request.feedback.strip() not in default_approval_texts:
            resume_messages.append({
                "role": "user",
                "content": f"Operator Feedback: {request.feedback}",
            })

    is_langgraph = task_id.startswith("langgraph_")
    if is_langgraph:
        from src.agent.langgraph_agent import LangGraphAgent
        agent = LangGraphAgent()
        agent_iter = agent.run_stream(
            user_query=record.user_query,
            task_id=task_id,
            session_id=record.session_id,
            resume_messages=resume_messages,
            initial_step=record.current_step,
            is_approved=(decision == "approved"),
        )
    else:
        agent = ManualAgentLoop()
        agent_iter = agent.run(
            user_query=record.user_query,
            task_id=task_id,
            session_id=record.session_id,
            resume_messages=resume_messages,
            initial_step=record.current_step,
            is_approved=(decision == "approved"),
        )

    async def event_generator():
        try:
            async for event in agent_iter:
                if event["event"] == "approval_required":
                    appr_data = event["data"]
                    appr_id = appr_data.get("approval_id")
                    if appr_id:
                        pending_approvals[appr_id] = appr_data
                yield {
                    "event": event["event"],
                    "data": json.dumps(event["data"], ensure_ascii=False),
                }
        except Exception as e:
            logger.error("Error in resume event generator: %s", e)
            yield {
                "event": "error",
                "data": json.dumps({"message": f"Resume execution error: {e}"}),
            }

    return EventSourceResponse(event_generator())


@app.get("/", response_class=HTMLResponse, tags=["UI"])
async def web_ui():
    """Claude AI-inspired warm aesthetic UI for Harnessly with live streaming, HITL gate, and observability."""
    if STATIC_INDEX_PATH.exists():
        return HTMLResponse(content=STATIC_INDEX_PATH.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Harnessly UI template not found.</h1>", status_code=404)

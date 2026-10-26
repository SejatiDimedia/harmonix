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

from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"
STATIC_INDEX_PATH = STATIC_DIR / "index.html"

from src.agent.auditor import DataAuditorAgent
from src.agent.langgraph_agent import LangGraphAgent
from src.agent.manual_loop import ManualAgentLoop
from src.agent.models import AgentTaskStatus
from src.agent.state import (
    get_task_record,
    get_task_by_approval_id,
    save_task_checkpoint,
    init_task_state_table,
    list_chat_sessions,
    get_session_details,
    rename_session,
    delete_session,
    get_session_active_model,
)
from src.config import settings
from src.db.connection import check_db_health
from src.llm.registry import ModelRegistry
from src.rag.glossary import seed_glossary_if_empty
from src.tools.database import RunSQLTool

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("harnessly.api")


from src.observability.metrics import get_system_metrics_summary
from src.observability.tracer import init_traces_table
from src.dashboard.manager import (
    PinWidgetInput,
    init_dashboard_table,
    pin_widget,
    get_dashboard_widgets,
    delete_dashboard_widget,
    refresh_dashboard_widgets,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle events: seed metric glossary, init state tables, traces table, and dashboard table on startup."""
    try:
        if await check_db_health():
            await seed_glossary_if_empty()
            await init_task_state_table()
            await init_traces_table()
            await init_dashboard_table()
            logger.info("Auto-seeded metric glossary and initialized state/trace/dashboard tables at startup.")
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

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


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
    provider: str | None = Field(default=None, description="Optional runtime LLM provider override")
    model: str | None = Field(default=None, description="Optional runtime LLM model override")
    auditor_provider: str | None = Field(default=None, description="Optional runtime Auditor provider override")
    auditor_model: str | None = Field(default=None, description="Optional runtime Auditor model override")


class UpdateActiveModelRequest(BaseModel):
    analyst_provider: str | None = None
    analyst_model: str | None = None
    auditor_provider: str | None = None
    auditor_model: str | None = None


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
    active_cfg = ModelRegistry.get_instance().active_config
    return {
        "status": "healthy" if db_ok else "degraded",
        "database_connected": db_ok,
        "llm_provider": active_cfg.analyst_provider,
        "active_model": active_cfg.analyst_model,
        "environment": settings.app_env,
    }


@app.get("/v1/models", tags=["Models"])
async def list_models():
    """Retrieve full catalog of providers, available models, and currently active config (FR-36)."""
    return await ModelRegistry.get_instance().get_catalog()


@app.post("/v1/models/active", tags=["Models"])
async def set_active_models(request: UpdateActiveModelRequest):
    """Update active models for Analyst and Auditor dynamically without server restart (FR-36)."""
    updated = ModelRegistry.get_instance().update_active_config(
        analyst_provider=request.analyst_provider,
        analyst_model=request.analyst_model,
        auditor_provider=request.auditor_provider,
        auditor_model=request.auditor_model,
    )
    return {"status": "success", "active_config": updated.model_dump()}


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
    req_provider = request.provider
    req_model = request.model
    if (not req_provider or not req_model) and request.session_id:
        sess_prov, sess_model = await get_session_active_model(request.session_id)
        if sess_prov and sess_model:
            req_provider = req_provider or sess_prov
            req_model = req_model or sess_model

    registry = ModelRegistry.get_instance()
    analyst_llm = registry.create_analyst_llm(
        override_provider=req_provider,
        override_model=req_model,
    )
    auditor_llm = registry.create_auditor_llm(
        override_provider=request.auditor_provider,
        override_model=request.auditor_model,
    )
    custom_auditor = DataAuditorAgent(llm=auditor_llm)

    if request.engine == "langgraph":
        agent_runner = LangGraphAgent(llm=analyst_llm, auditor=custom_auditor)
        stream_iter = agent_runner.run_stream(
            user_query=request.query,
            task_id=request.task_id,
            session_id=request.session_id,
        )
    else:
        agent_runner = ManualAgentLoop(llm=analyst_llm, auditor=custom_auditor)
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


@app.get("/v1/sessions", tags=["Sessions"])
async def list_sessions(limit: int = 50):
    """Retrieve summarized list of all conversation sessions."""
    sessions = await list_chat_sessions(limit=limit)
    return {"sessions": sessions}


@app.get("/v1/sessions/{session_id}", tags=["Sessions"])
async def get_session(session_id: str):
    """Retrieve full conversation details and turns for a given session."""
    session_data = await get_session_details(session_id=session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return session_data


@app.delete("/v1/sessions/{session_id}", tags=["Sessions"])
async def remove_session(session_id: str):
    """Delete a conversation session and all its associated tasks and checkpoints."""
    success = await delete_session(session_id=session_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found or could not be deleted.")
    return {"status": "deleted", "session_id": session_id}


class RenameSessionInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=150, description="New title for the conversation session")


@app.patch("/v1/sessions/{session_id}", tags=["Sessions"])
async def update_session_title(session_id: str, payload: RenameSessionInput):
    """Rename a conversation session title."""
    clean_title = payload.title.strip()
    if not clean_title:
        raise HTTPException(status_code=422, detail="Title cannot be empty or whitespace.")
    success = await rename_session(session_id=session_id, new_title=clean_title)
    if not success:
        raise HTTPException(status_code=400, detail=f"Could not rename session '{session_id}'.")
    return {"status": "updated", "session_id": session_id, "title": clean_title[:150]}


# ==============================================================================
# Live BI Dashboard Canvas Endpoints (FR-37)
# ==============================================================================

@app.get("/v1/dashboard/{session_id}", tags=["Dashboard"])
async def list_dashboard_widgets(session_id: str):
    """Retrieve all pinned widgets for a given session's live dashboard."""
    widgets = await get_dashboard_widgets(session_id=session_id)
    return {
        "session_id": session_id,
        "widgets": [w.model_dump() for w in widgets],
        "total": len(widgets),
    }


@app.post("/v1/dashboard/pin", tags=["Dashboard"])
async def pin_to_dashboard(payload: PinWidgetInput):
    """Pin a chart, table, or KPI metric card to the session's live dashboard."""
    widget = await pin_widget(payload)
    return widget.model_dump()


@app.delete("/v1/dashboard/{widget_id}", tags=["Dashboard"])
async def delete_widget(widget_id: str):
    """Remove/unpin a widget from the dashboard."""
    success = await delete_dashboard_widget(widget_id=widget_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Widget '{widget_id}' not found.")
    return {"status": "deleted", "widget_id": widget_id}


@app.post("/v1/dashboard/refresh/{session_id}", tags=["Dashboard"])
async def refresh_dashboard(session_id: str):
    """Re-execute all pinned widgets' SQL queries directly against PostgreSQL (0 LLM Cost)."""
    updated_widgets = await refresh_dashboard_widgets(session_id=session_id)
    return {
        "session_id": session_id,
        "widgets": [w.model_dump() for w in updated_widgets],
        "total": len(updated_widgets),
    }


@app.get("/", response_class=HTMLResponse, tags=["UI"])
async def web_ui():
    """Claude AI-inspired warm aesthetic UI for Harnessly with live streaming, HITL gate, and observability."""
    if STATIC_INDEX_PATH.exists():
        return HTMLResponse(content=STATIC_INDEX_PATH.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Harnessly UI template not found.</h1>", status_code=404)

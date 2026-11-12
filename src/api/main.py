"""FastAPI application with SSE streaming, state persistence, checkpointing, and HITL endpoints."""

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Literal, Any
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, UploadFile, File, Response, Security, Depends, status
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
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
from src.agent.planner_executor import PlannerExecutorAgent
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
from src.agent.cancellation import request_task_cancellation, is_task_cancelled, clear_task_cancellation
from src.llm.keys_manager import (
    UpdateAPIKeysInput,
    get_all_masked_keys,
    save_keys_to_env,
)
from src.rag.glossary import seed_glossary_if_empty
from src.tools.database import RunSQLTool

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("harmonix.api")


from src.observability.metrics import get_system_metrics_summary
from src.observability.tracer import init_traces_table
from src.dashboard.manager import (
    PinWidgetInput,
    WidgetLayoutItem,
    init_dashboard_table,
    pin_widget,
    get_dashboard_widgets,
    delete_dashboard_widget,
    refresh_dashboard_widgets,
    update_dashboard_layout,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle events: seed metric glossary, init state tables, traces table, dashboard table, and watchdog on startup."""
    try:
        if await check_db_health():
            await seed_glossary_if_empty()
            await init_task_state_table()
            await init_traces_table()
            await init_dashboard_table()
            from src.ingestion.excel_csv_parser import init_uploaded_tables_registry
            await init_uploaded_tables_registry()
            from src.ingestion.google_sheets import init_google_tables
            await init_google_tables()
            from src.rag.long_term_memory import seed_golden_memories_if_empty
            await seed_golden_memories_if_empty()
            from src.watchdog.manager import init_watchdog_tables, start_watchdog_scheduler
            await init_watchdog_tables()
            asyncio.create_task(start_watchdog_scheduler())
            logger.info("Auto-seeded metric glossary, long-term memories, and initialized state/trace/dashboard/upload/watchdog tables at startup.")
    except Exception as e:
        logger.warning("Startup initialization error: %s", e)
    yield
    try:
        from src.watchdog.manager import stop_watchdog_scheduler
        stop_watchdog_scheduler()
    except Exception:
        pass


app = FastAPI(
    title="Harmonix Data Analyst Agent API",
    description="Production-grade text-to-SQL agent with full harness, guardrails, state persistence, and SSE streaming.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# Authentication Dependencies (P0-3, P0-4)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_auth = HTTPBearer(auto_error=False)


async def verify_api_auth(
    api_key: str | None = Security(api_key_header),
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_auth),
) -> bool:
    """Verify standard API authentication via X-API-Key header or Bearer token."""
    expected_key = settings.api_auth_key
    if not expected_key:
        return True  # If no auth key is configured (dev baseline), allow access

    token = api_key or (credentials.credentials if credentials else None)
    if not token or token != expected_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API authentication credentials. Provide a valid 'X-API-Key' or 'Authorization: Bearer <key>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True


async def verify_admin_auth(
    api_key: str | None = Security(api_key_header),
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_auth),
) -> bool:
    """Verify administrator access for critical management endpoints."""
    expected_admin = settings.admin_api_key or settings.api_auth_key
    if not expected_admin:
        if settings.app_env.lower() == "production":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Administrative actions are restricted in production unless ADMIN_API_KEY is configured.",
            )
        return True

    token = api_key or (credentials.credentials if credentials else None)
    if not token or token != expected_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Administrative privileges required.",
        )
    return True


# In-memory approval store for pending HITL requests
pending_approvals: dict[str, dict] = {}


# ==============================================================================
# Request / Response Schemas
# ==============================================================================

class ChatRequest(BaseModel):
    query: str = Field(..., description="User analytics question in natural language (Indonesian or English)")
    task_id: str | None = Field(default=None, description="Optional custom task tracking ID")
    session_id: str | None = Field(default=None, description="Optional conversation session ID")
    engine: Literal["manual", "langgraph", "swarm"] = Field(
        default="manual",
        description="Orchestrator engine: 'manual' (ManualAgentLoop), 'langgraph' (LangGraphAgent), or 'swarm' (PlannerExecutorAgent)",
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
async def set_active_models(
    request: UpdateActiveModelRequest,
    _auth: bool = Depends(verify_api_auth),
):
    """Update active models for Analyst and Auditor dynamically without server restart (FR-36)."""
    updated = ModelRegistry.get_instance().update_active_config(
        analyst_provider=request.analyst_provider,
        analyst_model=request.analyst_model,
        auditor_provider=request.auditor_provider,
        auditor_model=request.auditor_model,
    )
    return {"status": "success", "active_config": updated.model_dump()}


@app.get("/v1/models/keys", tags=["Models"])
async def get_model_api_keys(_auth: bool = Depends(verify_api_auth)):
    """Retrieve configuration status and masked API keys for all cloud providers (FR-36)."""
    return {"keys": get_all_masked_keys()}


@app.post("/v1/models/keys", tags=["Models"])
async def update_model_api_keys(
    payload: UpdateAPIKeysInput,
    _auth: bool = Depends(verify_admin_auth),
):
    """Configure custom API keys from UI or API, updating runtime settings and persisting to .env (FR-36)."""
    if settings.app_env.lower() == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Writing API keys to .env is disabled in production environment.",
        )

    # Format validation for submitted keys (P0-4)
    if payload.groq_api_key and not payload.groq_api_key.startswith("gsk_"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid Groq API key format. Expected key starting with 'gsk_'.",
        )
    if payload.openrouter_api_key and not (payload.openrouter_api_key.startswith("sk-or-") or payload.openrouter_api_key.startswith("sk-")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid OpenRouter API key format. Expected key starting with 'sk-or-' or 'sk-'.",
        )

    updates = {}
    if payload.groq_api_key is not None:
        updates["GROQ_API_KEY"] = payload.groq_api_key
    if payload.gemini_api_key is not None:
        updates["GEMINI_API_KEY"] = payload.gemini_api_key
    if payload.openrouter_api_key is not None:
        updates["OPENROUTER_API_KEY"] = payload.openrouter_api_key

    save_keys_to_env(updates)
    catalog = await ModelRegistry.get_instance().get_catalog()
    return {
        "status": "updated",
        "message": "Kunci API berhasil disimpan dan diterapkan.",
        "keys": get_all_masked_keys(),
        "catalog": catalog,
    }


@app.get("/v1/metrics", tags=["Observability"])
async def get_metrics():
    """Retrieve aggregated observability metrics, p50/p95 latency, tokens, and drift detection (OB-02, OB-03, OB-04)."""
    return await get_system_metrics_summary()


@app.post("/v1/chat", tags=["Agent"])
async def chat_stream(
    request: ChatRequest,
    _auth: bool = Depends(verify_api_auth),
):
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

    active_task_id = request.task_id or f"task_{uuid.uuid4().hex[:12]}"

    if request.engine == "swarm":
        agent_runner = PlannerExecutorAgent(llm=analyst_llm, auditor=custom_auditor)
        stream_iter = agent_runner.run_stream(
            user_query=request.query,
            task_id=active_task_id,
            session_id=request.session_id,
        )
    elif request.engine == "langgraph":
        agent_runner = LangGraphAgent(llm=analyst_llm, auditor=custom_auditor)
        stream_iter = agent_runner.run_stream(
            user_query=request.query,
            task_id=active_task_id,
            session_id=request.session_id,
        )
    else:
        agent_runner = ManualAgentLoop(llm=analyst_llm, auditor=custom_auditor)
        stream_iter = agent_runner.run(
            user_query=request.query,
            task_id=active_task_id,
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
        except (asyncio.CancelledError, GeneratorExit):
            logger.info("Chat stream cancelled by client for task %s", active_task_id)
            request_task_cancellation(active_task_id)
            try:
                await save_task_checkpoint(
                    task_id=active_task_id,
                    status=AgentTaskStatus.CANCELLED,
                    current_step=0,
                    messages=[],
                    user_query=request.query,
                    session_id=request.session_id,
                    final_result={"answer_text": ""},
                    error_message="Koneksi dibatalkan oleh pengguna.",
                )
            except Exception:
                pass
            raise
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


@app.post("/v1/tasks/{task_id}/cancel", tags=["Agent"])
async def cancel_task_endpoint(
    task_id: str,
    _auth: bool = Depends(verify_api_auth),
):
    """Cancel an ongoing agent task (e.g. when user sent a wrong chat query)."""
    request_task_cancellation(task_id)

    # Cancel any pending approvals linked to this task
    for appr_id, appr in list(pending_approvals.items()):
        if appr.get("task_id") == task_id:
            pending_approvals.pop(appr_id, None)

    # Persist cancelled status in DB
    try:
        record = await get_task_record(task_id)
        if record:
            await save_task_checkpoint(
                task_id=task_id,
                status=AgentTaskStatus.CANCELLED,
                current_step=record.current_step,
                messages=record.messages,
                user_query=record.user_query,
                session_id=record.session_id,
                final_result={"answer_text": ""},
                error_message="Dibatalkan oleh pengguna.",
            )
    except Exception as e:
        logger.warning("Could not update cancelled task status in DB: %s", e)

    return {
        "status": "cancelled",
        "task_id": task_id,
        "message": "Proses analitik berhasil dibatalkan.",
    }


class CancelChatRequest(BaseModel):
    task_id: str | None = None
    session_id: str | None = None


@app.post("/v1/chat/cancel", tags=["Agent"])
async def cancel_chat(
    request: CancelChatRequest,
    _auth: bool = Depends(verify_api_auth),
):
    """Cancel current in-flight chat query by task_id or session_id."""
    if request.task_id:
        request_task_cancellation(request.task_id)
        for appr_id, appr in list(pending_approvals.items()):
            if appr.get("task_id") == request.task_id:
                pending_approvals.pop(appr_id, None)
    return {"status": "cancelled", "task_id": request.task_id}


@app.post("/v1/approvals/{approval_id}", tags=["Agent"])
async def submit_approval(
    approval_id: str,
    request: ApprovalRequest,
    _auth: bool = Depends(verify_api_auth),
):
    """Approve or reject a risky query that triggered the human-in-the-loop approval gate (P0-2)."""
    item = pending_approvals.get(approval_id)
    if not item:
        # Fallback: check PostgreSQL state table in case server was restarted during pending approval
        record = await get_task_by_approval_id(approval_id)
        if record and record.pending_approval:
            item = record.pending_approval
            pending_approvals[approval_id] = item
        else:
            raise HTTPException(status_code=404, detail="Approval request not found or expired.")

    # Idempotency check: prevent duplicate / conflicting state mutation
    if item.get("status") == "processed" or item.get("decision"):
        existing_decision = item.get("decision")
        if existing_decision == request.decision:
            return {
                "approval_id": approval_id,
                "status": "processed",
                "decision": request.decision,
                "task_id": item.get("task_id"),
                "idempotent": True,
            }
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Approval request '{approval_id}' has already been processed with decision '{existing_decision}'.",
        )

    item["decision"] = request.decision
    item["reason"] = request.reason
    item["status"] = "processed"
    item["processed_at"] = datetime.now(timezone.utc).isoformat()

    task_id = item.get("task_id")
    if task_id:
        record = await get_task_record(task_id)
        if record and record.pending_approval:
            record.pending_approval["decision"] = request.decision
            record.pending_approval["reason"] = request.reason
            record.pending_approval["status"] = "processed"
            record.pending_approval["processed_at"] = item["processed_at"]

            new_status = AgentTaskStatus.RESUMED if request.decision == "approved" else AgentTaskStatus.REJECTED
            await save_task_checkpoint(
                task_id=task_id,
                status=new_status,
                current_step=record.current_step,
                messages=record.messages,
                user_query=record.user_query,
                session_id=record.session_id,
                pending_approval=record.pending_approval,
                analyst_provider=record.analyst_provider,
                analyst_model=record.analyst_model,
            )

    return {
        "approval_id": approval_id,
        "status": "processed",
        "decision": request.decision,
        "task_id": task_id,
    }


@app.post("/v1/tasks/{task_id}/resume", tags=["Agent"])
async def resume_task_stream(
    task_id: str,
    request: ResumeTaskRequest | None = None,
    _auth: bool = Depends(verify_api_auth),
):
    """Resume execution of a paused or waiting-approval task with SSE streaming."""
    record = await get_task_record(task_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")

    if record.status not in (AgentTaskStatus.WAITING_APPROVAL, AgentTaskStatus.RESUMED, AgentTaskStatus.RUNNING, AgentTaskStatus.REJECTED):
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

        if "question" in pending_appr and "context_key" in pending_appr:
            user_choice = (request.feedback if (request and request.feedback) else pending_appr.get("choice")) or "Clarified"
            obs = {
                "status": "clarified",
                "message": f"User clarified choice: '{user_choice}'. Applied to active session context.",
            }
            resume_messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": "request_clarification",
                "content": json.dumps(obs, ensure_ascii=False),
            })
        elif decision == "approved":
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

    # Resolve active model for task/session
    req_provider = record.analyst_provider
    req_model = record.analyst_model
    if (not req_provider or not req_model) and record.session_id:
        sess_prov, sess_model = await get_session_active_model(record.session_id)
        if sess_prov and sess_model:
            req_provider = req_provider or sess_prov
            req_model = req_model or sess_model

    registry = ModelRegistry.get_instance()
    analyst_llm = registry.create_analyst_llm(
        override_provider=req_provider,
        override_model=req_model,
    )
    auditor_llm = registry.create_auditor_llm()
    custom_auditor = DataAuditorAgent(llm=auditor_llm)

    if task_id.startswith("swarm_"):
        agent = PlannerExecutorAgent(llm=analyst_llm, auditor=custom_auditor)
        agent_iter = agent.run_stream(
            user_query=record.user_query,
            task_id=task_id,
            session_id=record.session_id,
            resume_messages=resume_messages,
            initial_step=record.current_step,
            is_approved=(decision == "approved"),
        )
    elif task_id.startswith("langgraph_") or task_id.startswith("lg_"):
        from src.agent.langgraph_agent import LangGraphAgent
        agent = LangGraphAgent(llm=analyst_llm, auditor=custom_auditor)
        agent_iter = agent.run_stream(
            user_query=record.user_query,
            task_id=task_id,
            session_id=record.session_id,
            resume_messages=resume_messages,
            initial_step=record.current_step,
            is_approved=(decision == "approved"),
        )
    else:
        agent = ManualAgentLoop(llm=analyst_llm, auditor=custom_auditor)
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
async def remove_session(
    session_id: str,
    _auth: bool = Depends(verify_api_auth),
):
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


@app.get("/v1/sessions/{session_id}/summary", tags=["Sessions"])
async def get_session_summary_endpoint(session_id: str):
    """Retrieve active conversation compaction summary for a session (FR-14)."""
    from src.agent.state import get_session_compacted_summary
    summary_text, turn_count = await get_session_compacted_summary(session_id)
    return {
        "session_id": session_id,
        "has_compacted_context": bool(summary_text),
        "compacted_summary": summary_text,
        "compacted_turn_count": turn_count,
    }


@app.post("/v1/sessions/{session_id}/compact", tags=["Sessions"])
async def trigger_session_compaction_endpoint(session_id: str):
    """Manually trigger or update conversation compaction for a session (FR-14)."""
    from src.agent.compaction import force_compact_session
    from src.llm.registry import ModelRegistry
    registry = ModelRegistry.get_instance()
    llm = registry.create_analyst_llm()
    result = await force_compact_session(session_id=session_id, llm=llm)
    return result


# ==============================================================================
# Dynamic Session Business Context & Column Clarification (FR-51)
# ==============================================================================

class CustomContextPayload(BaseModel):
    column_mappings: dict[str, Any] = Field(default_factory=dict)
    custom_formulas: dict[str, Any] = Field(default_factory=dict)
    business_rules: list[str] = Field(default_factory=list)


class UpdateSessionContextRequest(BaseModel):
    custom_context: CustomContextPayload


class PromoteToGlossaryRequest(BaseModel):
    metric_name: str = Field(..., min_length=1, max_length=100)
    sql_formula: str = Field(default="")
    description: str = Field(..., min_length=1)
    domain: str = Field(default="General")
    relevant_tables: list[str] = Field(default_factory=list)


class ClarificationAnswerRequest(BaseModel):
    choice: str = Field(..., min_length=1)
    context_key: str = Field(default="")
    category: str = Field(default="column_mapping")


@app.get("/v1/sessions/{session_id}/context", tags=["Session Context (FR-51)"])
async def get_session_context_endpoint(session_id: str):
    """Retrieve custom business context, column mappings, and formulas for a session (FR-51)."""
    from src.agent.state import get_session_custom_context
    ctx = await get_session_custom_context(session_id=session_id)
    ctx_str = json.dumps(ctx, ensure_ascii=False)
    # 1 token ~= 4 chars rule of thumb
    token_est = max(1, len(ctx_str) // 4)
    return {
        "session_id": session_id,
        "custom_context": ctx,
        "token_count_estimate": token_est,
        "max_token_budget": 1000,
    }


@app.put("/v1/sessions/{session_id}/context", tags=["Session Context (FR-51)"])
async def update_session_context_endpoint(
    session_id: str,
    payload: UpdateSessionContextRequest,
    _auth: bool = Depends(verify_api_auth),
):
    """Update or add session-scoped column mappings, formulas, and business rules (FR-51)."""
    from src.agent.state import save_session_custom_context
    ctx_dict = payload.custom_context.model_dump()
    raw_str = json.dumps(ctx_dict, ensure_ascii=False)
    if len(raw_str) > 4000:
        raise HTTPException(
            status_code=400,
            detail="Session business context exceeds max budget (~1,000 tokens / 4,000 characters). Please condense rules.",
        )
    saved = await save_session_custom_context(session_id=session_id, context=ctx_dict)
    token_est = max(1, len(json.dumps(saved, ensure_ascii=False)) // 4)
    return {
        "status": "success",
        "session_id": session_id,
        "custom_context": saved,
        "token_count_estimate": token_est,
        "max_token_budget": 1000,
    }


@app.post("/v1/sessions/{session_id}/context/promote-glossary", tags=["Session Context (FR-51)"])
async def promote_context_to_glossary_endpoint(
    session_id: str,
    payload: PromoteToGlossaryRequest,
    _auth: bool = Depends(verify_api_auth),
):
    """Promote a session-scoped metric formula to global analytics.metric_glossary (FR-51)."""
    from src.rag.glossary import promote_to_metric_glossary
    try:
        promoted = await promote_to_metric_glossary(
            metric_name=payload.metric_name,
            business_definition=payload.description,
            calculation_formula=payload.sql_formula or payload.description,
            sql_expression="",
            relevant_tables=payload.relevant_tables,
        )
        return {
            "status": "promoted",
            "session_id": session_id,
            "metric": promoted,
        }
    except Exception as e:
        logger.error("Failed to promote metric to glossary: %s", e)
        raise HTTPException(status_code=400, detail=f"Promotion failed: {e}")


@app.post("/v1/tasks/{task_id}/clarify", tags=["Session Context (FR-51)"])
async def clarify_task_endpoint(
    task_id: str,
    payload: ClarificationAnswerRequest,
    _auth: bool = Depends(verify_api_auth),
):
    """Answer an agent proactive clarification request and auto-save choice to session context (FR-51)."""
    record = await get_task_record(task_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")

    pending_appr = record.pending_approval or {}
    session_id = record.session_id

    # Auto-save choice to session custom_context if session_id exists
    if session_id:
        from src.agent.state import get_session_custom_context, save_session_custom_context
        current_ctx = await get_session_custom_context(session_id=session_id)
        ctx_key = payload.context_key or pending_appr.get("context_key") or "clarified_selection"
        category = payload.category or pending_appr.get("category", "column_mapping")

        if category == "column_mapping":
            col_map = current_ctx.get("column_mappings", {})
            col_map[ctx_key] = {
                "description": pending_appr.get("question", "User Clarified Column"),
                "selected_value": payload.choice,
            }
            current_ctx["column_mappings"] = col_map
        elif category == "custom_formula":
            form_map = current_ctx.get("custom_formulas", {})
            form_map[ctx_key] = payload.choice
            current_ctx["custom_formulas"] = form_map
        else:
            rules = current_ctx.get("business_rules", [])
            rules.append(f"{ctx_key}: {payload.choice}")
            current_ctx["business_rules"] = rules

        await save_session_custom_context(session_id=session_id, context=current_ctx)

    # Update pending approval state to approved with choice
    pending_appr["decision"] = "approved"
    pending_appr["choice"] = payload.choice
    await save_task_checkpoint(
        task_id=task_id,
        status=AgentTaskStatus.RESUMED,
        current_step=record.current_step,
        messages=record.messages,
        user_query=record.user_query,
        session_id=session_id,
        pending_approval=pending_appr,
        analyst_provider=record.analyst_provider,
        analyst_model=record.analyst_model,
    )

    return {
        "status": "clarified",
        "task_id": task_id,
        "session_id": session_id,
        "choice": payload.choice,
    }


# ==============================================================================
# Batch Processing API (FR-42, Pilar 6.4)
# ==============================================================================

from src.batch.engine import BatchProcessingEngine, CreateBatchRequest

@app.post("/v1/batch", tags=["Batch Analytics"])
async def submit_batch_job(
    payload: CreateBatchRequest,
    _auth: bool = Depends(verify_api_auth),
):
    """Submit a bulk batch of natural language analytical questions for background processing (FR-42)."""
    record = await BatchProcessingEngine.create_batch(
        queries=payload.queries,
        engine=payload.engine,
        concurrency_limit=payload.concurrency_limit,
        provider=payload.provider,
        model=payload.model,
        session_id=payload.session_id,
    )
    return record.model_dump()


@app.get("/v1/batch/{batch_id}", tags=["Batch Analytics"])
async def get_batch_status(batch_id: str):
    """Check progress and execution status of a batch analytics job."""
    record = await BatchProcessingEngine.get_batch_async(batch_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
    return record.model_dump()


@app.get("/v1/batch/{batch_id}/results", tags=["Batch Analytics"])
async def get_batch_results(
    batch_id: str,
    format: Literal["json", "jsonl", "csv"] = "json",
):
    """Download results of a completed batch job in JSON, JSONL, or CSV format."""
    record = await BatchProcessingEngine.get_batch_async(batch_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")

    if format == "jsonl":
        jsonl_content = BatchProcessingEngine.export_jsonl(batch_id)
        return Response(
            content=jsonl_content,
            media_type="application/x-ndjson",
            headers={"Content-Disposition": f"attachment; filename={batch_id}_results.jsonl"},
        )
    elif format == "csv":
        csv_content = BatchProcessingEngine.export_csv(batch_id)
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={batch_id}_results.csv"},
        )

    return record.model_dump()


@app.get("/v1/batch", tags=["Batch Analytics"])
async def list_all_batches():
    """List all submitted batch analytics jobs."""
    jobs = await BatchProcessingEngine.list_batches_async()
    return {"total": len(jobs), "batches": [j.model_dump() for j in jobs]}


# ==============================================================================
# Distributed Task Queue & Worker API (FR-43, Pilar 6.3)
# ==============================================================================

from src.queue.manager import get_task_queue
from src.queue.models import EnqueueJobRequest, QueueJobState

@app.get("/v1/queue/status", tags=["Task Queue"])
async def get_queue_status_endpoint():
    """Get queue health, pending task breakdown, and active worker telemetry (FR-43)."""
    queue = get_task_queue()
    stats = await queue.get_stats()
    return stats.model_dump()


@app.get("/v1/queue/jobs", tags=["Task Queue"])
async def list_queue_jobs_endpoint(
    status: QueueJobState | None = None,
    limit: int = 50,
):
    """List recent tasks in the distributed queue with optional status filter."""
    queue = get_task_queue()
    jobs = await queue.list_jobs(status=status, limit=min(limit, 100))
    return {"total": len(jobs), "jobs": [j.model_dump() for j in jobs]}


@app.get("/v1/queue/jobs/{job_id}", tags=["Task Queue"])
async def get_queue_job_endpoint(job_id: str):
    """Retrieve details, payload, and execution results of a specific queue job."""
    queue = get_task_queue()
    job = await queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found in queue.")
    return job.model_dump()


@app.post("/v1/queue/jobs/{job_id}/retry", tags=["Task Queue"])
async def retry_queue_job_endpoint(
    job_id: str,
    _auth: bool = Depends(verify_api_auth),
):
    """Manually re-enqueue a FAILED or DEAD_LETTER job for execution."""
    queue = get_task_queue()
    job = await queue.retry_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found or cannot be retried.")
    return {"status": "re-queued", "job": job.model_dump()}


@app.post("/v1/queue/jobs", tags=["Task Queue"])
async def enqueue_job_endpoint(
    payload: EnqueueJobRequest,
    _auth: bool = Depends(verify_api_auth),
):
    """Enqueue a new asynchronous task for background worker execution."""
    queue = get_task_queue()
    job = await queue.enqueue(
        job_type=payload.job_type,
        payload=payload.payload,
        priority=payload.priority,
        max_retries=payload.max_retries,
        delay_seconds=payload.delay_seconds,
    )
    return job.model_dump()




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
async def pin_to_dashboard(
    payload: PinWidgetInput,
    _auth: bool = Depends(verify_api_auth),
):
    """Pin a chart, table, or KPI metric card to the session's live dashboard."""
    widget = await pin_widget(payload)
    return widget.model_dump()


@app.delete("/v1/dashboard/{widget_id}", tags=["Dashboard"])
async def delete_widget(
    widget_id: str,
    _auth: bool = Depends(verify_api_auth),
):
    """Remove/unpin a widget from the dashboard."""
    success = await delete_dashboard_widget(widget_id=widget_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Widget '{widget_id}' not found.")
    return {"status": "deleted", "widget_id": widget_id}


@app.post("/v1/dashboard/refresh/{session_id}", tags=["Dashboard"])
async def refresh_dashboard(
    session_id: str,
    _auth: bool = Depends(verify_api_auth),
):
    """Re-execute all pinned widgets' SQL queries directly against PostgreSQL (0 LLM Cost)."""
    updated_widgets = await refresh_dashboard_widgets(session_id=session_id)
    return {
        "session_id": session_id,
        "widgets": [w.model_dump() for w in updated_widgets],
        "total": len(updated_widgets),
    }


class UpdateDashboardLayoutPayload(BaseModel):
    layout: list[WidgetLayoutItem]


@app.put("/v1/dashboard/layout/{session_id}", tags=["Dashboard"])
async def update_dashboard_layout_endpoint(
    session_id: str,
    payload: UpdateDashboardLayoutPayload,
    _auth: bool = Depends(verify_api_auth),
):
    """Update layout positions and span widths for pinned dashboard widgets."""
    updated = await update_dashboard_layout(session_id=session_id, items=payload.layout)
    return {"status": "success", "session_id": session_id, "updated_count": updated}


# ==============================================================================
# BYOD File Ingestion Endpoints (FR-39)
# ==============================================================================

@app.post("/v1/sessions/{session_id}/upload", tags=["Ingestion"])
async def upload_files_to_session(
    session_id: str,
    files: list[UploadFile] = File(...),
    _auth: bool = Depends(verify_api_auth),
):
    """Upload one or more CSV/Excel files and convert each sheet into dynamic PostgreSQL tables."""
    from src.ingestion.excel_csv_parser import (
        process_file_and_create_tables,
        MAX_FILES_PER_BATCH,
        MAX_FILE_SIZE_BYTES,
        SUPPORTED_EXTENSIONS,
    )
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada berkas yang diunggah.")
    if len(files) > MAX_FILES_PER_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"Maksimum {MAX_FILES_PER_BATCH} berkas dapat diunggah per batch.",
        )

    all_created_tables = []
    errors = []

    for f in files:
        filename = f.filename or "uploaded_data.csv"
        file_ext = Path(filename).suffix.lower()
        if file_ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Tipe berkas '{filename}' tidak didukung. Hanya format {', '.join(sorted(SUPPORTED_EXTENSIONS))} yang diizinkan.",
            )

        try:
            content = await f.read()
            if len(content) > MAX_FILE_SIZE_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Ukuran berkas '{filename}' ({len(content)} bytes) melebihi batas maksimum {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB.",
                )
            created = await process_file_and_create_tables(
                session_id=session_id,
                filename=filename,
                file_bytes=content,
            )
            all_created_tables.extend(created)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error processing file %s: %s", filename, e)
            errors.append(f"{filename}: {str(e)}")

    if errors and not all_created_tables:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    return {
        "status": "success",
        "session_id": session_id,
        "total_files": len(files),
        "total_tables_created": len(all_created_tables),
        "tables": [t.model_dump() for t in all_created_tables],
        "warnings": errors if errors else None,
    }


@app.get("/v1/sessions/{session_id}/tables", tags=["Ingestion"])
async def list_session_tables(session_id: str):
    """List all dynamic tables created from uploaded files for a session."""
    from src.ingestion.excel_csv_parser import get_session_uploaded_tables
    tables = await get_session_uploaded_tables(session_id=session_id)
    return {
        "session_id": session_id,
        "total_tables": len(tables),
        "tables": [t.model_dump() for t in tables],
    }


@app.get("/v1/sessions/{session_id}/tables/{table_name}/health", tags=["Ingestion"])
async def get_table_health(session_id: str, table_name: str):
    """Compute instant data quality, completeness, and outlier health profile (FR-41)."""
    from src.ingestion.data_health_profiler import compute_table_data_health
    try:
        profile = await compute_table_data_health(table_name=table_name, session_id=session_id)
        return profile.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error computing table health for %s: %s", table_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Gagal memproses profil kesehatan data: {e}")


@app.delete("/v1/sessions/{session_id}/tables/{table_name}", tags=["Ingestion"])
async def delete_session_table(session_id: str, table_name: str):
    """Delete a single uploaded table and drop its physical table from PostgreSQL."""
    from src.ingestion.excel_csv_parser import delete_session_uploaded_table
    success = await delete_session_uploaded_table(session_id=session_id, table_name=table_name)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Tabel '{table_name}' tidak ditemukan pada sesi '{session_id}'."
        )
    return {
        "status": "success",
        "message": f"Tabel '{table_name}' berhasil dihapus dari sesi.",
        "table_name": table_name,
        "session_id": session_id,
    }


# ==============================================================================
# Long-Term Memory Endpoints (FR-17)
# ==============================================================================

class CreateMemoryInput(BaseModel):
    question: str = Field(..., description="Pertanyaan analisis atau aturan preferensi pengguna")
    sql: str | None = Field(None, description="Kueri SQL yang terbukti berhasil (opsional)")
    explanation: str | None = Field(None, description="Penjelasan atau definisi metrik")
    session_id: str | None = Field(None, description="ID sesi asal (opsional)")
    memory_type: str = Field("successful_query", description="successful_query atau user_preference")


@app.get("/v1/memories", tags=["Memory"])
async def list_memories_endpoint(limit: int = 50, memory_type: str | None = None):
    """List long-term memories and few-shot query exemplars stored in pgvector (FR-17)."""
    from src.rag.long_term_memory import list_long_term_memories
    memories = await list_long_term_memories(limit=limit, memory_type=memory_type)
    return {
        "status": "success",
        "total": len(memories),
        "memories": memories,
    }


@app.post("/v1/memories", tags=["Memory"])
async def create_memory_endpoint(payload: CreateMemoryInput):
    """Store a verified SQL query or user preference into pgvector long-term memory (FR-17)."""
    from src.rag.long_term_memory import store_successful_query, store_user_preference
    if payload.memory_type == "user_preference" or not payload.sql:
        mem_id = await store_user_preference(
            preference_text=payload.question,
            session_id=payload.session_id,
        )
    else:
        mem_id = await store_successful_query(
            question=payload.question,
            sql=payload.sql,
            session_id=payload.session_id,
            explanation=payload.explanation,
        )
    if not mem_id:
        raise HTTPException(status_code=400, detail="Gagal menyimpan memori.")
    return {
        "status": "success",
        "memory_id": mem_id,
        "message": "Memori berhasil disimpan ke dalam pgvector.",
    }


@app.delete("/v1/memories/{memory_id}", tags=["Memory"])
async def delete_memory_endpoint(memory_id: int):
    """Delete a memory item from long-term memory (FR-17)."""
    from src.rag.long_term_memory import delete_long_term_memory
    deleted = await delete_long_term_memory(memory_id=memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memori tidak ditemukan.")
    return {
        "status": "success",
        "message": f"Memori #{memory_id} berhasil dihapus.",
    }


# ==============================================================================
# Watchdog & Anomaly Alerting Endpoints (FR-49)
# ==============================================================================

@app.get("/v1/watchdog/rules", tags=["Watchdog"])
async def list_watchdog_rules_endpoint(
    session_id: str | None = None,
    scope: str | None = None,
):
    """List configured watchdog monitoring rules with optional session/scope filtering."""
    from src.watchdog.manager import list_rules
    rules = await list_rules(session_id=session_id, scope=scope)
    return {
        "status": "success",
        "total": len(rules),
        "rules": [r.model_dump() for r in rules],
    }


@app.get("/v1/watchdog/triggered-count", tags=["Watchdog"])
async def get_triggered_watchdog_count_endpoint(session_id: str | None = None):
    """Get the count of currently triggered watchdog rules for current context."""
    from src.watchdog.manager import get_triggered_count
    count = await get_triggered_count(session_id=session_id)
    return {
        "status": "success",
        "triggered_count": count,
    }


@app.post("/v1/watchdog/rules", tags=["Watchdog"])
async def create_watchdog_rule_endpoint(payload: dict):
    """Create a new metric monitoring watchdog rule."""
    from src.watchdog.manager import WatchdogRuleCreate, create_rule
    try:
        rule_input = WatchdogRuleCreate(**payload)
        rule = await create_rule(rule_input)
        return {
            "status": "success",
            "message": f"Aturan watchdog '{rule.rule_name}' berhasil dibuat.",
            "rule": rule.model_dump(),
        }
    except Exception as e:
        logger.error("Failed to create watchdog rule: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/v1/watchdog/rules/{rule_id}", tags=["Watchdog"])
async def update_watchdog_rule_endpoint(rule_id: int, payload: dict):
    """Update an existing watchdog rule."""
    from src.watchdog.manager import WatchdogRuleUpdate, update_rule
    try:
        rule_update = WatchdogRuleUpdate(**payload)
        rule = await update_rule(rule_id, rule_update)
        return {
            "status": "success",
            "message": f"Aturan watchdog #{rule_id} berhasil diperbarui.",
            "rule": rule.model_dump(),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to update watchdog rule: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/v1/watchdog/rules/{rule_id}", tags=["Watchdog"])
async def delete_watchdog_rule_endpoint(rule_id: int):
    """Delete a watchdog rule and its associated execution logs."""
    from src.watchdog.manager import delete_rule
    deleted = await delete_rule(rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Aturan #{rule_id} tidak ditemukan.")
    return {
        "status": "success",
        "message": f"Aturan watchdog #{rule_id} berhasil dihapus.",
    }


@app.post("/v1/watchdog/rules/{rule_id}/run", tags=["Watchdog"])
async def run_watchdog_rule_endpoint(rule_id: int):
    """Trigger manual immediate evaluation of a watchdog rule."""
    from src.watchdog.manager import evaluate_rule
    try:
        log_entry = await evaluate_rule(rule_id)
        return {
            "status": "success",
            "message": f"Aturan watchdog #{rule_id} selesai dievaluasi.",
            "result": log_entry.model_dump(),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to run watchdog rule #{rule_id}: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/watchdog/logs", tags=["Watchdog"])
async def list_watchdog_logs_endpoint(
    limit: int = 50,
    rule_id: int | None = None,
    session_id: str | None = None,
):
    """Retrieve recent watchdog execution logs and trigger history."""
    from src.watchdog.manager import get_logs
    logs = await get_logs(limit=limit, rule_id=rule_id, session_id=session_id)
    return {
        "status": "success",
        "total": len(logs),
        "logs": [l.model_dump() for l in logs],
    }


# ==============================================================================
# Google Account OAuth 2.0 & Google Sheets Ingestion Endpoints (FR-50)
# ==============================================================================

@app.get("/v1/auth/google/login", tags=["Google Integration"])
async def google_login(session_id: str, redirect_uri: str | None = None):
    """Generate Google OAuth 2.0 consent URL for connecting Google account."""
    from src.ingestion.google_sheets import get_google_auth_url
    try:
        url = get_google_auth_url(session_id=session_id, redirect_uri=redirect_uri)
        return {"status": "success", "auth_url": url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to generate Google auth URL: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/auth/google/callback", tags=["Google Integration"])
async def google_callback(code: str, state: str):
    """Handle Google OAuth 2.0 authorization code exchange and token persistence."""
    from src.ingestion.google_sheets import handle_google_oauth_callback
    try:
        res = await handle_google_oauth_callback(code=code, state=state)
        user_email = res.get("google_email", "")
        sess_id = res.get("session_id", "")
        html_content = f"""<!DOCTYPE html>
<html>
<head>
    <title>Google Account Connected</title>
    <style>
        body {{ background: #0b1120; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
        .card {{ background: #131d32; border: 1px solid rgba(255,255,255,0.08); padding: 2rem 2.5rem; border-radius: 1rem; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); max-width: 400px; }}
        .badge {{ background: #052e16; color: #4ade80; border: 1px solid #166534; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; display: inline-block; margin-bottom: 1rem; }}
        p {{ color: #94a3b8; font-size: 0.875rem; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="badge">Connected</div>
        <h2 style="margin: 0 0 0.5rem 0;">Google Account Connected Successfully</h2>
        <p><strong>{user_email}</strong></p>
        <p>This window will close automatically...</p>
    </div>
    <script>
        if (window.opener) {{
            window.opener.postMessage({{
                type: 'GOOGLE_AUTH_SUCCESS',
                session_id: '{sess_id}',
                google_email: '{user_email}'
            }}, '*');
            setTimeout(() => window.close(), 1500);
        }} else {{
            setTimeout(() => {{ window.location.href = '/'; }}, 2000);
        }}
    </script>
</body>
</html>"""
        return HTMLResponse(content=html_content)
    except Exception as e:
        logger.error("Google OAuth callback error: %s", e)
        err_html = f"""<!DOCTYPE html>
<html>
<head><title>Authorization Failed</title></head>
<body style="background: #0b1120; color: #f87171; font-family: sans-serif; padding: 2rem; text-align: center;">
    <h2>Failed to Connect Google Account</h2>
    <p style="color: #94a3b8;">{str(e)}</p>
</body>
</html>"""
        return HTMLResponse(content=err_html, status_code=400)


@app.get("/v1/auth/google/status", tags=["Google Integration"])
async def google_auth_status(session_id: str):
    """Check whether a session has an active connected Google account."""
    from src.ingestion.google_sheets import get_google_connection_status
    status = await get_google_connection_status(session_id=session_id)
    return status.model_dump()


@app.delete("/v1/auth/google/disconnect", tags=["Google Integration"])
async def google_disconnect(session_id: str):
    """Disconnect Google account from the session and revoke tokens."""
    from src.ingestion.google_sheets import disconnect_google_account
    success = await disconnect_google_account(session_id=session_id)
    return {"status": "success" if success else "not_connected"}


class GoogleSheetsMetadataRequest(BaseModel):
    session_id: str
    spreadsheet_url: str


@app.post("/v1/google-sheets/metadata", tags=["Google Sheets"])
async def get_google_sheets_metadata_endpoint(payload: GoogleSheetsMetadataRequest):
    """Retrieve spreadsheet title and list of available sheet tabs for preview."""
    from src.ingestion.google_sheets import extract_spreadsheet_id, get_valid_access_token, fetch_spreadsheet_metadata
    try:
        ss_id = extract_spreadsheet_id(payload.spreadsheet_url)
        token = await get_valid_access_token(payload.session_id)
        meta = await fetch_spreadsheet_metadata(token, ss_id)
        return {"status": "success", "metadata": meta}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to fetch Google Sheets metadata: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


class ImportGoogleSheetsRequest(BaseModel):
    session_id: str
    spreadsheet_url: str
    selected_sheets: list[str] | None = None


@app.post("/v1/google-sheets/import", tags=["Google Sheets"])
async def import_google_sheets_endpoint(payload: ImportGoogleSheetsRequest):
    """Ingest selected sheets into PostgreSQL and register in session catalog."""
    from src.ingestion.google_sheets import ingest_google_sheets
    try:
        result = await ingest_google_sheets(
            session_id=payload.session_id,
            spreadsheet_url_or_id=payload.spreadsheet_url,
            selected_sheet_titles=payload.selected_sheets,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to import Google Sheets: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/google-sheets/resync/{sheet_link_id}", tags=["Google Sheets"])
async def resync_google_sheet_endpoint(sheet_link_id: str):
    """Re-sync live data from Google Sheets into corresponding PostgreSQL tables."""
    from src.ingestion.google_sheets import resync_google_sheet
    try:
        res = await resync_google_sheet(sheet_link_id=sheet_link_id)
        return res
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to re-sync Google Sheet %s: %s", sheet_link_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/google-sheets/{session_id}", tags=["Google Sheets"])
async def list_google_sheets_endpoint(session_id: str):
    """List all linked Google Sheets for a session."""
    from src.ingestion.google_sheets import list_session_google_sheets
    sheets = await list_session_google_sheets(session_id=session_id)
    return {
        "status": "success",
        "session_id": session_id,
        "sheets": [s.model_dump() for s in sheets],
        "total": len(sheets),
    }


@app.delete("/v1/google-sheets/{sheet_link_id}", tags=["Google Sheets"])
async def remove_google_sheet_endpoint(sheet_link_id: str):
    """Remove a linked Google Sheet and drop its PostgreSQL tables."""
    from src.ingestion.google_sheets import remove_session_google_sheet
    success = await remove_session_google_sheet(sheet_link_id=sheet_link_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Link Google Sheets '{sheet_link_id}' tidak ditemukan.")
    return {"status": "success", "sheet_link_id": sheet_link_id}


@app.get("/", response_class=HTMLResponse, tags=["UI"])
async def web_ui():
    """Claude AI-inspired warm aesthetic UI for Harmonix with live streaming, HITL gate, and observability."""
    if STATIC_INDEX_PATH.exists():
        return HTMLResponse(content=STATIC_INDEX_PATH.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Harmonix UI template not found.</h1>", status_code=404)


@app.get("/tv/{session_id}", response_class=HTMLResponse, tags=["UI"])
async def tv_ui(session_id: str):
    """Standalone TV Command Center Kiosk display for Harmonix Live Dashboard."""
    if STATIC_INDEX_PATH.exists():
        return HTMLResponse(content=STATIC_INDEX_PATH.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Harmonix UI template not found.</h1>", status_code=404)


@app.get("/design-system", response_class=HTMLResponse, tags=["UI"])
async def design_system_ui():
    """Harmonix Design System & Component Catalog UI."""
    if STATIC_INDEX_PATH.exists():
        return HTMLResponse(content=STATIC_INDEX_PATH.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Harmonix UI template not found.</h1>", status_code=404)

"""FastAPI application with SSE streaming, state persistence, checkpointing, and HITL endpoints."""

import json
import logging
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from contextlib import asynccontextmanager
from sse_starlette.sse import EventSourceResponse

from src.agent.manual_loop import ManualAgentLoop
from src.agent.models import AgentTaskStatus
from src.agent.state import get_task_record, save_task_checkpoint, init_task_state_table
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

    - `step_start`: agent starts a reasoning step
    - `token`: streaming text tokens
    - `approval_required`: query flagged by risk assessment waiting for approval
    - `final_result`: complete structured answer with SQL citations and tables
    - `error`: error or timeout details
    """
    agent = ManualAgentLoop()

    async def event_generator():
        try:
            async for event in agent.run(
                user_query=request.query,
                task_id=request.task_id,
                session_id=request.session_id,
            ):
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
    if approval_id not in pending_approvals:
        raise HTTPException(status_code=404, detail="Approval request not found or expired.")

    item = pending_approvals[approval_id]
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
        resume_messages.append({
            "role": "user",
            "content": f"Operator Feedback: {request.feedback}",
        })

    agent = ManualAgentLoop()

    async def event_generator():
        try:
            async for event in agent.run(
                user_query=record.user_query,
                task_id=task_id,
                session_id=record.session_id,
                resume_messages=resume_messages,
                initial_step=record.current_step,
            ):
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
    """Minimal zero-cost chat UI for testing agent streaming, HITL approval, and SQL results."""
    return """
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Harnessly - AI Data Analyst Agent</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-900 text-slate-100 min-h-screen flex flex-col font-sans">
        <header class="border-b border-slate-800 p-4 bg-slate-950/80 backdrop-blur sticky top-0 flex justify-between items-center">
            <div class="flex items-center gap-3">
                <span class="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Harnessly</span>
                <span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">Production-Grade Agent Harness</span>
            </div>
            <div class="flex items-center gap-2">
                <button id="btnMetrics" class="text-xs font-mono px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition">📊 Metrics</button>
                <div id="healthBadge" class="text-xs font-mono px-2 py-1 rounded bg-slate-800 text-slate-300">Checking...</div>
            </div>
        </header>

        <main class="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col gap-4">
            <div id="metricsPanel" class="hidden p-4 rounded-xl bg-slate-950/90 border border-cyan-800/60 shadow-xl space-y-3">
                <div class="flex justify-between items-center border-b border-slate-800 pb-2">
                    <span class="text-xs font-bold text-cyan-400 font-mono">📈 OBSERVABILITY & PERFORMANCE METRICS (OB-02, OB-03)</span>
                    <button id="btnCloseMetrics" class="text-xs text-slate-400 hover:text-white">✕</button>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    <div class="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                        <div class="text-[10px] text-slate-400">Total Requests</div>
                        <div id="metricTotalReq" class="text-base font-bold text-white font-mono">-</div>
                    </div>
                    <div class="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                        <div class="text-[10px] text-slate-400">Success Rate</div>
                        <div id="metricSuccessRate" class="text-base font-bold text-emerald-400 font-mono">-</div>
                    </div>
                    <div class="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                        <div class="text-[10px] text-slate-400">Latency p50 / p95</div>
                        <div id="metricLatency" class="text-base font-bold text-cyan-300 font-mono">-</div>
                    </div>
                    <div class="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                        <div class="text-[10px] text-slate-400">Total Tokens / Cost</div>
                        <div id="metricTokens" class="text-base font-bold text-amber-300 font-mono">-</div>
                    </div>
                </div>
                <div id="driftAlert" class="hidden text-xs px-3 py-1.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300 font-mono"></div>
            </div>
            <div id="messages" class="flex-1 overflow-y-auto space-y-4 min-h-[400px] p-2">
                <div class="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 text-slate-300 text-sm">
                    👋 Halo! Saya Data Analyst Agent. Anda dapat menanyakan tren penjualan, perbandingan produk, atau metrik e-commerce. Seluruh query SQL tervalidasi AST, read-only, dan tersimpan dalam state machine PostgreSQL secara persisten.
                </div>
            </div>

            <div id="approvalBanner" class="hidden p-4 rounded-xl bg-amber-950/60 border border-amber-600/60 text-amber-200">
                <div class="font-bold flex items-center gap-2">⚠️ Approval Required (Human-in-the-Loop)</div>
                <div id="approvalReason" class="text-sm mt-1"></div>
                <pre id="approvalSQL" class="bg-slate-950 p-2 rounded text-xs mt-2 overflow-x-auto text-amber-300"></pre>
                <div class="flex gap-2 mt-3">
                    <button id="btnApprove" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded text-xs font-medium">Setujui Query</button>
                    <button id="btnReject" class="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1 rounded text-xs font-medium">Tolak</button>
                </div>
            </div>

            <form id="chatForm" class="flex gap-2 mt-auto sticky bottom-4">
                <input id="queryInput" type="text" placeholder="Tanyakan data, mis: Tampilkan total penjualan per kategori produk..." 
                    class="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 text-white shadow-inner" required />
                <button type="submit" id="submitBtn" class="bg-cyan-600 hover:bg-cyan-500 text-white font-medium px-5 py-3 rounded-xl text-sm transition">Kirim</button>
            </form>
        </main>

        <script>
            const messagesDiv = document.getElementById('messages');
            const chatForm = document.getElementById('chatForm');
            const queryInput = document.getElementById('queryInput');
            const submitBtn = document.getElementById('submitBtn');
            const healthBadge = document.getElementById('healthBadge');
            const approvalBanner = document.getElementById('approvalBanner');
            const approvalReason = document.getElementById('approvalReason');
            const approvalSQL = document.getElementById('approvalSQL');
            const btnApprove = document.getElementById('btnApprove');
            const btnReject = document.getElementById('btnReject');
            const btnMetrics = document.getElementById('btnMetrics');
            const metricsPanel = document.getElementById('metricsPanel');
            const btnCloseMetrics = document.getElementById('btnCloseMetrics');

            let currentApprovalId = null;
            let currentTaskId = null;
            let currentStatusEl = null;
            let currentContentEl = null;
            let currentAgentBox = null;

            async function checkHealth() {
                try {
                    const res = await fetch('/health');
                    const data = await res.json();
                    healthBadge.textContent = `${data.status.toUpperCase()} | Provider: ${data.llm_provider}`;
                    healthBadge.className = data.status === 'healthy' 
                        ? 'text-xs font-mono px-2 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : 'text-xs font-mono px-2 py-1 rounded bg-amber-950 text-amber-400 border border-amber-800';
                } catch {
                    healthBadge.textContent = 'OFFLINE';
                }
            }
            checkHealth();

            async function loadMetrics() {
                try {
                    const res = await fetch('/v1/metrics');
                    const m = await res.json();
                    document.getElementById('metricTotalReq').textContent = m.total_requests;
                    document.getElementById('metricSuccessRate').textContent = m.success_rate_percentage + '%';
                    document.getElementById('metricLatency').textContent = `${m.p50_latency_ms}ms / ${m.p95_latency_ms}ms`;
                    document.getElementById('metricTokens').textContent = `${m.total_tokens_consumed.toLocaleString()} ($0.00)`;

                    const driftAlert = document.getElementById('driftAlert');
                    if (m.drift_detected && m.drift_reasons && m.drift_reasons.length > 0) {
                        driftAlert.textContent = '⚠️ Drift Alert: ' + m.drift_reasons.join('; ');
                        driftAlert.classList.remove('hidden');
                    } else {
                        driftAlert.classList.add('hidden');
                    }
                } catch (e) {
                    console.error("Could not load metrics", e);
                }
            }

            btnMetrics.addEventListener('click', () => {
                metricsPanel.classList.toggle('hidden');
                if (!metricsPanel.classList.contains('hidden')) {
                    loadMetrics();
                }
            });
            btnCloseMetrics.addEventListener('click', () => metricsPanel.classList.add('hidden'));

            async function readSSEStream(response, statusEl, contentEl, agentBox) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split('\\n');
                    buffer = lines.pop();

                    let currentEvent = 'message';
                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            currentEvent = line.replace('event: ', '').trim();
                        } else if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '').trim();
                            try {
                                const parsed = JSON.parse(dataStr);
                                if (currentEvent === 'step_start') {
                                    statusEl.textContent = `⚡ Step ${parsed.step}/${parsed.max_steps}: Analyzing & executing...`;
                                } else if (currentEvent === 'token') {
                                    contentEl.textContent += parsed.delta;
                                } else if (currentEvent === 'approval_required') {
                                    currentApprovalId = parsed.approval_id;
                                    currentTaskId = parsed.task_id;
                                    currentStatusEl = statusEl;
                                    currentContentEl = contentEl;
                                    currentAgentBox = agentBox;

                                    statusEl.textContent = `⚠️ Menunggu Approval Manusia`;
                                    statusEl.className = 'text-xs text-amber-400 font-mono';
                                    approvalReason.textContent = (parsed.risk_reasons || []).join(", ");
                                    approvalSQL.textContent = parsed.sanitized_query || '';
                                    approvalBanner.classList.remove('hidden');
                                } else if (currentEvent === 'final_result') {
                                    statusEl.textContent = `✅ Selesai dalam ${parsed.total_steps} langkah`;
                                    statusEl.className = 'text-xs text-emerald-400 font-mono';
                                    
                                    if (parsed.metrics) {
                                        const perfBadge = document.createElement('div');
                                        perfBadge.className = 'text-[11px] text-slate-400 font-mono mt-1 pt-1 border-t border-slate-700/50';
                                        perfBadge.textContent = `⏱️ Total: ${parsed.metrics.total_latency_ms}ms | TTFT: ${parsed.metrics.ttft_ms || 0}ms | Tokens: ${parsed.metrics.total_tokens} | Cost: $0.00`;
                                        agentBox.appendChild(perfBadge);
                                    }

                                    if (parsed.sql_queries && parsed.sql_queries.length > 0) {
                                        const sqlBox = document.createElement('div');
                                        sqlBox.className = 'mt-3 p-2 bg-slate-950 rounded border border-slate-800 text-xs text-cyan-300 font-mono overflow-x-auto';
                                        sqlBox.innerHTML = '<strong>SQL Query (Sanitized):</strong><br>' + parsed.sql_queries.join('<br>');
                                        agentBox.appendChild(sqlBox);
                                    }

                                    if (parsed.tables && parsed.tables.length > 0) {
                                        parsed.tables.forEach(t => {
                                            const tbl = document.createElement('table');
                                            tbl.className = 'w-full text-xs text-left border-collapse mt-2 border border-slate-700';
                                            let ths = t.columns.map(c => `<th class="border border-slate-700 p-1 bg-slate-900">${c}</th>`).join('');
                                            let trs = t.rows.map(r => `<tr>${r.map(val => `<td class="border border-slate-800 p-1">${val ?? 'NULL'}</td>`).join('')}</tr>`).join('');
                                            tbl.innerHTML = `<thead><tr>${ths}</tr></thead><tbody>${trs}</tbody>`;
                                            agentBox.appendChild(tbl);
                                        });
                                    }
                                } else if (currentEvent === 'error') {
                                    statusEl.textContent = `❌ ${parsed.message}`;
                                    statusEl.className = 'text-xs text-rose-400 font-mono';
                                }
                            } catch (err) {}
                        }
                    }
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }
            }

            chatForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const q = queryInput.value.trim();
                if (!q) return;

                const userBox = document.createElement('div');
                userBox.className = 'bg-cyan-950/40 border border-cyan-800/50 p-3 rounded-xl ml-auto max-w-[80%] text-sm text-cyan-100';
                userBox.textContent = q;
                messagesDiv.appendChild(userBox);
                queryInput.value = '';
                submitBtn.disabled = true;

                const agentBox = document.createElement('div');
                agentBox.className = 'bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-sm space-y-3';
                agentBox.innerHTML = '<div class="text-xs text-cyan-400 font-mono animate-pulse">⏳ Agent loop planning...</div><div class="content whitespace-pre-wrap"></div>';
                messagesDiv.appendChild(agentBox);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                const statusEl = agentBox.querySelector('.animate-pulse');
                const contentEl = agentBox.querySelector('.content');

                try {
                    const response = await fetch('/v1/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: q })
                    });
                    await readSSEStream(response, statusEl, contentEl, agentBox);
                } catch (err) {
                    statusEl.textContent = `❌ Error: ${err.message}`;
                } finally {
                    submitBtn.disabled = false;
                }
            });

            btnApprove.addEventListener('click', async () => {
                if (!currentApprovalId || !currentTaskId) return;
                approvalBanner.classList.add('hidden');
                currentStatusEl.textContent = `⚡ Melanjutkan tugas setelah persetujuan...`;
                currentStatusEl.className = 'text-xs text-cyan-400 font-mono animate-pulse';

                await fetch(`/v1/approvals/${currentApprovalId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ decision: 'approved' })
                });

                const resumeResp = await fetch(`/v1/tasks/${currentTaskId}/resume`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ feedback: 'Query disetujui.' })
                });
                await readSSEStream(resumeResp, currentStatusEl, currentContentEl, currentAgentBox);
            });

            btnReject.addEventListener('click', async () => {
                if (!currentApprovalId || !currentTaskId) return;
                approvalBanner.classList.add('hidden');
                currentStatusEl.textContent = `⚡ Melanjutkan tugas dengan query alternatif...`;
                currentStatusEl.className = 'text-xs text-rose-400 font-mono animate-pulse';

                await fetch(`/v1/approvals/${currentApprovalId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ decision: 'rejected', reason: 'Query ditolak oleh human operator.' })
                });

                const resumeResp = await fetch(`/v1/tasks/${currentTaskId}/resume`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ feedback: 'Query ditolak, gunakan pendekatan lain.' })
                });
                await readSSEStream(resumeResp, currentStatusEl, currentContentEl, currentAgentBox);
            });
        </script>
    </body>
    </html>
    """

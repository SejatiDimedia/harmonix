"""FastAPI application with SSE streaming, healthcheck, and approval endpoints."""

import json
import logging
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from src.agent.manual_loop import ManualAgentLoop
from src.config import settings
from src.db.connection import check_db_health

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("harnessly.api")

app = FastAPI(
    title="Harnessly Data Analyst Agent API",
    description="Production-grade text-to-SQL agent with full harness, guardrails, and SSE streaming.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# In-memory approval store for pending HITL requests (will be backed by DB in M3)
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
            async for event in agent.run(user_query=request.query, task_id=request.task_id):
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


@app.post("/v1/approvals/{approval_id}", tags=["Agent"])
async def submit_approval(approval_id: str, request: ApprovalRequest):
    """Approve or reject a risky query that triggered the human-in-the-loop approval gate."""
    if approval_id not in pending_approvals:
        raise HTTPException(status_code=404, detail="Approval request not found or expired.")

    item = pending_approvals[approval_id]
    item["decision"] = request.decision
    item["reason"] = request.reason

    return {
        "approval_id": approval_id,
        "status": "processed",
        "decision": request.decision,
    }


@app.get("/", response_class=HTMLResponse, tags=["UI"])
async def web_ui():
    """Minimal zero-cost chat UI for testing agent streaming and SQL results."""
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
            <div id="healthBadge" class="text-xs font-mono px-2 py-1 rounded bg-slate-800 text-slate-300">Checking...</div>
        </header>

        <main class="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col gap-4">
            <div id="messages" class="flex-1 overflow-y-auto space-y-4 min-h-[400px] p-2">
                <div class="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 text-slate-300 text-sm">
                    👋 Halo! Saya Data Analyst Agent. Anda dapat menanyakan tren penjualan, perbandingan produk, atau metrik e-commerce. Seluruh query SQL tervalidasi AST & read-only secara aman.
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

            chatForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const q = queryInput.value.trim();
                if (!q) return;

                // Append user message
                const userBox = document.createElement('div');
                userBox.className = 'bg-cyan-950/40 border border-cyan-800/50 p-3 rounded-xl ml-auto max-w-[80%] text-sm text-cyan-100';
                userBox.textContent = q;
                messagesDiv.appendChild(userBox);
                queryInput.value = '';
                submitBtn.disabled = true;

                // Agent message placeholder
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

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });

                        const lines = buffer.split('\\n');
                        buffer = lines.pop(); // keep last incomplete chunk

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
                                    } else if (currentEvent === 'final_result') {
                                        statusEl.textContent = `✅ Selesai dalam ${parsed.total_steps} langkah`;
                                        statusEl.className = 'text-xs text-emerald-400 font-mono';
                                        
                                        // Render SQL citations if present
                                        if (parsed.sql_queries && parsed.sql_queries.length > 0) {
                                            const sqlBox = document.createElement('div');
                                            sqlBox.className = 'mt-3 p-2 bg-slate-950 rounded border border-slate-800 text-xs text-cyan-300 font-mono overflow-x-auto';
                                            sqlBox.innerHTML = '<strong>SQL Query (Sanitized):</strong><br>' + parsed.sql_queries.join('<br>');
                                            agentBox.appendChild(sqlBox);
                                        }

                                        // Render Tables if present
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
                } catch (err) {
                    statusEl.textContent = `❌ Error: ${err.message}`;
                } finally {
                    submitBtn.disabled = false;
                }
            });
        </script>
    </body>
    </html>
    """

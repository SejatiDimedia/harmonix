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
    """Claude AI-inspired warm aesthetic UI for Harnessly with live streaming, HITL gate, and observability."""
    return """<!DOCTYPE html>
<html lang="id" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Harnessly — AI Data Analyst Agent</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
                        serif: ['Newsreader', 'Georgia', 'serif'],
                        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                    },
                    colors: {
                        clay: {
                            50: '#fdf8f6',
                            100: '#f9eee9',
                            200: '#f3ded4',
                            300: '#e8c4b4',
                            400: '#daa18b',
                            500: '#d97757', // Claude Terracotta Signature
                            600: '#c55d3b',
                            700: '#a3482c',
                            800: '#833d27',
                            900: '#6d3624',
                            950: '#3a1a10',
                        },
                        stone: {
                            850: '#1e1d1b',
                            900: '#181816', // Warm deep charcoal
                            925: '#141413',
                            950: '#0f0e0d',
                        }
                    }
                }
            }
        }
    </script>
    <style>
        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #383633; border-radius: 9999px; }
        ::-webkit-scrollbar-thumb:hover { background: #4f4c47; }
        
        .code-syntax {
            font-family: 'JetBrains Mono', monospace;
            tab-size: 2;
        }
    </style>
</head>
<body class="bg-stone-900 text-[#ecebe6] min-h-screen flex flex-col font-sans antialiased selection:bg-clay-500/20 selection:text-clay-200">
    
    <!-- Top Navigation Bar -->
    <header class="border-b border-[#2d2b28] bg-stone-900/90 backdrop-blur-md sticky top-0 z-30 px-6 py-3.5 flex justify-between items-center">
        <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-clay-500/10 border border-clay-500/30 flex items-center justify-center text-clay-400 font-serif italic font-bold text-lg">
                H
            </div>
            <div>
                <div class="flex items-center gap-2">
                    <span class="font-serif text-lg tracking-tight font-medium text-[#f5f4ef]">Harnessly</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-[#272522] text-[#9b988f] border border-[#383632]">v0.1.0</span>
                </div>
                <p class="text-[11px] text-[#8e8b82] -mt-0.5 hidden sm:block">Production-grade AI Data Analyst Agent</p>
            </div>
        </div>

        <div class="flex items-center gap-3">
            <div id="healthBadge" class="flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono bg-[#22211e] text-[#9b988f] border border-[#312f2b]">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Connecting...</span>
            </div>

            <button id="btnMetrics" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#c9c7bf] bg-[#22211e] hover:bg-[#2b2a26] border border-[#383632] hover:border-[#4d4a44] transition shadow-sm">
                <svg class="w-3.5 h-3.5 text-clay-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>Observabilitas</span>
            </button>
        </div>
    </header>

    <!-- Metrics Drawer / Panel (Sliding Modal) -->
    <div id="metricsPanel" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
        <div class="w-full max-w-md bg-stone-900 border-l border-[#33312c] h-full p-6 flex flex-col gap-6 shadow-2xl overflow-y-auto">
            <div class="flex justify-between items-center border-b border-[#2d2b27] pb-4">
                <div>
                    <h3 class="font-serif text-lg text-[#f5f4ef] font-medium">Metrik Observabilitas</h3>
                    <p class="text-xs text-[#8e8b82]">Granular Tracer & Drift Alerts (OB-02, OB-03)</p>
                </div>
                <button id="btnCloseMetrics" class="text-[#8e8b82] hover:text-white p-1 rounded hover:bg-[#272522]">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div class="p-3.5 rounded-xl bg-[#201f1d] border border-[#2e2c28]">
                    <span class="text-[11px] text-[#8e8b82] uppercase tracking-wider font-mono">Total Requests</span>
                    <div id="metricTotalReq" class="text-xl font-semibold text-[#f5f4ef] mt-1 font-mono">-</div>
                </div>
                <div class="p-3.5 rounded-xl bg-[#201f1d] border border-[#2e2c28]">
                    <span class="text-[11px] text-[#8e8b82] uppercase tracking-wider font-mono">Success Rate</span>
                    <div id="metricSuccessRate" class="text-xl font-semibold text-emerald-400 mt-1 font-mono">-</div>
                </div>
                <div class="p-3.5 rounded-xl bg-[#201f1d] border border-[#2e2c28]">
                    <span class="text-[11px] text-[#8e8b82] uppercase tracking-wider font-mono">Latensi p50 / p95</span>
                    <div id="metricLatency" class="text-xl font-semibold text-clay-400 mt-1 font-mono">-</div>
                </div>
                <div class="p-3.5 rounded-xl bg-[#201f1d] border border-[#2e2c28]">
                    <span class="text-[11px] text-[#8e8b82] uppercase tracking-wider font-mono">Token & Cost</span>
                    <div id="metricTokens" class="text-xl font-semibold text-amber-300 mt-1 font-mono">-</div>
                </div>
            </div>

            <div id="driftAlert" class="hidden p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs font-mono"></div>

            <div class="p-4 rounded-xl bg-[#201f1d] border border-[#2e2c28] space-y-2 text-xs text-[#a8a59c]">
                <div class="font-medium text-[#e4e2d9] flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-clay-500"></span>
                    <span>Arsitektur Zero-Cost & Multi-Tier</span>
                </div>
                <p>Seluruh trace latensi, TTFT, dan span dicatat secara persisten ke tabel PostgreSQL <code>analytics.agent_traces</code> dengan zero runtime API cost.</p>
            </div>
        </div>
    </div>

    <!-- Main Container -->
    <main class="flex-1 max-w-3xl w-full mx-auto px-4 py-6 flex flex-col justify-between">
        
        <!-- Messages Flow -->
        <div id="messages" class="flex-1 space-y-6 overflow-y-auto pb-8">
            
            <!-- Welcome Hero (Claude Style) -->
            <div id="welcomeHero" class="pt-8 pb-4 text-center max-w-xl mx-auto space-y-4">
                <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-clay-500/10 border border-clay-500/20 text-clay-400 mb-2">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                    </svg>
                </div>
                <h1 class="font-serif text-3xl sm:text-4xl font-normal text-[#f5f4ef] tracking-tight">
                    Ada data analitik yang ingin Anda bedah?
                </h1>
                <p class="text-sm text-[#9b988f] leading-relaxed">
                    Ajukan pertanyaan seputar metrik penjualan, tren produk, atau performa pesanan. Didukung AST Guardrail, RAG Glosarium Metrik lokal, dan persetujuan analis.
                </p>

                <!-- Quick Prompt Chips -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-4 text-left">
                    <button class="prompt-chip p-3 rounded-xl bg-[#201f1d] hover:bg-[#282724] border border-[#2e2c28] hover:border-[#423f3a] text-xs text-[#cfccc4] transition group flex items-start gap-2.5" data-query="Berapa total GMV dan tren penjualan bulanan?">
                        <span class="text-clay-400 mt-0.5">📊</span>
                        <div>
                            <div class="font-medium text-[#e8e6dd] group-hover:text-clay-300">Total GMV & Tren</div>
                            <div class="text-[11px] text-[#817e75]">Hitung pendapatan kotor dengan rumus resmi</div>
                        </div>
                    </button>
                    <button class="prompt-chip p-3 rounded-xl bg-[#201f1d] hover:bg-[#282724] border border-[#2e2c28] hover:border-[#423f3a] text-xs text-[#cfccc4] transition group flex items-start gap-2.5" data-query="Kategori produk apa yang memiliki pesanan terbanyak?">
                        <span class="text-clay-400 mt-0.5">🏆</span>
                        <div>
                            <div class="font-medium text-[#e8e6dd] group-hover:text-clay-300">Produk Terlaris</div>
                            <div class="text-[11px] text-[#817e75]">Peringkat volume transaksi per kategori</div>
                        </div>
                    </button>
                    <button class="prompt-chip p-3 rounded-xl bg-[#201f1d] hover:bg-[#282724] border border-[#2e2c28] hover:border-[#423f3a] text-xs text-[#cfccc4] transition group flex items-start gap-2.5" data-query="Uji AST Guardrail: DROP TABLE analytics.customers;">
                        <span class="text-rose-400 mt-0.5">🛡️</span>
                        <div>
                            <div class="font-medium text-[#e8e6dd] group-hover:text-rose-300">Uji Keamanan (AST)</div>
                            <div class="text-[11px] text-[#817e75]">Coba eksekusi perintah DROP TABLE berbahaya</div>
                        </div>
                    </button>
                    <button class="prompt-chip p-3 rounded-xl bg-[#201f1d] hover:bg-[#282724] border border-[#2e2c28] hover:border-[#423f3a] text-xs text-[#cfccc4] transition group flex items-start gap-2.5" data-query="Tampilkan daftar email dan nomor telepon semua pelanggan">
                        <span class="text-amber-400 mt-0.5">⚠️</span>
                        <div>
                            <div class="font-medium text-[#e8e6dd] group-hover:text-amber-300">Uji Approval Gate</div>
                            <div class="text-[11px] text-[#817e75]">Permintaan akses data pribadi pelanggan (PII)</div>
                        </div>
                    </button>
                </div>
            </div>

        </div>

        <!-- Human-in-the-Loop Approval Modal / Card -->
        <div id="approvalBanner" class="hidden mb-4 p-4 rounded-2xl bg-[#241f17] border border-amber-600/40 text-amber-200 shadow-xl space-y-3 animate-fade-in">
            <div class="flex items-center gap-2.5 text-sm font-medium text-amber-300">
                <svg class="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Konfirmasi Diperlukan: Query Berisiko Tinggi Terdeteksi</span>
            </div>
            <p id="approvalReason" class="text-xs text-[#c9bfa8] leading-relaxed"></p>
            <div class="p-2.5 rounded-lg bg-[#151310] border border-[#383124] text-[11px] font-mono text-amber-300 overflow-x-auto">
                <code id="approvalSQL"></code>
            </div>
            <div class="flex items-center gap-2 pt-1">
                <button id="btnApprove" class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-clay-500 hover:bg-clay-600 text-white transition shadow-sm">
                    Setujui Eksekusi
                </button>
                <button id="btnReject" class="px-4 py-1.5 rounded-lg text-xs font-medium text-[#9b988f] hover:text-[#ecebe6] bg-[#22211e] hover:bg-[#2b2a26] border border-[#383632] transition">
                    Tolak Query
                </button>
            </div>
        </div>

        <!-- Floating Chat Input (Claude Style) -->
        <div class="sticky bottom-0 z-20 pt-2 pb-2 bg-gradient-to-t from-stone-900 via-stone-900 to-transparent">
            <form id="chatForm" class="relative rounded-2xl bg-[#201f1d] border border-[#33312c] focus-within:border-clay-500/80 focus-within:ring-1 focus-within:ring-clay-500/50 shadow-xl transition">
                <textarea id="queryInput" rows="2" placeholder="Tanyakan tentang data penjualan, analisis pelanggan, atau uji metrik..." 
                    class="w-full bg-transparent px-4 pt-3.5 pb-12 text-sm text-[#f5f4ef] placeholder-[#76736a] resize-none focus:outline-none" required></textarea>
                
                <div class="absolute bottom-2.5 left-3.5 right-3 flex justify-between items-center text-[11px] text-[#76736a]">
                    <span class="hidden sm:inline font-mono text-[10px]">Tekan Enter untuk kirim, Shift+Enter untuk baris baru</span>
                    <span class="sm:hidden"></span>
                    <button type="submit" id="submitBtn" class="w-8 h-8 rounded-xl bg-clay-500 hover:bg-clay-600 disabled:opacity-40 text-white flex items-center justify-center transition shadow-sm ml-auto">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>
            </form>
            <div class="text-center text-[10px] text-[#6d6b63] pt-2">
                Harnessly v0.1.0 — 100% Zero-Cost Architecture (Ollama / Gemini Free Tier)
            </div>
        </div>

    </main>

    <script>
        const messagesDiv = document.getElementById('messages');
        const welcomeHero = document.getElementById('welcomeHero');
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

        // Auto-expand textarea
        queryInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (Math.min(this.scrollHeight, 180)) + 'px';
        });

        // Enter to submit, Shift+Enter for newline
        queryInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                chatForm.dispatchEvent(new Event('submit'));
            }
        });

        // Quick prompt chips
        document.querySelectorAll('.prompt-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                queryInput.value = chip.getAttribute('data-query');
                queryInput.dispatchEvent(new Event('input'));
                chatForm.dispatchEvent(new Event('submit'));
            });
        });

        async function checkHealth() {
            try {
                const res = await fetch('/health');
                const data = await res.json();
                healthBadge.innerHTML = `
                    <span class="w-1.5 h-1.5 rounded-full ${data.status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
                    <span>${data.llm_provider.toUpperCase()} (${data.status})</span>
                `;
            } catch {
                healthBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span><span>OFFLINE</span>`;
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
                    driftAlert.textContent = '⚠️ Peringatan Anomali: ' + m.drift_reasons.join('; ');
                    driftAlert.classList.remove('hidden');
                } else {
                    driftAlert.classList.add('hidden');
                }
            } catch (e) {
                console.error("Could not load metrics", e);
            }
        }

        btnMetrics.addEventListener('click', () => {
            metricsPanel.classList.remove('hidden');
            loadMetrics();
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
                                statusEl.innerHTML = `
                                    <span class="inline-block w-2 h-2 rounded-full bg-clay-500 animate-ping mr-1"></span>
                                    <span>Langkah ${parsed.step}/${parsed.max_steps}: Menginspeksi skema & glosarium...</span>
                                `;
                            } else if (currentEvent === 'token') {
                                contentEl.textContent += parsed.delta;
                            } else if (currentEvent === 'approval_required') {
                                currentApprovalId = parsed.approval_id;
                                currentTaskId = parsed.task_id;
                                currentStatusEl = statusEl;
                                currentContentEl = contentEl;
                                currentAgentBox = agentBox;

                                statusEl.innerHTML = `
                                    <span class="text-amber-400 font-mono">⚠️ Menunggu Persetujuan Operator</span>
                                `;
                                approvalReason.textContent = (parsed.risk_reasons || []).join(", ");
                                approvalSQL.textContent = parsed.sanitized_query || '';
                                approvalBanner.classList.remove('hidden');
                                approvalBanner.scrollIntoView({ behavior: 'smooth' });
                            } else if (currentEvent === 'final_result') {
                                statusEl.innerHTML = `
                                    <span class="text-emerald-400 font-mono text-[11px]">✓ Selesai (${parsed.total_steps} langkah)</span>
                                `;
                                
                                if (parsed.metrics) {
                                    const perfBadge = document.createElement('div');
                                    perfBadge.className = 'text-[11px] text-[#7f7c74] font-mono mt-3 pt-2.5 border-t border-[#2e2c28] flex items-center justify-between';
                                    perfBadge.innerHTML = `
                                        <span>⏱️ Latensi: ${parsed.metrics.total_latency_ms}ms (TTFT: ${parsed.metrics.ttft_ms || 0}ms)</span>
                                        <span>Token: ${parsed.metrics.total_tokens} (USD 0.00)</span>
                                    `;
                                    agentBox.appendChild(perfBadge);
                                }

                                if (parsed.sql_queries && parsed.sql_queries.length > 0) {
                                    const sqlBox = document.createElement('div');
                                    sqlBox.className = 'mt-3 rounded-xl bg-[#141413] border border-[#2d2b27] overflow-hidden';
                                    const sqlHeader = document.createElement('div');
                                    sqlHeader.className = 'px-3 py-1.5 bg-[#1b1a18] border-b border-[#2d2b27] text-[10px] font-mono text-[#8b877d] flex justify-between items-center';
                                    sqlHeader.innerHTML = `
                                        <span>POSTGRESQL (SANITIZED & LIMIT 100)</span>
                                        <button class="copy-sql-btn hover:text-white transition">Salin SQL</button>
                                    `;
                                    const sqlContent = document.createElement('pre');
                                    sqlContent.className = 'p-3 text-[11px] font-mono text-clay-300 overflow-x-auto';
                                    sqlContent.textContent = parsed.sql_queries.join('\\n\\n');

                                    const copyBtn = sqlHeader.querySelector('.copy-sql-btn');
                                    copyBtn.addEventListener('click', () => {
                                        navigator.clipboard.writeText(parsed.sql_queries.join('\\n\\n'));
                                        copyBtn.textContent = 'Tersalin!';
                                        setTimeout(() => copyBtn.textContent = 'Salin SQL', 2000);
                                    });

                                    sqlBox.appendChild(sqlHeader);
                                    sqlBox.appendChild(sqlContent);
                                    agentBox.appendChild(sqlBox);
                                }

                                if (parsed.tables && parsed.tables.length > 0) {
                                    parsed.tables.forEach(t => {
                                        const tblWrap = document.createElement('div');
                                        tblWrap.className = 'mt-3 rounded-xl border border-[#2e2c28] overflow-hidden overflow-x-auto bg-[#1b1a18]';
                                        const tbl = document.createElement('table');
                                        tbl.className = 'w-full text-xs text-left border-collapse';
                                        let ths = t.columns.map(c => `<th class="p-2 text-[11px] font-mono uppercase bg-[#242320] text-[#a8a59c] border-b border-[#2e2c28]">${c}</th>`).join('');
                                        let trs = t.rows.map((r, i) => `
                                            <tr class="${i % 2 === 0 ? 'bg-[#1b1a18]' : 'bg-[#1e1d1b]'} hover:bg-[#262522] transition">
                                                ${r.map(val => `<td class="p-2 border-b border-[#262421] text-[#dedcd5] font-mono text-[11px]">${val ?? '<span class="text-stone-600">NULL</span>'}</td>`).join('')}
                                            </tr>
                                        `).join('');
                                        tbl.innerHTML = `<thead><tr>${ths}</tr></thead><tbody>${trs}</tbody>`;
                                        tblWrap.appendChild(tbl);
                                        agentBox.appendChild(tblWrap);
                                    });
                                }
                            } else if (currentEvent === 'error') {
                                statusEl.innerHTML = `<span class="text-rose-400 font-mono text-xs">✕ ${parsed.message}</span>`;
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

            if (welcomeHero) {
                welcomeHero.classList.add('hidden');
            }

            // User Message Card (Clean Stone Pill)
            const userBox = document.createElement('div');
            userBox.className = 'flex justify-end';
            userBox.innerHTML = `
                <div class="max-w-[85%] rounded-2xl bg-[#262522] border border-[#383632] px-4 py-3 text-sm text-[#f5f4ef] leading-relaxed shadow-sm">
                    ${q}
                </div>
            `;
            messagesDiv.appendChild(userBox);
            queryInput.value = '';
            queryInput.style.height = 'auto';
            submitBtn.disabled = true;

            // Assistant Message Container (Editorial Claude Aesthetic)
            const agentContainer = document.createElement('div');
            agentContainer.className = 'flex gap-3 text-sm text-[#ecebe6]';
            agentContainer.innerHTML = `
                <div class="w-7 h-7 rounded-lg bg-clay-500/10 border border-clay-500/30 flex items-center justify-center text-clay-400 font-serif italic text-xs shrink-0 mt-0.5">
                    H
                </div>
                <div class="agent-box flex-1 space-y-2 leading-relaxed">
                    <div class="status text-xs text-[#8e8b82] font-mono flex items-center gap-1.5">
                        <span class="inline-block w-2 h-2 rounded-full bg-clay-500 animate-pulse"></span>
                        <span>Merancang rencana analitik...</span>
                    </div>
                    <div class="content whitespace-pre-wrap font-sans text-sm text-[#f0efe9]"></div>
                </div>
            `;
            messagesDiv.appendChild(agentContainer);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            const agentBox = agentContainer.querySelector('.agent-box');
            const statusEl = agentBox.querySelector('.status');
            const contentEl = agentBox.querySelector('.content');

            try {
                const response = await fetch('/v1/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q })
                });
                await readSSEStream(response, statusEl, contentEl, agentBox);
            } catch (err) {
                statusEl.innerHTML = `<span class="text-rose-400">✕ Error: ${err.message}</span>`;
            } finally {
                submitBtn.disabled = false;
            }
        });

        btnApprove.addEventListener('click', async () => {
            if (!currentApprovalId || !currentTaskId) return;
            approvalBanner.classList.add('hidden');
            currentStatusEl.innerHTML = `<span class="text-clay-400 font-mono text-xs">⚡ Mengeksekusi query yang disetujui...</span>`;

            await fetch(`/v1/approvals/${currentApprovalId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: 'approved' })
            });

            const resumeResp = await fetch(`/v1/tasks/${currentTaskId}/resume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feedback: 'Query disetujui oleh analis.' })
            });
            await readSSEStream(resumeResp, currentStatusEl, currentContentEl, currentAgentBox);
        });

        btnReject.addEventListener('click', async () => {
            if (!currentApprovalId || !currentTaskId) return;
            approvalBanner.classList.add('hidden');
            currentStatusEl.innerHTML = `<span class="text-rose-400 font-mono text-xs">⚡ Membatalkan dan menyusun query alternatif...</span>`;

            await fetch(`/v1/approvals/${currentApprovalId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: 'rejected', reason: 'Query ditolak oleh analis manusia.' })
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

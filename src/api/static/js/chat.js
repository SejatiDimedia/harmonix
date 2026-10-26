/**
 * Chat Stream Controller, SSE Reader & Multi-Turn Session Manager (FR-01, FR-09, FR-16, FR-19)
 */

import {
    appState,
    escapeHtml,
    formatSQL,
    formatSessionDate,
    showToast,
    ensureSessionId,
} from './state.js';

import {
    renderSQLBox,
    renderTables,
    renderCharts,
    renderMetrics,
    renderFollowUpSuggestions,
    renderAuditResult,
} from './components.js';

import { updateBadgeLabel } from './model-picker.js';

const messagesDiv = document.getElementById('messages');
const welcomeHero = document.getElementById('welcomeHero');
const queryInput = document.getElementById('queryInput');
const submitBtn = document.getElementById('submitBtn');
const historySidebar = document.getElementById('historySidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const sessionList = document.getElementById('sessionList');
const sessionCountText = document.getElementById('sessionCountText');
const approvalBanner = document.getElementById('approvalBanner');
const approvalReason = document.getElementById('approvalReason');
const approvalSQL = document.getElementById('approvalSQL');

export function clearMessagesView() {
    if (!messagesDiv) return;
    const children = Array.from(messagesDiv.children);
    for (const child of children) {
        if (child !== welcomeHero) {
            messagesDiv.removeChild(child);
        }
    }
}

export function showWelcomeHero() {
    if (welcomeHero) welcomeHero.classList.remove('hidden');
}

export function hideWelcomeHero() {
    if (welcomeHero) welcomeHero.classList.add('hidden');
}

export async function loadSessions() {
    try {
        const res = await fetch('/v1/sessions?limit=50');
        if (!res.ok) return;
        const data = await res.json();
        appState.cachedSessions = data.sessions || [];
        if (sessionCountText) sessionCountText.textContent = `${appState.cachedSessions.length} sesi`;
        renderSessionList();
    } catch (e) {
        console.error("Failed to load sessions:", e);
    }
}

export function renderSessionList() {
    if (!sessionList) return;
    if (appState.cachedSessions.length === 0) {
        sessionList.innerHTML = `
            <div class="p-6 text-center text-xs text-[#78756d]">
                <p class="font-serif italic text-sm text-[#9c9990]">Belum ada riwayat</p>
                <p class="text-[11px] mt-1">Mulai ajukan pertanyaan data analitik pertama Anda.</p>
            </div>
        `;
        return;
    }

    sessionList.innerHTML = '';
    appState.cachedSessions.forEach(s => {
        const isActive = s.session_id === appState.currentSessionId;
        const item = document.createElement('div');
        item.className = `session-item group relative flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition text-xs border ${
            isActive 
                ? 'bg-[#282622] text-[#f5f4ef] border-clay-500/40 shadow-sm' 
                : 'text-[#a3a097] hover:bg-[#201f1d] hover:text-[#e4e2d9] border-transparent'
        }`;
        item.setAttribute('data-session-id', s.session_id);
        item.innerHTML = `
            <div class="flex items-start gap-2.5 min-w-0 flex-1 pr-1">
                <svg class="w-4 h-4 mt-0.5 shrink-0 ${isActive ? 'text-clay-400' : 'text-[#817e75] group-hover:text-clay-400'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <div class="min-w-0 flex-1">
                    <div class="font-medium truncate leading-tight">${escapeHtml(s.title || 'Percakapan')}</div>
                    <div class="text-[10px] text-[#78756d] mt-1 font-mono flex items-center gap-1.5">
                        <span>${s.total_turns} pesan</span>
                        <span>•</span>
                        <span>${formatSessionDate(s.last_activity || s.created_at)}</span>
                    </div>
                </div>
            </div>
            <button class="btn-delete-session opacity-0 group-hover:opacity-100 p-1 rounded-lg text-[#817e75] hover:text-rose-400 hover:bg-rose-950/40 transition shrink-0 cursor-pointer" title="Hapus sesi">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        `;

        item.addEventListener('click', () => {
            switchSession(s.session_id);
        });

        const btnDel = item.querySelector('.btn-delete-session');
        btnDel.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSessionConfirm(s.session_id, s.title);
        });

        sessionList.appendChild(item);
    });
}

export async function switchSession(sessionId) {
    if (!sessionId) return;
    try {
        const res = await fetch(`/v1/sessions/${sessionId}`);
        if (!res.ok) {
            if (res.status === 404) {
                localStorage.removeItem('harnessly_session_id');
                appState.currentSessionId = null;
                showWelcomeHero();
                loadSessions();
            }
            return;
        }
        const data = await res.json();
        appState.currentSessionId = sessionId;
        localStorage.setItem('harnessly_session_id', sessionId);

        // Restore session-scoped active model if recorded (FR-36 & Phase 2)
        if (data.active_provider && data.active_model) {
            appState.activeAnalystProvider = data.active_provider;
            appState.activeAnalystModel = data.active_model;
            updateBadgeLabel();
        }

        clearMessagesView();
        hideWelcomeHero();
        renderSessionList();

        for (const turn of (data.turns || [])) {
            // User bubble
            const userBox = document.createElement('div');
            userBox.className = 'flex justify-end';
            userBox.innerHTML = `
                <div class="max-w-[85%] rounded-2xl bg-[#262522] border border-[#383632] px-4 py-3 text-sm text-[#f5f4ef] leading-relaxed shadow-sm">
                    ${escapeHtml(turn.user_query)}
                </div>
            `;
            messagesDiv.appendChild(userBox);

            // Assistant container
            const agentContainer = document.createElement('div');
            agentContainer.className = 'flex gap-3 text-sm text-[#ecebe6]';
            agentContainer.innerHTML = `
                <img src="/static/favicon.png" alt="Harnessly" class="w-7 h-7 rounded-lg object-cover border border-clay-500/30 shrink-0 mt-0.5 select-none shadow-sm" />
                <div class="agent-box flex-1 space-y-2 leading-relaxed">
                    <div class="status text-xs font-mono flex items-center gap-1">
                        <span class="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                            <svg class="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Selesai</span>
                        </span>
                    </div>
                    <div class="content markdown-body"></div>
                </div>
            `;
            messagesDiv.appendChild(agentContainer);
            const agentBox = agentContainer.querySelector('.agent-box');
            const contentEl = agentBox.querySelector('.content');

            if (turn.answer_text && window.marked && window.DOMPurify) {
                contentEl.innerHTML = DOMPurify.sanitize(marked.parse(turn.answer_text));
            } else {
                contentEl.textContent = turn.answer_text || '';
            }

            if (turn.sql_queries && turn.sql_queries.length > 0) {
                renderSQLBox(turn.sql_queries, agentBox);
            }
            if (turn.tables && turn.tables.length > 0) {
                renderTables(turn.tables, agentBox);
            }
            if (turn.charts && turn.charts.length > 0) {
                renderCharts(turn.charts, turn.tables, agentBox);
            }
            if (turn.metrics) {
                renderMetrics(turn.metrics, agentBox);
            }
            if (turn.follow_up_suggestions && turn.follow_up_suggestions.length > 0) {
                renderFollowUpSuggestions(turn.follow_up_suggestions, agentBox, (suggestionText) => {
                    handleQuickSubmit(suggestionText);
                });
            }
            if (turn.audit_result) {
                renderAuditResult(turn.audit_result, agentBox);
            }
        }
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        if (window.innerWidth < 768) {
            closeSidebarMobile();
        }
    } catch (e) {
        console.error("Error switching session:", e);
    }
}

export function startNewChat() {
    appState.currentSessionId = null;
    localStorage.removeItem('harnessly_session_id');
    clearMessagesView();
    showWelcomeHero();
    renderSessionList();
    if (queryInput) queryInput.focus();
    if (window.innerWidth < 768) {
        closeSidebarMobile();
    }
}

export async function deleteSessionConfirm(sessionId, title) {
    const ok = confirm(`Hapus riwayat percakapan:\n"${title || 'Sesi ini'}"?`);
    if (!ok) return;

    try {
        const res = await fetch(`/v1/sessions/${sessionId}`, { method: 'DELETE' });
        if (res.ok) {
            if (appState.currentSessionId === sessionId) {
                startNewChat();
            }
            loadSessions();
        }
    } catch (e) {
        console.error("Failed to delete session:", e);
    }
}

export function toggleSidebar() {
    if (!historySidebar) return;
    if (window.innerWidth < 768) {
        const isClosed = historySidebar.classList.contains('-translate-x-full');
        if (isClosed) {
            historySidebar.classList.remove('-translate-x-full');
            if (sidebarBackdrop) sidebarBackdrop.classList.remove('hidden');
        } else {
            closeSidebarMobile();
        }
    } else {
        historySidebar.classList.toggle('md:hidden');
    }
}

export function closeSidebarMobile() {
    if (historySidebar) historySidebar.classList.add('-translate-x-full');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
}

export async function readSSEStream(response, statusEl, contentEl, agentBox) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedMarkdown = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
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
                            <span class="inline-block w-2 h-2 rounded-full bg-clay-500 animate-pulse mr-1.5"></span>
                            <span>Langkah ${parsed.step}/${parsed.max_steps}: Menginspeksi skema & glosarium...</span>
                        `;
                        if (parsed.step > 1) {
                            accumulatedMarkdown = '';
                        }
                    } else if (currentEvent === 'token') {
                        accumulatedMarkdown += parsed.delta;
                        if (window.marked && window.DOMPurify) {
                            contentEl.innerHTML = DOMPurify.sanitize(marked.parse(accumulatedMarkdown));
                        } else {
                            contentEl.textContent = accumulatedMarkdown;
                        }
                    } else if (currentEvent === 'approval_required') {
                        appState.pendingApproval.id = parsed.approval_id;
                        appState.pendingApproval.taskId = parsed.task_id;
                        appState.pendingApproval.statusEl = statusEl;
                        appState.pendingApproval.contentEl = contentEl;
                        appState.pendingApproval.agentBox = agentBox;

                        statusEl.innerHTML = `
                            <span class="text-amber-400 font-mono text-xs flex items-center gap-1.5">
                                <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                <span>Menunggu Persetujuan Operator</span>
                            </span>
                        `;
                        if (approvalReason) approvalReason.textContent = (parsed.risk_reasons || []).join(", ");
                        if (approvalSQL) approvalSQL.textContent = formatSQL(parsed.sanitized_query || '');
                        if (approvalBanner) {
                            approvalBanner.classList.remove('hidden');
                            approvalBanner.scrollIntoView({ behavior: 'smooth' });
                        }
                    } else if (currentEvent === 'audit_step') {
                        const aStatus = (parsed.status || 'auditing').toLowerCase();
                        if (aStatus === 'auditing') {
                            statusEl.innerHTML = `
                                <span class="text-indigo-400 font-mono text-[11px] flex items-center gap-1.5 animate-pulse">
                                    <svg class="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>[Data Auditor] Memverifikasi logika SQL & konsistensi angka...</span>
                                </span>
                            `;
                        } else if (aStatus === 'passed') {
                            statusEl.innerHTML = `
                                <span class="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                                    <span>🛡️ Auditor: Verified (${Math.round((parsed.confidence_score || 1) * 100)}%)</span>
                                </span>
                            `;
                        } else {
                            statusEl.innerHTML = `
                                <span class="text-amber-400 font-mono text-[11px] flex items-center gap-1">
                                    <span>⚠️ Auditor: ${escapeHtml(parsed.badge || 'Flagged')}</span>
                                </span>
                            `;
                        }
                    } else if (currentEvent === 'final_result') {
                        statusEl.innerHTML = `
                            <span class="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                                <svg class="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                </svg>
                                <span>Selesai (${parsed.total_steps || 1} langkah)</span>
                            </span>
                        `;

                        const finalMarkdown = parsed.answer_text || accumulatedMarkdown;
                        if (finalMarkdown && window.marked && window.DOMPurify) {
                            contentEl.innerHTML = DOMPurify.sanitize(marked.parse(finalMarkdown));
                        }

                        if (parsed.sql_queries && parsed.sql_queries.length > 0) {
                            renderSQLBox(parsed.sql_queries, agentBox);
                        }

                        if (parsed.tables && parsed.tables.length > 0) {
                            renderTables(parsed.tables, agentBox);
                        }

                        if (parsed.charts && parsed.charts.length > 0) {
                            renderCharts(parsed.charts, parsed.tables, agentBox);
                        }

                        if (parsed.metrics) {
                            renderMetrics(parsed.metrics, agentBox);
                        }

                        if (parsed.follow_up_suggestions && parsed.follow_up_suggestions.length > 0) {
                            renderFollowUpSuggestions(parsed.follow_up_suggestions, agentBox, (suggestionText) => {
                                handleQuickSubmit(suggestionText);
                            });
                        }

                        if (parsed.audit_result) {
                            renderAuditResult(parsed.audit_result, agentBox);
                        }

                        // Refresh session list to reflect new/updated session
                        loadSessions();
                    } else if (currentEvent === 'error') {
                        statusEl.innerHTML = `<span class="text-rose-400 font-mono text-xs flex items-center gap-1.5"><svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><span>${parsed.message}</span></span>`;
                    }
                } catch (err) {}
            }
        }
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

export async function submitChatMessage(questionText) {
    const q = (questionText || (queryInput ? queryInput.value : '')).trim();
    if (!q) return;

    hideWelcomeHero();

    // User Message Card (Clean Stone Pill)
    const userBox = document.createElement('div');
    userBox.className = 'flex justify-end';
    userBox.innerHTML = `
        <div class="max-w-[85%] rounded-2xl bg-[#262522] border border-[#383632] px-4 py-3 text-sm text-[#f5f4ef] leading-relaxed shadow-sm">
            ${escapeHtml(q)}
        </div>
    `;
    messagesDiv.appendChild(userBox);
    if (queryInput) {
        queryInput.value = '';
        queryInput.style.height = 'auto';
    }
    if (submitBtn) submitBtn.disabled = true;

    // Assistant Message Container (Editorial Claude Aesthetic)
    const agentContainer = document.createElement('div');
    agentContainer.className = 'flex gap-3 text-sm text-[#ecebe6]';
    agentContainer.innerHTML = `
        <img src="/static/favicon.png" alt="Harnessly" class="w-7 h-7 rounded-lg object-cover border border-clay-500/30 shrink-0 mt-0.5 select-none shadow-sm" />
        <div class="agent-box flex-1 space-y-2 leading-relaxed">
            <div class="status text-xs text-[#9c9990] font-mono flex items-center gap-1.5">
                <span class="inline-block w-2 h-2 rounded-full bg-clay-500 animate-pulse"></span>
                <span>[${appState.currentEngine === 'langgraph' ? 'LangGraph' : 'Manual Loop'}] Merancang rencana analitik...</span>
            </div>
            <div class="content markdown-body"></div>
        </div>
    `;
    messagesDiv.appendChild(agentContainer);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const agentBox = agentContainer.querySelector('.agent-box');
    const statusEl = agentBox.querySelector('.status');
    const contentEl = agentBox.querySelector('.content');

    const sid = ensureSessionId();

    try {
        const response = await fetch('/v1/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: q,
                engine: appState.currentEngine,
                session_id: sid,
                provider: appState.activeAnalystProvider,
                model: appState.activeAnalystModel,
                auditor_provider: appState.activeAuditorProvider,
                auditor_model: appState.activeAuditorModel
            })
        });
        await readSSEStream(response, statusEl, contentEl, agentBox);
    } catch (err) {
        statusEl.innerHTML = `<span class="text-rose-400 font-mono text-xs flex items-center gap-1.5"><svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><span>Error: ${err.message}</span></span>`;
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

export function handleQuickSubmit(text) {
    if (!text) return;
    if (queryInput) {
        queryInput.value = text;
        queryInput.dispatchEvent(new Event('input'));
    }
    submitChatMessage(text);
}

export async function approveCurrentTask() {
    const { id, taskId, statusEl, contentEl, agentBox } = appState.pendingApproval;
    if (!id || !taskId) return;
    if (approvalBanner) approvalBanner.classList.add('hidden');
    if (statusEl) {
        statusEl.innerHTML = `<span class="text-clay-400 font-mono text-xs flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-clay-400 animate-pulse"></span> Mengeksekusi query yang disetujui...</span>`;
    }

    await fetch(`/v1/approvals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' })
    });

    const resumeResp = await fetch(`/v1/tasks/${taskId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Query disetujui oleh analis.' })
    });
    await readSSEStream(resumeResp, statusEl, contentEl, agentBox);
}

export async function rejectCurrentTask() {
    const { id, taskId, statusEl, contentEl, agentBox } = appState.pendingApproval;
    if (!id || !taskId) return;
    if (approvalBanner) approvalBanner.classList.add('hidden');
    if (statusEl) {
        statusEl.innerHTML = `<span class="text-rose-400 font-mono text-xs flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> Membatalkan dan menyusun query alternatif...</span>`;
    }

    await fetch(`/v1/approvals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected', reason: 'Query ditolak oleh analis manusia.' })
    });

    const resumeResp = await fetch(`/v1/tasks/${taskId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Query ditolak, gunakan pendekatan lain.' })
    });
    await readSSEStream(resumeResp, statusEl, contentEl, agentBox);
}

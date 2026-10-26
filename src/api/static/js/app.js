/**
 * Application Entry Point (Vanilla ES Module Architecture)
 */

import { appState, showToast } from './state.js';
import {
    fetchModelCatalog,
    openModelModal,
    closeModelModal,
    saveModelModal,
    toggleInputModelPopover,
    closeInputModelPopover,
    syncAnalystModels,
    syncAuditorModels,
    updateAnalystDesc,
    updateAuditorDesc,
} from './model-picker.js';
import {
    loadSessions,
    switchSession,
    startNewChat,
    submitChatMessage,
    handleQuickSubmit,
    approveCurrentTask,
    rejectCurrentTask,
    toggleSidebar,
    closeSidebarMobile,
} from './chat.js';

// DOM Elements
const healthBadge = document.getElementById('healthBadge');
const chatForm = document.getElementById('chatForm');
const queryInput = document.getElementById('queryInput');
const btnEngineManual = document.getElementById('btnEngineManual');
const btnEngineLangGraph = document.getElementById('btnEngineLangGraph');
const btnMetrics = document.getElementById('btnMetrics');
const metricsPanel = document.getElementById('metricsPanel');
const btnCloseMetrics = document.getElementById('btnCloseMetrics');

const btnManageModel = document.getElementById('btnManageModel');
const btnInputModelPicker = document.getElementById('btnInputModelPicker');
const btnCloseInputModelPopover = document.getElementById('btnCloseInputModelPopover');
const btnOpenFullModalFromPopover = document.getElementById('btnOpenFullModalFromPopover');
const inputModelPopover = document.getElementById('inputModelPopover');
const btnCloseModelModal = document.getElementById('btnCloseModelModal');
const btnCancelModelModal = document.getElementById('btnCancelModelModal');
const btnSaveModelModal = document.getElementById('btnSaveModelModal');
const selectAnalystProvider = document.getElementById('selectAnalystProvider');
const selectAnalystModel = document.getElementById('selectAnalystModel');
const selectAuditorProvider = document.getElementById('selectAuditorProvider');
const selectAuditorModel = document.getElementById('selectAuditorModel');

const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const btnCloseSidebarMobile = document.getElementById('btnCloseSidebarMobile');
const btnNewChat = document.getElementById('btnNewChat');
const btnRefreshSessions = document.getElementById('btnRefreshSessions');
const btnApprove = document.getElementById('btnApprove');
const btnReject = document.getElementById('btnReject');

// Health Check
export async function checkHealth() {
    if (!healthBadge) return;
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

// Metrics Panel
export async function loadMetrics() {
    try {
        const res = await fetch('/v1/metrics');
        const m = await res.json();
        const totalReq = document.getElementById('metricTotalReq');
        const successRate = document.getElementById('metricSuccessRate');
        const latency = document.getElementById('metricLatency');
        const tokens = document.getElementById('metricTokens');
        const driftAlert = document.getElementById('driftAlert');

        if (totalReq) totalReq.textContent = m.total_requests;
        if (successRate) successRate.textContent = m.success_rate_percentage + '%';
        if (latency) latency.textContent = `${m.p50_latency_ms}ms / ${m.p95_latency_ms}ms`;
        if (tokens) tokens.textContent = `${m.total_tokens_consumed.toLocaleString()} ($0.00)`;

        if (driftAlert) {
            if (m.drift_detected && m.drift_reasons && m.drift_reasons.length > 0) {
                driftAlert.textContent = 'Peringatan Anomali: ' + m.drift_reasons.join('; ');
                driftAlert.classList.remove('hidden');
            } else {
                driftAlert.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error("Could not load metrics", e);
    }
}

// Wire Event Listeners
function setupEventListeners() {
    // Engine switcher
    if (btnEngineManual && btnEngineLangGraph) {
        btnEngineManual.addEventListener('click', () => {
            appState.currentEngine = 'manual';
            btnEngineManual.className = 'px-2 py-0.5 rounded-lg font-medium text-white bg-clay-600 transition shadow-sm cursor-pointer';
            btnEngineLangGraph.className = 'px-2 py-0.5 rounded-lg font-medium text-[#9c9990] hover:text-white transition cursor-pointer';
            showToast('Orchestrator: Manual Loop (Zero-Latency)');
        });

        btnEngineLangGraph.addEventListener('click', () => {
            appState.currentEngine = 'langgraph';
            btnEngineLangGraph.className = 'px-2 py-0.5 rounded-lg font-medium text-white bg-clay-600 transition shadow-sm cursor-pointer';
            btnEngineManual.className = 'px-2 py-0.5 rounded-lg font-medium text-[#9c9990] hover:text-white transition cursor-pointer';
            showToast('Orchestrator: LangGraph StateGraph');
        });
    }

    // Auto-expanding query input & submit on Enter
    if (queryInput) {
        queryInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (Math.min(this.scrollHeight, 180)) + 'px';
        });

        queryInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (chatForm) chatForm.dispatchEvent(new Event('submit'));
            }
        });
    }

    // Chat form submit
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitChatMessage();
        });
    }

    // Quick prompt chips
    document.querySelectorAll('.prompt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const query = chip.getAttribute('data-query');
            handleQuickSubmit(query);
        });
    });

    // Metrics panel toggle
    if (btnMetrics && metricsPanel) {
        btnMetrics.addEventListener('click', () => {
            metricsPanel.classList.remove('hidden');
            loadMetrics();
        });
    }
    if (btnCloseMetrics && metricsPanel) {
        btnCloseMetrics.addEventListener('click', () => {
            metricsPanel.classList.add('hidden');
        });
    }

    // Model popover events
    if (btnInputModelPicker) {
        btnInputModelPicker.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleInputModelPopover();
        });
    }
    if (btnCloseInputModelPopover) {
        btnCloseInputModelPopover.addEventListener('click', (e) => {
            e.stopPropagation();
            closeInputModelPopover();
        });
    }
    if (btnOpenFullModalFromPopover) {
        btnOpenFullModalFromPopover.addEventListener('click', (e) => {
            e.stopPropagation();
            closeInputModelPopover();
            openModelModal();
        });
    }
    if (btnManageModel) {
        btnManageModel.addEventListener('click', openModelModal);
    }
    if (btnCloseModelModal) btnCloseModelModal.addEventListener('click', closeModelModal);
    if (btnCancelModelModal) btnCancelModelModal.addEventListener('click', closeModelModal);
    if (btnSaveModelModal) {
        btnSaveModelModal.addEventListener('click', () => saveModelModal(checkHealth));
    }

    if (selectAnalystProvider) selectAnalystProvider.addEventListener('change', syncAnalystModels);
    if (selectAnalystModel) selectAnalystModel.addEventListener('change', updateAnalystDesc);
    if (selectAuditorProvider) selectAuditorProvider.addEventListener('change', syncAuditorModels);
    if (selectAuditorModel) selectAuditorModel.addEventListener('change', updateAuditorDesc);

    // Close model popover on outside click
    document.addEventListener('click', (e) => {
        if (inputModelPopover && !inputModelPopover.classList.contains('hidden')) {
            if (!inputModelPopover.contains(e.target) && (!btnInputModelPicker || !btnInputModelPicker.contains(e.target))) {
                closeInputModelPopover();
            }
        }
    });

    // Sidebar & Session events
    if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', toggleSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebarMobile);
    if (btnCloseSidebarMobile) btnCloseSidebarMobile.addEventListener('click', closeSidebarMobile);
    if (btnNewChat) btnNewChat.addEventListener('click', startNewChat);
    if (btnRefreshSessions) btnRefreshSessions.addEventListener('click', loadSessions);

    // Approval gate buttons
    if (btnApprove) btnApprove.addEventListener('click', approveCurrentTask);
    if (btnReject) btnReject.addEventListener('click', rejectCurrentTask);
}

// Application Startup
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkHealth();
    fetchModelCatalog();
    loadSessions();
    if (appState.currentSessionId) {
        switchSession(appState.currentSessionId);
    }
});

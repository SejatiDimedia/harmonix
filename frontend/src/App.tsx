import React, { useState, useEffect, useRef } from 'react';
import {
  HealthStatus,
  MetricSummary,
  ModelCatalogResponse,
  ChatSessionSummary,
  ChatTurn,
  ApprovalPayload,
  EngineType,
} from './types';
import {
  getHealth,
  getMetrics,
  getModelCatalog,
  setActiveModels,
  getSessions,
  getSessionDetails,
  deleteSession,
  submitApproval,
  sendChatMessage,
  resumeTask,
} from './services/api';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { WelcomeHero } from './components/WelcomeHero';
import { ApprovalBanner } from './components/ApprovalBanner';
import { MetricsModal } from './components/MetricsModal';
import { ModelSettingsModal } from './components/ModelSettingsModal';
import { Toast } from './components/Toast';
import { formatModelNameShort } from './utils/formatters';

export const App: React.FC = () => {
  // System State
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [metrics, setMetrics] = useState<MetricSummary | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);

  // Active Models & Engine
  const [activeProvider, setActiveProvider] = useState<string>('groq');
  const [activeModel, setActiveModel] = useState<string>('openai/gpt-oss-120b');
  const [activeAuditorProvider, setActiveAuditorProvider] = useState<string>('auto');
  const [activeAuditorModel, setActiveAuditorModel] = useState<string>('');
  const [engine, setEngine] = useState<EngineType>('manual');

  // Sessions & Turns
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => localStorage.getItem('harnessly_session_id') || null
  );
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  // Streaming State
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string>('Merancang rencana analitik...');
  const [streamingTurn, setStreamingTurn] = useState<ChatTurn | null>(null);

  // Modals & UI Toggles
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMetricsOpen, setIsMetricsOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalPayload | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [turns, streamingTurn]);

  // Initial load
  useEffect(() => {
    refreshHealth();
    loadCatalog();
    loadSessionList();

    if (currentSessionId) {
      loadSessionData(currentSessionId);
    }
  }, []);

  const refreshHealth = async () => {
    try {
      const data = await getHealth();
      setHealth(data);
    } catch {
      setHealth({
        status: 'offline',
        database_connected: false,
        llm_provider: 'OFFLINE',
        active_model: '',
      });
    }
  };

  const loadCatalog = async () => {
    try {
      const cat = await getModelCatalog();
      setCatalog(cat);
      if (cat.active_config) {
        setActiveProvider(cat.active_config.analyst_provider || 'groq');
        setActiveModel(cat.active_config.analyst_model || '');
        setActiveAuditorProvider(cat.active_config.auditor_provider || 'auto');
        setActiveAuditorModel(cat.active_config.auditor_model || '');
      }
    } catch (e) {
      console.error('Failed to load model catalog:', e);
    }
  };

  const loadSessionList = async () => {
    try {
      const data = await getSessions(50);
      setSessions(data.sessions || []);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  const loadSessionData = async (sid: string) => {
    try {
      const details = await getSessionDetails(sid);
      setCurrentSessionId(sid);
      localStorage.setItem('harnessly_session_id', sid);

      // Restore session-scoped active model if recorded (FR-36 / Phase 2)
      if (details.active_provider && details.active_model) {
        setActiveProvider(details.active_provider);
        setActiveModel(details.active_model);
      }

      setTurns(details.turns || []);
    } catch {
      // Session might have been deleted
      localStorage.removeItem('harnessly_session_id');
      setCurrentSessionId(null);
      setTurns([]);
    }
  };

  const handleSelectSession = (sid: string) => {
    loadSessionData(sid);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    localStorage.removeItem('harnessly_session_id');
    setTurns([]);
    setStreamingTurn(null);
    setPendingApproval(null);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleDeleteSession = async (sid: string, title: string) => {
    const ok = window.confirm(`Hapus riwayat percakapan:\n"${title || 'Sesi ini'}"?`);
    if (!ok) return;

    try {
      const success = await deleteSession(sid);
      if (success) {
        if (currentSessionId === sid) {
          handleNewChat();
        }
        loadSessionList();
        showToast('Sesi berhasil dihapus');
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  const ensureSession = () => {
    let sid = currentSessionId;
    if (!sid) {
      sid = 'ses_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      setCurrentSessionId(sid);
      localStorage.setItem('harnessly_session_id', sid);
    }
    return sid;
  };

  const handleSendMessage = async (query: string) => {
    const sid = ensureSession();
    setIsStreaming(true);
    setStreamingStatus('Merancang rencana analitik...');

    const inFlightTurn: ChatTurn = {
      task_id: `task_${Date.now()}`,
      status: 'RUNNING',
      user_query: query,
      answer_text: '',
    };
    setStreamingTurn(inFlightTurn);

    let accumulatedText = '';

    try {
      await sendChatMessage(
        {
          query,
          engine,
          session_id: sid,
          provider: activeProvider,
          model: activeModel,
          auditor_provider: activeAuditorProvider,
          auditor_model: activeAuditorModel || undefined,
        },
        (event, data) => {
          if (event === 'step_start') {
            setStreamingStatus(`Langkah ${data.step}/${data.max_steps}: Menginspeksi skema & glosarium...`);
            if (data.step > 1) {
              accumulatedText = '';
            }
          } else if (event === 'token') {
            accumulatedText += data.delta || '';
            setStreamingTurn((prev) => (prev ? { ...prev, answer_text: accumulatedText } : null));
          } else if (event === 'approval_required') {
            setPendingApproval({
              approval_id: data.approval_id,
              task_id: data.task_id,
              sanitized_query: data.sanitized_query,
              risk_reasons: data.risk_reasons || [],
              sensitive_columns: data.sensitive_columns || [],
            });
            setStreamingStatus('Menunggu Persetujuan Operator');
          } else if (event === 'audit_step') {
            const st = (data.status || 'auditing').toLowerCase();
            if (st === 'auditing') {
              setStreamingStatus('[Data Auditor] Memverifikasi logika SQL & konsistensi angka...');
            } else if (st === 'passed') {
              setStreamingStatus(`🛡️ Auditor: Verified (${Math.round((data.confidence_score || 1) * 100)}%)`);
            } else {
              setStreamingStatus(`⚠️ Auditor: ${data.badge || 'Flagged'}`);
            }
          } else if (event === 'final_result') {
            const completedTurn: ChatTurn = {
              task_id: data.task_id || inFlightTurn.task_id,
              status: 'COMPLETED',
              user_query: query,
              answer_text: data.answer_text || accumulatedText,
              sql_queries: data.sql_queries,
              tables: data.tables,
              charts: data.charts,
              metrics: data.metrics,
              follow_up_suggestions: data.follow_up_suggestions,
              audit_result: data.audit_result,
            };
            setTurns((prev) => [...prev, completedTurn]);
            setStreamingTurn(null);
            loadSessionList();
          } else if (event === 'error') {
            const errorTurn: ChatTurn = {
              task_id: inFlightTurn.task_id,
              status: 'ERROR',
              user_query: query,
              answer_text: `Error: ${data.message || 'Terjadi kesalahan sistem'}`,
            };
            setTurns((prev) => [...prev, errorTurn]);
            setStreamingTurn(null);
          }
        }
      );
    } catch (err: any) {
      const errorTurn: ChatTurn = {
        task_id: inFlightTurn.task_id,
        status: 'ERROR',
        user_query: query,
        answer_text: `Error: ${err.message || 'Koneksi terputus'}`,
      };
      setTurns((prev) => [...prev, errorTurn]);
      setStreamingTurn(null);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleApprove = async () => {
    if (!pendingApproval) return;
    const { approval_id, task_id } = pendingApproval;
    setPendingApproval(null);
    setIsStreaming(true);
    setStreamingStatus('Mengeksekusi query yang disetujui...');

    try {
      await submitApproval(approval_id, 'approved');
      let accumulatedText = streamingTurn?.answer_text || '';
      await resumeTask(task_id, 'Query disetujui oleh analis.', (event, data) => {
        if (event === 'token') {
          accumulatedText += data.delta || '';
          setStreamingTurn((prev) => (prev ? { ...prev, answer_text: accumulatedText } : null));
        } else if (event === 'final_result') {
          const completedTurn: ChatTurn = {
            task_id,
            status: 'COMPLETED',
            user_query: streamingTurn?.user_query || '',
            answer_text: data.answer_text || accumulatedText,
            sql_queries: data.sql_queries,
            tables: data.tables,
            charts: data.charts,
            metrics: data.metrics,
            follow_up_suggestions: data.follow_up_suggestions,
            audit_result: data.audit_result,
          };
          setTurns((prev) => [...prev, completedTurn]);
          setStreamingTurn(null);
          loadSessionList();
        }
      });
    } catch (err: any) {
      showToast(`Resume error: ${err.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleReject = async () => {
    if (!pendingApproval) return;
    const { approval_id, task_id } = pendingApproval;
    setPendingApproval(null);
    setIsStreaming(true);
    setStreamingStatus('Membatalkan dan menyusun query alternatif...');

    try {
      await submitApproval(approval_id, 'rejected', 'Query ditolak oleh analis manusia.');
      let accumulatedText = streamingTurn?.answer_text || '';
      await resumeTask(task_id, 'Query ditolak, gunakan pendekatan lain.', (event, data) => {
        if (event === 'token') {
          accumulatedText += data.delta || '';
          setStreamingTurn((prev) => (prev ? { ...prev, answer_text: accumulatedText } : null));
        } else if (event === 'final_result') {
          const completedTurn: ChatTurn = {
            task_id,
            status: 'COMPLETED',
            user_query: streamingTurn?.user_query || '',
            answer_text: data.answer_text || accumulatedText,
            sql_queries: data.sql_queries,
            tables: data.tables,
            charts: data.charts,
            metrics: data.metrics,
            follow_up_suggestions: data.follow_up_suggestions,
            audit_result: data.audit_result,
          };
          setTurns((prev) => [...prev, completedTurn]);
          setStreamingTurn(null);
          loadSessionList();
        }
      });
    } catch (err: any) {
      showToast(`Resume error: ${err.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSelectModel = async (provider: string, modelId: string) => {
    try {
      await setActiveModels({
        analyst_provider: provider,
        analyst_model: modelId,
        auditor_provider: activeAuditorProvider,
        auditor_model: activeAuditorModel || null,
      });
      setActiveProvider(provider);
      setActiveModel(modelId);
      showToast(`Model aktif: ${provider.toUpperCase()} (${formatModelNameShort(modelId)})`);
      refreshHealth();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleSaveModelModal = async (payload: {
    analyst_provider: string;
    analyst_model: string;
    auditor_provider: string;
    auditor_model?: string | null;
  }) => {
    await setActiveModels(payload);
    setActiveProvider(payload.analyst_provider);
    setActiveModel(payload.analyst_model);
    setActiveAuditorProvider(payload.auditor_provider);
    setActiveAuditorModel(payload.auditor_model || '');
    showToast(`Model aktif: ${payload.analyst_provider.toUpperCase()} (${formatModelNameShort(payload.analyst_model)})`);
    refreshHealth();
  };

  const handleOpenMetrics = async () => {
    try {
      const data = await getMetrics();
      setMetrics(data);
    } catch {}
    setIsMetricsOpen(true);
  };

  const showHero = turns.length === 0 && !streamingTurn;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#161513] text-[#dedcd5]">
      {/* Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onRefreshSessions={loadSessionList}
        onDeleteSession={handleDeleteSession}
        onCloseMobile={() => setIsSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Navbar */}
        <Navbar
          health={health}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onOpenMetrics={handleOpenMetrics}
        />

        {/* Approval Banner */}
        <ApprovalBanner
          payload={pendingApproval}
          onApprove={handleApprove}
          onReject={handleReject}
        />

        {/* Chat Messages Scrollable Container */}
        <main className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
          <div className="max-w-4xl mx-auto space-y-6">
            {showHero ? (
              <WelcomeHero onSelectPrompt={handleSendMessage} />
            ) : (
              <>
                {turns.map((turn, idx) => (
                  <ChatMessage
                    key={turn.task_id || idx}
                    turn={turn}
                    onSelectSuggestion={handleSendMessage}
                  />
                ))}

                {streamingTurn && (
                  <ChatMessage
                    turn={streamingTurn}
                    isStreaming={isStreaming}
                    streamingStatus={streamingStatus}
                    onSelectSuggestion={handleSendMessage}
                  />
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Chat Input Box Toolbar */}
        <ChatInput
          isLoading={isStreaming}
          engine={engine}
          catalog={catalog}
          activeProvider={activeProvider}
          activeModel={activeModel}
          onSetEngine={(eng) => {
            setEngine(eng);
            showToast(`Orchestrator: ${eng === 'manual' ? 'Manual Loop' : 'LangGraph'}`);
          }}
          onSelectModel={handleSelectModel}
          onOpenFullModelModal={() => setIsModelModalOpen(true)}
          onSubmit={handleSendMessage}
        />
      </div>

      {/* Observability Metrics Modal */}
      <MetricsModal
        isOpen={isMetricsOpen}
        metrics={metrics}
        onClose={() => setIsMetricsOpen(false)}
      />

      {/* Model Settings Modal */}
      <ModelSettingsModal
        isOpen={isModelModalOpen}
        catalog={catalog}
        activeAnalystProvider={activeProvider}
        activeAnalystModel={activeModel}
        activeAuditorProvider={activeAuditorProvider}
        activeAuditorModel={activeAuditorModel}
        onSave={handleSaveModelModal}
        onClose={() => setIsModelModalOpen(false)}
      />

      {/* Toast Notification */}
      <Toast message={toastMessage} />
    </div>
  );
};

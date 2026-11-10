import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChartSpec, TableData } from './types';
import { useAppStore } from './store/useAppStore';
import {
  useHealthQuery,
  useCatalogQuery,
  useSessionsQuery,
  useSessionDetailsQuery,
  useMetricsQuery,
  useDashboardQuery,
  useDeleteSessionMutation,
  useRenameSessionMutation,
  usePinWidgetMutation,
  useDeleteWidgetMutation,
  useRefreshDashboardMutation,
  useWatchdogRulesQuery,
} from './hooks/useQueries';
import {
  sendChatMessage,
  submitApproval,
  resumeTask,
  cancelTask,
  setActiveModels as apiSetActiveModels,
} from './services/api';
import { formatModelNameShort, getChartDescriptiveTitle } from './utils/formatters';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { WelcomeHero } from './components/WelcomeHero';
import { ApprovalBanner } from './components/ApprovalBanner';
import { MetricsModal } from './components/MetricsModal';
import { ModelSettingsModal } from './components/ModelSettingsModal';
import { WatchdogModal } from './components/WatchdogModal';
import { DashboardCanvas } from './components/DashboardCanvas';
import { BatchRunner } from './components/BatchRunner';
import { DesignSystemCatalog } from './components/DesignSystemCatalog';
import { ConfirmDeleteModal } from './components/ConfirmDeleteModal';
import { Toast } from './components/Toast';

export const App: React.FC = () => {
  // Global Store via Zustand
  const {
    activeTab,
    setActiveTab,
    engine,
    setEngine,
    activeProvider,
    activeModel,
    activeAuditorProvider,
    activeAuditorModel,
    setActiveModels,
    currentSessionId,
    setCurrentSessionId,
    turns,
    setTurns,
    appendTurn,
    isStreaming,
    setIsStreaming,
    streamingStatus,
    setStreamingStatus,
    streamingTurn,
    setStreamingTurn,
    pendingApproval,
    setPendingApproval,
    resetStream,
    isSidebarOpen,
    setIsSidebarOpen,
    isMetricsOpen,
    setIsMetricsOpen,
    isModelModalOpen,
    setIsModelModalOpen,
    toastMessage,
    showToast,
  } = useAppStore();

  const [isWatchdogOpen, setIsWatchdogOpen] = useState(false);

  // Server Queries via TanStack Query
  const { data: healthData } = useHealthQuery();
  const { data: catalogData } = useCatalogQuery();
  const { data: sessionsData, refetch: refetchSessions } = useSessionsQuery();
  const { data: sessionDetailsData } = useSessionDetailsQuery(currentSessionId);
  const { data: metricsData, refetch: refetchMetrics } = useMetricsQuery();
  const { data: dashboardData, isLoading: isDashboardLoading } = useDashboardQuery(currentSessionId);
  const { data: watchdogRulesData } = useWatchdogRulesQuery();

  const triggeredWatchdogCount = (watchdogRulesData?.rules || []).filter(
    (r) => r.last_status === 'triggered'
  ).length;

  // Mutations via TanStack Query
  const deleteSessionMutation = useDeleteSessionMutation();
  const renameSessionMutation = useRenameSessionMutation();
  const pinWidgetMutation = usePinWidgetMutation(currentSessionId);
  const deleteWidgetMutation = useDeleteWidgetMutation(currentSessionId);
  const refreshDashboardMutation = useRefreshDashboardMutation(currentSessionId);

  const [inputPrefill, setInputPrefill] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasAutoRestored = useRef(false);

  // Standalone TV Kiosk Route Detection (/tv/:sessionId or ?tv=true&session=:sessionId)
  const [isStandaloneTv, setIsStandaloneTv] = useState(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    return searchParams.get('tv') === 'true' || path.startsWith('/tv/');
  });

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    let targetSessionId: string | null = null;

    if (path.startsWith('/tv/')) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) {
        targetSessionId = parts[1];
      }
    } else if (searchParams.get('session')) {
      targetSessionId = searchParams.get('session');
    }

    if (targetSessionId) {
      setCurrentSessionId(targetSessionId);
    }

    if (searchParams.get('tv') === 'true' || path.startsWith('/tv/')) {
      setIsStandaloneTv(true);
      setActiveTab('dashboard');
    } else if (
      path === '/design-system' ||
      path.startsWith('/design-system') ||
      searchParams.get('tab') === 'design-system' ||
      searchParams.get('design-system') === 'true'
    ) {
      setActiveTab('design-system');
    }
  }, [setCurrentSessionId, setActiveTab]);

  // Auto-restore most recent session on initial load if none is selected
  useEffect(() => {
    if (!hasAutoRestored.current && !currentSessionId && sessionsData?.sessions && sessionsData.sessions.length > 0) {
      hasAutoRestored.current = true;
      setCurrentSessionId(sessionsData.sessions[0].session_id);
    }
  }, [currentSessionId, sessionsData, setCurrentSessionId]);

  // Sync initial catalog config
  useEffect(() => {
    if (catalogData?.active_config) {
      setActiveModels(
        catalogData.active_config.analyst_provider || 'groq',
        catalogData.active_config.analyst_model || '',
        catalogData.active_config.auditor_provider || 'auto',
        catalogData.active_config.auditor_model || ''
      );
    }
  }, [catalogData, setActiveModels]);

  // Sync loaded session turns & session-scoped model
  useEffect(() => {
    if (sessionDetailsData) {
      if (sessionDetailsData.active_provider && sessionDetailsData.active_model) {
        setActiveModels(
          sessionDetailsData.active_provider,
          sessionDetailsData.active_model,
          activeAuditorProvider,
          activeAuditorModel
        );
      }
      setTurns(sessionDetailsData.turns || []);
    }
  }, [sessionDetailsData, setActiveModels, setTurns, activeAuditorProvider, activeAuditorModel]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom();
    }
  }, [turns, streamingTurn, activeTab, scrollToBottom]);

  // Session Handlers
  const ensureSession = useCallback(() => {
    let sid = currentSessionId;
    if (!sid) {
      sid = 'ses_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      setCurrentSessionId(sid);
    }
    return sid;
  }, [currentSessionId, setCurrentSessionId]);

  const handleSelectSession = useCallback(
    (sid: string) => {
      resetStream();
      setCurrentSessionId(sid);
      setActiveTab('chat');
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
      }
    },
    [resetStream, setCurrentSessionId, setActiveTab, setIsSidebarOpen]
  );

  const handleNewChat = useCallback(() => {
    resetStream();
    setCurrentSessionId(null);
    setTurns([]);
    setActiveTab('chat');
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, [resetStream, setCurrentSessionId, setTurns, setActiveTab, setIsSidebarOpen]);

  // Delete Confirmation State
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(null);

  const handleDeleteSessionClick = useCallback((sid: string, title: string) => {
    setSessionToDelete({ id: sid, title });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!sessionToDelete) return;
    const { id } = sessionToDelete;
    deleteSessionMutation.mutate(id, {
      onSuccess: () => {
        if (currentSessionId === id) {
          handleNewChat();
        }
        setSessionToDelete(null);
        showToast('Chat history deleted successfully');
      },
      onError: (err: any) => {
        showToast(`Failed to delete session: ${err.message}`);
        setSessionToDelete(null);
      },
    });
  }, [sessionToDelete, deleteSessionMutation, currentSessionId, handleNewChat, showToast]);

  const handleRenameSession = useCallback(
    (sessionId: string, newTitle: string) => {
      renameSessionMutation.mutate(
        { sessionId, title: newTitle },
        {
          onSuccess: (res) => {
            showToast(`Session renamed: "${res.title}"`);
          },
          onError: (err: any) => {
            showToast(`Failed to rename session: ${err.message}`);
          },
        }
      );
    },
    [renameSessionMutation, showToast]
  );

  // Model Selection Handlers
  const handleSelectModel = useCallback(
    async (provider: string, modelId: string) => {
      try {
        await apiSetActiveModels({
          analyst_provider: provider,
          analyst_model: modelId,
          auditor_provider: activeAuditorProvider,
          auditor_model: activeAuditorModel || null,
        });
        setActiveModels(provider, modelId, activeAuditorProvider, activeAuditorModel);
        showToast(`Active model: ${provider.toUpperCase()} (${formatModelNameShort(modelId)})`);
      } catch (err: any) {
        showToast(`Error: ${err.message}`);
      }
    },
    [activeAuditorProvider, activeAuditorModel, setActiveModels, showToast]
  );

  const handleSaveModelModal = useCallback(
    async (payload: {
      analyst_provider: string;
      analyst_model: string;
      auditor_provider: string;
      auditor_model?: string | null;
    }) => {
      await apiSetActiveModels(payload);
      setActiveModels(
        payload.analyst_provider,
        payload.analyst_model,
        payload.auditor_provider,
        payload.auditor_model || ''
      );
      showToast(
        `Active model: ${payload.analyst_provider.toUpperCase()} (${formatModelNameShort(
          payload.analyst_model
        )})`
      );
    },
    [setActiveModels, showToast]
  );

  const handleEditQuery = useCallback(
    (queryText: string) => {
      setInputPrefill(queryText);
      showToast('Question loaded into input field');
    },
    [showToast]
  );

  // Streaming & Human-in-the-Loop Handlers
  const handleSendMessage = useCallback(
    async (query: string) => {
      const sid = ensureSession();
      setIsStreaming(true);
      setStreamingStatus('Formulating analytics plan...');

      const inFlightTurn = {
        task_id: `task_${Date.now()}`,
        status: 'RUNNING',
        user_query: query,
        answer_text: '',
        created_at: new Date().toISOString(),
      };
      setStreamingTurn(inFlightTurn);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let accumulatedText = '';

      try {
        await sendChatMessage(
          {
            query,
            engine,
            session_id: sid,
            task_id: inFlightTurn.task_id,
            provider: activeProvider,
            model: activeModel,
            auditor_provider: activeAuditorProvider,
            auditor_model: activeAuditorModel || undefined,
          },
          (event, data) => {
            if (event === 'step_start') {
              setStreamingStatus(
                `Step ${data.step}/${data.max_steps}: Inspecting schema and glossary...`
              );
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
              setStreamingStatus('Awaiting Operator Approval');
            } else if (event === 'plan_created') {
              setStreamingStatus(`Swarm Plan: ${data.tasks_count} sub-tasks generated by Planner`);
            } else if (event === 'subagent_start') {
              const roleTitle = data.role === 'sql_specialist' ? 'SQL Specialist' : (data.role === 'calc_specialist' ? 'Calc Specialist' : (data.role === 'chart_specialist' ? 'Chart Specialist' : data.role));
              setStreamingStatus(`[${roleTitle}] Executing: ${data.title}`);
            } else if (event === 'subagent_complete') {
              setStreamingStatus(`Sub-Agent ${data.role} completed (${data.duration_ms}ms)`);
            } else if (event === 'audit_step') {
              const st = (data.status || 'auditing').toLowerCase();
              if (st === 'auditing') {
                setStreamingStatus(
                  '[Data Auditor] Verifying SQL logic and numeric consistency...'
                );
              } else if (st === 'passed') {
                setStreamingStatus(
                  `Auditor: Verified (${Math.round((data.confidence_score || 1) * 100)}%)`
                );
              } else {
                setStreamingStatus(`Auditor: ${data.badge || 'Flagged'}`);
              }
            } else if (event === 'final_result') {
              const completedTurn = {
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
                memories_recalled: data.memories_recalled,
                working_memory: data.working_memory,
                execution_plan: data.execution_plan,
                created_at: inFlightTurn.created_at || new Date().toISOString(),
              };
              appendTurn(completedTurn);
              setStreamingTurn(null);
              refetchSessions();
            } else if (event === 'cancelled') {
              setStreamingTurn(null);
              setIsStreaming(false);
            } else if (event === 'error') {
              const errorTurn = {
                task_id: inFlightTurn.task_id,
                status: 'ERROR',
                user_query: query,
                answer_text: `Error: ${data.message || 'System error occurred'}`,
                created_at: inFlightTurn.created_at || new Date().toISOString(),
              };
              appendTurn(errorTurn);
              setStreamingTurn(null);
            }
          },
          controller.signal
        );
      } catch (err: any) {
        if (err.name === 'AbortError' || err.message?.includes('aborted')) {
          // Handled gracefully via handleCancelStream
          return;
        }
        const errorTurn = {
          task_id: inFlightTurn.task_id,
          status: 'ERROR',
          user_query: query,
          answer_text: `Error: ${err.message || 'Connection lost'}`,
          created_at: inFlightTurn.created_at || new Date().toISOString(),
        };
        appendTurn(errorTurn);
        setStreamingTurn(null);
      } finally {
        abortControllerRef.current = null;
        setIsStreaming(false);
      }
    },
    [
      ensureSession,
      engine,
      activeProvider,
      activeModel,
      activeAuditorProvider,
      activeAuditorModel,
      setIsStreaming,
      setStreamingStatus,
      setStreamingTurn,
      setPendingApproval,
      appendTurn,
      refetchSessions,
    ]
  );

  const handleDrillDown = useCallback(
    (promptText: string) => {
      if (isStandaloneTv) {
        setIsStandaloneTv(false);
        window.history.pushState({}, '', '/');
      }
      if (activeTab !== 'chat') {
        setActiveTab('chat');
        showToast('Switched to chat session for deep-dive investigation');
      }
      handleSendMessage(promptText);
    },
    [isStandaloneTv, activeTab, setActiveTab, showToast, handleSendMessage]
  );

  const handlePrefillDrillDown = useCallback(
    (promptText: string) => {
      if (isStandaloneTv) {
        setIsStandaloneTv(false);
        window.history.pushState({}, '', '/');
      }
      if (activeTab !== 'chat') {
        setActiveTab('chat');
      }
      setInputPrefill(promptText);
      showToast('Data point context loaded into chat input');
    },
    [isStandaloneTv, activeTab, setActiveTab, setInputPrefill, showToast]
  );

  const handleApprove = useCallback(async () => {
    if (!pendingApproval) return;
    const { approval_id, task_id, user_query: apprUserQuery } = pendingApproval;
    const activeUserQuery = apprUserQuery || streamingTurn?.user_query || '';
    setPendingApproval(null);
    setIsStreaming(true);
    setStreamingStatus('Executing approved query...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await submitApproval(approval_id, 'approved');
      let accumulatedText = streamingTurn?.answer_text || '';
      await resumeTask(task_id, 'Query approved by analyst.', (event, data) => {
        if (event === 'token') {
          accumulatedText += data.delta || '';
          setStreamingTurn((prev) => (prev ? { ...prev, answer_text: accumulatedText } : null));
        } else if (event === 'step_start') {
          setStreamingStatus(`Step ${data.step}/${data.max_steps}: Analyzing...`);
        } else if (event === 'tool_trigger') {
          setStreamingStatus(`Running tool: ${data.tool_name}...`);
        } else if (event === 'approval_required') {
          setPendingApproval(data);
          setIsStreaming(false);
        } else if (event === 'auditor_evaluation') {
          const st = data.status || 'review';
          if (st === 'failed') {
            setStreamingStatus(`Auditor: Rejected - ${data.hallucination_type || 'Data mismatch'}`);
          } else if (st === 'passed') {
            setStreamingStatus(
              `Auditor: Verified (${Math.round((data.confidence_score || 1) * 100)}%)`
            );
          } else {
            setStreamingStatus(`Auditor: ${data.badge || 'Flagged'}`);
          }
        } else if (event === 'final_result') {
          const completedTurn = {
            task_id,
            status: 'COMPLETED',
            user_query: activeUserQuery,
            answer_text: data.answer_text || accumulatedText,
            sql_queries: data.sql_queries,
            tables: data.tables,
            charts: data.charts,
            metrics: data.metrics,
            follow_up_suggestions: data.follow_up_suggestions,
            audit_result: data.audit_result,
            memories_recalled: data.memories_recalled,
            working_memory: data.working_memory,
            execution_plan: data.execution_plan,
            created_at: new Date().toISOString(),
          };
          appendTurn(completedTurn);
          setStreamingTurn(null);
          refetchSessions();
        } else if (event === 'cancelled') {
          setStreamingTurn(null);
          setIsStreaming(false);
        } else if (event === 'error') {
          const errorTurn = {
            task_id,
            status: 'ERROR',
            user_query: activeUserQuery,
            answer_text: `Error: ${data.message || 'System error while resuming task'}`,
            created_at: new Date().toISOString(),
          };
          appendTurn(errorTurn);
          setStreamingTurn(null);
          showToast(`Resume error: ${data.message || 'Execution error'}`);
        }
      }, controller.signal);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        return;
      }
      const errorTurn = {
        task_id,
        status: 'ERROR',
        user_query: activeUserQuery,
        answer_text: `Error: ${err.message || 'Resume connection lost'}`,
        created_at: new Date().toISOString(),
      };
      appendTurn(errorTurn);
      setStreamingTurn(null);
      showToast(`Resume error: ${err.message}`);
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }, [
    pendingApproval,
    streamingTurn,
    setPendingApproval,
    setIsStreaming,
    setStreamingStatus,
    setStreamingTurn,
    appendTurn,
    refetchSessions,
    showToast,
  ]);

  const handleReject = useCallback(async () => {
    if (!pendingApproval) return;
    const { approval_id, task_id, user_query: apprUserQuery } = pendingApproval;
    const activeUserQuery = apprUserQuery || streamingTurn?.user_query || '';
    setPendingApproval(null);
    setIsStreaming(true);
    setStreamingStatus('Cancelling and preparing alternative query...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await submitApproval(approval_id, 'rejected', 'Query rejected by human analyst.');
      let accumulatedText = streamingTurn?.answer_text || '';
      await resumeTask(task_id, 'Query rejected, use an alternative approach.', (event, data) => {
        if (event === 'token') {
          accumulatedText += data.delta || '';
          setStreamingTurn((prev) => (prev ? { ...prev, answer_text: accumulatedText } : null));
        } else if (event === 'step_start') {
          setStreamingStatus(`Step ${data.step}/${data.max_steps}: Analyzing...`);
        } else if (event === 'tool_trigger') {
          setStreamingStatus(`Running tool: ${data.tool_name}...`);
        } else if (event === 'approval_required') {
          setPendingApproval(data);
          setIsStreaming(false);
        } else if (event === 'auditor_evaluation') {
          const st = data.status || 'review';
          if (st === 'failed') {
            setStreamingStatus(`Auditor: Rejected - ${data.hallucination_type || 'Data mismatch'}`);
          } else if (st === 'passed') {
            setStreamingStatus(
              `Auditor: Verified (${Math.round((data.confidence_score || 1) * 100)}%)`
            );
          } else {
            setStreamingStatus(`Auditor: ${data.badge || 'Flagged'}`);
          }
        } else if (event === 'final_result') {
          const completedTurn = {
            task_id,
            status: 'COMPLETED',
            user_query: activeUserQuery,
            answer_text: data.answer_text || accumulatedText,
            sql_queries: data.sql_queries,
            tables: data.tables,
            charts: data.charts,
            metrics: data.metrics,
            follow_up_suggestions: data.follow_up_suggestions,
            audit_result: data.audit_result,
            memories_recalled: data.memories_recalled,
            working_memory: data.working_memory,
            execution_plan: data.execution_plan,
            created_at: new Date().toISOString(),
          };
          appendTurn(completedTurn);
          setStreamingTurn(null);
          refetchSessions();
        } else if (event === 'cancelled') {
          setStreamingTurn(null);
          setIsStreaming(false);
        } else if (event === 'error') {
          const errorTurn = {
            task_id,
            status: 'ERROR',
            user_query: activeUserQuery,
            answer_text: `Error: ${data.message || 'System error while resuming task'}`,
            created_at: new Date().toISOString(),
          };
          appendTurn(errorTurn);
          setStreamingTurn(null);
          showToast(`Resume error: ${data.message || 'Execution error'}`);
        }
      }, controller.signal);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        return;
      }
      const errorTurn = {
        task_id,
        status: 'ERROR',
        user_query: activeUserQuery,
        answer_text: `Error: ${err.message || 'Resume connection lost'}`,
        created_at: new Date().toISOString(),
      };
      appendTurn(errorTurn);
      setStreamingTurn(null);
      showToast(`Resume error: ${err.message}`);
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }, [
    pendingApproval,
    streamingTurn,
    setPendingApproval,
    setIsStreaming,
    setStreamingStatus,
    setStreamingTurn,
    appendTurn,
    refetchSessions,
    showToast,
  ]);

  // Cancel Process Handler (e.g. user made typo or sent wrong query)
  const handleCancelStream = useCallback(async () => {
    if (!isStreaming && !pendingApproval) return;

    // 1. Abort in-flight network SSE request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const targetTaskId = streamingTurn?.task_id || pendingApproval?.task_id;
    const targetQuery = streamingTurn?.user_query || pendingApproval?.user_query || '';

    // 2. Notify backend to gracefully abort LLM and database connections
    if (targetTaskId) {
      cancelTask(targetTaskId).catch((err) =>
        console.warn('Backend cancel error:', err)
      );
    }

    // 3. Clear streaming & approval state
    setIsStreaming(false);
    setPendingApproval(null);

    // 4. Save cancelled turn in chat history
    if (streamingTurn) {
      const partialText = streamingTurn.answer_text?.trim();
      const cancelledTurn = {
        ...streamingTurn,
        status: 'CANCELLED',
        answer_text: partialText || '',
      };
      appendTurn(cancelledTurn);
    }
    setStreamingTurn(null);

    // 5. Restore original query to chat input for immediate editing
    if (targetQuery) {
      setInputPrefill(targetQuery);
      showToast('Process cancelled. Your query was restored to the input box for editing.');
    } else {
      showToast('Analytics process cancelled.');
    }
  }, [isStreaming, pendingApproval, streamingTurn, appendTurn, showToast]);

  // Global Escape keyboard listener to abort running queries
  useEffect(() => {
    const handleGlobalEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isStreaming) {
        handleCancelStream();
      }
    };
    window.addEventListener('keydown', handleGlobalEsc);
    return () => window.removeEventListener('keydown', handleGlobalEsc);
  }, [isStreaming, handleCancelStream]);

  // Feature #3: Pinning to Dashboard Handlers
  const handlePinChart = useCallback(
    (spec: ChartSpec, sqlQuery?: string, tableData?: TableData) => {
      const sid = ensureSession();
      const resolvedTitle = getChartDescriptiveTitle(spec);
      pinWidgetMutation.mutate(
        {
          session_id: sid,
          widget_type: 'chart',
          title: resolvedTitle,
          sql_query: sqlQuery || null,
          chart_spec: { ...spec, title: resolvedTitle },
          table_data: tableData || null,
        },
        {
          onSuccess: () => {
            showToast(`Chart "${resolvedTitle}" pinned to Live Dashboard!`);
          },
          onError: (err: any) => {
            showToast(`Failed to pin: ${err.message}`);
          },
        }
      );
    },
    [ensureSession, pinWidgetMutation, showToast]
  );

  const handlePinTable = useCallback(
    (table: TableData, title: string, sqlQuery?: string) => {
      const sid = ensureSession();
      pinWidgetMutation.mutate(
        {
          session_id: sid,
          widget_type: 'table',
          title: title || 'Analytical Table Result',
          sql_query: sqlQuery || null,
          table_data: table,
        },
        {
          onSuccess: () => {
            showToast('Table pinned to Live Dashboard!');
          },
          onError: (err: any) => {
            showToast(`Failed to pin: ${err.message}`);
          },
        }
      );
    },
    [ensureSession, pinWidgetMutation, showToast]
  );

  const handleDeleteWidget = useCallback(
    (widgetId: string) => {
      deleteWidgetMutation.mutate(widgetId, {
        onSuccess: () => {
          showToast('Widget removed from dashboard');
        },
      });
    },
    [deleteWidgetMutation, showToast]
  );

  const handleRefreshDashboard = useCallback(() => {
    refreshDashboardMutation.mutate(undefined, {
      onSuccess: (data) => {
        showToast(`Successfully refreshed ${data.total} widgets in real time!`);
      },
      onError: (err: any) => {
        showToast(`Failed to refresh: ${err.message}`);
      },
    });
  }, [refreshDashboardMutation, showToast]);

  const showHero = turns.length === 0 && !streamingTurn;
  const widgetCount = dashboardData?.total || 0;

  if (isStandaloneTv) {
    return (
      <div className="flex h-screen w-screen overflow-hidden bg-[#080f1d] text-[#f8fafc] font-sans antialiased">
        <DashboardCanvas
          widgets={dashboardData?.widgets || []}
          isLoading={isDashboardLoading}
          isRefreshing={refreshDashboardMutation.isPending}
          onRefresh={handleRefreshDashboard}
          onDeleteWidget={handleDeleteWidget}
          onDrillDown={handleDrillDown}
          onPrefillChat={handlePrefillDrillDown}
          onSwitchToChat={() => {
            setIsStandaloneTv(false);
            window.history.pushState({}, '', '/');
            setActiveTab('chat');
          }}
          sessionTitle={sessionDetailsData?.title}
          sessionId={currentSessionId || undefined}
          activeModel={activeModel}
          showToast={showToast}
          initialTvMode={true}
          isStandaloneTv={true}
          onExitTv={() => {
            setIsStandaloneTv(false);
            window.history.pushState({}, '', '/');
            setActiveTab('dashboard');
          }}
        />
        <Toast message={toastMessage} />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#080f1d] text-[#f8fafc] print:h-auto print:w-full print:max-w-full print:bg-white print:overflow-visible print:text-gray-900 print:block">
      {/* Session History & Navigation Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        activeTab={activeTab}
        widgetCount={widgetCount}
        onSelectTab={setActiveTab}
        sessions={sessionsData?.sessions || []}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onRefreshSessions={refetchSessions}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSessionClick}
        onCloseMobile={() => setIsSidebarOpen(false)}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden print:h-auto print:w-full print:max-w-full print:bg-white print:overflow-visible print:block print:p-0 print:m-0">
        {/* Navbar */}
        <Navbar
          health={healthData || null}
          activeTab={activeTab}
          isSidebarOpen={isSidebarOpen}
          isMetricsOpen={isMetricsOpen}
          triggeredWatchdogCount={triggeredWatchdogCount}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onOpenWatchdog={() => setIsWatchdogOpen(true)}
          onOpenMetrics={() => {
            if (isMetricsOpen) {
              setIsMetricsOpen(false);
            } else {
              refetchMetrics();
              setIsMetricsOpen(true);
            }
          }}
        />

        {/* Human-in-the-Loop Risk Approval Banner */}
        <ApprovalBanner
          payload={pendingApproval}
          onApprove={handleApprove}
          onReject={handleReject}
        />

        {/* Dynamic View: Percakapan vs Live BI Dashboard */}
        {activeTab === 'chat' ? (
          <>
            <main className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
              <div className="max-w-4xl mx-auto space-y-6">
                {showHero ? (
                  <WelcomeHero onSelectPrompt={handleSendMessage} />
                ) : (
                  <>
                    {sessionDetailsData?.compacted_summary && (
                      <div className="bg-[#0f172a]/90 border border-sky-900/40 rounded-xl p-3.5 text-xs text-slate-300 shadow-sm backdrop-blur-sm animate-fade-in">
                        <div className="flex items-center justify-between font-medium text-sky-400 mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold tracking-wide">Session Conversation Context Summary</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-sky-950 text-sky-300 border border-sky-800/50">
                              {sessionDetailsData.compacted_turn_count || 0} turns summarized
                            </span>
                          </div>
                        </div>
                        <div className="whitespace-pre-line leading-relaxed text-slate-300 font-sans text-xs bg-[#0b1120]/80 p-3 rounded-lg border border-slate-800/80">
                          {sessionDetailsData.compacted_summary}
                        </div>
                      </div>
                    )}

                    {turns.map((turn, idx) => (
                      <ChatMessage
                        key={turn.task_id || idx}
                        turn={turn}
                        onSelectSuggestion={handleSendMessage}
                        onEditQuery={handleEditQuery}
                        onPinChart={handlePinChart}
                        onPinTable={handlePinTable}
                        onDrillDown={handleDrillDown}
                        onPrefillChat={handlePrefillDrillDown}
                      />
                    ))}

                    {streamingTurn && (
                      <ChatMessage
                        turn={streamingTurn}
                        isStreaming={isStreaming}
                        streamingStatus={streamingStatus}
                        onSelectSuggestion={handleSendMessage}
                        onEditQuery={handleEditQuery}
                        onPinChart={handlePinChart}
                        onPinTable={handlePinTable}
                        onDrillDown={handleDrillDown}
                        onPrefillChat={handlePrefillDrillDown}
                        onCancel={handleCancelStream}
                      />
                    )}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>
            </main>

            <ChatInput
              isLoading={isStreaming}
              engine={engine}
              catalog={catalogData || null}
              activeProvider={activeProvider}
              activeModel={activeModel}
              sessionId={currentSessionId}
              onEnsureSession={ensureSession}
              onSetEngine={(eng) => {
                setEngine(eng);
                showToast(`Orchestrator: ${eng === 'manual' ? 'Manual Loop' : 'LangGraph'}`);
              }}
              onSelectModel={handleSelectModel}
              onOpenFullModelModal={() => setIsModelModalOpen(true)}
              onSubmit={handleSendMessage}
              onCancel={handleCancelStream}
              showToast={showToast}
              inputPrefill={inputPrefill}
              onClearPrefill={() => setInputPrefill('')}
            />
          </>
        ) : activeTab === 'dashboard' ? (
          <DashboardCanvas
            widgets={dashboardData?.widgets || []}
            isLoading={isDashboardLoading}
            isRefreshing={refreshDashboardMutation.isPending}
            onRefresh={handleRefreshDashboard}
            onDeleteWidget={handleDeleteWidget}
            onDrillDown={handleDrillDown}
            onPrefillChat={handlePrefillDrillDown}
            onSwitchToChat={() => setActiveTab('chat')}
            sessionTitle={sessionDetailsData?.title}
            sessionId={currentSessionId || undefined}
            activeModel={activeModel}
            showToast={showToast}
          />
        ) : activeTab === 'batch' ? (
          <BatchRunner
            showToast={showToast}
            activeProvider={activeProvider}
            activeModel={activeModel}
            sessionId={currentSessionId || undefined}
          />
        ) : activeTab === 'design-system' ? (
          <DesignSystemCatalog
            showToast={showToast}
            onBack={() => {
              setActiveTab('chat');
              if (window.location.pathname.startsWith('/design-system')) {
                window.history.pushState({}, '', '/');
              }
            }}
          />
        ) : null}
      </div>

      {/* Observability Metrics Modal */}
      <MetricsModal
        isOpen={isMetricsOpen}
        metrics={metricsData || null}
        sessionTitle={sessionDetailsData?.title}
        sessionId={currentSessionId || undefined}
        turns={turns}
        onClose={() => setIsMetricsOpen(false)}
      />

      {/* Metric Watchdog & Alerting Modal (FR-49) */}
      <WatchdogModal
        isOpen={isWatchdogOpen}
        onClose={() => setIsWatchdogOpen(false)}
        showToast={showToast}
      />

      {/* Model Hot-Switching Settings Modal */}
      <ModelSettingsModal
        isOpen={isModelModalOpen}
        catalog={catalogData || null}
        activeAnalystProvider={activeProvider}
        activeAnalystModel={activeModel}
        activeAuditorProvider={activeAuditorProvider}
        activeAuditorModel={activeAuditorModel}
        onSave={handleSaveModelModal}
        onClose={() => setIsModelModalOpen(false)}
      />

      {/* Confirmation Modal for Session Deletion */}
      <ConfirmDeleteModal
        isOpen={!!sessionToDelete}
        sessionTitle={sessionToDelete?.title}
        isDeleting={deleteSessionMutation.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setSessionToDelete(null)}
      />

      {/* Toast Notification */}
      <Toast message={toastMessage} />
    </div>
  );
};

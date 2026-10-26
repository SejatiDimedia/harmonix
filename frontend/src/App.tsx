import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MetricSummary } from './types';
import { getMetrics } from './services/api';
import { useToast } from './hooks/useToast';
import { useModelConfig } from './hooks/useModelConfig';
import { useSessions } from './hooks/useSessions';
import { useChatStream } from './hooks/useChatStream';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { WelcomeHero } from './components/WelcomeHero';
import { ApprovalBanner } from './components/ApprovalBanner';
import { MetricsModal } from './components/MetricsModal';
import { ModelSettingsModal } from './components/ModelSettingsModal';
import { Toast } from './components/Toast';

export const App: React.FC = () => {
  // Toast notifications
  const { toastMessage, showToast } = useToast();

  // Model & Orchestrator Configuration
  const {
    health,
    catalog,
    activeProvider,
    activeModel,
    activeAuditorProvider,
    activeAuditorModel,
    engine,
    setEngine,
    selectModel,
    saveModelModal,
    setSessionModel,
  } = useModelConfig({ onNotify: showToast });

  // Session Management
  const {
    currentSessionId,
    sessions,
    turns,
    setTurns,
    loadSessionList,
    handleSelectSession: selectSessionRaw,
    handleNewChat: newChatRaw,
    handleDeleteSession,
    ensureSession,
  } = useSessions({
    onSessionModelLoaded: setSessionModel,
    onNotify: showToast,
  });

  // Chat Streaming & Human-in-the-Loop
  const {
    isStreaming,
    streamingStatus,
    streamingTurn,
    pendingApproval,
    sendMessage,
    handleApprove: approveStream,
    handleReject: rejectStream,
    resetStream,
  } = useChatStream({ onNotify: showToast });

  // UI Modals & Panels
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMetricsOpen, setIsMetricsOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [metrics, setMetrics] = useState<MetricSummary | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [turns, streamingTurn, scrollToBottom]);

  // Turn completed callback appends to turns state
  const handleTurnCompleted = useCallback(
    (completedTurn: any) => {
      setTurns((prev) => [...prev, completedTurn]);
    },
    [setTurns]
  );

  const handleSelectSession = useCallback(
    (sid: string) => {
      resetStream();
      selectSessionRaw(sid, () => setIsSidebarOpen(false));
    },
    [resetStream, selectSessionRaw]
  );

  const handleNewChat = useCallback(() => {
    resetStream();
    newChatRaw(() => setIsSidebarOpen(false));
  }, [resetStream, newChatRaw]);

  const handleSendMessage = useCallback(
    async (query: string) => {
      const sid = ensureSession();
      await sendMessage(
        query,
        sid,
        {
          engine,
          provider: activeProvider,
          model: activeModel,
          auditorProvider: activeAuditorProvider,
          auditorModel: activeAuditorModel,
        },
        handleTurnCompleted,
        loadSessionList
      );
    },
    [
      ensureSession,
      sendMessage,
      engine,
      activeProvider,
      activeModel,
      activeAuditorProvider,
      activeAuditorModel,
      handleTurnCompleted,
      loadSessionList,
    ]
  );

  const handleApprove = useCallback(() => {
    approveStream(handleTurnCompleted, loadSessionList);
  }, [approveStream, handleTurnCompleted, loadSessionList]);

  const handleReject = useCallback(() => {
    rejectStream(handleTurnCompleted, loadSessionList);
  }, [rejectStream, handleTurnCompleted, loadSessionList]);

  const handleOpenMetrics = useCallback(async () => {
    try {
      const data = await getMetrics();
      setMetrics(data);
    } catch {}
    setIsMetricsOpen(true);
  }, []);

  const showHero = turns.length === 0 && !streamingTurn;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#161513] text-[#dedcd5]">
      {/* Session History Sidebar */}
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

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Navbar */}
        <Navbar
          health={health}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onOpenMetrics={handleOpenMetrics}
        />

        {/* Human-in-the-Loop Risk Approval Banner */}
        <ApprovalBanner
          payload={pendingApproval}
          onApprove={handleApprove}
          onReject={handleReject}
        />

        {/* Chat History & Streaming Scroll View */}
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

        {/* Bottom Chat Input & Model Toolbar */}
        <ChatInput
          isLoading={isStreaming}
          engine={engine}
          catalog={catalog}
          activeProvider={activeProvider}
          activeModel={activeModel}
          onSetEngine={setEngine}
          onSelectModel={selectModel}
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

      {/* Model Hot-Switching Settings Modal */}
      <ModelSettingsModal
        isOpen={isModelModalOpen}
        catalog={catalog}
        activeAnalystProvider={activeProvider}
        activeAnalystModel={activeModel}
        activeAuditorProvider={activeAuditorProvider}
        activeAuditorModel={activeAuditorModel}
        onSave={saveModelModal}
        onClose={() => setIsModelModalOpen(false)}
      />

      {/* Toast Notification */}
      <Toast message={toastMessage} />
    </div>
  );
};

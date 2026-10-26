import { useState, useCallback } from 'react';
import { ChatTurn, ApprovalPayload, EngineType } from '../types';
import { sendChatMessage, submitApproval, resumeTask } from '../services/api';

interface ChatStreamConfig {
  engine: EngineType;
  provider: string;
  model: string;
  auditorProvider: string;
  auditorModel?: string;
}

interface UseChatStreamProps {
  onNotify?: (message: string) => void;
}

export const useChatStream = ({ onNotify }: UseChatStreamProps = {}) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string>('Merancang rencana analitik...');
  const [streamingTurn, setStreamingTurn] = useState<ChatTurn | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ApprovalPayload | null>(null);

  const sendMessage = useCallback(
    async (
      query: string,
      sessionId: string,
      config: ChatStreamConfig,
      onTurnCompleted: (turn: ChatTurn) => void,
      onRefreshSessions: () => void
    ) => {
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
            engine: config.engine,
            session_id: sessionId,
            provider: config.provider,
            model: config.model,
            auditor_provider: config.auditorProvider,
            auditor_model: config.auditorModel || undefined,
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
              onTurnCompleted(completedTurn);
              setStreamingTurn(null);
              onRefreshSessions();
            } else if (event === 'error') {
              const errorTurn: ChatTurn = {
                task_id: inFlightTurn.task_id,
                status: 'ERROR',
                user_query: query,
                answer_text: `Error: ${data.message || 'Terjadi kesalahan sistem'}`,
              };
              onTurnCompleted(errorTurn);
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
        onTurnCompleted(errorTurn);
        setStreamingTurn(null);
      } finally {
        setIsStreaming(false);
      }
    },
    []
  );

  const handleApprove = useCallback(
    async (
      onTurnCompleted: (turn: ChatTurn) => void,
      onRefreshSessions: () => void
    ) => {
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
            onTurnCompleted(completedTurn);
            setStreamingTurn(null);
            onRefreshSessions();
          }
        });
      } catch (err: any) {
        onNotify?.(`Resume error: ${err.message}`);
      } finally {
        setIsStreaming(false);
      }
    },
    [pendingApproval, streamingTurn, onNotify]
  );

  const handleReject = useCallback(
    async (
      onTurnCompleted: (turn: ChatTurn) => void,
      onRefreshSessions: () => void
    ) => {
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
            onTurnCompleted(completedTurn);
            setStreamingTurn(null);
            onRefreshSessions();
          }
        });
      } catch (err: any) {
        onNotify?.(`Resume error: ${err.message}`);
      } finally {
        setIsStreaming(false);
      }
    },
    [pendingApproval, streamingTurn, onNotify]
  );

  const resetStream = useCallback(() => {
    setStreamingTurn(null);
    setPendingApproval(null);
    setIsStreaming(false);
  }, []);

  return {
    isStreaming,
    streamingStatus,
    streamingTurn,
    pendingApproval,
    sendMessage,
    handleApprove,
    handleReject,
    resetStream,
  };
};

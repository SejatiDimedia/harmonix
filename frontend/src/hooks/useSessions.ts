import { useState, useEffect, useCallback } from 'react';
import { ChatSessionSummary, ChatTurn } from '../types';
import { getSessions, getSessionDetails, deleteSession } from '../services/api';

interface UseSessionsProps {
  onSessionModelLoaded?: (provider: string, model: string) => void;
  onNotify?: (message: string) => void;
}

export const useSessions = ({ onSessionModelLoaded, onNotify }: UseSessionsProps = {}) => {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => localStorage.getItem('harnessly_session_id') || null
  );
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const loadSessionList = useCallback(async () => {
    try {
      const data = await getSessions(50);
      setSessions(data.sessions || []);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }, []);

  const loadSessionData = useCallback(
    async (sid: string) => {
      try {
        const details = await getSessionDetails(sid);
        setCurrentSessionId(sid);
        localStorage.setItem('harnessly_session_id', sid);

        // Restore session-scoped active model if recorded (FR-36 / Phase 2)
        if (details.active_provider && details.active_model) {
          onSessionModelLoaded?.(details.active_provider, details.active_model);
        }

        setTurns(details.turns || []);
      } catch {
        // Session might have been deleted
        localStorage.removeItem('harnessly_session_id');
        setCurrentSessionId(null);
        setTurns([]);
      }
    },
    [onSessionModelLoaded]
  );

  useEffect(() => {
    loadSessionList();
    if (currentSessionId) {
      loadSessionData(currentSessionId);
    }
  }, [loadSessionList, loadSessionData]);

  const handleSelectSession = useCallback(
    (sid: string, onMobileClose?: () => void) => {
      loadSessionData(sid);
      if (window.innerWidth < 768 && onMobileClose) {
        onMobileClose();
      }
    },
    [loadSessionData]
  );

  const handleNewChat = useCallback((onMobileClose?: () => void) => {
    setCurrentSessionId(null);
    localStorage.removeItem('harnessly_session_id');
    setTurns([]);
    if (window.innerWidth < 768 && onMobileClose) {
      onMobileClose();
    }
  }, []);

  const handleDeleteSession = useCallback(
    async (sid: string, title: string) => {
      const ok = window.confirm(`Hapus riwayat percakapan:\n"${title || 'Sesi ini'}"?`);
      if (!ok) return;

      try {
        const success = await deleteSession(sid);
        if (success) {
          if (currentSessionId === sid) {
            handleNewChat();
          }
          await loadSessionList();
          onNotify?.('Sesi berhasil dihapus');
        }
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
    },
    [currentSessionId, handleNewChat, loadSessionList, onNotify]
  );

  const ensureSession = useCallback(() => {
    let sid = currentSessionId;
    if (!sid) {
      sid = 'ses_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      setCurrentSessionId(sid);
      localStorage.setItem('harnessly_session_id', sid);
    }
    return sid;
  }, [currentSessionId]);

  return {
    currentSessionId,
    setCurrentSessionId,
    sessions,
    turns,
    setTurns,
    loadSessionList,
    loadSessionData,
    handleSelectSession,
    handleNewChat,
    handleDeleteSession,
    ensureSession,
  };
};

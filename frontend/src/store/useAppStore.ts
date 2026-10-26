import { create } from 'zustand';
import {
  ActiveTab,
  EngineType,
  ChatTurn,
  ApprovalPayload,
} from '../types';

interface AppState {
  // Navigation
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;

  // Engine & Model Settings
  engine: EngineType;
  setEngine: (engine: EngineType) => void;
  activeProvider: string;
  activeModel: string;
  activeAuditorProvider: string;
  activeAuditorModel: string;
  setActiveModels: (
    provider: string,
    model: string,
    auditorProvider?: string,
    auditorModel?: string
  ) => void;

  // Session & Turns
  currentSessionId: string | null;
  setCurrentSessionId: (sid: string | null) => void;
  turns: ChatTurn[];
  setTurns: (turns: ChatTurn[] | ((prev: ChatTurn[]) => ChatTurn[])) => void;
  appendTurn: (turn: ChatTurn) => void;

  // Streaming & Human-in-the-Loop
  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;
  streamingStatus: string;
  setStreamingStatus: (status: string) => void;
  streamingTurn: ChatTurn | null;
  setStreamingTurn: (turn: ChatTurn | null | ((prev: ChatTurn | null) => ChatTurn | null)) => void;
  pendingApproval: ApprovalPayload | null;
  setPendingApproval: (payload: ApprovalPayload | null) => void;
  resetStream: () => void;

  // Modals & Sidebar UI
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isMetricsOpen: boolean;
  setIsMetricsOpen: (open: boolean) => void;
  isModelModalOpen: boolean;
  setIsModelModalOpen: (open: boolean) => void;

  // Toast
  toastMessage: string | null;
  showToast: (msg: string, durationMs?: number) => void;
}

let toastTimer: NodeJS.Timeout | null = null;

export const useAppStore = create<AppState>((set) => ({
  // Navigation
  activeTab: 'chat',
  setActiveTab: (activeTab) => set({ activeTab }),

  // Engine & Model Settings
  engine: 'manual',
  setEngine: (engine) => set({ engine }),
  activeProvider: 'groq',
  activeModel: 'openai/gpt-oss-120b',
  activeAuditorProvider: 'auto',
  activeAuditorModel: '',
  setActiveModels: (provider, model, auditorProvider = 'auto', auditorModel = '') =>
    set({
      activeProvider: provider,
      activeModel: model,
      activeAuditorProvider: auditorProvider,
      activeAuditorModel: auditorModel,
    }),

  // Session & Turns
  currentSessionId: localStorage.getItem('harnessly_session_id') || null,
  setCurrentSessionId: (sid) => {
    if (sid) {
      localStorage.setItem('harnessly_session_id', sid);
    } else {
      localStorage.removeItem('harnessly_session_id');
    }
    set({ currentSessionId: sid });
  },
  turns: [],
  setTurns: (turns) =>
    set((state) => ({
      turns: typeof turns === 'function' ? turns(state.turns) : turns,
    })),
  appendTurn: (turn) => set((state) => ({ turns: [...state.turns, turn] })),

  // Streaming & Human-in-the-Loop
  isStreaming: false,
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  streamingStatus: 'Merancang rencana analitik...',
  setStreamingStatus: (streamingStatus) => set({ streamingStatus }),
  streamingTurn: null,
  setStreamingTurn: (streamingTurn) =>
    set((state) => ({
      streamingTurn:
        typeof streamingTurn === 'function'
          ? streamingTurn(state.streamingTurn)
          : streamingTurn,
    })),
  pendingApproval: null,
  setPendingApproval: (pendingApproval) => set({ pendingApproval }),
  resetStream: () =>
    set({
      streamingTurn: null,
      pendingApproval: null,
      isStreaming: false,
      streamingStatus: 'Merancang rencana analitik...',
    }),

  // Modals & Sidebar UI
  isSidebarOpen: true,
  setIsSidebarOpen: (isSidebarOpen) =>
    set((state) => ({
      isSidebarOpen:
        typeof isSidebarOpen === 'function'
          ? isSidebarOpen(state.isSidebarOpen)
          : isSidebarOpen,
    })),
  isMetricsOpen: false,
  setIsMetricsOpen: (isMetricsOpen) => set({ isMetricsOpen }),
  isModelModalOpen: false,
  setIsModelModalOpen: (isModelModalOpen) => set({ isModelModalOpen }),

  // Toast
  toastMessage: null,
  showToast: (msg, durationMs = 3200) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toastMessage: msg });
    toastTimer = setTimeout(() => {
      set({ toastMessage: null });
      toastTimer = null;
    }, durationMs);
  },
}));

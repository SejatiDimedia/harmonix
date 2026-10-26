import React from 'react';
import { Plus, RefreshCw, MessageSquare, Trash2, X } from 'lucide-react';
import { ChatSessionSummary } from '../types';
import { formatSessionDate } from '../utils/formatters';

interface SidebarProps {
  isOpen: boolean;
  sessions: ChatSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  onDeleteSession: (sessionId: string, title: string) => void;
  onCloseMobile: () => void;
}

const SidebarComponent: React.FC<SidebarProps> = ({
  isOpen,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onRefreshSessions,
  onDeleteSession,
  onCloseMobile,
}) => {
  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-30 transition-opacity duration-200 md:hidden no-print print:hidden ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onCloseMobile}
      />

      {/* Sidebar container */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 bg-[#1b1a18] border-r border-[#2e2c28] flex flex-col transition-transform duration-200 ease-in-out shrink-0 no-print print:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
        }`}
      >
        {/* Header Action */}
        <div className="p-3 border-b border-[#2e2c28] flex items-center gap-2">
          <button
            type="button"
            onClick={onNewChat}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-clay-600 hover:bg-clay-500 text-white font-medium text-xs shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Percakapan Baru</span>
          </button>
          <button
            type="button"
            onClick={onRefreshSessions}
            className="p-2 rounded-xl text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#262421] transition cursor-pointer"
            title="Muat Ulang Riwayat"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            className="p-2 rounded-xl text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#262421] md:hidden transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sessions list count */}
        <div className="px-3.5 py-2 text-[10px] font-mono text-[#78756d] uppercase tracking-wider flex items-center justify-between">
          <span>Riwayat Analisis</span>
          <span>{sessions.length} sesi</span>
        </div>

        {/* Sessions scrollable area */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
          {sessions.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#78756d]">
              <p className="font-serif italic text-sm text-[#9c9990]">Belum ada riwayat</p>
              <p className="text-[11px] mt-1">Mulai ajukan pertanyaan data analitik pertama Anda.</p>
            </div>
          ) : (
            sessions.map((s) => {
              const isActive = s.session_id === currentSessionId;
              return (
                <div
                  key={s.session_id}
                  onClick={() => onSelectSession(s.session_id)}
                  className={`group relative flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition text-xs border ${
                    isActive
                      ? 'bg-[#282622] text-[#f5f4ef] border-clay-500/40 shadow-sm'
                      : 'text-[#a3a097] hover:bg-[#201f1d] hover:text-[#e4e2d9] border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1 pr-1">
                    <MessageSquare
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isActive ? 'text-clay-400' : 'text-[#817e75] group-hover:text-clay-400'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate leading-tight">
                        {s.title || 'Percakapan'}
                      </div>
                      <div className="text-[10px] text-[#78756d] mt-1 font-mono flex items-center gap-1.5">
                        <span>{s.total_turns} pesan</span>
                        <span>•</span>
                        <span>{formatSessionDate(s.last_activity || s.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.session_id, s.title);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-[#817e75] hover:text-rose-400 hover:bg-rose-950/40 transition shrink-0 cursor-pointer"
                    title="Hapus sesi"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
};

export const Sidebar = React.memo(SidebarComponent);

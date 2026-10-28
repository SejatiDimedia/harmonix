import React, { useState } from 'react';
import { Plus, RefreshCw, MessageSquare, Trash2, Pencil, Check, X } from 'lucide-react';
import { ChatSessionSummary } from '../types';
import { formatSessionDate } from '../utils/formatters';

interface SidebarProps {
  isOpen: boolean;
  sessions: ChatSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
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
  onRenameSession,
  onDeleteSession,
  onCloseMobile,
}) => {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');

  const handleStartRename = (e: React.MouseEvent, sid: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingSessionId(sid);
    setEditTitle(currentTitle || 'Percakapan');
  };

  const handleCancelRename = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingSessionId(null);
    setEditTitle('');
  };

  const handleSaveRename = (e: React.FormEvent, sid: string) => {
    e.preventDefault();
    e.stopPropagation();
    const cleanTitle = editTitle.trim();
    if (cleanTitle && onRenameSession) {
      onRenameSession(sid, cleanTitle);
    }
    setEditingSessionId(null);
    setEditTitle('');
  };
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
            aria-label="Muat ulang riwayat sesi percakapan"
            className="p-2 rounded-xl text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#262421] transition cursor-pointer"
            title="Muat Ulang Riwayat"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Tutup menu riwayat"
            className="p-2 rounded-xl text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#262421] md:hidden transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sessions list count */}
        <div className="px-3.5 py-2 text-[10px] font-mono text-[#9c9990] uppercase tracking-wider flex items-center justify-between">
          <span>Riwayat Analisis</span>
          <span>{sessions.length} sesi</span>
        </div>

        {/* Sessions scrollable area */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
          {sessions.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#9c9990]">
              <p className="font-serif italic text-sm text-[#dedcd5]">Belum ada riwayat</p>
              <p className="text-[11px] mt-1">Mulai ajukan pertanyaan data analitik pertama Anda.</p>
            </div>
          ) : (
            sessions.map((s) => {
              const isActive = s.session_id === currentSessionId;
              const isEditing = s.session_id === editingSessionId;

              return (
                <div
                  key={s.session_id}
                  onClick={() => !isEditing && onSelectSession(s.session_id)}
                  className={`group relative flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition text-xs border ${
                    isActive
                      ? 'bg-[#282622] text-[#f5f4ef] border-clay-500/40 shadow-sm'
                      : 'text-[#a3a097] hover:bg-[#201f1d] hover:text-[#e4e2d9] border-transparent'
                  }`}
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => handleSaveRename(e, s.session_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5"
                    >
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            handleCancelRename();
                          }
                        }}
                        autoFocus
                        maxLength={100}
                        aria-label="Nama sesi percakapan"
                        placeholder="Nama sesi..."
                        className="w-full bg-[#161513] border border-clay-500/60 rounded-lg px-2 py-1 text-xs text-[#f5f4ef] focus:outline-none focus:ring-1 focus:ring-clay-500 shadow-inner"
                      />
                      <button
                        type="submit"
                        disabled={!editTitle.trim()}
                        aria-label="Simpan perubahan nama sesi"
                        className="p-1 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-30 transition cursor-pointer shrink-0"
                        title="Simpan nama"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelRename}
                        aria-label="Batal ubah nama sesi"
                        className="p-1 rounded-md text-[#9c9990] hover:text-[#dedcd5] hover:bg-[#262421] transition cursor-pointer shrink-0"
                        title="Batal"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-start gap-2.5 min-w-0 flex-1 pr-1">
                        <MessageSquare
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            isActive ? 'text-clay-400' : 'text-[#9c9990] group-hover:text-clay-400'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate leading-tight">
                            {s.title || 'Percakapan'}
                          </div>
                          <div className="text-[10px] text-[#9c9990] mt-1 font-mono flex items-center gap-1.5">
                            <span>{s.total_turns} pesan</span>
                            <span>•</span>
                            <span>{formatSessionDate(s.last_activity || s.created_at)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleStartRename(e, s.session_id, s.title)}
                          aria-label={`Ubah nama sesi ${s.title || 'percakapan'}`}
                          className="p-1 rounded-lg text-[#9c9990] hover:text-clay-300 hover:bg-[#2e2c28] transition cursor-pointer"
                          title="Ubah nama sesi"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(s.session_id, s.title);
                          }}
                          aria-label={`Hapus sesi ${s.title || 'percakapan'}`}
                          className="p-1 rounded-lg text-[#9c9990] hover:text-rose-400 hover:bg-rose-950/40 transition shrink-0 cursor-pointer"
                          title="Hapus sesi"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
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

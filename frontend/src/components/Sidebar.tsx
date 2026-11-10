import React, { useState, useRef } from 'react';
import { Plus, RefreshCw, MessageSquare, LayoutDashboard, Layers, Trash2, Pencil, Check, X, PanelLeft } from 'lucide-react';
import { ChatSessionSummary, ActiveTab } from '../types';
import { formatSessionDate } from '../utils/formatters';
import { Button, Badge } from './ui';

interface SidebarProps {
  isOpen: boolean;
  activeTab: ActiveTab;
  widgetCount?: number;
  onSelectTab: (tab: ActiveTab) => void;
  sessions: ChatSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
  onDeleteSession: (sessionId: string, title: string) => void;
  onCloseMobile: () => void;
  onToggleSidebar?: () => void;
}

const SidebarComponent: React.FC<SidebarProps> = ({
  isOpen,
  activeTab,
  widgetCount = 0,
  onSelectTab,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onRefreshSessions,
  onRenameSession,
  onDeleteSession,
  onCloseMobile,
  onToggleSidebar,
}) => {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');

  // Slide / Drag State
  const [dragOffset, setDragOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartYRef = useRef<number>(0);
  const isHorizontalDragRef = useRef<boolean | null>(null);

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

  // Touch Swipe to Hide (Mobile & Touchscreens)
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, button, textarea, form')) return;

    dragStartXRef.current = e.touches[0].clientX;
    dragStartYRef.current = e.touches[0].clientY;
    isHorizontalDragRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const dx = currentX - dragStartXRef.current;
    const dy = currentY - dragStartYRef.current;

    // Detect if this is an intentional horizontal swipe
    if (isHorizontalDragRef.current === null) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          isHorizontalDragRef.current = true;
          setIsDragging(true);
        } else {
          isHorizontalDragRef.current = false;
        }
      }
    }

    if (isHorizontalDragRef.current) {
      // Only drag leftwards to close
      if (dx < 0) {
        setDragOffset(Math.max(-288, dx));
      } else {
        setDragOffset(0);
      }
    }
  };

  const handleTouchEnd = () => {
    if (isDragging) {
      // Threshold: swipe > 50px to the left collapses the sidebar
      if (dragOffset < -50) {
        if (onToggleSidebar) {
          onToggleSidebar();
        } else {
          onCloseMobile();
        }
      }
    }
    setIsDragging(false);
    setDragOffset(0);
    isHorizontalDragRef.current = null;
  };

  // Desktop Mouse Drag on Edge Handle
  const handleMouseDownEdge = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartXRef.current = e.clientX;
    setIsDragging(true);
    setDragOffset(0);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - dragStartXRef.current;
      if (dx < 0) {
        setDragOffset(Math.max(-288, dx));
      } else {
        setDragOffset(0);
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const dx = upEvent.clientX - dragStartXRef.current;
      if (dx < -50) {
        if (onToggleSidebar) {
          onToggleSidebar();
        } else {
          onCloseMobile();
        }
      }
      setIsDragging(false);
      setDragOffset(0);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Edge Swipe from Left Screen Border to Open (when sidebar is closed)
  const edgeTouchStartXRef = useRef<number>(0);
  const handleEdgeTouchStart = (e: React.TouchEvent) => {
    edgeTouchStartXRef.current = e.touches[0].clientX;
  };
  const handleEdgeTouchEnd = (e: React.TouchEvent) => {
    const endX = e.changedTouches[0].clientX;
    const dx = endX - edgeTouchStartXRef.current;
    if (dx > 45) {
      if (onToggleSidebar) onToggleSidebar();
    }
  };

  return (
    <>
      {/* Edge Touch Gesture Area to Slide-Open Sidebar when closed */}
      {!isOpen && (
        <div
          onTouchStart={handleEdgeTouchStart}
          onTouchEnd={handleEdgeTouchEnd}
          className="fixed inset-y-0 left-0 w-4 z-30 md:hidden"
          title="Geser ke kanan untuk membuka menu samping"
        />
      )}

      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden no-print print:hidden ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        style={{
          opacity: isDragging && dragOffset < 0
            ? Math.max(0, 1 - Math.abs(dragOffset) / 288)
            : undefined,
          transition: isDragging ? 'none' : 'opacity 200ms ease-in-out',
        }}
        onClick={onCloseMobile}
      />

      {/* Sidebar container with Slide Gestures */}
      <aside
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined,
          marginRight: dragOffset < 0 ? `${dragOffset}px` : undefined,
          transition: isDragging ? 'none' : undefined,
        }}
        className={`relative fixed md:static inset-y-0 left-0 z-40 w-72 bg-[#0b1424] border-r border-white/[0.06] flex flex-col transition-transform duration-200 ease-in-out shrink-0 no-print print:hidden ${isOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
          }`}
      >
        {/* Right Edge Slide / Drag Handle (Desktop) */}
        <div
          onMouseDown={handleMouseDownEdge}
          className="hidden md:flex absolute top-0 -right-2 w-4 h-full cursor-ew-resize group z-50 items-center justify-center select-none"
          title="Tarik atau geser ke kiri untuk menyembunyikan menu samping"
        >
          <div className="w-1 h-12 rounded-full bg-white/10 group-hover:bg-sky-400 group-hover:w-1.5 group-active:bg-sky-400 group-active:w-1.5 transition-all duration-150 flex items-center justify-center shadow-sm">
            <div className="w-0.5 h-4 bg-white/30 group-hover:bg-white/60 rounded-full" />
          </div>
        </div>
        {/* Top Header: App Branding & Hide Sidebar Button */}
        <div className="p-3.5 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <img
              src="/static/logo.png?v=2"
              alt="Harmonix"
              className="w-7 h-7 rounded-lg object-cover shadow-sm shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-100 font-sans tracking-tight leading-tight">
                Harmonix
              </span>
              <span className="text-[10px] text-slate-400 font-mono leading-none">
                Enterprise AI Analyst
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleSidebar || onCloseMobile}
            aria-label="Sembunyikan menu samping"
            title="Sembunyikan Menu Samping"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer border border-transparent hover:border-slate-700/60"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Primary Action: New Chat Button */}
        <div className="p-3 pb-2">
          <Button
            variant="secondary"
            size="md"
            fullWidth
            onClick={() => {
              onNewChat();
              onSelectTab('chat');
              if (window.innerWidth < 768) onCloseMobile();
            }}
            leftIcon={<Plus className="w-4 h-4 text-sky-400 shrink-0" />}
            className="justify-start border-slate-700/60"
          >
            New Chat
          </Button>
        </div>

        {/* Primary Workspace Navigation Tabs (Replaces top navbar tabs) */}
        <nav aria-label="Main Navigation" className="px-3 py-1 space-y-1 select-none">
          {/* Percakapan */}
          <button
            type="button"
            onClick={() => {
              onSelectTab('chat');
              if (window.innerWidth < 768) onCloseMobile();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer border ${activeTab === 'chat'
              ? 'bg-[#14223b] text-sky-300 font-semibold shadow-sm border-slate-700/60'
              : 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-[#121c2e] border-transparent'
              }`}
          >
            <div className="flex items-center gap-2.5">
              <MessageSquare className={`w-4 h-4 shrink-0 ${activeTab === 'chat' ? 'text-sky-400' : 'text-slate-400'}`} />
              <span className="font-sans">Analytics Chat</span>
            </div>
          </button>

          {/* Live Dashboard */}
          <button
            type="button"
            onClick={() => {
              onSelectTab('dashboard');
              if (window.innerWidth < 768) onCloseMobile();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer border ${activeTab === 'dashboard'
              ? 'bg-[#14223b] text-sky-300 font-semibold shadow-sm border-slate-700/60'
              : 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-[#121c2e] border-transparent'
              }`}
          >
            <div className="flex items-center gap-2.5">
              <LayoutDashboard className={`w-4 h-4 shrink-0 ${activeTab === 'dashboard' ? 'text-sky-400' : 'text-slate-400'}`} />
              <span className="font-sans">Live Dashboard</span>
            </div>
            {widgetCount > 0 && (
              <Badge variant={activeTab === 'dashboard' ? 'info' : 'neutral'} size="xs">
                {widgetCount}
              </Badge>
            )}
          </button>

          {/* Bulk Analytics */}
          <button
            type="button"
            onClick={() => {
              onSelectTab('batch');
              if (window.innerWidth < 768) onCloseMobile();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer border ${activeTab === 'batch'
              ? 'bg-[#14223b] text-sky-300 font-semibold shadow-sm border-slate-700/60'
              : 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-[#121c2e] border-transparent'
              }`}
          >
            <div className="flex items-center gap-2.5">
              <Layers className={`w-4 h-4 shrink-0 ${activeTab === 'batch' ? 'text-sky-400' : 'text-slate-400'}`} />
              <span className="font-sans">Bulk Analytics</span>
            </div>
          </button>
        </nav>

        {/* Section Header: Session History */}
        <div className="mt-2 pt-2.5 px-3.5 pb-1 flex items-center justify-between text-[10px] font-mono text-slate-400 select-none">
          <div className="flex items-center gap-1.5 uppercase tracking-wider font-semibold">
            <span>Session History</span>
            <span className="text-slate-500 font-normal">({sessions.length})</span>
          </div>
          <button
            type="button"
            onClick={onRefreshSessions}
            aria-label="Refresh session history"
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
            title="Refresh History"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Sessions scrollable area */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
          {sessions.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#94a3b8]">
              <p className="font-serif italic text-sm text-[#f8fafc]">No history yet</p>
              <p className="text-[11px] mt-1">Ask your first data analysis question to get started.</p>
            </div>
          ) : (
            sessions.map((s) => {
              const isActive = s.session_id === currentSessionId;
              const isEditing = s.session_id === editingSessionId;

              return (
                <div
                  key={s.session_id}
                  onClick={() => !isEditing && onSelectSession(s.session_id)}
                  className={`group relative flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition text-xs ${isActive
                    ? 'bg-[#14223b] text-[#f8fafc] shadow-sm font-medium'
                    : 'text-[#94a3b8] hover:bg-[#14223b]/60 hover:text-[#f8fafc]'
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
                        aria-label="Session title"
                        placeholder="Session title..."
                        className="w-full bg-[#080f1d] border border-clay-500/60 rounded-lg px-2 py-1 text-xs text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-clay-500 shadow-inner"
                      />
                      <button
                        type="submit"
                        disabled={!editTitle.trim()}
                        aria-label="Save session title"
                        className="p-1 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-30 transition cursor-pointer shrink-0"
                        title="Save title"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelRename}
                        aria-label="Cancel renaming"
                        className="p-1 rounded-md text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#182a47] transition cursor-pointer shrink-0"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-start gap-2.5 min-w-0 flex-1 pr-1">
                        <MessageSquare
                          className={`w-4 h-4 mt-0.5 shrink-0 ${isActive ? 'text-clay-400' : 'text-[#94a3b8] group-hover:text-clay-400'
                            }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate leading-tight">
                            {s.title || 'Conversation'}
                          </div>
                          <div className="text-[10px] text-[#94a3b8] mt-1 font-mono flex items-center gap-1.5">
                            <span>{s.total_turns} {s.total_turns === 1 ? 'turn' : 'turns'}</span>
                            <span>•</span>
                            <span>{formatSessionDate(s.last_activity || s.created_at)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleStartRename(e, s.session_id, s.title)}
                          aria-label={`Rename session ${s.title || 'conversation'}`}
                          className="p-1 rounded-lg text-[#94a3b8] hover:text-clay-300 hover:bg-[#1e3557] transition cursor-pointer"
                          title="Rename session"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(s.session_id, s.title);
                          }}
                          aria-label={`Delete session ${s.title || 'conversation'}`}
                          className="p-1 rounded-lg text-[#94a3b8] hover:text-rose-400 hover:bg-rose-950/40 transition shrink-0 cursor-pointer"
                          title="Delete session"
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

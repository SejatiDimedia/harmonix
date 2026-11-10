import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  LayoutDashboard,
  RefreshCw,
  Trash2,
  Code,
  MessageSquare,
  ArrowRight,
  Pin,
  Download,
  FileDown,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  Tv,
  Clock,
  Maximize,
  X,
  Share2,
  Check,
  SlidersHorizontal,
  Maximize2,
  ChevronDown,
} from 'lucide-react';
import { DashboardWidget, ChartSpec, TableData } from '../types';
import { DataChart } from './DataChart';
import { formatSQL, getChartDescriptiveTitle, formatTableCellValue } from '../utils/formatters';
import { exportTableToCSV, triggerExecutivePDFPrint } from '../utils/exportUtils';
import { updateDashboardLayout } from '../services/api';

interface DashboardCanvasProps {
  widgets: DashboardWidget[];
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onDeleteWidget: (widgetId: string) => void;
  onSwitchToChat: () => void;
  sessionTitle?: string;
  sessionId?: string;
  activeModel?: string;
  showToast?: (msg: string) => void;
  initialTvMode?: boolean;
  isStandaloneTv?: boolean;
  onExitTv?: () => void;
  onDrillDown?: (prompt: string) => void;
  onPrefillChat?: (text: string) => void;
}

export const DashboardCanvas: React.FC<DashboardCanvasProps> = ({
  widgets,
  isLoading,
  isRefreshing,
  onRefresh,
  onDeleteWidget,
  onSwitchToChat,
  sessionTitle,
  sessionId,
  activeModel,
  showToast,
  initialTvMode = false,
  isStandaloneTv = false,
  onExitTv,
  onDrillDown,
  onPrefillChat,
}) => {
  const [expandedSqlIds, setExpandedSqlIds] = useState<Record<string, boolean>>({});
  const [localWidgets, setLocalWidgets] = useState<DashboardWidget[]>(widgets);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [isTvMode, setIsTvMode] = useState<boolean>(initialTvMode);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(30);
  const [countdownSec, setCountdownSec] = useState<number>(30);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [copiedTvLink, setCopiedTvLink] = useState(false);
  const [isTvEditLayout, setIsTvEditLayout] = useState(false);
  const [isTvAutoFit, setIsTvAutoFit] = useState<boolean>(true);
  const [isRefreshMenuOpen, setIsRefreshMenuOpen] = useState(false);
  const refreshMenuRef = useRef<HTMLDivElement>(null);

  // Close refresh dropdown on click outside
  useEffect(() => {
    if (!isRefreshMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (refreshMenuRef.current && !refreshMenuRef.current.contains(event.target as Node)) {
        setIsRefreshMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isRefreshMenuOpen]);

  const handleCopyTvLink = () => {
    if (!sessionId) {
      if (showToast) showToast('Please select or create a conversation session first');
      return;
    }
    const origin = window.location.origin;
    const tvUrl = `${origin}/tv/${sessionId}`;
    navigator.clipboard.writeText(tvUrl);
    setCopiedTvLink(true);
    setTimeout(() => setCopiedTvLink(false), 2500);
    if (showToast) {
      showToast('TV Command Center link copied to clipboard!');
    }
  };

  // 1. Digital Clock Timer (1s updates)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Auto-Refresh Loop for TV Mode
  useEffect(() => {
    if (!isTvMode || refreshIntervalSec <= 0) return;

    setCountdownSec(refreshIntervalSec);
    const interval = setInterval(() => {
      setCountdownSec((prev) => {
        if (prev <= 1) {
          onRefresh();
          setLastRefreshedAt(new Date());
          return refreshIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isTvMode, refreshIntervalSec, onRefresh]);

  // 3. Escape key to exit TV mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTvMode && !isStandaloneTv) {
        setIsTvMode(false);
        if (onExitTv) onExitTv();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTvMode, isStandaloneTv, onExitTv]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => { });
      }
    }
  };

  useEffect(() => {
    const sorted = [...widgets].sort((a, b) => (a.layout_position ?? 0) - (b.layout_position ?? 0));
    setLocalWidgets(sorted);
  }, [widgets]);

  const persistLayout = async (newWidgets: DashboardWidget[]) => {
    if (!sessionId) return;
    try {
      setIsSavingLayout(true);
      const items = newWidgets.map((w, idx) => ({
        widget_id: w.widget_id,
        position: idx,
        span: w.layout_span || 'half',
        height: w.layout_height || 'normal',
      }));
      await updateDashboardLayout(sessionId, items);
      if (showToast) {
        showToast('Dashboard layout saved');
      }
    } catch (err) {
      console.error('Failed to save dashboard layout:', err);
      if (showToast) {
        showToast('Failed to save dashboard layout');
      }
    } finally {
      setIsSavingLayout(false);
    }
  };

  const tvGridRef = useRef<HTMLDivElement>(null);
  const normalGridRef = useRef<HTMLDivElement>(null);

  interface ResizingState {
    widgetId: string;
    startX: number;
    startY: number;
    startCols: number;
    startHeight: number;
    currentCols: number;
    currentHeight: number;
    gridWidth: number;
  }
  const [resizingState, setResizingState] = useState<ResizingState | null>(null);

  const parseColSpan = (span?: string | number): number => {
    if (typeof span === 'number') return Math.max(3, Math.min(12, span));
    if (!span) return 6;
    if (span === 'full') return 12;
    if (span === 'half') return 6;
    if (span === 'third') return 4;
    const num = parseInt(span, 10);
    return isNaN(num) ? 6 : Math.max(3, Math.min(12, num));
  };

  const parseHeightPx = (height?: string | number, isKiosk: boolean = false): number => {
    if (typeof height === 'number') return Math.max(220, Math.min(900, height));
    if (!height) return isKiosk ? 460 : 440;
    if (height === 'compact') return isKiosk ? 340 : 320;
    if (height === 'normal') return isKiosk ? 460 : 440;
    if (height === 'tall') return isKiosk ? 580 : 560;
    const num = parseInt(height, 10);
    return isNaN(num) ? (isKiosk ? 460 : 440) : Math.max(220, Math.min(900, num));
  };

  const getSpanClass = (span?: string | number): string => {
    const n = parseColSpan(span);
    switch (n) {
      case 3:
        return 'col-span-12 sm:col-span-6 md:col-span-4 lg:col-span-3';
      case 4:
        return 'col-span-12 sm:col-span-6 md:col-span-6 lg:col-span-4';
      case 5:
        return 'col-span-12 sm:col-span-6 md:col-span-6 lg:col-span-5';
      case 6:
        return 'col-span-12 md:col-span-6 lg:col-span-6';
      case 7:
        return 'col-span-12 md:col-span-12 lg:col-span-7';
      case 8:
        return 'col-span-12 md:col-span-12 lg:col-span-8';
      case 9:
        return 'col-span-12 md:col-span-12 lg:col-span-9';
      case 10:
        return 'col-span-12 md:col-span-12 lg:col-span-10';
      case 11:
        return 'col-span-12 md:col-span-12 lg:col-span-11';
      case 12:
        return 'col-span-12 md:col-span-12 lg:col-span-12';
      default:
        return 'col-span-12 md:col-span-6 lg:col-span-6';
    }
  };

  // Dynamically compute the number of rows in the 12-column grid
  const totalGridRows = useMemo(() => {
    let currentCols = 0;
    let rows = 1;
    for (const w of localWidgets) {
      const span = parseColSpan(w.layout_span);
      if (currentCols + span > 12) {
        rows++;
        currentCols = span;
      } else {
        currentCols += span;
      }
    }
    return Math.max(1, rows);
  }, [localWidgets]);

  const autoFitHeightStyle = useMemo(() => {
    if (totalGridRows === 1) {
      return 'calc(100vh - 104px)';
    }
    if (totalGridRows === 2) {
      return 'calc((100vh - 124px) / 2)';
    }
    return 'max(280px, calc((100vh - 144px) / 3))';
  }, [totalGridRows]);

  const handleStartResize = (
    e: React.MouseEvent,
    widgetId: string,
    currentCols: number,
    currentHeight: number,
    isTv: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();

    if (isTv) {
      setIsTvAutoFit(false);
    }

    const gridEl = isTv ? tvGridRef.current : normalGridRef.current;
    const gridWidth = gridEl ? gridEl.getBoundingClientRect().width : window.innerWidth;

    setResizingState({
      widgetId,
      startX: e.clientX,
      startY: e.clientY,
      startCols: currentCols,
      startHeight: currentHeight,
      currentCols,
      currentHeight,
      gridWidth,
    });
  };

  const handleStartResizeTouch = (
    e: React.TouchEvent,
    widgetId: string,
    currentCols: number,
    currentHeight: number,
    isTv: boolean
  ) => {
    if (e.touches.length !== 1) return;
    if (isTv) {
      setIsTvAutoFit(false);
    }
    const touch = e.touches[0];
    const gridEl = isTv ? tvGridRef.current : normalGridRef.current;
    const gridWidth = gridEl ? gridEl.getBoundingClientRect().width : window.innerWidth;

    setResizingState({
      widgetId,
      startX: touch.clientX,
      startY: touch.clientY,
      startCols: currentCols,
      startHeight: currentHeight,
      currentCols,
      currentHeight,
      gridWidth,
    });
  };

  useEffect(() => {
    if (!resizingState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizingState.startX;
      const deltaY = e.clientY - resizingState.startY;

      const colWidth = Math.max(40, resizingState.gridWidth / 12);
      const deltaCols = Math.round(deltaX / colWidth);
      const newCols = Math.max(3, Math.min(12, resizingState.startCols + deltaCols));
      const newHeight = Math.max(220, Math.min(900, Math.round(resizingState.startHeight + deltaY)));

      setResizingState((prev) =>
        prev
          ? {
            ...prev,
            currentCols: newCols,
            currentHeight: newHeight,
          }
          : null
      );
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - resizingState.startX;
      const deltaY = touch.clientY - resizingState.startY;

      const colWidth = Math.max(40, resizingState.gridWidth / 12);
      const deltaCols = Math.round(deltaX / colWidth);
      const newCols = Math.max(3, Math.min(12, resizingState.startCols + deltaCols));
      const newHeight = Math.max(220, Math.min(900, Math.round(resizingState.startHeight + deltaY)));

      setResizingState((prev) =>
        prev
          ? {
            ...prev,
            currentCols: newCols,
            currentHeight: newHeight,
          }
          : null
      );
    };

    const handleEnd = () => {
      const finalState = resizingState;
      if (!finalState) return;

      const { widgetId, currentCols, currentHeight, startCols, startHeight } = finalState;
      setResizingState(null);

      if (currentCols !== startCols || currentHeight !== startHeight) {
        setLocalWidgets((prev) => {
          const updated = prev.map((w) => {
            if (w.widget_id === widgetId) {
              return {
                ...w,
                layout_span: String(currentCols),
                layout_height: String(currentHeight),
              };
            }
            return w;
          });
          persistLayout(updated);
          return updated;
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleEnd);

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'se-resize';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [resizingState]);

  const handleMoveWidget = (widgetId: string, direction: 'up' | 'down') => {
    const idx = localWidgets.findIndex((w) => w.widget_id === widgetId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= localWidgets.length) return;

    const copy = [...localWidgets];
    const [moved] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, moved);

    const reindexed = copy.map((w, pos) => ({ ...w, layout_position: pos }));
    setLocalWidgets(reindexed);
    persistLayout(reindexed);
  };

  const toggleSql = (id: string) => {
    setExpandedSqlIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExportChartData = (spec: ChartSpec, title: string) => {
    if (!spec.data || spec.data.length === 0) return;
    const columns = Object.keys(spec.data[0]);
    const rows = spec.data.map((item) => columns.map((col) => item[col]));
    const tableData: TableData = { columns, rows };
    exportTableToCSV(tableData, title);
  };

  const formattedPrintDate = new Date().toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isTvMode) {
    return (
      <div className="fixed inset-0 z-50 bg-[#080f1d] text-[#f8fafc] flex flex-col overflow-hidden select-none">
        {/* TV Header Bar - Production Clean Single Bar */}
        <header className="h-14 px-6 bg-[#0b1424]/95 border-b border-white/[0.06] backdrop-blur-md flex items-center justify-between shrink-0 sticky top-0 z-40 gap-4">
          {/* Left: Branding & Connection Status */}
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/static/logo.png?v=2"
              alt="Harmonix"
              className="w-7 h-7 rounded-lg object-contain shadow-sm shrink-0"
            />
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-sm sm:text-base text-slate-100 font-sans tracking-tight truncate max-w-xs md:max-w-md">
                {sessionTitle || 'Harmonix Dashboard'}
              </span>
            </div>
          </div>

          {/* Center: Realtime Digital Clock */}
          <div className="hidden md:flex items-center gap-2 font-mono text-xs text-slate-300 select-none bg-[#14223b]/50 px-3 py-1 rounded-full border border-white/[0.04]">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-semibold text-slate-100 tracking-wider">
              {currentTime.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-400 font-sans text-xs">
              {currentTime.toLocaleDateString('en-US', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </span>
          </div>

          {/* Right: Consolidated Minimalist Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* 1. Refresh & Interval Control (Compact Capsule + Dropdown) */}
            <div className="relative" ref={refreshMenuRef}>
              <div className="flex items-center bg-[#14223b]/90 border border-white/[0.08] rounded-lg p-0.5 text-xs shadow-sm">
                <button
                  type="button"
                  onClick={() => {
                    onRefresh();
                    setLastRefreshedAt(new Date());
                    setCountdownSec(refreshIntervalSec);
                  }}
                  disabled={isRefreshing}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-slate-300 hover:text-white hover:bg-white/[0.05] rounded-md transition cursor-pointer"
                  title={`Refresh data now (${lastRefreshedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})${refreshIntervalSec > 0 ? ` (Auto: ${countdownSec}s)` : ''}`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span className="font-mono text-[11px] font-medium text-slate-200">
                    {refreshIntervalSec > 0 ? `${countdownSec}s` : 'Refresh'}
                  </span>
                </button>
                <div className="h-3 w-px bg-white/[0.08]" />
                <button
                  type="button"
                  onClick={() => setIsRefreshMenuOpen((prev) => !prev)}
                  className="flex items-center gap-1 px-2 py-1 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded-md transition cursor-pointer text-[11px] font-mono"
                  title="Select auto-refresh interval"
                >
                  <span>
                    {refreshIntervalSec === 0
                      ? 'Off'
                      : refreshIntervalSec >= 60
                        ? `${refreshIntervalSec / 60}m`
                        : `${refreshIntervalSec}s`}
                  </span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>
              </div>

              {/* Interval Popover Dropdown */}
              {isRefreshMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-40 bg-[#0f1b2d] border border-white/[0.1] rounded-lg shadow-2xl py-1 z-50 text-xs backdrop-blur-md">
                  <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-b border-white/[0.06]">
                    Refresh Interval
                  </div>
                  {[
                    { label: 'Off', val: 0 },
                    { label: 'Every 30 seconds', val: 30 },
                    { label: 'Every 60 seconds', val: 60 },
                    { label: 'Every 5 minutes', val: 300 },
                  ].map((item) => (
                    <button
                      key={item.val}
                      type="button"
                      onClick={() => {
                        setRefreshIntervalSec(item.val);
                        setCountdownSec(item.val);
                        setIsRefreshMenuOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between text-xs transition cursor-pointer hover:bg-sky-500/10 ${refreshIntervalSec === item.val
                        ? 'text-sky-400 font-medium bg-sky-500/5'
                        : 'text-slate-300'
                        }`}
                    >
                      <span>{item.label}</span>
                      {refreshIntervalSec === item.val && <Check className="w-3.5 h-3.5 text-sky-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 2. View & Layout Controls (Unified Capsule) */}
            <div className="flex items-center bg-[#14223b]/90 border border-white/[0.08] rounded-lg p-0.5 text-xs shadow-sm">
              <button
                type="button"
                onClick={() => setIsTvEditLayout((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans transition cursor-pointer ${isTvEditLayout
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.05]'
                  }`}
                title="Edit widget layout and positions"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isTvEditLayout ? 'Done' : 'Layout'}</span>
              </button>

              <div className="h-3 w-px bg-white/[0.08]" />

              <button
                type="button"
                onClick={() => setIsTvAutoFit((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans transition cursor-pointer ${isTvAutoFit
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
                  }`}
                title={
                  isTvAutoFit
                    ? 'Auto-Fit Viewport Active: Cards automatically fit screen height'
                    : 'Custom Mode: Click to fit viewport automatically'
                }
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Fit Screen</span>
              </button>
            </div>

            {/* 3. Utility Actions (Share, Fullscreen, Exit) */}
            <div className="flex items-center bg-[#14223b]/90 border border-white/[0.08] rounded-lg p-0.5 text-xs shadow-sm">
              <button
                type="button"
                onClick={handleCopyTvLink}
                className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/[0.05] transition cursor-pointer"
                title="Copy TV Command Center link to share"
              >
                {copiedTvLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Share2 className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/[0.05] transition cursor-pointer"
                title="Toggle Fullscreen"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>

              {!isStandaloneTv && (
                <>
                  <div className="h-3 w-px bg-white/[0.08]" />
                  <button
                    type="button"
                    onClick={() => {
                      setIsTvMode(false);
                      if (onExitTv) onExitTv();
                    }}
                    className="p-1.5 rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition cursor-pointer"
                    title="Exit TV mode (Esc)"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* TV Main Grid */}
        <main
          className={`flex-1 p-4 sm:p-5 flex flex-col ${isTvAutoFit && totalGridRows <= 2 ? 'overflow-hidden' : 'overflow-y-auto pb-6'
            }`}
        >
          {localWidgets.length === 0 ? (
            <div className="h-full flex-1 flex flex-col items-center justify-center space-y-4 text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-[#14223b] flex items-center justify-center text-slate-400 shadow-lg">
                <Tv className="w-8 h-8 text-sky-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-100 font-sans">
                Awaiting Pinned Dashboard Widgets
              </h2>
              <p className="text-xs text-slate-400 max-w-md">
                No chart or table widgets have been pinned to this dashboard yet.
              </p>
            </div>
          ) : (
            <div
              ref={tvGridRef}
              className={`grid grid-cols-12 gap-4 sm:gap-5 w-full max-w-full ${isTvAutoFit && totalGridRows <= 2 ? 'flex-1 h-full min-h-0' : ''
                }`}
              style={
                isTvAutoFit && totalGridRows <= 2
                  ? {
                    gridTemplateRows: `repeat(${totalGridRows}, minmax(0, 1fr))`,
                  }
                  : undefined
              }
            >
              {localWidgets.map((w, idx) => {
                const isChart = w.widget_type === 'chart' && w.chart_spec;
                const isTable = w.widget_type === 'table' && w.table_data;
                const isBeingResized = resizingState?.widgetId === w.widget_id;
                const effectiveCols = isBeingResized ? resizingState.currentCols : parseColSpan(w.layout_span);
                const effectiveHeight = isBeingResized
                  ? resizingState.currentHeight
                  : parseHeightPx(w.layout_height, true);

                const displayTitle =
                  w.widget_type === 'chart'
                    ? getChartDescriptiveTitle(w.chart_spec, w.title)
                    : w.title && w.title.toLowerCase() !== 'table'
                      ? w.title
                      : `Data Table (${w.table_data?.rows?.length || 0} rows)`;

                return (
                  <div
                    key={w.widget_id}
                    style={
                      isBeingResized
                        ? {
                          height: `${resizingState.currentHeight}px`,
                          minHeight: '200px',
                        }
                        : isTvAutoFit
                          ? totalGridRows <= 2
                            ? {
                              height: '100%',
                              minHeight: 0,
                            }
                            : {
                              height: autoFitHeightStyle,
                              minHeight: '260px',
                            }
                          : {
                            height: `${effectiveHeight}px`,
                            minHeight: `${Math.min(effectiveHeight, 260)}px`,
                            maxHeight: 'calc(100vh - 100px)',
                          }
                    }
                    className={`relative rounded-2xl bg-[#0b1424] border border-white/[0.08] ${
                      effectiveHeight <= 300
                        ? 'p-2.5 sm:p-3'
                        : effectiveHeight <= 360
                        ? 'p-3 sm:p-3.5'
                        : 'p-4 sm:p-5'
                    } shadow-xl flex flex-col justify-between ${isBeingResized
                      ? 'transition-none ring-2 ring-sky-500/80 shadow-2xl shadow-sky-950/50 z-30'
                      : 'transition-all duration-150'
                      } ${getSpanClass(effectiveCols)}`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] gap-3 shrink-0">
                      <h2 className="text-sm sm:text-base font-semibold text-[#f8fafc] font-sans tracking-tight truncate">
                        {displayTitle}
                      </h2>

                      {/* Interactive TV Layout Controls */}
                      {isTvEditLayout && (
                        <div className="flex items-center gap-2 animate-fadeIn shrink-0">
                          {/* Reorder Up/Down */}
                          <div className="flex items-center bg-[#14223b] rounded-lg p-0.5 border border-white/[0.06]">
                            <button
                              type="button"
                              onClick={() => handleMoveWidget(w.widget_id, 'up')}
                              disabled={idx === 0}
                              className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 transition cursor-pointer"
                              title="Move up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveWidget(w.widget_id, 'down')}
                              disabled={idx === localWidgets.length - 1}
                              className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 transition cursor-pointer"
                              title="Move down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Dimension Indicator Badge */}
                          <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-[#14223b] border border-white/[0.06]">
                            {effectiveCols} cols • {effectiveHeight}px
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Card Body */}
                    <div className={`flex-1 w-full min-h-0 flex flex-col items-center justify-center overflow-hidden ${
                      effectiveHeight <= 340 ? 'pt-1' : 'pt-2'
                    }`}>
                      {isChart && (
                        <div className="w-full h-full flex-1 flex flex-col items-center justify-center min-h-0">
                          <DataChart
                            charts={[w.chart_spec as ChartSpec]}
                            hideHeader={true}
                            showToolbox={false}
                            isKiosk={true}
                            onDrillDown={onDrillDown}
                            onPrefillChat={onPrefillChat}
                          />
                        </div>
                      )}
                      {isTable && (
                        <div className="overflow-x-auto overflow-y-auto rounded-xl border border-white/[0.06] bg-[#0b1322] w-full h-full max-h-full">
                          <table className="w-full text-xs text-left border-collapse table-auto">
                            <thead className="sticky top-0 bg-[#14223b] z-10">
                              <tr>
                                {(w.table_data?.columns || []).map((col, cIdx) => (
                                  <th
                                    key={cIdx}
                                    scope="col"
                                    className="p-3 text-[11px] font-mono uppercase text-[#94a3b8] border-b border-white/[0.06]"
                                  >
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                              {(w.table_data?.rows || []).slice(0, 50).map((row, rIdx) => (
                                <tr key={rIdx} className="hover:bg-white/[0.02] transition">
                                  {row.map((val, cellIdx) => {
                                    const colName = w.table_data?.columns?.[cellIdx];
                                    const { formatted, isNumeric } = formatTableCellValue(val, colName);
                                    return (
                                      <td
                                        key={cellIdx}
                                        className={`p-3 text-xs font-mono ${isNumeric ? 'text-[#38bdf8] font-medium' : 'text-slate-300 font-sans'
                                          }`}
                                      >
                                        {formatted}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Interactive Drag-to-Resize Corner Handle */}
                    {isTvEditLayout && (
                      <div
                        onMouseDown={(e) => handleStartResize(e, w.widget_id, effectiveCols, effectiveHeight, true)}
                        onTouchStart={(e) => handleStartResizeTouch(e, w.widget_id, effectiveCols, effectiveHeight, true)}
                        className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-md bg-[#14223b]/90 hover:bg-sky-600 text-slate-400 hover:text-white flex items-center justify-center cursor-se-resize transition-all border border-white/[0.08] hover:border-sky-400/50 z-30 group shadow-md select-none"
                        title="Drag corner to adjust column width and pixel height"
                      >
                        <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                          <line x1="6" y1="14" x2="14" y2="6" />
                          <line x1="10" y1="14" x2="14" y2="10" />
                          <line x1="13.5" y1="14" x2="14" y2="13.5" />
                        </svg>
                      </div>
                    )}

                    {/* Floating dimension tooltip badge during drag */}
                    {isBeingResized && (
                      <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-sky-600/95 text-white font-mono text-xs font-semibold shadow-lg backdrop-blur-sm border border-sky-400/50 pointer-events-none z-40 animate-pulse">
                        {effectiveCols}/12 Cols • {effectiveHeight}px
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth print:p-0 print:m-0 print:w-full print:max-w-full print:overflow-visible print:bg-white print:block">
      <div className="max-w-6xl mx-auto space-y-6 print:max-w-full print:w-full print:space-y-6 print:p-0 print:m-0 print:bg-white print:block">
        {/* Printable Executive Letterhead (Visible only when printing to PDF / Paper) */}
        <div className="print-only hidden pb-6 mb-6 border-b-2 border-gray-300 space-y-5">
          {/* Top Brand Bar */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/static/logo.png?v=2"
                alt="Harmonix Logo"
                className="w-11 h-11 rounded-xl object-contain border border-gray-200 shadow-sm"
              />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold tracking-tight text-gray-900 font-sans">
                    HARMONIX ENTERPRISE
                  </span>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-clay-100 text-clay-900 border border-clay-200 uppercase font-semibold">
                    Executive BI
                  </span>
                </div>
                <p className="text-xs text-gray-500 font-sans tracking-wide">
                  Autonomous Business Intelligence & Executive Performance Report
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end text-right">
              <span className="inline-block px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase rounded bg-gray-900 text-white font-mono">
                CONFIDENTIAL • INTERNAL USE
              </span>
              <span className="text-[10px] text-gray-500 font-mono mt-1">
                Ref: REP-{sessionId ? sessionId.slice(0, 8).toUpperCase() : 'LIVE-01'}
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                Print Date: {formattedPrintDate}
              </span>
            </div>
          </div>

          {/* Accent Divider */}
          <div className="h-px bg-gray-200" />

          {/* Executive KPI & Governance Cards */}
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-lg bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">Analysis Subject</span>
              <span className="font-bold text-gray-900 text-[11px] truncate block mt-0.5">
                {sessionTitle || 'Executive Data Analysis'}
              </span>
            </div>
            <div className="p-3.5 rounded-lg bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">AI Reasoning Engine</span>
              <span className="font-semibold text-gray-800 text-[11px] truncate block mt-0.5">
                {activeModel || 'Llama 3.3 70B (Groq)'}
              </span>
            </div>
            <div className="p-3.5 rounded-lg bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">Warehouse Database</span>
              <span className="font-semibold text-gray-800 text-[11px] truncate block mt-0.5">
                PostgreSQL 16 Enterprise
              </span>
            </div>
            <div className="p-3.5 rounded-lg bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">Auditor Verification</span>
              <span className="font-semibold text-emerald-700 text-[11px] flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                100% Read-Only Safety
              </span>
            </div>
          </div>

          {/* Executive Overview Narrative */}
          <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/90 text-[9.5pt] text-gray-800 leading-relaxed">
            <strong className="text-gray-950 font-bold">Executive Summary: </strong>
            This document presents business intelligence insights autonomously extracted from transactional data warehouses. All SQL queries were deterministically validated by guardrail systems to guarantee data integrity and read-only compliance without manual modification.
          </div>

          {/* Section I Header for Print */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
              I. Key Visualizations & Analytical Components ({widgets.length} Components)
            </h2>
            <span className="text-[9px] font-mono text-gray-500">
              Paper Format: A4 Portrait
            </span>
          </div>
        </div>

        {/* Dashboard Canvas Header (Hidden on print) */}
        <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0f1a2e] border border-white/[0.06] shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-clay-500/15 text-clay-400">
                <LayoutDashboard className="w-5 h-5" />
              </div>
              <h1 className="text-lg font-semibold text-[#f8fafc] font-sans flex items-center gap-2.5">
                <span>Live BI Dashboard Canvas</span>
                {isSavingLayout && (
                  <span className="flex items-center gap-1 text-[11px] font-mono text-sky-300 bg-sky-500/15 px-2 py-0.5 rounded">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    <span>Saving layout...</span>
                  </span>
                )}
              </h1>
            </div>
            <p className="text-xs text-[#94a3b8] leading-relaxed max-w-xl">
              Interactive visualization canvas pinned from active conversations. Data can be refreshed in real time against analytical databases or exported as executive documents.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={handleCopyTvLink}
              disabled={widgets.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#14223b] hover:bg-[#182a47] disabled:opacity-40 text-[#94a3b8] hover:text-[#f8fafc] text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              aria-label="Copy TV Command Center link to share"
              title="Copy TV mode URL to open in another browser or office monitor"
            >
              {copiedTvLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-sans">Copied!</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>Share TV Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsTvMode(true)}
              disabled={widgets.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#14223b] hover:bg-[#1a2d4e] disabled:opacity-40 text-slate-100 border border-slate-700/60 text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              aria-label="Open TV Kiosk Mode"
              title="Display dashboard in Fullscreen TV Kiosk Mode"
            >
              <Tv className="w-3.5 h-3.5 text-sky-400" />
              <span>TV Kiosk Mode</span>
            </button>

            <button
              type="button"
              onClick={triggerExecutivePDFPrint}
              disabled={widgets.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#14223b] hover:bg-[#182a47] disabled:opacity-40 disabled:hover:bg-[#14223b] text-[#94a3b8] hover:text-[#f8fafc] text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              aria-label="Export dashboard as PDF report"
              title="Print or export dashboard as executive PDF report"
            >
              <FileDown className="w-3.5 h-3.5 text-clay-400" />
              <span>Export PDF</span>
            </button>

            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing || widgets.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-clay-600 hover:bg-clay-500 disabled:opacity-40 disabled:hover:bg-clay-600 text-white text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              aria-label="Refresh all dashboard widget data"
              title="Refresh all widget data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh Data'}</span>
            </button>
          </div>
        </div>

        {/* Empty State */}
        {widgets.length === 0 && !isLoading && (
          <div className="py-16 text-center space-y-5 rounded-2xl border border-dashed border-white/[0.1] bg-[#0b1526] p-8 no-print">
            <div className="w-12 h-12 rounded-2xl bg-[#14223b] flex items-center justify-center text-[#94a3b8] mx-auto shadow-sm">
              <Pin className="w-6 h-6" />
            </div>
            <div className="space-y-2 max-w-md mx-auto">
              <h3 className="text-sm font-semibold text-[#f8fafc]">
                No Dashboard Widgets Pinned
              </h3>
              <p className="text-xs text-[#94a3b8] leading-relaxed">
                You can pin bar charts, donut charts, or data tables from the chat tab by clicking the <strong>Pin</strong> button on any analytical result.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={onSwitchToChat}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#14223b] hover:bg-[#182a47] text-xs font-medium text-clay-400 transition cursor-pointer shadow-sm"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Open Chat Tab</span>
                <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
              </button>
            </div>
          </div>
        )}

        {/* Widgets Grid */}
        {localWidgets.length > 0 && (
          <div
            ref={normalGridRef}
            className="grid grid-cols-12 print:block print:space-y-6 gap-6 w-full max-w-full"
          >
            {localWidgets.map((w, idx) => {
              const isChart = w.widget_type === 'chart' && w.chart_spec;
              const isTable = w.widget_type === 'table' && w.table_data;
              const isSqlExpanded = !!expandedSqlIds[w.widget_id];
              const isBeingResized = resizingState?.widgetId === w.widget_id;
              const effectiveCols = isBeingResized ? resizingState.currentCols : parseColSpan(w.layout_span);
              const effectiveHeight = isBeingResized
                ? resizingState.currentHeight
                : parseHeightPx(w.layout_height, false);

              const displayTitle =
                w.widget_type === 'chart'
                  ? getChartDescriptiveTitle(w.chart_spec, w.title)
                  : w.title && w.title.toLowerCase() !== 'table'
                    ? w.title
                    : `Data Table (${w.table_data?.rows?.length || 0} rows)`;

              return (
                <div
                  key={w.widget_id}
                  style={{ height: `${effectiveHeight}px`, minHeight: `${effectiveHeight}px` }}
                  className={`print-widget-card relative rounded-2xl bg-[#0f1a2e] print:bg-white border border-white/[0.06] print:border-gray-300 ${
                    effectiveHeight <= 300
                      ? 'p-2.5 sm:p-3 gap-1'
                      : effectiveHeight <= 360
                      ? 'p-3 sm:p-3.5 gap-1.5 sm:gap-2'
                      : 'p-4 sm:p-5 gap-2.5 sm:gap-3'
                  } shadow-md shadow-black/20 flex flex-col ${isBeingResized
                    ? 'transition-none ring-2 ring-sky-500/80 shadow-2xl shadow-sky-950/50 z-30'
                    : 'transition-all duration-150'
                    } print:space-y-3 print:rounded-xl print:p-0 print:overflow-hidden ${getSpanClass(
                      effectiveCols
                    )}`}
                >
                  {/* Card Header (Corporate Styled on Print) */}
                  <div className="flex items-start justify-between gap-2.5 pb-2 border-b border-white/[0.04] print:bg-gray-50/80 print:p-4 print:pb-3 print:border-b print:border-gray-200 shrink-0">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="print-only hidden inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-900 text-white font-mono text-[10px] font-bold shrink-0">
                          {idx + 1}
                        </span>
                        <h2
                          className="text-xs sm:text-sm font-semibold text-[#f8fafc] truncate font-sans print:text-sm print:font-bold print:text-gray-900 tracking-tight"
                          title={displayTitle}
                        >
                          {displayTitle}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#94a3b8] font-mono print:text-gray-500 truncate">
                        <span className="uppercase text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-[#14223b] text-clay-400 print:bg-white print:text-gray-700 print:border-gray-300 print:font-semibold">
                          {w.widget_type === 'chart'
                            ? (w.chart_spec?.chart_type || 'chart')
                            : 'table'}
                        </span>
                        {w.updated_at && (
                          <span
                            className="text-slate-500 truncate"
                            title={`Synced: ${new Date(w.updated_at).toLocaleTimeString('en-US')}`}
                          >
                            {new Date(w.updated_at).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                        <span className="text-slate-600 font-mono hidden sm:inline" title="Column width x pixel height">
                          {effectiveCols} cols • {effectiveHeight}px
                        </span>
                      </div>
                    </div>

                    {/* Compact Icon Toolbar */}
                    <div className="flex items-center gap-1 shrink-0 no-print">
                      {/* Reorder Up & Down */}
                      <div className="flex items-center bg-[#14223b] rounded-lg p-0.5 border border-white/[0.06]">
                        <button
                          type="button"
                          onClick={() => handleMoveWidget(w.widget_id, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed transition cursor-pointer"
                          aria-label="Move widget up"
                          title="Move up"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveWidget(w.widget_id, 'down')}
                          disabled={idx === localWidgets.length - 1}
                          className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed transition cursor-pointer"
                          aria-label="Move widget down"
                          title="Move down"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Download CSV Button for Table Widget */}
                      {isTable && w.table_data && (
                        <button
                          type="button"
                          onClick={() => exportTableToCSV(w.table_data!, displayTitle)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#14223b] transition cursor-pointer"
                          aria-label={`Download ${displayTitle} as CSV`}
                          title="Download table data as CSV"
                        >
                          <Download className="w-3.5 h-3.5 text-sky-400" />
                        </button>
                      )}

                      {/* Download CSV Button for Chart Widget if underlying data exists */}
                      {isChart && w.chart_spec?.data && w.chart_spec.data.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleExportChartData(w.chart_spec!, displayTitle)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#14223b] transition cursor-pointer"
                          aria-label={`Download ${displayTitle} as CSV`}
                          title="Download chart data as CSV"
                        >
                          <Download className="w-3.5 h-3.5 text-sky-400" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onDeleteWidget(w.widget_id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition shrink-0 cursor-pointer"
                        aria-label={`Remove widget ${displayTitle} from dashboard`}
                        title="Remove widget from dashboard"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body: Chart or Table */}
                  <div className="flex-1 w-full min-h-0 overflow-hidden flex flex-col print:bg-white print:p-4 print:pt-1">
                    {isChart && (
                      <div className="w-full h-full flex-1 min-h-0 flex flex-col print:bg-white">
                        <DataChart
                          charts={[w.chart_spec as ChartSpec]}
                          hideHeader={true}
                          showToolbox={false}
                          onDrillDown={onDrillDown}
                          onPrefillChat={onPrefillChat}
                        />
                        <div className="print-only hidden text-center text-[8.5pt] text-gray-500 font-sans mt-3 italic">
                          * Figure {idx + 1}: {displayTitle} (Source: PostgreSQL warehouse).
                        </div>
                      </div>
                    )}

                    {isTable && (
                      <div className="overflow-x-auto overflow-y-auto rounded-xl border border-white/[0.06] bg-[#0b1322] w-full h-full max-h-full print:bg-white print:border print:border-gray-200 print:rounded-lg print:overflow-hidden">
                        <table className="w-full text-xs text-left border-collapse table-auto print:bg-white">
                          <thead>
                            <tr className="print:bg-gray-100">
                              {(w.table_data?.columns || []).map((col, cIdx) => (
                                <th
                                    key={cIdx}
                                    scope="col"
                                    className="p-2.5 text-[10px] font-mono uppercase bg-[#14223b] print:bg-gray-100 text-[#94a3b8] print:text-gray-900 border-b border-white/[0.04] print:border-gray-300 print:font-bold"
                                  >
                                    {col}
                                  </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(w.table_data?.rows || []).slice(0, 50).map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className={`${rIdx % 2 === 0 ? 'bg-[#0f1a2e]' : 'bg-[#111e33]'
                                  } print:bg-white print:even:bg-gray-50/70 hover:bg-[#14223b] transition`}
                              >
                                {row.map((val, cellIdx) => {
                                  const colName = w.table_data?.columns?.[cellIdx];
                                  const { formatted, isNumeric } = formatTableCellValue(val, colName);
                                  return (
                                    <td
                                      key={cellIdx}
                                      className={`p-2.5 border-b border-white/[0.03] print:border-gray-200 text-[#f8fafc] print:text-gray-800 font-mono text-[11px] print:bg-transparent ${isNumeric ? 'text-[#38bdf8] font-medium' : ''
                                        }`}
                                    >
                                      {val !== null && val !== undefined ? formatted : '-'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {(w.table_data?.rows?.length || 0) > 50 && (
                          <div className="print-only hidden text-[8pt] text-gray-500 font-mono mt-1.5 italic">
                            * Showing first 50 rows of {w.table_data?.rows?.length} total data rows.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Print-Only Subtle Card Footnote */}
                  <div className="print-only hidden px-4 py-2 border-t border-gray-100 text-[8pt] text-gray-400 font-sans flex justify-between items-center bg-gray-50/50">
                    <span>Harmonix Enterprise BI Platform • Read-Only Verified</span>
                    <span className="font-mono">ID: {w.widget_id.slice(0, 8)}</span>
                  </div>

                  {/* Card Footer: Collapsible SQL on screen only */}
                  {w.sql_query && (
                    <div className="pt-1.5 border-t border-white/[0.04] no-print shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleSql(w.widget_id)}
                        aria-expanded={isSqlExpanded}
                        className="flex items-center gap-1.5 text-[10px] font-mono text-[#94a3b8] hover:text-clay-400 transition cursor-pointer"
                      >
                        <Code className="w-3 h-3" />
                        <span>{isSqlExpanded ? 'Hide SQL' : 'View SQL Query'}</span>
                      </button>

                      {isSqlExpanded && (
                        <div className="mt-1.5 p-2 rounded-lg bg-[#0b1322] border border-white/[0.06] text-[10px] font-mono text-clay-300 max-h-28 overflow-x-auto overflow-y-auto whitespace-pre">
                          {formatSQL(w.sql_query)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Interactive Drag-to-Resize Corner Handle */}
                  <div
                    onMouseDown={(e) => handleStartResize(e, w.widget_id, effectiveCols, effectiveHeight, false)}
                    onTouchStart={(e) => handleStartResizeTouch(e, w.widget_id, effectiveCols, effectiveHeight, false)}
                    className="no-print absolute bottom-1.5 right-1.5 w-6 h-6 rounded-md bg-[#14223b]/90 hover:bg-sky-600 text-slate-400 hover:text-white flex items-center justify-center cursor-se-resize transition-all border border-white/[0.08] hover:border-sky-400/50 z-30 group shadow-md select-none"
                    title="Drag corner to adjust column width and pixel height"
                  >
                    <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                      <line x1="6" y1="14" x2="14" y2="6" />
                      <line x1="10" y1="14" x2="14" y2="10" />
                      <line x1="13.5" y1="14" x2="14" y2="13.5" />
                    </svg>
                  </div>

                  {/* Floating dimension tooltip badge during drag */}
                  {isBeingResized && (
                    <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-sky-600/95 text-white font-mono text-xs font-semibold shadow-lg backdrop-blur-sm border border-sky-400/50 pointer-events-none z-40 animate-pulse">
                      {effectiveCols}/12 Cols • {effectiveHeight}px
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Print-Only Appendix: Data Lineage & Governance Audit Trail */}
        {widgets.some((w) => w.sql_query) && (
          <div className="print-only hidden pt-6 mt-8 border-t-2 border-gray-300 break-inside-avoid">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold tracking-tight text-gray-900 uppercase font-sans">
                Appendix: Data Governance & Audit Trail
              </h3>
              <span className="text-[9px] text-emerald-700 font-semibold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">
                Guardrail Certified: 100% Read-Only Safety
              </span>
            </div>
            <p className="text-[9.5pt] text-gray-500 mb-4 font-sans">
              The following validated SQL queries were executed directly against PostgreSQL warehouse to generate the visualizations above without manual transformation:
            </p>
            <div className="space-y-3">
              {widgets.map((w, wIdx) => {
                if (!w.sql_query) return null;
                const widgetTitle =
                  w.widget_type === 'chart'
                    ? getChartDescriptiveTitle(w.chart_spec, w.title)
                    : w.title || `Data Table #${wIdx + 1}`;

                return (
                  <div
                    key={w.widget_id}
                    className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-[8pt] font-mono"
                  >
                    <div className="flex justify-between items-center text-gray-700 font-semibold mb-1">
                      <span>
                        Section {wIdx + 1}: {widgetTitle}
                      </span>
                      <span className="text-gray-500 font-normal">Dialect: PostgreSQL</span>
                    </div>
                    <pre className="text-gray-800 whitespace-pre-wrap bg-white p-2 rounded border border-gray-200 text-[7.5pt] overflow-hidden">
                      {w.sql_query}
                    </pre>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Print-Only Document Footer & Sign-off */}
        <div className="print-only hidden mt-8 pt-4 border-t border-gray-200 text-center text-[9px] text-gray-400 font-mono">
          Harmonix Autonomous Business Intelligence Platform • Official Digital Report • Export Date: {formattedPrintDate}
        </div>
      </div>
    </div>
  );
};

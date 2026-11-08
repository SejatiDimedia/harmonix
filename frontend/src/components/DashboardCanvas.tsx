import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  RefreshCw,
  Trash2,
  Code,
  Calendar,
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

  const handleCopyTvLink = () => {
    if (!sessionId) {
      if (showToast) showToast('Pilih atau buat sesi percakapan terlebih dahulu');
      return;
    }
    const origin = window.location.origin;
    const tvUrl = `${origin}/tv/${sessionId}`;
    navigator.clipboard.writeText(tvUrl);
    setCopiedTvLink(true);
    setTimeout(() => setCopiedTvLink(false), 2500);
    if (showToast) {
      showToast('Tautan TV Command Center disalin ke clipboard!');
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
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
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
      }));
      await updateDashboardLayout(sessionId, items);
      if (showToast) {
        showToast('Tata letak dashboard tersimpan');
      }
    } catch (err) {
      console.error('Failed to save dashboard layout:', err);
      if (showToast) {
        showToast('Gagal menyimpan tata letak dashboard');
      }
    } finally {
      setIsSavingLayout(false);
    }
  };

  const getSpanClass = (span?: string) => {
    if (span === 'full') return 'lg:col-span-12';
    if (span === 'third') return 'lg:col-span-4';
    return 'lg:col-span-6';
  };

  const handleSetSpan = (widgetId: string, span: 'half' | 'full' | 'third') => {
    const updated = localWidgets.map((w) => {
      if (w.widget_id === widgetId) {
        return { ...w, layout_span: span };
      }
      return w;
    });
    setLocalWidgets(updated);
    persistLayout(updated);
  };

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

  const formattedPrintDate = new Date().toLocaleDateString('id-ID', {
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
              <span
                className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"
                title={`PostgreSQL Terhubung • Terakhir sinkronisasi: ${lastRefreshedAt.toLocaleTimeString('id-ID')}`}
              />
            </div>
          </div>

          {/* Center: Realtime Digital Clock (Single-line executive display) */}
          <div className="hidden md:flex items-center gap-2 font-mono text-xs text-slate-300 select-none">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-semibold text-slate-100 tracking-wider">
              {currentTime.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-400 font-sans text-xs">
              {currentTime.toLocaleDateString('id-ID', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </span>
          </div>

          {/* Right: Consolidated Minimalist Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Compact Refresh Pill */}
            <div className="flex items-center bg-[#14223b] rounded-lg p-0.5 border border-white/[0.06] text-xs">
              <button
                type="button"
                onClick={() => {
                  onRefresh();
                  setLastRefreshedAt(new Date());
                  setCountdownSec(refreshIntervalSec);
                }}
                disabled={isRefreshing}
                className="p-1.5 text-slate-300 hover:text-white transition cursor-pointer flex items-center gap-1"
                title={`Segarkan data sekarang ${refreshIntervalSec > 0 ? `(Auto: ${countdownSec}s)` : ''}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                {refreshIntervalSec > 0 && (
                  <span className="text-[10px] font-mono text-sky-400 font-semibold">{countdownSec}s</span>
                )}
              </button>
              <div className="h-3 w-px bg-white/[0.08]" />
              <div className="flex items-center px-1">
                {[
                  { label: 'Off', val: 0 },
                  { label: '30s', val: 30 },
                  { label: '60s', val: 60 },
                  { label: '5m', val: 300 },
                ].map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    onClick={() => setRefreshIntervalSec(item.val)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition cursor-pointer ${
                      refreshIntervalSec === item.val
                        ? 'bg-sky-600 text-white font-medium shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Atur Layout Toggle */}
            <button
              type="button"
              onClick={() => setIsTvEditLayout((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-sans transition cursor-pointer border ${
                isTvEditLayout
                  ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                  : 'bg-[#14223b] hover:bg-[#1a2d4e] text-slate-300 border-white/[0.06]'
              }`}
              title="Atur kolom dan tata letak widget langsung di layar TV"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Layout</span>
            </button>

            {/* Shareable Link Button */}
            <button
              type="button"
              onClick={handleCopyTvLink}
              className="p-1.5 rounded-lg bg-[#14223b] hover:bg-[#1a2d4e] text-slate-300 border border-white/[0.06] transition cursor-pointer shadow-sm"
              title="Salin tautan TV Command Center untuk dibagikan"
            >
              {copiedTvLink ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Share2 className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg bg-[#14223b] hover:bg-[#1a2d4e] text-slate-300 border border-white/[0.06] transition cursor-pointer"
              title="Toggle Fullscreen Layar Penuh"
            >
              <Maximize className="w-3.5 h-3.5 text-slate-300" />
            </button>

            {/* Exit Button */}
            {!isStandaloneTv && (
              <button
                type="button"
                onClick={() => {
                  setIsTvMode(false);
                  if (onExitTv) onExitTv();
                }}
                className="p-1.5 rounded-lg bg-[#14223b] hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-white/[0.06] transition cursor-pointer"
                title="Keluar dari mode TV (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </header>

        {/* TV Main Grid */}
        <main className="flex-1 p-5 overflow-y-auto flex flex-col">
          {localWidgets.length === 0 ? (
            <div className="h-full flex-1 flex flex-col items-center justify-center space-y-4 text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-[#14223b] flex items-center justify-center text-slate-400 shadow-lg">
                <Tv className="w-8 h-8 text-sky-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-100 font-sans">
                Menunggu Komponen Dashboard Tersemat
              </h2>
              <p className="text-xs text-slate-400 max-w-md">
                Belum ada widget grafik atau tabel yang disematkan ke dashboard ini.
              </p>
            </div>
          ) : (
            <div
              className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-5 w-full max-w-full ${
                localWidgets.length <= 2 ? 'flex-1' : ''
              }`}
            >
              {localWidgets.map((w, idx) => {
                const isChart = w.widget_type === 'chart' && w.chart_spec;
                const isTable = w.widget_type === 'table' && w.table_data;
                const displayTitle =
                  w.widget_type === 'chart'
                    ? getChartDescriptiveTitle(w.chart_spec, w.title)
                    : w.title && w.title.toLowerCase() !== 'table'
                      ? w.title
                      : `Tabel Data (${w.table_data?.rows?.length || 0} baris)`;

                return (
                  <div
                    key={w.widget_id}
                    className={`rounded-2xl bg-[#0b1424] border border-white/[0.08] p-5 shadow-xl flex flex-col justify-between transition-all duration-300 ${
                      localWidgets.length <= 2 ? 'min-h-[calc(100vh-100px)]' : 'min-h-[440px]'
                    } ${getSpanClass(w.layout_span)}`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] gap-3">
                      <h2 className="text-sm sm:text-base font-semibold text-[#f8fafc] font-sans tracking-tight truncate">
                        {displayTitle}
                      </h2>

                      {/* Interactive TV Layout Controls */}
                      {isTvEditLayout && (
                        <div className="flex items-center gap-1.5 animate-fadeIn shrink-0">
                          {/* Reorder Up/Down */}
                          <div className="flex items-center bg-[#14223b] rounded-lg p-0.5 border border-white/[0.06]">
                            <button
                              type="button"
                              onClick={() => handleMoveWidget(w.widget_id, 'up')}
                              disabled={idx === 0}
                              className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 transition cursor-pointer"
                              title="Pindah ke atas"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveWidget(w.widget_id, 'down')}
                              disabled={idx === localWidgets.length - 1}
                              className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-25 transition cursor-pointer"
                              title="Pindah ke bawah"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Segmented Width Selector */}
                          <div className="inline-flex rounded-lg bg-[#14223b] p-0.5 border border-white/[0.06]">
                            <button
                              type="button"
                              onClick={() => handleSetSpan(w.widget_id, 'half')}
                              className={`px-2 py-0.5 text-[10px] font-mono rounded transition cursor-pointer ${
                                w.layout_span === 'half' || !w.layout_span
                                  ? 'bg-sky-600 text-white font-medium shadow-sm'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                              title="2 Kolom per baris (50% lebar)"
                            >
                              2 Kolom
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetSpan(w.widget_id, 'full')}
                              className={`px-2 py-0.5 text-[10px] font-mono rounded transition cursor-pointer ${
                                w.layout_span === 'full'
                                  ? 'bg-sky-600 text-white font-medium shadow-sm'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                              title="1 Kolom per baris (100% penuh)"
                            >
                              1 Kolom
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Card Body */}
                    <div className="flex-1 w-full min-h-[320px] flex flex-col items-center justify-center pt-2">
                      {isChart && (
                        <div className="w-full h-full flex-1 flex flex-col items-center justify-center">
                          <DataChart charts={[w.chart_spec as ChartSpec]} hideHeader={true} isKiosk={true} />
                        </div>
                      )}
                      {isTable && (
                        <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0b1322] w-full max-h-[calc(100vh-220px)]">
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
                              {(w.table_data?.rows || []).slice(0, 20).map((row, rIdx) => (
                                <tr key={rIdx} className="hover:bg-white/[0.02] transition">
                                  {row.map((val, cellIdx) => {
                                    const colName = w.table_data?.columns?.[cellIdx];
                                    const { formatted, isNumeric } = formatTableCellValue(val, colName);
                                    return (
                                      <td
                                        key={cellIdx}
                                        className={`p-3 text-xs font-mono ${
                                          isNumeric ? 'text-[#38bdf8] font-medium' : 'text-slate-300 font-sans'
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
                Waktu Cetak: {formattedPrintDate}
              </span>
            </div>
          </div>

          {/* Accent Divider */}
          <div className="h-px bg-gray-200" />

          {/* Executive KPI & Governance Cards */}
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-lg bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">Topik Analisis</span>
              <span className="font-bold text-gray-900 text-[11px] truncate block mt-0.5">
                {sessionTitle || 'Analisis Data Eksekutif'}
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
            <strong className="text-gray-950 font-bold">Ringkasan Eksekutif: </strong>
            Dokumen ini menyajikan wawasan analitik bisnis yang diekstraksi secara otonom dari data warehouse transaksional. Seluruh kueri SQL telah diverifikasi secara deterministik oleh sistem guardrail untuk menjamin integritas data dan kepatuhan read-only tanpa modifikasi manual.
          </div>

          {/* Section I Header for Print */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
              I. Visualisasi & Komponen Analisis Kunci ({widgets.length} Komponen)
            </h2>
            <span className="text-[9px] font-mono text-gray-500">
              Format Kertas: A4 Portrait
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
                  <span className="flex items-center gap-1 text-[11px] font-mono text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/40">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    <span>Menyimpan layout...</span>
                  </span>
                )}
              </h1>
            </div>
            <p className="text-xs text-[#94a3b8] leading-relaxed max-w-xl">
              Papan visualisasi interaktif tersemat dari percakapan aktif. Data dapat disegarkan ulang secara berkala langsung ke database analitik atau diekspor sebagai dokumen eksekutif.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={handleCopyTvLink}
              disabled={widgets.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#14223b] hover:bg-[#182a47] disabled:opacity-40 text-[#94a3b8] hover:text-[#f8fafc] text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              aria-label="Salin tautan TV Command Center untuk dibagikan"
              title="Salin URL mode TV untuk dibuka di browser lain atau monitor kantor"
            >
              {copiedTvLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-sans">Tersalin!</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>Bagikan Link TV</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsTvMode(true)}
              disabled={widgets.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#14223b] hover:bg-[#1a2d4e] disabled:opacity-40 text-slate-100 border border-slate-700/60 text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              aria-label="Buka Mode TV Kiosk"
              title="Tampilkan dashboard dalam Mode TV Kiosk Layar Penuh"
            >
              <Tv className="w-3.5 h-3.5 text-sky-400" />
              <span>Mode TV Kiosk</span>
            </button>

            <button
              type="button"
              onClick={triggerExecutivePDFPrint}
              disabled={widgets.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#14223b] hover:bg-[#182a47] disabled:opacity-40 disabled:hover:bg-[#14223b] text-[#94a3b8] hover:text-[#f8fafc] text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              aria-label="Ekspor dashboard sebagai dokumen laporan PDF"
              title="Cetak atau simpan dashboard sebagai dokumen laporan PDF"
            >
              <FileDown className="w-3.5 h-3.5 text-clay-400" />
              <span>Ekspor PDF</span>
            </button>

            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing || widgets.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-clay-600 hover:bg-clay-500 disabled:opacity-40 disabled:hover:bg-clay-600 text-white text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              aria-label="Segarkan data semua widget di dashboard"
              title="Segarkan data semua widget"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Menyegarkan...' : 'Segarkan Data'}</span>
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
                Belum Ada Widget yang Disematkan
              </h3>
              <p className="text-xs text-[#94a3b8] leading-relaxed">
                Anda dapat menyematkan grafik batang, diagram donat, atau tabel hasil analisis dari tab percakapan dengan menekan tombol <strong>Pin</strong> pada hasil analitik.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={onSwitchToChat}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#14223b] hover:bg-[#182a47] text-xs font-medium text-clay-400 transition cursor-pointer shadow-sm"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Buka Tab Percakapan</span>
                <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
              </button>
            </div>
          </div>
        )}

        {/* Widgets Grid */}
        {localWidgets.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 print:block print:space-y-6 gap-6 w-full max-w-full">
            {localWidgets.map((w, idx) => {
              const isChart = w.widget_type === 'chart' && w.chart_spec;
              const isTable = w.widget_type === 'table' && w.table_data;
              const isSqlExpanded = !!expandedSqlIds[w.widget_id];
              const displayTitle =
                w.widget_type === 'chart'
                  ? getChartDescriptiveTitle(w.chart_spec, w.title)
                  : w.title && w.title.toLowerCase() !== 'table'
                    ? w.title
                    : `Tabel Data (${w.table_data?.rows?.length || 0} baris)`;

              return (
                <div
                  key={w.widget_id}
                  className={`print-widget-card rounded-2xl bg-[#0f1a2e] print:bg-white border border-white/[0.06] print:border-gray-300 p-5 shadow-md shadow-black/20 flex flex-col justify-between transition-all duration-200 space-y-4 print:space-y-3 print:rounded-xl print:p-0 print:overflow-hidden ${getSpanClass(
                    w.layout_span
                  )}`}
                >
                  {/* Card Header (Corporate Styled on Print) */}
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.04] print:bg-gray-50/80 print:p-4 print:pb-3 print:border-b print:border-gray-200">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="print-only hidden inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-900 text-white font-mono text-[10px] font-bold shrink-0">
                          {idx + 1}
                        </span>
                        <h2 className="text-sm font-semibold text-[#f8fafc] truncate font-sans print:text-sm print:font-bold print:text-gray-900">
                          {displayTitle}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#94a3b8] font-mono print:text-gray-500">
                        <span className="uppercase px-2 py-0.5 rounded bg-[#14223b] text-clay-400 print:bg-white print:text-gray-700 print:border-gray-300 print:font-semibold print:text-[9px]">
                          {w.widget_type === 'chart'
                            ? w.chart_spec?.chart_type
                              ? `Grafik ${w.chart_spec.chart_type.toUpperCase()}`
                              : 'Grafik Visualisasi'
                            : 'Tabel Data Analisis'}
                        </span>
                        {w.updated_at && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-clay-400 print:text-gray-400" />
                            <span>
                              Sinkronisasi:{' '}
                              {new Date(w.updated_at).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 no-print flex-wrap justify-end">
                      {/* Urutan Posisi Ke Atas */}
                      <button
                        type="button"
                        onClick={() => handleMoveWidget(w.widget_id, 'up')}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] disabled:opacity-25 disabled:cursor-not-allowed transition cursor-pointer"
                        aria-label="Pindahkan widget ke atas"
                        title="Pindahkan widget ke posisi sebelumnya"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      {/* Urutkan Posisi Ke Bawah */}
                      <button
                        type="button"
                        onClick={() => handleMoveWidget(w.widget_id, 'down')}
                        disabled={idx === localWidgets.length - 1}
                        className="p-1.5 rounded-lg text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] disabled:opacity-25 disabled:cursor-not-allowed transition cursor-pointer"
                        aria-label="Pindahkan widget ke bawah"
                        title="Pindahkan widget ke posisi selanjutnya"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      {/* Segmented Width Selector: 2 Kolom vs 1 Kolom */}
                      <div className="inline-flex rounded-lg bg-[#14223b] p-0.5 border border-white/[0.06] shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSetSpan(w.widget_id, 'half')}
                          className={`px-2 py-1 text-[11px] font-mono rounded transition cursor-pointer ${
                            w.layout_span === 'half' || !w.layout_span
                              ? 'bg-sky-600 text-white font-medium shadow-sm'
                              : 'text-[#94a3b8] hover:text-[#f8fafc]'
                          }`}
                          aria-label="Atur tampilan 2 kolom per baris (50%)"
                          title="2 Kolom per baris (50% lebar baris)"
                        >
                          2 Kolom
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetSpan(w.widget_id, 'full')}
                          className={`px-2 py-1 text-[11px] font-mono rounded transition cursor-pointer ${
                            w.layout_span === 'full'
                              ? 'bg-sky-600 text-white font-medium shadow-sm'
                              : 'text-[#94a3b8] hover:text-[#f8fafc]'
                          }`}
                          aria-label="Atur tampilan 1 kolom per baris (100% penuh)"
                          title="1 Kolom per baris (100% lebar penuh)"
                        >
                          1 Kolom
                        </button>
                      </div>

                      {/* Unduh CSV Button for Table Widget */}
                      {isTable && w.table_data && (
                        <button
                          type="button"
                          onClick={() => exportTableToCSV(w.table_data!, displayTitle)}
                          className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded bg-[#14223b] hover:bg-[#182a47] text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer shadow-sm"
                          aria-label={`Unduh data ${displayTitle} sebagai CSV`}
                          title="Unduh data tabel sebagai CSV"
                        >
                          <Download className="w-3 h-3 text-clay-400" />
                          <span>CSV</span>
                        </button>
                      )}

                      {/* Unduh CSV Button for Chart Widget if underlying data exists */}
                      {isChart && w.chart_spec?.data && w.chart_spec.data.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleExportChartData(w.chart_spec!, displayTitle)}
                          className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded bg-[#14223b] hover:bg-[#182a47] text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer shadow-sm"
                          aria-label={`Unduh data ${displayTitle} sebagai CSV`}
                          title="Unduh data grafik sebagai CSV"
                        >
                          <Download className="w-3 h-3 text-clay-400" />
                          <span>CSV</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onDeleteWidget(w.widget_id)}
                        className="p-1.5 rounded-lg text-[#94a3b8] hover:text-rose-400 hover:bg-rose-950/30 transition shrink-0 cursor-pointer"
                        aria-label={`Lepas widget ${displayTitle} dari dashboard`}
                        title="Lepas widget dari dashboard"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body: Chart or Table */}
                  <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center print:bg-white print:p-4 print:pt-1">
                    {isChart && (
                      <div className="w-full flex-1 flex flex-col items-center justify-center print:bg-white">
                        <div className="chart-wrapper w-full flex-1 flex items-center justify-center print:h-[250px] print:max-w-xl print:mx-auto">
                          <DataChart charts={[w.chart_spec as ChartSpec]} hideHeader={true} />
                        </div>
                        <div className="print-only hidden text-center text-[8.5pt] text-gray-500 font-sans mt-3 italic">
                          * Gambar {idx + 1}: {displayTitle} (Sumber: PostgreSQL warehouse).
                        </div>
                      </div>
                    )}

                    {isTable && (
                      <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0b1322] w-full print:bg-white print:border print:border-gray-200 print:rounded-lg print:overflow-hidden">
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
                            {(w.table_data?.rows || []).slice(0, 25).map((row, rIdx) => (
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
                                      className={`p-2.5 border-b border-white/[0.03] print:border-gray-200 text-[#f8fafc] print:text-gray-800 font-mono text-[11px] print:bg-transparent ${
                                        isNumeric ? 'text-[#38bdf8] font-medium' : ''
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
                        {(w.table_data?.rows?.length || 0) > 25 && (
                          <div className="print-only hidden text-[8pt] text-gray-500 font-mono mt-1.5 italic">
                            * Menampilkan 25 baris pertama dari total {w.table_data?.rows?.length} baris data.
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
                    <div className="pt-2 border-t border-white/[0.04] no-print">
                      <button
                        type="button"
                        onClick={() => toggleSql(w.widget_id)}
                        aria-expanded={isSqlExpanded}
                        className="flex items-center gap-1.5 text-[11px] font-mono text-[#94a3b8] hover:text-clay-400 transition cursor-pointer"
                      >
                        <Code className="w-3.5 h-3.5" />
                        <span>{isSqlExpanded ? 'Sembunyikan SQL' : 'Lihat SQL Kueri'}</span>
                      </button>

                      {isSqlExpanded && (
                        <div className="mt-2 p-2.5 rounded-lg bg-[#0b1322] border border-white/[0.06] text-[11px] font-mono text-clay-300 overflow-x-auto whitespace-pre">
                          {formatSQL(w.sql_query)}
                        </div>
                      )}
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
                Lampiran: Tata Kelola Data & Jejak Audit (Data Lineage & Audit Trail)
              </h3>
              <span className="text-[9px] text-emerald-700 font-semibold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">
                ✓ Guardrail Certified: 100% Read-Only Safety
              </span>
            </div>
            <p className="text-[9.5pt] text-gray-500 mb-4 font-sans">
              Kueri SQL berikut tervalidasi dieksekusi secara langsung ke PostgreSQL warehouse untuk menyusun visualisasi data di atas tanpa transformasi manual:
            </p>
            <div className="space-y-3">
              {widgets.map((w, wIdx) => {
                if (!w.sql_query) return null;
                const widgetTitle =
                  w.widget_type === 'chart'
                    ? getChartDescriptiveTitle(w.chart_spec, w.title)
                    : w.title || `Tabel Data #${wIdx + 1}`;

                return (
                  <div
                    key={w.widget_id}
                    className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-[8pt] font-mono"
                  >
                    <div className="flex justify-between items-center text-gray-700 font-semibold mb-1">
                      <span>
                        Bagian {wIdx + 1}: {widgetTitle}
                      </span>
                      <span className="text-gray-500 font-normal">Dialek: PostgreSQL</span>
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
          Harmonix Autonomous Business Intelligence Platform • Dokumen Resmi Tanpa Tanda Tangan Basah • Tanggal Ekspor: {formattedPrintDate}
        </div>
      </div>
    </div>
  );
};

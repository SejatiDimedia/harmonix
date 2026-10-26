import React, { useState } from 'react';
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
} from 'lucide-react';
import { DashboardWidget, ChartSpec, TableData } from '../types';
import { DataChart } from './DataChart';
import { formatSQL, getChartDescriptiveTitle } from '../utils/formatters';
import { exportTableToCSV, triggerExecutivePDFPrint } from '../utils/exportUtils';

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
}) => {
  const [expandedSqlIds, setExpandedSqlIds] = useState<Record<string, boolean>>({});

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

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Printable Executive Letterhead (Visible only when printing to PDF / Paper) */}
        <div className="print-only hidden pb-6 mb-6 border-b-2 border-gray-300 space-y-5">
          {/* Top Brand Bar */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/static/favicon.png"
                alt="Harnessly Logo"
                className="w-11 h-11 rounded-xl object-contain border border-gray-200 shadow-sm"
              />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold tracking-tight text-gray-900 font-sans">
                    HARNESSLY ENTERPRISE
                  </span>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-orange-100 text-orange-900 border border-orange-200 uppercase font-semibold">
                    Zero-Cost BI
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

          {/* Accent Ribbon */}
          <div className="h-1 bg-gradient-to-r from-clay-500 via-amber-500 to-clay-600 rounded-full" />

          {/* Executive KPI & Governance Cards */}
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">Topik Analisis</span>
              <span className="font-bold text-gray-900 text-[11px] truncate block mt-0.5">
                {sessionTitle || 'Analisis Data Eksekutif'}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">AI Reasoning Engine</span>
              <span className="font-semibold text-gray-800 text-[11px] truncate block mt-0.5">
                {activeModel || 'Llama 3.3 70B (Groq)'}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">Warehouse Database</span>
              <span className="font-semibold text-gray-800 text-[11px] truncate block mt-0.5">
                PostgreSQL 16 Enterprise
              </span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
              <span className="text-[9px] text-gray-500 uppercase font-mono block">Auditor Verification</span>
              <span className="font-semibold text-emerald-700 text-[11px] flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                100% Read-Only Safety
              </span>
            </div>
          </div>

          {/* Executive Overview Narrative */}
          <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/80 text-[9.5pt] text-gray-700 leading-relaxed">
            <strong className="text-gray-900 font-semibold">Ringkasan Eksekutif: </strong>
            Dokumen ini menyajikan wawasan analitik bisnis yang diekstraksi secara otonom dari data warehouse transaksional. Seluruh kueri SQL telah diverifikasi secara deterministik oleh sistem guardrail untuk menjamin integritas data dan kepatuhan read-only tanpa modifikasi manual.
          </div>
        </div>

        {/* Dashboard Canvas Header (Hidden on print) */}
        <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#1c1b18] border border-[#2e2c28] shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-clay-500/15 border border-clay-500/30 text-clay-400">
                <LayoutDashboard className="w-5 h-5" />
              </div>
              <h1 className="text-lg font-semibold text-[#f5f4ef] font-sans">
                Live BI Dashboard Canvas
              </h1>
            </div>
            <p className="text-xs text-[#a3a097] leading-relaxed max-w-xl">
              Papan visualisasi interaktif tersemat dari percakapan aktif. Data dapat disegarkan ulang secara berkala langsung ke PostgreSQL (0 biaya LLM) atau diekspor sebagai dokumen eksekutif.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={triggerExecutivePDFPrint}
              disabled={widgets.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#242320] hover:bg-[#2c2a26] disabled:opacity-40 disabled:hover:bg-[#242320] text-[#dedcd5] hover:text-[#f5f4ef] border border-[#383632] hover:border-[#48453f] text-xs font-medium transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
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
              title="Segarkan data semua widget"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Menyegarkan...' : 'Segarkan Data'}</span>
            </button>
          </div>
        </div>

        {/* Empty State */}
        {widgets.length === 0 && !isLoading && (
          <div className="py-16 text-center space-y-5 rounded-2xl border border-dashed border-[#2e2c28] bg-[#161513] p-8 no-print">
            <div className="w-12 h-12 rounded-2xl bg-[#201f1d] border border-[#2e2c28] flex items-center justify-center text-[#8e8b82] mx-auto">
              <Pin className="w-6 h-6" />
            </div>
            <div className="space-y-2 max-w-md mx-auto">
              <h3 className="text-sm font-semibold text-[#dedcd5]">
                Belum Ada Widget yang Disematkan
              </h3>
              <p className="text-xs text-[#8e8b82] leading-relaxed">
                Anda dapat menyematkan grafik batang, diagram donat, atau tabel hasil analisis dari tab percakapan dengan menekan tombol <strong>Pin</strong> pada hasil analitik.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={onSwitchToChat}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#201f1d] hover:bg-[#282623] text-xs font-medium text-clay-400 border border-[#383632] hover:border-clay-500/50 transition cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Buka Tab Percakapan</span>
                <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
              </button>
            </div>
          </div>
        )}

        {/* Widgets Grid */}
        {widgets.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-1 gap-6">
            {widgets.map((w, idx) => {
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
                  className="print-widget-card rounded-2xl bg-[#1c1b18] border border-[#2e2c28] hover:border-[#383632] p-5 shadow-sm flex flex-col justify-between transition space-y-4"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#262421] print:border-gray-200">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="no-print w-2 h-2 rounded-full bg-clay-500 shrink-0" />
                        <h2 className="text-sm font-semibold text-[#f5f4ef] truncate font-sans print:text-base print:text-gray-900">
                          <span className="print-only hidden mr-1 text-clay-700 font-bold font-mono">
                            Bagian {idx + 1}:
                          </span>
                          {displayTitle}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#8e8b82] font-mono print:text-gray-500">
                        <span className="uppercase px-2 py-0.5 rounded bg-[#242320] text-clay-400 border border-[#383632] print:bg-gray-100 print:text-gray-700 print:border-gray-200">
                          {w.widget_type === 'chart' ? 'Visualisasi Grafik' : 'Tabel Data'}
                        </span>
                        {w.updated_at && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
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

                    <div className="flex items-center gap-1.5 shrink-0 no-print">
                      {/* Unduh CSV Button for Table Widget */}
                      {isTable && w.table_data && (
                        <button
                          type="button"
                          onClick={() => exportTableToCSV(w.table_data!, displayTitle)}
                          className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded bg-[#242320] hover:bg-[#2c2a26] text-[#dedcd5] hover:text-[#f5f4ef] border border-[#383632] hover:border-[#48453f] transition cursor-pointer"
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
                          className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded bg-[#242320] hover:bg-[#2c2a26] text-[#dedcd5] hover:text-[#f5f4ef] border border-[#383632] hover:border-[#48453f] transition cursor-pointer"
                          title="Unduh data grafik sebagai CSV"
                        >
                          <Download className="w-3 h-3 text-clay-400" />
                          <span>CSV</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onDeleteWidget(w.widget_id)}
                        className="p-1.5 rounded-lg text-[#8e8b82] hover:text-rose-400 hover:bg-rose-950/30 transition shrink-0 cursor-pointer"
                        title="Lepas widget dari dashboard"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body: Chart or Table */}
                  <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center">
                    {isChart && (
                      <div className="w-full flex-1 flex flex-col items-center justify-center">
                        <DataChart charts={[w.chart_spec as ChartSpec]} hideHeader={true} />
                        <div className="print-only hidden text-center text-[8pt] text-gray-500 font-sans mt-2">
                          Visualisasi diekstrak dari basis data PostgreSQL warehouse.
                        </div>
                      </div>
                    )}

                    {isTable && (
                      <div className="overflow-x-auto rounded-xl border border-[#2e2c28] bg-[#161513] w-full print:border-none print:overflow-visible">
                        <table className="w-full text-xs text-left border-collapse table-auto">
                          <thead>
                            <tr>
                              {(w.table_data?.columns || []).map((col, cIdx) => (
                                <th
                                  key={cIdx}
                                  className="p-2 text-[10px] font-mono uppercase bg-[#201f1d] text-[#a3a097] border-b border-[#2e2c28]"
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
                                className={`${
                                  rIdx % 2 === 0 ? 'bg-[#161513]' : 'bg-[#1a1917]'
                                } hover:bg-[#201f1d] transition`}
                              >
                                {row.map((val, cellIdx) => (
                                  <td
                                    key={cellIdx}
                                    className="p-2 border-b border-[#262421] text-[#dedcd5] font-mono text-[11px]"
                                  >
                                    {val !== null && val !== undefined ? String(val) : '-'}
                                  </td>
                                ))}
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

                  {/* Card Footer: Collapsible SQL on screen only */}
                  {w.sql_query && (
                    <div className="pt-2 border-t border-[#262421] no-print">
                      <button
                        type="button"
                        onClick={() => toggleSql(w.widget_id)}
                        className="flex items-center gap-1.5 text-[11px] font-mono text-[#8e8b82] hover:text-clay-400 transition cursor-pointer"
                      >
                        <Code className="w-3.5 h-3.5" />
                        <span>{isSqlExpanded ? 'Sembunyikan SQL' : 'Lihat SQL Kueri'}</span>
                      </button>

                      {isSqlExpanded && (
                        <div className="mt-2 p-2.5 rounded-lg bg-[#141311] border border-[#2e2c28] text-[11px] font-mono text-clay-300 overflow-x-auto whitespace-pre">
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
          Harnessly Autonomous Business Intelligence Platform • Dokumen Resmi Tanpa Tanda Tangan Basah • Tanggal Ekspor: {formattedPrintDate}
        </div>
      </div>
    </div>
  );
};

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
} from 'lucide-react';
import { DashboardWidget, ChartSpec } from '../types';
import { DataChart } from './DataChart';
import { formatSQL } from '../utils/formatters';

interface DashboardCanvasProps {
  widgets: DashboardWidget[];
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onDeleteWidget: (widgetId: string) => void;
  onSwitchToChat: () => void;
}

export const DashboardCanvas: React.FC<DashboardCanvasProps> = ({
  widgets,
  isLoading,
  isRefreshing,
  onRefresh,
  onDeleteWidget,
  onSwitchToChat,
}) => {
  const [expandedSqlIds, setExpandedSqlIds] = useState<Record<string, boolean>>({});

  const toggleSql = (id: string) => {
    setExpandedSqlIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Dashboard Canvas Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#1c1b18] border border-[#2e2c28] shadow-sm">
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
              Papan visualisasi interaktif tersemat dari percakapan aktif. Data dapat disegarkan ulang secara berkala langsung ke PostgreSQL (0 biaya LLM).
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
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
          <div className="py-16 text-center space-y-5 rounded-2xl border border-dashed border-[#2e2c28] bg-[#161513] p-8">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {widgets.map((w) => {
              const isChart = w.widget_type === 'chart' && w.chart_spec;
              const isTable = w.widget_type === 'table' && w.table_data;
              const isSqlExpanded = !!expandedSqlIds[w.widget_id];

              return (
                <div
                  key={w.widget_id}
                  className="rounded-2xl bg-[#1c1b18] border border-[#2e2c28] hover:border-[#383632] p-5 shadow-sm flex flex-col justify-between transition space-y-4"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#262421]">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-clay-500 shrink-0" />
                        <h2 className="text-sm font-semibold text-[#f5f4ef] truncate font-sans">
                          {w.title}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#8e8b82] font-mono">
                        <span className="uppercase px-2 py-0.5 rounded bg-[#242320] text-clay-400 border border-[#383632]">
                          {w.widget_type}
                        </span>
                        {w.updated_at && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            <span>
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

                    <button
                      type="button"
                      onClick={() => onDeleteWidget(w.widget_id)}
                      className="p-1.5 rounded-lg text-[#8e8b82] hover:text-rose-400 hover:bg-rose-950/30 transition shrink-0 cursor-pointer"
                      title="Lepas widget dari dashboard"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Card Body: Chart or Table */}
                  <div className="flex-1 min-h-[220px]">
                    {isChart && (
                      <DataChart charts={[w.chart_spec as ChartSpec]} />
                    )}

                    {isTable && (
                      <div className="overflow-x-auto rounded-xl border border-[#2e2c28] bg-[#161513]">
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
                            {(w.table_data?.rows || []).slice(0, 8).map((row, rIdx) => (
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
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Collapsible SQL */}
                  {w.sql_query && (
                    <div className="pt-2 border-t border-[#262421]">
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
      </div>
    </div>
  );
};

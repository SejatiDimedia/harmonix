import React, { useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Loader2, Brain, Database, ChevronDown, Copy, Check, Pencil, RotateCcw, FileText, Layers, Square } from 'lucide-react';
import { ChatTurn, ChartSpec, TableData } from '../types';
import { SQLBox } from './SQLBox';
import { DataTable } from './DataTable';
import { DataChart } from './DataChart';
import { AuditorGate } from './AuditorGate';
import { FollowUpChips } from './FollowUpChips';
import { ErrorBoundary } from './ErrorBoundary';
import { formatPseudoTableToMarkdown, formatRelativeTime } from '../utils/formatters';

interface ChatMessageProps {
  turn: ChatTurn;
  isStreaming?: boolean;
  streamingStatus?: string;
  onSelectSuggestion: (text: string) => void;
  onEditQuery?: (text: string) => void;
  onPinChart?: (spec: ChartSpec, sqlQuery?: string) => void;
  onPinTable?: (table: TableData, title: string, sqlQuery?: string) => void;
  onCancel?: () => void;
}

const ChatMessageComponent: React.FC<ChatMessageProps> = ({
  turn,
  isStreaming,
  streamingStatus,
  onSelectSuggestion,
  onEditQuery,
  onPinChart,
  onPinTable,
  onCancel,
}) => {
  const [showDataFlow, setShowDataFlow] = useState(false);
  const [copiedQuery, setCopiedQuery] = useState(false);
  const [copiedAnswer, setCopiedAnswer] = useState(false);

  const formatLatency = (ms?: number) => {
    if (!ms) return '0ms';
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };

  const formatMemoryKey = (rawKey: string) => {
    const map: Record<string, string> = {
      swarm_plan: 'Rencana Eksekusi',
      sql_specialist_result: 'Hasil Eksekusi SQL',
      calc_specialist_result: 'Hasil Perhitungan Kalkulator',
      chart_specialist_result: 'Hasil Desain Visualisasi',
      general_analyst_result: 'Hasil Sintesis Analis',
    };
    const k = rawKey.toLowerCase().trim();
    return map[k] || rawKey.replace(/_/g, ' ');
  };

  const workingMemoryKeys = turn.working_memory ? Object.keys(turn.working_memory) : [];
  const hasPlan = Boolean(turn.execution_plan && turn.execution_plan.tasks && turn.execution_plan.tasks.length > 0);

  const hasDataFlow = Boolean(
    (turn.sql_queries && turn.sql_queries.length > 0) ||
    (turn.tables && turn.tables.length > 0) ||
    (turn.memories_recalled && turn.memories_recalled.length > 0) ||
    (workingMemoryKeys.length > 0) ||
    hasPlan
  );

  const handleCopyQuery = () => {
    if (!turn.user_query) return;
    navigator.clipboard.writeText(turn.user_query);
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 2000);
  };

  const handleCopyAnswer = () => {
    if (!turn.answer_text) return;
    navigator.clipboard.writeText(turn.answer_text);
    setCopiedAnswer(true);
    setTimeout(() => setCopiedAnswer(false), 2000);
  };

  const sanitizedMarkdown = useMemo(() => {
    if (!turn.answer_text) return '';
    const formatted = formatPseudoTableToMarkdown(turn.answer_text);
    return DOMPurify.sanitize(marked.parse(formatted) as string);
  }, [turn.answer_text]);

  return (
    <div className="space-y-4">
      {/* User Bubble */}
      {turn.user_query && (
        <div className="flex flex-col items-end group">
          <div className="relative max-w-[85%] rounded-2xl bg-[#14223b] px-4 py-3 text-sm text-[#f8fafc] leading-relaxed shadow-sm font-sans border border-white/[0.04]">
            <div className="select-text whitespace-pre-wrap break-words">
              {turn.user_query}
            </div>
          </div>

          {/* Quick Actions for User Query (Resend, Edit, Copy) - Only visible on hover */}
          <div className="mt-1 flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 select-none min-h-[26px]">
            <span className="text-xs text-slate-400 font-sans mr-1 select-none">
              {formatRelativeTime(turn.created_at)}
            </span>

            {onSelectSuggestion && (
              <button
                type="button"
                onClick={() => onSelectSuggestion(turn.user_query!)}
                aria-label="Ajukan ulang pertanyaan"
                title="Ajukan ulang pertanyaan ini langsung ke agent"
                className="relative group/btn p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-sans bg-slate-900/95 border border-slate-700/80 text-slate-200 whitespace-nowrap shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 z-30">
                  Ajukan Ulang
                </span>
              </button>
            )}

            {onEditQuery && (
              <button
                type="button"
                onClick={() => onEditQuery(turn.user_query!)}
                aria-label="Edit pertanyaan"
                title="Salin pertanyaan ke kolom pesan untuk diedit"
                className="relative group/btn p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-sans bg-slate-900/95 border border-slate-700/80 text-slate-200 whitespace-nowrap shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 z-30">
                  Edit
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyQuery}
              aria-label={copiedQuery ? 'Tersalin ke clipboard' : 'Salin pertanyaan'}
              title={copiedQuery ? 'Tersalin ke clipboard' : 'Salin pertanyaan'}
              className="relative group/btn p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
            >
              {copiedQuery ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-sans bg-slate-900/95 border border-slate-700/80 text-slate-200 whitespace-nowrap shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 z-30">
                {copiedQuery ? 'Tersalin!' : 'Salin'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Assistant Card */}
      <div className="flex gap-3 text-sm text-[#f8fafc]">
        <img
          src="/static/logo.png?v=2"
          alt="Harmonix"
          className="w-7 h-7 rounded-lg object-cover shrink-0 mt-0.5 select-none shadow-sm"
        />

        <div className="flex-1 space-y-2.5 leading-relaxed min-w-0">
          {/* Streaming status badge & Cancel button */}
          {isStreaming && (
            <div role="status" aria-live="polite" className="text-xs font-mono flex items-center justify-between gap-2 select-none pb-1">
              <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400 shrink-0" />
                <span>{streamingStatus || 'Merancang rencana analitik...'}</span>
              </span>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 transition cursor-pointer flex items-center gap-1.5 shadow-sm shrink-0"
                  title="Batalkan proses saat ini (Esc)"
                >
                  <Square className="w-2.5 h-2.5 fill-rose-400 text-rose-400" />
                  <span>Batalkan</span>
                </button>
              )}
            </div>
          )}

          {/* Cancelled state banner (Refined Sober Neutral - No AI Slop Neon) */}
          {turn.status === 'CANCELLED' && (
            <div className="p-3 rounded-xl bg-[#0c1424] border border-white/[0.08] text-xs flex flex-wrap items-center justify-between gap-3 shadow-sm my-1">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] font-medium tracking-wide border border-slate-700/60">
                  Dibatalkan
                </span>
                <span className="text-slate-400 font-sans text-xs">
                  Proses analitik dihentikan atas permintaan pengguna.
                </span>
              </div>
              {turn.user_query && onEditQuery && (
                <button
                  type="button"
                  onClick={() => onEditQuery(turn.user_query)}
                  className="px-2.5 py-1 rounded-lg text-xs font-mono bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.08] transition cursor-pointer flex items-center gap-1.5 shrink-0"
                  title="Kembalikan kueri ke kolom input untuk diperbaiki"
                >
                  <Pencil className="w-3 h-3 text-slate-400" />
                  <span>Edit Pesan</span>
                </button>
              )}
            </div>
          )}

          {/* Answer Markdown content (Jawaban Inti / Kesimpulan Utama) */}
          {sanitizedMarkdown && turn.status !== 'CANCELLED' && (
            <div
              className="content markdown-body"
              dangerouslySetInnerHTML={{ __html: sanitizedMarkdown }}
            />
          )}

          {/* Charts (Visualisasi Grafik Utama - Ditampilkan Langsung Bersama Jawaban Inti) */}
          {turn.charts && turn.charts.length > 0 && (
            <ErrorBoundary fallbackTitle="Gagal memuat visualisasi grafik">
              <DataChart
                charts={turn.charts}
                tables={turn.tables}
                onPinChart={
                  onPinChart
                    ? (spec) =>
                        onPinChart(
                          spec,
                          turn.sql_queries && turn.sql_queries.length > 0
                            ? turn.sql_queries[0]
                            : undefined
                        )
                    : undefined
                }
              />
            </ErrorBoundary>
          )}

          {/* Data Auditor verdict */}
          {turn.audit_result && <AuditorGate verdict={turn.audit_result} />}

          {/* Collapsible Flow Pengambilan Data (Query SQL, Tabel Mentah & Memori pgvector) */}
          {hasDataFlow && (
            <div className="pt-1 select-none">
              <button
                type="button"
                onClick={() => setShowDataFlow((prev) => !prev)}
                aria-expanded={showDataFlow}
                className="group flex items-center justify-between w-full px-3.5 py-2 rounded-xl bg-[#0f1a2e]/90 hover:bg-[#14233e] text-xs font-mono text-[#94a3b8] hover:text-[#f8fafc] transition border border-white/[0.04] cursor-pointer shadow-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="w-3.5 h-3.5 text-clay-400 shrink-0 group-hover:text-clay-300 transition" />
                  <span className="font-medium text-[#cbd5e1] group-hover:text-white transition truncate">
                    {showDataFlow ? 'Sembunyikan Flow Pengambilan Data' : 'Lihat Flow Pengambilan Data'}
                  </span>
                  <div className="hidden sm:flex items-center gap-1.5 shrink-0 ml-1">
                    {turn.sql_queries && turn.sql_queries.length > 0 && (
                      <span className="text-[10px] text-slate-300 bg-slate-800/80 px-2.5 py-0.5 rounded-full font-mono border border-slate-700/40">
                        {turn.sql_queries.length} SQL
                      </span>
                    )}
                    {turn.tables && turn.tables.length > 0 && (
                      <span className="text-[10px] text-slate-300 bg-slate-800/80 px-2.5 py-0.5 rounded-full font-mono border border-slate-700/40">
                        {turn.tables.length} Tabel
                      </span>
                    )}
                    {turn.memories_recalled && turn.memories_recalled.length > 0 && (
                      <span className="text-[10px] text-slate-300 bg-slate-800/80 px-2.5 py-0.5 rounded-full font-mono border border-slate-700/40 flex items-center gap-1">
                        <Brain className="w-2.5 h-2.5 text-slate-400" />
                        Memori
                      </span>
                    )}
                    {workingMemoryKeys.length > 0 && (
                      <span className="text-[10px] text-slate-300 bg-slate-800/80 px-2.5 py-0.5 rounded-full font-mono border border-slate-700/40 flex items-center gap-1">
                        <FileText className="w-2.5 h-2.5 text-slate-400" />
                        {workingMemoryKeys.length} Catatan
                      </span>
                    )}
                    {hasPlan && (
                      <span className="text-[10px] text-slate-300 bg-slate-800/80 px-2.5 py-0.5 rounded-full font-mono border border-slate-700/40 flex items-center gap-1">
                        <Layers className="w-2.5 h-2.5 text-slate-400" />
                        {turn.execution_plan?.tasks.length} Sub-Agent
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-[#64748b] group-hover:text-[#94a3b8] shrink-0 ml-2">
                  <span>{showDataFlow ? 'Tutup' : 'Buka'}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                      showDataFlow ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </button>

              {showDataFlow && (
                <div className="mt-2.5 space-y-3 pt-1 border-t border-white/[0.04]">
                  {/* Sub-Agent Swarm / Planner-Executor Plan */}
                  {hasPlan && (
                    <div className="flex flex-col gap-2 p-3 rounded-xl bg-[#0c1424] border border-white/[0.06] text-xs font-mono shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-200 font-semibold font-sans">
                          <Layers className="w-3.5 h-3.5 text-clay-400" />
                          <span>Rencana & Delegasi Sub-Agent</span>
                        </div>
                        <span className="text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/40 uppercase font-mono">
                          {turn.execution_plan?.complexity_level || 'multi-agent'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-sans">
                        Sasaran: "{turn.execution_plan?.goal}"
                      </div>
                      <div className="grid grid-cols-1 gap-2 mt-1">
                        {turn.execution_plan?.tasks.map((task) => {
                          const roleLabel =
                            task.role === 'sql_specialist'
                              ? 'SQL Specialist'
                              : task.role === 'calc_specialist'
                              ? 'Quantitative Specialist'
                              : task.role === 'chart_specialist'
                              ? 'Chart Specialist'
                              : 'General Analyst';
                          return (
                            <div key={task.id} className="p-2.5 rounded-lg bg-[#080d18] border border-white/[0.04] text-[11px] flex flex-col gap-1">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-200 font-sans">
                                  #{task.id} {task.title}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {roleLabel}
                                </span>
                              </div>
                              <div className="text-slate-400 text-[11px] font-sans">
                                {task.instruction}
                              </div>
                              {task.result_summary && (
                                <div className="text-emerald-400 text-[10px] font-mono mt-0.5 truncate">
                                  ✓ {task.result_summary}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Recalled Long-Term Memories */}
                  {turn.memories_recalled && turn.memories_recalled.length > 0 && (
                    <div className="flex flex-col gap-2 p-3 rounded-xl bg-[#0c1424] border border-white/[0.06] text-xs font-mono shadow-sm select-none">
                      <div className="flex items-center gap-2 text-slate-200 font-semibold font-sans">
                        <Brain className="w-3.5 h-3.5 text-clay-400 shrink-0" />
                        <span>
                          Memori Analisis Terkait ({turn.memories_recalled.length} kueri terverifikasi)
                        </span>
                      </div>
                      <div className="pl-5 text-[11px] text-slate-300 flex flex-col gap-1.5">
                        {turn.memories_recalled.map((m, idx) => (
                          <div key={idx} className="flex items-baseline gap-2">
                            <span className="text-slate-500">•</span>
                            <span className="truncate max-w-[420px] text-slate-300 font-sans text-xs" title={m.question_text}>
                              "{m.question_text}"
                            </span>
                            <span className="text-slate-400 text-[10px] ml-auto shrink-0 font-mono">
                              {Math.round((m.similarity || 0.8) * 100)}% relevan
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Working Memory / Scratchpad */}
                  {turn.working_memory && workingMemoryKeys.length > 0 && (
                    <div className="flex flex-col gap-2 p-3 rounded-xl bg-[#0c1424] border border-white/[0.06] text-xs font-mono shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-200 font-semibold font-sans">
                          <FileText className="w-3.5 h-3.5 text-clay-400" />
                          <span>Catatan Pemikiran Analisis</span>
                        </div>
                        <span className="text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/40 font-mono">
                          {workingMemoryKeys.length} catatan
                        </span>
                      </div>
                      <div className="space-y-2 mt-1">
                        {workingMemoryKeys.map((key) => (
                          <div key={key} className="p-2.5 rounded-lg bg-[#080d18] border border-white/[0.04] text-[11px]">
                            <div className="text-slate-300 font-semibold mb-1 uppercase tracking-wide text-[10px] font-mono">
                              {formatMemoryKey(key)}
                            </div>
                            <div className="text-slate-300 whitespace-pre-wrap leading-relaxed font-sans text-xs">
                              {turn.working_memory![key]}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SQL Box */}
                  {turn.sql_queries && turn.sql_queries.length > 0 && (
                    <SQLBox queries={turn.sql_queries} />
                  )}

                  {/* Tables */}
                  {turn.tables && turn.tables.length > 0 && (
                    <DataTable
                      tables={turn.tables}
                      onPinTable={
                        onPinTable
                          ? (tbl, title) =>
                              onPinTable(
                                tbl,
                                title,
                                turn.sql_queries && turn.sql_queries.length > 0
                                  ? turn.sql_queries[0]
                                  : undefined
                              )
                          : undefined
                      }
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Latency & Token Metrics & Copy Answer */}
          {turn.status !== 'CANCELLED' && (turn.metrics || (turn.answer_text && turn.answer_text.trim().length > 0)) && (
            <div className="text-[11px] text-[#94a3b8] font-mono mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between select-none">
            <div className="flex items-center gap-3">
              {turn.metrics && (
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span>Latensi: {formatLatency(turn.metrics.total_latency_ms)}</span>
                  {turn.metrics.ttft_ms ? (
                    <span className="text-[10px] text-slate-500">
                      (TTFT: {formatLatency(turn.metrics.ttft_ms)})
                    </span>
                  ) : null}
                </span>
              )}
              {turn.answer_text && !isStreaming && (
                <button
                  type="button"
                  onClick={handleCopyAnswer}
                  aria-label={copiedAnswer ? 'Tersalin!' : 'Salin jawaban'}
                  title={copiedAnswer ? 'Tersalin!' : 'Salin jawaban analitik lengkap'}
                  className="relative group/btn p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition cursor-pointer"
                >
                  {copiedAnswer ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-sans bg-slate-900/95 border border-slate-700/80 text-slate-200 whitespace-nowrap shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 z-30">
                    {copiedAnswer ? 'Tersalin!' : 'Salin'}
                  </span>
                </button>
              )}
            </div>
            {turn.metrics && (
              <span
                className="flex items-center gap-1.5 text-slate-400 select-text"
                title={
                  turn.metrics.prompt_tokens || turn.metrics.completion_tokens
                    ? `Input (Prompt): ${(turn.metrics.prompt_tokens || 0).toLocaleString('id-ID')} token\nOutput (Completion): ${(turn.metrics.completion_tokens || 0).toLocaleString('id-ID')} token`
                    : undefined
                }
              >
                <span>{turn.metrics.total_tokens?.toLocaleString('id-ID') || 0} token</span>
                {turn.metrics.prompt_tokens && turn.metrics.completion_tokens ? (
                  <span className="text-[10px] text-slate-500 font-mono">
                    ({turn.metrics.prompt_tokens.toLocaleString('id-ID')} in / {turn.metrics.completion_tokens.toLocaleString('id-ID')} out)
                  </span>
                ) : null}
                {turn.metrics.cached_tokens && turn.metrics.cached_tokens > 0 ? (
                  <span
                    className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-medium"
                    title={`Prompt Caching: ${turn.metrics.cached_tokens.toLocaleString('id-ID')} token dibaca langsung dari cache`}
                  >
                    <span>⚡</span>
                    <span>{turn.metrics.cached_tokens.toLocaleString('id-ID')} cached</span>
                  </span>
                ) : null}
              </span>
            )}
          </div>
          )}

          {/* Follow-up suggestions */}
          {turn.follow_up_suggestions && turn.follow_up_suggestions.length > 0 && (
            <FollowUpChips
              suggestions={turn.follow_up_suggestions}
              onSelect={onSelectSuggestion}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const ChatMessage = React.memo(ChatMessageComponent);

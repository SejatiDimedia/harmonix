import React, { useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Loader2, Brain, Database, ChevronDown, Copy, Check, Pencil, RotateCcw, FileText, Layers } from 'lucide-react';
import { ChatTurn, ChartSpec, TableData } from '../types';
import { SQLBox } from './SQLBox';
import { DataTable } from './DataTable';
import { DataChart } from './DataChart';
import { AuditorGate } from './AuditorGate';
import { FollowUpChips } from './FollowUpChips';
import { ErrorBoundary } from './ErrorBoundary';
import { formatPseudoTableToMarkdown } from '../utils/formatters';

interface ChatMessageProps {
  turn: ChatTurn;
  isStreaming?: boolean;
  streamingStatus?: string;
  onSelectSuggestion: (text: string) => void;
  onEditQuery?: (text: string) => void;
  onPinChart?: (spec: ChartSpec, sqlQuery?: string) => void;
  onPinTable?: (table: TableData, title: string, sqlQuery?: string) => void;
}

const ChatMessageComponent: React.FC<ChatMessageProps> = ({
  turn,
  isStreaming,
  streamingStatus,
  onSelectSuggestion,
  onEditQuery,
  onPinChart,
  onPinTable,
}) => {
  const [showDataFlow, setShowDataFlow] = useState(false);
  const [copiedQuery, setCopiedQuery] = useState(false);
  const [copiedAnswer, setCopiedAnswer] = useState(false);

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
        <div className="flex justify-end group">
          <div className="relative max-w-[85%] rounded-2xl bg-[#14223b] px-4 py-3 text-sm text-[#f8fafc] leading-relaxed shadow-sm font-sans border border-white/[0.04]">
            <div className="select-text whitespace-pre-wrap break-words">
              {turn.user_query}
            </div>

            {/* Quick Actions for User Query (Copy, Edit, Resend) */}
            <div className="mt-2 pt-1.5 border-t border-white/[0.06] flex items-center justify-end gap-1 sm:opacity-80 sm:group-hover:opacity-100 transition-opacity select-none">
              <button
                type="button"
                onClick={handleCopyQuery}
                title="Salin pertanyaan ke clipboard"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono text-[#94a3b8] hover:text-[#f8fafc] hover:bg-white/[0.06] transition cursor-pointer"
              >
                {copiedQuery ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Tersalin!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Salin</span>
                  </>
                )}
              </button>

              {onEditQuery && (
                <button
                  type="button"
                  onClick={() => onEditQuery(turn.user_query!)}
                  title="Salin pertanyaan ke kolom pesan untuk diedit"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono text-[#94a3b8] hover:text-[#f8fafc] hover:bg-white/[0.06] transition cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )}

              {onSelectSuggestion && (
                <button
                  type="button"
                  onClick={() => onSelectSuggestion(turn.user_query!)}
                  title="Ajukan ulang pertanyaan ini langsung ke agent"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono text-[#94a3b8] hover:text-[#f8fafc] hover:bg-white/[0.06] transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Ajukan Ulang</span>
                </button>
              )}
            </div>
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
          {/* Streaming status badge */}
          {isStreaming && (
            <div role="status" aria-live="polite" className="text-xs font-mono flex items-center gap-1.5 select-none pb-1">
              <span className="text-clay-400 font-mono text-[11px] flex items-center gap-1.5 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>{streamingStatus || 'Merancang rencana analitik...'}</span>
              </span>
            </div>
          )}

          {/* Answer Markdown content (Jawaban Inti / Kesimpulan Utama) */}
          {sanitizedMarkdown && (
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
                      <span className="text-[10px] text-[#94a3b8] bg-[#162742] px-2 py-0.5 rounded-full font-mono">
                        {turn.sql_queries.length} SQL
                      </span>
                    )}
                    {turn.tables && turn.tables.length > 0 && (
                      <span className="text-[10px] text-[#94a3b8] bg-[#162742] px-2 py-0.5 rounded-full font-mono">
                        {turn.tables.length} Tabel
                      </span>
                    )}
                    {turn.memories_recalled && turn.memories_recalled.length > 0 && (
                      <span className="text-[10px] text-[#00d2ee] bg-[#0c2438] px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                        <Brain className="w-2.5 h-2.5" />
                        Memori pgvector
                      </span>
                    )}
                    {workingMemoryKeys.length > 0 && (
                      <span className="text-[10px] text-amber-300 bg-[#241a08] border border-amber-700/40 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                        <FileText className="w-2.5 h-2.5 text-amber-400" />
                        {workingMemoryKeys.length} Catatan Kerja
                      </span>
                    )}
                    {hasPlan && (
                      <span className="text-[10px] text-purple-300 bg-[#261538] border border-purple-700/40 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                        <Layers className="w-2.5 h-2.5 text-purple-400" />
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
                  {/* Sub-Agent Swarm / Planner-Executor Plan (FR-04) */}
                  {hasPlan && (
                    <div className="flex flex-col gap-2 p-3 rounded-xl bg-[#19132d]/90 border border-purple-500/30 text-xs font-mono shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-purple-300 font-semibold">
                          <Layers className="w-3.5 h-3.5 text-purple-400" />
                          <span>Rencana & Delegasi Sub-Agent (FR-04 Swarm)</span>
                        </div>
                        <span className="text-[10px] text-purple-300/90 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-700/40 uppercase">
                          {turn.execution_plan?.complexity_level || 'multi-agent'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 italic">
                        🎯 Sasaran: "{turn.execution_plan?.goal}"
                      </div>
                      <div className="grid grid-cols-1 gap-2 mt-1">
                        {turn.execution_plan?.tasks.map((task) => {
                          const roleLabel =
                            task.role === 'sql_specialist'
                              ? '🔍 SQL Specialist'
                              : task.role === 'calc_specialist'
                              ? '🔢 Quantitative Specialist'
                              : task.role === 'chart_specialist'
                              ? '📊 Chart Specialist'
                              : '🤖 General Analyst';
                          return (
                            <div key={task.id} className="p-2.5 rounded-lg bg-[#0e0a1c] border border-white/[0.04] text-[11px] flex flex-col gap-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-purple-200">
                                  #{task.id} {task.title}
                                </span>
                                <span className="text-[10px] text-purple-400 font-mono">
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

                  {/* Recalled Long-Term Memories Badge (FR-17) */}
                  {turn.memories_recalled && turn.memories_recalled.length > 0 && (
                    <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-[#0c1e33]/80 border border-[#00d2ee]/20 text-xs font-mono text-[#00d2ee] shadow-sm select-none">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-[#00d2ee] shrink-0" />
                        <span className="font-semibold">
                          Memori Pengalaman (pgvector): {turn.memories_recalled.length} kueri terverifikasi digunakan
                        </span>
                      </div>
                      <div className="pl-6 text-[11px] text-slate-300 flex flex-col gap-1">
                        {turn.memories_recalled.map((m, idx) => (
                          <div key={idx} className="flex items-baseline gap-1.5">
                            <span className="text-[#00d2ee] font-bold">›</span>
                            <span className="truncate max-w-[420px] text-slate-200" title={m.question_text}>
                              "{m.question_text}"
                            </span>
                            <span className="text-[#00d2ee]/90 text-[10px] ml-auto shrink-0 font-medium">
                              ({Math.round((m.similarity || 0.8) * 100)}% mirip)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Working Memory / Scratchpad (FR-18) */}
                  {turn.working_memory && workingMemoryKeys.length > 0 && (
                    <div className="flex flex-col gap-2 p-3 rounded-xl bg-[#141d2e]/90 border border-amber-500/25 text-xs font-mono shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-amber-300 font-semibold">
                          <FileText className="w-3.5 h-3.5 text-amber-400" />
                          <span>Catatan Kerja Agen (Working Memory / Scratchpad - FR-18)</span>
                        </div>
                        <span className="text-[10px] text-amber-400/90 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-700/40">
                          {workingMemoryKeys.length} topik aktif
                        </span>
                      </div>
                      <div className="space-y-2 mt-1">
                        {workingMemoryKeys.map((key) => (
                          <div key={key} className="p-2.5 rounded-lg bg-[#0b1220] border border-white/[0.04] text-[11px]">
                            <div className="text-amber-400 font-semibold mb-1 uppercase tracking-wide text-[10px] flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                              {key}
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
          <div className="text-[11px] text-[#94a3b8] font-mono mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between select-none">
            <div className="flex items-center gap-3">
              {turn.metrics && (
                <span>
                  Latensi: {turn.metrics.total_latency_ms || 0}ms
                  {turn.metrics.ttft_ms ? ` (TTFT: ${turn.metrics.ttft_ms}ms)` : ''}
                </span>
              )}
              {turn.answer_text && !isStreaming && (
                <button
                  type="button"
                  onClick={handleCopyAnswer}
                  title="Salin jawaban analitik lengkap"
                  className="flex items-center gap-1 hover:text-[#f8fafc] transition cursor-pointer text-[#94a3b8]"
                >
                  {copiedAnswer ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">Jawaban tersalin!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Salin Jawaban</span>
                    </>
                  )}
                </button>
              )}
            </div>
            {turn.metrics && (
              <span className="flex items-center gap-1.5">
                <span>Konsumsi Token: {turn.metrics.total_tokens?.toLocaleString() || 0}</span>
                {turn.metrics.cached_tokens && turn.metrics.cached_tokens > 0 ? (
                  <span
                    className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-medium"
                    title={`Prompt Caching (FR-15): ${turn.metrics.cached_tokens.toLocaleString()} token dibaca langsung dari cache`}
                  >
                    <span>⚡</span>
                    <span>{turn.metrics.cached_tokens.toLocaleString()} cached</span>
                  </span>
                ) : null}
              </span>
            )}
          </div>

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

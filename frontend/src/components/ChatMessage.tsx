import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Loader2, Brain } from 'lucide-react';
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
  onPinChart?: (spec: ChartSpec, sqlQuery?: string) => void;
  onPinTable?: (table: TableData, title: string, sqlQuery?: string) => void;
}

const ChatMessageComponent: React.FC<ChatMessageProps> = ({
  turn,
  isStreaming,
  streamingStatus,
  onSelectSuggestion,
  onPinChart,
  onPinTable,
}) => {
  const sanitizedMarkdown = useMemo(() => {
    if (!turn.answer_text) return '';
    const formatted = formatPseudoTableToMarkdown(turn.answer_text);
    return DOMPurify.sanitize(marked.parse(formatted) as string);
  }, [turn.answer_text]);

  return (
    <div className="space-y-4">
      {/* User Bubble */}
      {turn.user_query && (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl bg-[#14223b] px-4 py-3 text-sm text-[#f8fafc] leading-relaxed shadow-sm font-sans">
            {turn.user_query}
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

        <div className="flex-1 space-y-2 leading-relaxed min-w-0">
          {/* Streaming status badge */}
          {isStreaming && (
            <div role="status" aria-live="polite" className="text-xs font-mono flex items-center gap-1.5 select-none pb-1">
              <span className="text-clay-400 font-mono text-[11px] flex items-center gap-1.5 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>{streamingStatus || 'Merancang rencana analitik...'}</span>
              </span>
            </div>
          )}

          {/* Answer Markdown content */}
          {sanitizedMarkdown && (
            <div
              className="content markdown-body"
              dangerouslySetInnerHTML={{ __html: sanitizedMarkdown }}
            />
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

          {/* Charts */}
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

          {/* Latency & Token Metrics */}
          {turn.metrics && (
            <div className="text-[11px] text-[#94a3b8] font-mono mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between select-none">
              <span>
                Latensi: {turn.metrics.total_latency_ms || 0}ms
                {turn.metrics.ttft_ms ? ` (TTFT: ${turn.metrics.ttft_ms}ms)` : ''}
              </span>
              <span>Konsumsi Token: {turn.metrics.total_tokens?.toLocaleString() || 0}</span>
            </div>
          )}

          {/* Data Auditor verdict */}
          {turn.audit_result && <AuditorGate verdict={turn.audit_result} />}

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

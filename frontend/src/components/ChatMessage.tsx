import React from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Check, Loader2 } from 'lucide-react';
import { ChatTurn } from '../types';
import { SQLBox } from './SQLBox';
import { DataTable } from './DataTable';
import { DataChart } from './DataChart';
import { AuditorGate } from './AuditorGate';
import { FollowUpChips } from './FollowUpChips';

interface ChatMessageProps {
  turn: ChatTurn;
  isStreaming?: boolean;
  streamingStatus?: string;
  onSelectSuggestion: (text: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  turn,
  isStreaming,
  streamingStatus,
  onSelectSuggestion,
}) => {
  const sanitizedMarkdown = turn.answer_text
    ? DOMPurify.sanitize(marked.parse(turn.answer_text) as string)
    : '';

  return (
    <div className="space-y-4">
      {/* User Bubble */}
      {turn.user_query && (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl bg-[#262522] border border-[#383632] px-4 py-3 text-sm text-[#f5f4ef] leading-relaxed shadow-sm font-sans">
            {turn.user_query}
          </div>
        </div>
      )}

      {/* Assistant Card */}
      <div className="flex gap-3 text-sm text-[#ecebe6]">
        <img
          src="/static/favicon.png"
          alt="Harnessly"
          className="w-7 h-7 rounded-lg object-cover border border-clay-500/30 shrink-0 mt-0.5 select-none shadow-sm"
        />

        <div className="flex-1 space-y-2 leading-relaxed min-w-0">
          {/* Status badge */}
          <div className="text-xs font-mono flex items-center gap-1.5 select-none">
            {isStreaming ? (
              <span className="text-clay-400 font-mono text-[11px] flex items-center gap-1.5 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>{streamingStatus || 'Merancang rencana analitik...'}</span>
              </span>
            ) : (
              <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                <span>Selesai</span>
              </span>
            )}
          </div>

          {/* Answer Markdown content */}
          {sanitizedMarkdown && (
            <div
              className="content markdown-body"
              dangerouslySetInnerHTML={{ __html: sanitizedMarkdown }}
            />
          )}

          {/* SQL Box */}
          {turn.sql_queries && turn.sql_queries.length > 0 && (
            <SQLBox queries={turn.sql_queries} />
          )}

          {/* Tables */}
          {turn.tables && turn.tables.length > 0 && (
            <DataTable tables={turn.tables} />
          )}

          {/* Charts */}
          {turn.charts && turn.charts.length > 0 && (
            <DataChart charts={turn.charts} tables={turn.tables} />
          )}

          {/* Latency & Token Metrics */}
          {turn.metrics && (
            <div className="text-[11px] text-[#8e8b82] font-mono mt-3 pt-2.5 border-t border-[#2e2c28] flex items-center justify-between select-none">
              <span>
                Latensi: {turn.metrics.total_latency_ms || 0}ms
                {turn.metrics.ttft_ms ? ` (TTFT: ${turn.metrics.ttft_ms}ms)` : ''}
              </span>
              <span>Token: {turn.metrics.total_tokens || 0} (USD 0.00)</span>
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

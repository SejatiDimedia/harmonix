import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  Globe,
  Zap,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import { ChatTurn, MetricSummary } from '../types';
import { Modal, Button, Badge, Card, Tabs } from './ui';

interface MetricsModalProps {
  isOpen: boolean;
  metrics: MetricSummary | null;
  onClose: () => void;
  sessionTitle?: string;
  sessionId?: string;
  turns?: ChatTurn[];
}

export const MetricsModal: React.FC<MetricsModalProps> = ({
  isOpen,
  metrics,
  onClose,
  sessionTitle,
  sessionId,
  turns,
}) => {
  const [activeTab, setActiveTab] = useState<'session' | 'system'>('session');

  // Compute Active Session Metrics from turns
  const validTurns = (turns || []).filter(
    (t) => t.status === 'COMPLETED' || t.metrics?.total_tokens
  );
  const sessionTotalTokens = validTurns.reduce(
    (acc, t) => acc + (t.metrics?.total_tokens || 0),
    0
  );
  const sessionPromptTokens = validTurns.reduce(
    (acc, t) => acc + (t.metrics?.prompt_tokens || 0),
    0
  );
  const sessionCompletionTokens = validTurns.reduce(
    (acc, t) => acc + (t.metrics?.completion_tokens || 0),
    0
  );
  const sessionCachedTokens = validTurns.reduce(
    (acc, t) => acc + (t.metrics?.cached_tokens || 0),
    0
  );
  const avgTurnLatencyMs =
    validTurns.length > 0
      ? Math.round(
        validTurns.reduce((acc, t) => acc + (t.metrics?.total_latency_ms || 0), 0) /
        validTurns.length
      )
      : 0;

  const formatMs = (ms?: number): string => {
    if (!ms || ms <= 0) return '0 ms';
    if (ms >= 1000) {
      return `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} s`;
    }
    return `${Math.round(ms).toLocaleString('en-US')} ms`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      icon={<Activity className="w-5 h-5 text-sky-400" />}
      title="System Observability & Token Metrics"
      subtitle="Input/output token visibility, TTFT latency, and system SLA health"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-[11px] text-slate-400 font-mono">
            Zero-Cost Baseline · 100% On-Premise Observability
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {/* Scope Tabs */}
      <Tabs
        tabs={[
          {
            id: 'session',
            label: `Current Chat Session (${validTurns.length} Turns)`,
            icon: <MessageSquare className="w-3.5 h-3.5" />,
          },
          {
            id: 'system',
            label: `Global System (${metrics?.total_requests || 0} Total Requests)`,
            icon: <Globe className="w-3.5 h-3.5" />,
          },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* Content Area */}
      {activeTab === 'session' ? (
        /* TAB 1: Current Chat Session */
        <div className="space-y-4 animate-in fade-in duration-100">
          {/* Session Meta Card */}
          <Card variant="default" className="p-3.5 flex items-center justify-between text-xs">
            <div className="truncate mr-2">
              <span className="text-[11px] text-slate-400 font-mono block">ACTIVE SESSION TITLE</span>
              <span className="font-semibold text-slate-200 truncate block">
                {sessionTitle || (sessionId ? `Session ${sessionId.slice(0, 10)}...` : 'Current Conversation')}
              </span>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[11px] text-slate-400 font-mono block">SESSION STATUS</span>
              <Badge variant="info">{validTurns.length} Questions Completed</Badge>
            </div>
          </Card>

          {/* 3 KPI Cards for Current Session */}
          <div className="grid grid-cols-3 gap-3">
            <Card variant="default" className="p-3.5 flex flex-col justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                TOTAL SESSION TOKENS
              </span>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-100 my-1">
                {sessionTotalTokens.toLocaleString('en-US')}
              </div>
              <span className="text-[10px] text-slate-400">Accumulated across this session</span>
            </Card>

            <Card variant="default" className="p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-mono uppercase tracking-wider">INPUT (PROMPT)</span>
                <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-sky-300 my-1">
                {sessionPromptTokens.toLocaleString('en-US')}
              </div>
              <span className="text-[10px] text-slate-400 truncate" title="System prompt, database schema, & conversation history">
                DDL schema &amp; turn history
              </span>
            </Card>

            <Card variant="default" className="p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-mono uppercase tracking-wider">OUTPUT (COMPLETION)</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-100 my-1">
                {sessionCompletionTokens.toLocaleString('en-US')}
              </div>
              <span className="text-[10px] text-slate-400 truncate" title="Executed SQL queries & report synthesis">
                SQL queries &amp; answers
              </span>
            </Card>
          </div>

          {/* Secondary Metrics Bar */}
          <div className="grid grid-cols-2 gap-3">
            <Card variant="dark" className="p-3 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                Cached Tokens:
              </span>
              <span className="font-semibold font-mono text-emerald-400">
                {sessionCachedTokens.toLocaleString('en-US')} tokens
              </span>
            </Card>

            <Card variant="dark" className="p-3 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">Avg Latency per Message:</span>
              <span className="font-semibold font-mono text-slate-200">
                {formatMs(avgTurnLatencyMs)}
              </span>
            </Card>
          </div>

          {/* Explanatory Note */}
          <Card variant="dark" className="p-3 text-xs text-slate-400 leading-relaxed">
            <p>
              <strong className="text-slate-300 font-medium">Cost Transparency:</strong> Token counts reflect actual inference calculations for this conversation session. Prompt caching reduces input token overhead automatically.
            </p>
          </Card>
        </div>
      ) : (
        /* TAB 2: Global System */
        <div className="space-y-4 animate-in fade-in duration-100">
          {/* Status SLA & Latency */}
          {(() => {
            const errorCount = metrics?.error_count ?? metrics?.failed_requests ?? 0;
            const successRate = metrics ? (metrics.success_rate_percentage ?? (100 - (metrics.total_requests > 0 ? (errorCount / metrics.total_requests) * 100 : 0))) : 100;
            const avgTotalLatency = metrics?.avg_total_latency_ms ?? metrics?.avg_latency_ms;

            return (
              <div className="grid grid-cols-2 gap-3">
                <Card variant="default" className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      SLA SUCCESS RATE
                    </span>
                    <Badge variant={errorCount > 0 ? 'warning' : 'success'} icon={errorCount > 0 ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}>{errorCount > 0 ? 'Attention Needed' : 'Optimal'}</Badge>
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-emerald-400 mt-1">
                    {metrics ? `${successRate.toFixed(1)}%` : '—'}
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-2">
                    <span>{metrics?.successful_requests || 0} successful</span>
                    <span>•</span>
                    <span>{errorCount} failed</span>
                  </div>
                </Card>

                <Card variant="default" className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      TOTAL AVERAGE LATENCY
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">End-to-End</span>
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-sky-300 mt-1">
                    {formatMs(avgTotalLatency)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Query response time until final synthesis
                  </div>
                </Card>
              </div>
            );
          })()}

          {/* Latency Breakdown Bar */}
          <div className="grid grid-cols-2 gap-3">
            <Card variant="dark" className="p-3 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">Avg TTFT (First Token):</span>
              <span className="font-semibold font-mono text-slate-200">
                {formatMs(metrics?.avg_ttft_ms)}
              </span>
            </Card>
            <Card variant="dark" className="p-3 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">Database SQL Execution:</span>
              <span className="font-semibold font-mono text-slate-200">
                {formatMs(metrics?.avg_db_execution_ms)}
              </span>
            </Card>
          </div>

          {/* Global Lifetime Tokens */}
          <Card variant="default" className="p-3.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              LIFETIME DATABASE TOKENS
            </span>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1.5 mb-1">
              {metrics ? `${metrics.total_tokens_consumed.toLocaleString('en-US')}` : '—'}
            </div>
            <div className="text-[10px] text-slate-400 space-y-0.5">
              {metrics?.total_prompt_tokens ? (
                <div>In: {metrics.total_prompt_tokens.toLocaleString('en-US')} | Out: {(metrics.total_completion_tokens || 0).toLocaleString('en-US')}</div>
              ) : (
                <div>Total across all sessions and system benchmarks</div>
              )}
            </div>
          </Card>

          {/* Explanatory Note */}
          <Card variant="dark" className="p-3 text-xs text-slate-400 leading-relaxed">
            <p>
              <strong className="text-slate-300 font-medium">Global Observability:</strong> The token metrics above represent aggregate statistics across all conversation histories, adversarial evaluations, and benchmarks recorded in the database.
            </p>
          </Card>
        </div>
      )}
    </Modal>
  );
};

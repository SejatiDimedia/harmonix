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
      return `${(ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} s`;
    }
    return `${Math.round(ms).toLocaleString('id-ID')} ms`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      icon={<Activity className="w-5 h-5 text-sky-400" />}
      title="Observabilitas & Penggunaan Token"
      subtitle="Transparansi token input/output, latensi TTFT, dan status SLA sistem"
      badge={<Badge variant="info">OB-02</Badge>}
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-[11px] text-slate-400 font-mono">
            Zero-Cost Baseline · 100% On-Premise Observability
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Tutup
          </Button>
        </div>
      }
    >
      {/* Scope Tabs */}
      <Tabs
        tabs={[
          {
            id: 'session',
            label: `Sesi Obrolan Ini (${validTurns.length} Turn)`,
            icon: <MessageSquare className="w-3.5 h-3.5" />,
          },
          {
            id: 'system',
            label: `Sistem Global (${metrics?.total_requests || 0} Total Kueri)`,
            icon: <Globe className="w-3.5 h-3.5" />,
          },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* Content Area */}
      {activeTab === 'session' ? (
        /* TAB 1: Sesi Obrolan Saat Ini */
        <div className="space-y-4 animate-in fade-in duration-100">
          {/* Session Meta Card */}
          <Card variant="default" className="p-3.5 flex items-center justify-between text-xs">
            <div className="truncate mr-2">
              <span className="text-[11px] text-slate-400 font-mono block">JUDUL SESI AKTIF</span>
              <span className="font-semibold text-slate-200 truncate block">
                {sessionTitle || (sessionId ? `Sesi ${sessionId.slice(0, 10)}...` : 'Percakapan Saat Ini')}
              </span>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[11px] text-slate-400 font-mono block">STATUS SESI</span>
              <Badge variant="info">{validTurns.length} Pertanyaan Selesai</Badge>
            </div>
          </Card>

          {/* 3 KPI Cards for Current Session */}
          <div className="grid grid-cols-3 gap-3">
            <Card variant="default" className="p-3.5 flex flex-col justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                TOTAL TOKEN SESI
              </span>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-100 my-1">
                {sessionTotalTokens.toLocaleString('id-ID')}
              </div>
              <span className="text-[10px] text-slate-400">Akumulasi turn sesi ini</span>
            </Card>

            <Card variant="default" className="p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-mono uppercase tracking-wider">INPUT (PROMPT)</span>
                <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-sky-300 my-1">
                {sessionPromptTokens.toLocaleString('id-ID')}
              </div>
              <span className="text-[10px] text-slate-400 truncate" title="System prompt, skema database, & riwayat percakapan">
                Skema DDL & riwayat turn
              </span>
            </Card>

            <Card variant="default" className="p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-mono uppercase tracking-wider">OUTPUT (COMPLETION)</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-100 my-1">
                {sessionCompletionTokens.toLocaleString('id-ID')}
              </div>
              <span className="text-[10px] text-slate-400 truncate" title="Kueri SQL dieksekusi & sintesis laporan">
                Kueri SQL & jawaban
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
                {sessionCachedTokens.toLocaleString('id-ID')} token
              </span>
            </Card>

            <Card variant="dark" className="p-3 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">Rerata Latensi per Pesan:</span>
              <span className="font-semibold font-mono text-slate-200">
                {formatMs(avgTurnLatencyMs)}
              </span>
            </Card>
          </div>

          {/* Explanatory Note */}
          <Card variant="dark" className="p-3 text-xs text-slate-400 leading-relaxed">
            <p>
              <strong className="text-slate-300 font-medium">Transparansi Biaya:</strong> Angka token di atas mencerminkan kalkulasi inferensi aktual pada sesi percakapan ini. Fitur prompt caching menghemat biaya input token secara berkelanjutan.
            </p>
          </Card>
        </div>
      ) : (
        /* TAB 2: Sistem Global */
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
                      STATUS KEBERHASILAN SLA
                    </span>
                    <Badge variant={errorCount > 0 ? 'warning' : 'success'}>
                      {errorCount > 0 ? (
                        <AlertTriangle className="w-3 h-3 text-amber-400 mr-1" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 mr-1" />
                      )}
                      {errorCount > 0 ? 'Perlu Perhatian' : 'Optimal'}
                    </Badge>
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-emerald-400 mt-1">
                    {metrics ? `${successRate.toFixed(1)}%` : '—'}
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-2">
                    <span>{metrics?.successful_requests || 0} berhasil</span>
                    <span>•</span>
                    <span>{errorCount} gagal</span>
                  </div>
                </Card>

                <Card variant="default" className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      LATENSI RATA-RATA TOTAL
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">End-to-End</span>
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-sky-300 mt-1">
                    {formatMs(avgTotalLatency)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Waktu respons kueri hingga teks disintesis
                  </div>
                </Card>
              </div>
            );
          })()}

          {/* Latency Breakdown Bar */}
          <div className="grid grid-cols-2 gap-3">
            <Card variant="dark" className="p-3 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">Rerata TTFT (First Token):</span>
              <span className="font-semibold font-mono text-slate-200">
                {formatMs(metrics?.avg_ttft_ms)}
              </span>
            </Card>
            <Card variant="dark" className="p-3 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">Eksekusi SQL Database:</span>
              <span className="font-semibold font-mono text-slate-200">
                {formatMs(metrics?.avg_db_execution_ms)}
              </span>
            </Card>
          </div>

          {/* Global Lifetime Tokens */}
          <Card variant="default" className="p-3.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              TOTAL TOKEN SISTEM (LIFETIME DATABASE)
            </span>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1.5 mb-1">
              {metrics ? `${metrics.total_tokens_consumed.toLocaleString('id-ID')}` : '—'}
            </div>
            <div className="text-[10px] text-slate-400 space-y-0.5">
              {metrics?.total_prompt_tokens ? (
                <div>In: {metrics.total_prompt_tokens.toLocaleString('id-ID')} | Out: {(metrics.total_completion_tokens || 0).toLocaleString('id-ID')}</div>
              ) : (
                <div>Total seluruh sesi dan benchmark database</div>
              )}
            </div>
          </Card>

          {/* Explanatory Note */}
          <Card variant="dark" className="p-3 text-xs text-slate-400 leading-relaxed">
            <p>
              <strong className="text-slate-300 font-medium">Observabilitas Global:</strong> Angka token di atas adalah total komparatif dari seluruh riwayat pertanyaan, evaluasi adversarial, dan benchmark yang pernah tercatat di database sistem sejak awal inisialisasi.
            </p>
          </Card>
        </div>
      )}
    </Modal>
  );
};

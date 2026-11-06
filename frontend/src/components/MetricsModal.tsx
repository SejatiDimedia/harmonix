import React, { useEffect, useState } from 'react';
import {
  X,
  Activity,
  AlertTriangle,
  MessageSquare,
  Globe,
  Zap,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import { ChatTurn, MetricSummary } from '../types';

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  if (!isOpen) return null;

  const formatMs = (ms?: number): string => {
    if (!ms || ms <= 0) return '0 ms';
    if (ms >= 1000) {
      return `${(ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} s`;
    }
    return `${Math.round(ms).toLocaleString('id-ID')} ms`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="metrics-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans no-print print:hidden select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-[#0c1524] border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#0e192c]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-slate-800 text-sky-400 border border-slate-700/60 shadow-inner">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 id="metrics-modal-title" className="text-base font-semibold text-slate-100">
                Observabilitas & Penggunaan Token
              </h3>
              <p className="text-xs text-slate-400">
                Transparansi token input/output, latensi TTFT, dan status SLA sistem
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal observabilitas (Esc)"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scope Tabs */}
        <div className="px-6 pt-4 pb-2 bg-[#0c1524]">
          <div className="flex items-center p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('session')}
              className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer ${
                activeTab === 'session'
                  ? 'bg-slate-800 text-sky-300 font-semibold shadow-sm border border-slate-700/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Sesi Obrolan Ini ({validTurns.length} Turn)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('system')}
              className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer ${
                activeTab === 'system'
                  ? 'bg-slate-800 text-sky-300 font-semibold shadow-sm border border-slate-700/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Sistem Global ({metrics?.total_requests || 0} Total Kueri)</span>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {activeTab === 'session' ? (
            /* TAB 1: Sesi Obrolan Saat Ini */
            <div className="space-y-4 animate-fade-in">
              {/* Session Meta Card */}
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between">
                <div className="truncate mr-2">
                  <span className="text-[11px] text-slate-400 font-mono block">JUDUL SESI AKTIF</span>
                  <span className="font-semibold text-slate-200 truncate block">
                    {sessionTitle || (sessionId ? `Sesi ${sessionId.slice(0, 10)}...` : 'Percakapan Saat Ini')}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[11px] text-slate-400 font-mono block">STATUS SESI</span>
                  <span className="inline-flex items-center text-xs text-sky-400 font-medium">
                    {validTurns.length} Pertanyaan Selesai
                  </span>
                </div>
              </div>

              {/* 3 KPI Cards for Current Session */}
              <div className="grid grid-cols-3 gap-3">
                {/* Total Sesi */}
                <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    TOTAL TOKEN SESI
                  </span>
                  <div className="text-xl font-bold font-mono tabular-nums text-slate-100 my-1">
                    {sessionTotalTokens.toLocaleString('id-ID')}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Akumulasi turn sesi ini
                  </span>
                </div>

                {/* Input Tokens */}
                <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[10px] font-mono uppercase tracking-wider">
                      INPUT (PROMPT)
                    </span>
                    <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-sky-300 my-1">
                    {sessionPromptTokens.toLocaleString('id-ID')}
                  </div>
                  <span className="text-[10px] text-slate-400 truncate" title="System prompt, skema database, & riwayat percakapan">
                    Skema DDL & riwayat turn
                  </span>
                </div>

                {/* Output Tokens */}
                <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[10px] font-mono uppercase tracking-wider">
                      OUTPUT (COMPLETION)
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" />
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-indigo-300 my-1">
                    {sessionCompletionTokens.toLocaleString('id-ID')}
                  </div>
                  <span className="text-[10px] text-slate-400 truncate" title="Kueri SQL dieksekusi & sintesis laporan">
                    Kueri SQL & jawaban
                  </span>
                </div>
              </div>

              {/* Secondary Metrics Bar */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    Cached Tokens:
                  </span>
                  <span className="font-semibold font-mono text-emerald-400">
                    {sessionCachedTokens.toLocaleString('id-ID')} token
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-mono text-[11px]">
                    Rerata Latensi per Pesan:
                  </span>
                  <span className="font-semibold font-mono text-slate-200">
                    {formatMs(avgTurnLatencyMs)}
                  </span>
                </div>
              </div>

              {/* Explanatory Note */}
              <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60 text-xs text-slate-400 leading-relaxed">
                <p>
                  <strong className="text-slate-300 font-medium">Catatan:</strong> Setiap pertanyaan di dalam sesi obrolan ini mencatat konsumsi token secara mandiri (tertera di footer tiap pesan). Token input mencakup skema tabel dan riwayat pesan sebelumnya agar model memahami konteks percakapan.
                </p>
              </div>
            </div>
          ) : (
            /* TAB 2: Akumulasi Sistem Global */
            <div className="space-y-4 animate-fade-in">
              {metrics?.drift_detected && (metrics.drift_reasons || []).length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200 flex items-start gap-2.5 shadow-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold font-mono block text-amber-300">
                      Peringatan Anomali Drift:
                    </span>
                    <ul className="mt-1 list-disc list-inside space-y-0.5 text-slate-300 text-xs">
                      {metrics.drift_reasons?.map((reason, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {/* Total Permintaan */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    TOTAL PERMINTAAN SISTEM
                  </span>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-100 mt-1.5 mb-1">
                    {metrics ? metrics.total_requests.toLocaleString('id-ID') : '—'}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Kueri analitik dijalankan di seluruh sesi
                  </span>
                </div>

                {/* Success Rate SLA */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    SUCCESS RATE (SLA)
                  </span>
                  <div
                    className={`text-2xl font-bold font-mono tabular-nums mt-1.5 mb-1 ${
                      (metrics?.success_rate_percentage || 0) < 80.0
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {metrics ? `${metrics.success_rate_percentage}%` : '—'}
                  </div>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    {(metrics?.success_rate_percentage || 0) < 80.0 ? (
                      <span className="text-amber-400 font-medium">⚠️ Di bawah batas SLA (80%)</span>
                    ) : (
                      <span className="text-emerald-400 font-medium">✓ Memenuhi standar SLA</span>
                    )}
                  </span>
                </div>

                {/* Latensi Sistem */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    LATENSI (P50 / P95)
                  </span>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-100 mt-1.5 mb-1">
                    {metrics ? (
                      <div className="space-y-0.5">
                        <div className="text-xs text-slate-400">
                          p50: <span className="text-slate-100 font-bold">{formatMs(metrics.p50_latency_ms)}</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          p95: <span className="text-slate-100 font-bold">{formatMs(metrics.p95_latency_ms)}</span>
                        </div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Median vs 95th Percentile
                  </span>
                </div>

                {/* Total Token Sistem */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    AKUMULASI TOKEN SISTEM
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
                </div>
              </div>

              {/* Explanatory Note */}
              <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60 text-xs text-slate-400 leading-relaxed">
                <p>
                  <strong className="text-slate-300 font-medium">Observabilitas Global:</strong> Angka 6+ juta token di atas adalah total komparatif dari seluruh 600+ riwayat pertanyaan, evaluasi adversarial, dan benchmark yang pernah tercatat di database sistem sejak awal inisialisasi.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800/80 flex items-center justify-between bg-[#0e192c]">
          <span className="text-[11px] text-slate-400 font-mono">
            Zero-Cost Baseline · 100% On-Premise Observability
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};

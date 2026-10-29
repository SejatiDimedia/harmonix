import React, { useEffect } from 'react';
import { X, Activity, AlertTriangle } from 'lucide-react';
import { MetricSummary } from '../types';

interface MetricsModalProps {
  isOpen: boolean;
  metrics: MetricSummary | null;
  onClose: () => void;
}

export const MetricsModal: React.FC<MetricsModalProps> = ({
  isOpen,
  metrics,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="metrics-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans no-print print:hidden"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-[#0f1a2e] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-clay-500/10 text-clay-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 id="metrics-modal-title" className="text-base font-semibold text-[#f8fafc]">
                Observabilitas Sistem
              </h3>
              <p className="text-xs text-[#94a3b8]">
                Metrik latensi p50/p95, konsumsi token, dan deteksi anomali performa
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal observabilitas (Esc)"
            className="p-1.5 rounded-lg text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {metrics?.drift_detected && (metrics.drift_reasons || []).length > 0 && (
            <div className="p-3.5 rounded-xl bg-[#1a161f] text-xs text-amber-200 flex items-start gap-2.5 shadow-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold font-mono">Peringatan Anomali Drift:</span>
                <p className="mt-0.5 text-xs text-[#94a3b8] leading-relaxed">{metrics.drift_reasons?.join('; ')}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-[#14223b] shadow-sm">
              <span className="text-[10px] font-mono uppercase text-[#94a3b8]">
                Total Permintaan
              </span>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#f8fafc] mt-1">
                {metrics ? metrics.total_requests : '—'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#14223b] shadow-sm">
              <span className="text-[10px] font-mono uppercase text-[#94a3b8]">
                Success Rate
              </span>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400 mt-1">
                {metrics ? `${metrics.success_rate_percentage}%` : '—'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#14223b] shadow-sm">
              <span className="text-[10px] font-mono uppercase text-[#94a3b8]">
                Latensi (p50 / p95)
              </span>
              <div className="text-xl font-bold font-mono tabular-nums text-[#f8fafc] mt-1">
                {metrics
                  ? `${metrics.p50_latency_ms}ms / ${metrics.p95_latency_ms}ms`
                  : '—'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#14223b] shadow-sm">
              <span className="text-[10px] font-mono uppercase text-[#94a3b8]">
                Total Token Consumed
              </span>
              <div className="text-xl font-bold font-mono tabular-nums text-[#f8fafc] mt-1">
                {metrics
                  ? `${metrics.total_tokens_consumed.toLocaleString()} tokens`
                  : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1e3557] flex justify-end bg-[#0b1526]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};

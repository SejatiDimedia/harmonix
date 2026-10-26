import React from 'react';
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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
      <div className="relative w-full max-w-lg bg-[#1b1a18] border border-[#2e2c28] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2e2c28] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-clay-500/10 text-clay-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#f5f4ef]">
                Observabilitas Sistem
              </h3>
              <p className="text-xs text-[#9c9990]">
                Metrik latensi p50/p95, total token, dan deteksi anomali (OB-02, OB-03)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#282623] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {metrics?.drift_detected && (metrics.drift_reasons || []).length > 0 && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold font-mono">Peringatan Anomali Drift:</span>
                <p className="mt-0.5">{metrics.drift_reasons?.join('; ')}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-[#141413] border border-[#2d2b27]">
              <span className="text-[10px] font-mono uppercase text-[#8e8b82]">
                Total Permintaan
              </span>
              <div className="text-2xl font-bold font-mono text-[#f5f4ef] mt-1">
                {metrics ? metrics.total_requests : '—'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#141413] border border-[#2d2b27]">
              <span className="text-[10px] font-mono uppercase text-[#8e8b82]">
                Success Rate
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                {metrics ? `${metrics.success_rate_percentage}%` : '—'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#141413] border border-[#2d2b27]">
              <span className="text-[10px] font-mono uppercase text-[#8e8b82]">
                Latensi (p50 / p95)
              </span>
              <div className="text-xl font-bold font-mono text-[#f5f4ef] mt-1">
                {metrics
                  ? `${metrics.p50_latency_ms}ms / ${metrics.p95_latency_ms}ms`
                  : '—'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#141413] border border-[#2d2b27]">
              <span className="text-[10px] font-mono uppercase text-[#8e8b82]">
                Total Token Consumed
              </span>
              <div className="text-xl font-bold font-mono text-[#f5f4ef] mt-1">
                {metrics
                  ? `${metrics.total_tokens_consumed.toLocaleString()} ($0.00)`
                  : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2e2c28] flex justify-end bg-[#161513]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#282623] transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};

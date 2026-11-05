import React, { useState, useEffect } from 'react';
import {
  Shield,
  Check,
  Copy,
  ChevronUp,
  Minimize2,
} from 'lucide-react';
import { ApprovalPayload } from '../types';
import { formatSQL } from '../utils/formatters';

interface ApprovalBannerProps {
  payload: ApprovalPayload | null;
  onApprove: () => void;
  onReject: () => void;
}

export const ApprovalBanner: React.FC<ApprovalBannerProps> = ({
  payload,
  onApprove,
  onReject,
}) => {
  const [copied, setCopied] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    if (payload) {
      setIsMinimized(false);
    }
  }, [payload?.approval_id]);

  if (!payload) return null;

  const handleCopySQL = async () => {
    if (!payload.sanitized_query) return;
    try {
      await navigator.clipboard.writeText(payload.sanitized_query);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Minimized state: subtle floating pill
  if (isMinimized) {
    return (
      <aside
        aria-label="Pemberitahuan persetujuan kueri tertunda"
        className="fixed bottom-6 right-6 z-40 bg-[#0c1524] border border-slate-700/80 shadow-2xl rounded-xl p-3 flex items-center gap-3 animate-fade-in font-sans no-print print:hidden select-none"
      >
        <div className="flex items-center gap-2 text-xs">
          <Shield className="w-4 h-4 text-slate-300" />
          <span className="font-medium text-slate-200">1 Kueri Menunggu Otorisasi</span>
        </div>
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center gap-1 cursor-pointer"
        >
          <ChevronUp className="w-3.5 h-3.5" />
          <span>Buka</span>
        </button>
      </aside>
    );
  }

  // Full Clean Review Dialog
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      aria-describedby="approval-desc"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in font-sans no-print print:hidden select-none"
    >
      <div
        className="relative w-full max-w-xl bg-[#0c1322] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#0e1728]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700/60">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 id="approval-title" className="text-sm font-semibold text-slate-100 tracking-tight">
                Otorisasi Kueri Database
              </h3>
              <p id="approval-desc" className="text-xs text-slate-400 mt-0.5">
                Kueri ini memerlukan konfirmasi karena mengakses data sensitif atau berisiko tinggi.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            title="Perkecil ke pojok kanan bawah"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Context & Risk Overview */}
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/80 text-xs space-y-2">
            {payload.user_query && (
              <div>
                <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider block">
                  Permintaan Pengguna
                </span>
                <p className="text-slate-200 font-medium mt-0.5 leading-relaxed">
                  "{payload.user_query}"
                </p>
              </div>
            )}

            <div className="pt-2 border-t border-slate-800/70 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider block">
                Catatan Keamanan
              </span>
              <p className="text-slate-300 leading-relaxed text-xs">
                {(payload.risk_reasons || []).join('; ')}
              </p>

              {payload.sensitive_columns && payload.sensitive_columns.length > 0 && (
                <div className="pt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-400 font-mono">Kolom PII:</span>
                  {payload.sensitive_columns.map((col, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700/60"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* SQL Code View */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Kueri SQL yang Diajukan
              </span>
              <button
                type="button"
                onClick={handleCopySQL}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded-md hover:bg-slate-800 transition cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>

            <div className="rounded-xl overflow-hidden border border-slate-800/90 bg-[#060b14]">
              <pre className="p-4 text-xs font-mono text-slate-200 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text font-normal">
                {formatSQL(payload.sanitized_query || '')}
              </pre>
              <div className="px-4 py-2 bg-slate-900/80 border-t border-slate-800/70 text-[10px] font-mono text-slate-400 flex items-center justify-between">
                <span>Database: PostgreSQL · analytics</span>
                <span>Mode: Read-Only Transaction</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800/80 flex items-center justify-between bg-[#0e1728]">
          <button
            type="button"
            onClick={onReject}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-slate-700/60 transition cursor-pointer"
          >
            Tolak Kueri
          </button>

          <button
            type="button"
            onClick={onApprove}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-clay-600 hover:bg-clay-500 border border-clay-500/50 shadow-sm transition flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Izinkan &amp; Eksekusi</span>
          </button>
        </div>
      </div>
    </div>
  );
};

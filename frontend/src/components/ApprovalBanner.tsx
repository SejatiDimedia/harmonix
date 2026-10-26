import React from 'react';
import { ShieldAlert, Check, X } from 'lucide-react';
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
  if (!payload) return null;

  return (
    <div className="bg-[#241c19] border-t border-b border-amber-500/40 px-4 py-3 shadow-lg z-10 shrink-0 no-print print:hidden">
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-amber-300 font-mono flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              <span>PERSETUJUAN MANUAL DIPERLUKAN (GUARDRAIL VERIFICATION)</span>
            </div>
            <p className="text-xs text-[#d6d4cb] mt-0.5">
              Alasan: <span className="font-medium text-amber-200">{(payload.risk_reasons || []).join(', ')}</span>
            </p>
            {payload.sanitized_query && (
              <pre className="text-[10px] font-mono text-clay-300 bg-[#161513] p-2 rounded-lg border border-[#383632] mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap">
                {formatSQL(payload.sanitized_query)}
              </pre>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
          <button
            type="button"
            onClick={onReject}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-800/60 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <X className="w-3.5 h-3.5" />
            <span>Tolak</span>
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Setujui & Eksekusi</span>
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, AlertOctagon, ChevronDown, Lightbulb } from 'lucide-react';
import { AuditVerdict } from '../types';

interface AuditorGateProps {
  verdict?: AuditVerdict;
}

export const AuditorGate: React.FC<AuditorGateProps> = ({ verdict }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  if (!verdict) return null;

  const status = (verdict.status || 'passed').toLowerCase();
  const confidence = Math.round((verdict.confidence_score || 1.0) * 100);
  const badgeText = verdict.badge || 'Verified by Data Auditor';
  const critique = verdict.critique || '';
  const issues = verdict.issues || [];

  let badgeBg = 'bg-[#181d19]/70 border-emerald-900/50 text-emerald-400/90';
  let Icon = ShieldCheck;
  let iconColor = 'text-emerald-400';

  if (status === 'flagged') {
    badgeBg = 'bg-rose-950/40 border-rose-800/60 text-rose-300';
    Icon = AlertOctagon;
    iconColor = 'text-rose-400';
  } else if (status === 'warning') {
    badgeBg = 'bg-amber-950/40 border-amber-800/60 text-amber-300';
    Icon = AlertTriangle;
    iconColor = 'text-amber-400';
  }

  return (
    <div className="mt-3 pt-2.5 border-t border-[#1e3557] text-xs">
      <div className={`rounded-xl p-3 border transition-all ${badgeBg}`}>
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-label={`Detail verifikasi auditor: ${badgeText} (${confidence}%). Klik untuk buka atau tutup.`}
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between cursor-pointer select-none text-left"
        >
          <div className="flex items-center gap-2 font-mono font-medium text-xs">
            <Icon className={`w-3.5 h-3.5 ${iconColor} shrink-0`} />
            <span>{badgeText}</span>
            <span className="opacity-75 text-[10px]">({confidence}%)</span>
          </div>

          <div className="flex items-center gap-1.5 opacity-80 hover:opacity-100 text-[11px]">
            <span className="font-mono text-[10px]">Detail Audit</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 transform ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-current/15 text-[11px] leading-relaxed space-y-2">
            <div className="opacity-95">{critique}</div>

            {issues.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="font-mono font-semibold text-[10px] uppercase opacity-90">
                  Temuan Kritis Auditor:
                </div>
                {issues.map((iss, idx) => (
                  <div
                    key={idx}
                    className="bg-black/25 rounded-lg p-2 border border-current/10"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-current/20">
                        {iss.severity || 'medium'}
                      </span>
                      <span className="font-medium font-mono text-[10px]">
                        {iss.category || 'sql_logic'}
                      </span>
                    </div>
                    <div className="mt-1 opacity-90">{iss.description}</div>
                    {iss.suggested_fix && (
                      <div className="mt-1 text-emerald-300 font-mono text-[10px] flex items-center gap-1">
                        <Lightbulb className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>Saran: {iss.suggested_fix}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

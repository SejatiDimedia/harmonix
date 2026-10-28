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

  let badgeBg = 'bg-[#0c1e33] border-cyan-500/30 text-cyan-200';
  let Icon = ShieldCheck;
  let iconColor = 'text-[#00d2ee]';
  let confidenceBg = 'bg-cyan-950/60 text-cyan-300 border-cyan-800/40';

  if (status === 'flagged') {
    badgeBg = 'bg-[#1a1222] border-rose-500/30 text-rose-200';
    Icon = AlertOctagon;
    iconColor = 'text-rose-400';
    confidenceBg = 'bg-rose-950/60 text-rose-300 border-rose-800/40';
  } else if (status === 'warning') {
    badgeBg = 'bg-[#1a161f] border-amber-500/30 text-amber-200';
    Icon = AlertTriangle;
    iconColor = 'text-amber-400';
    confidenceBg = 'bg-amber-950/60 text-amber-300 border-amber-800/40';
  }

  return (
    <div className="mt-3 pt-2.5 border-t border-[#1e3557] text-xs">
      <div className={`rounded-xl p-3 border transition-all shadow-sm ${badgeBg}`}>
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-label={`Detail verifikasi auditor: ${badgeText} (${confidence}%). Klik untuk buka atau tutup.`}
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between cursor-pointer select-none text-left"
        >
          <div className="flex items-center gap-2 text-xs">
            <Icon className={`w-4 h-4 ${iconColor} shrink-0`} />
            <span className="font-semibold text-[#f8fafc] font-sans tracking-tight">{badgeText}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${confidenceBg}`}>
              {confidence}%
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[#94a3b8] hover:text-[#f8fafc] transition text-[11px]">
            <span className="font-mono text-[10px]">Detail Audit</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 transform ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {isExpanded && (
          <div className="mt-2.5 pt-2.5 border-t border-white/10 text-[11px] leading-relaxed space-y-2.5">
            <div className="text-[#cbd5e1]">{critique}</div>

            {issues.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="font-mono font-semibold text-[10px] uppercase text-[#94a3b8]">
                  Temuan Kritis Auditor:
                </div>
                {issues.map((iss, idx) => (
                  <div
                    key={idx}
                    className="bg-[#0b1322] rounded-lg p-2.5 border border-[#1e3557]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-rose-950/60 border border-rose-800/40 text-rose-300">
                        {iss.severity || 'medium'}
                      </span>
                      <span className="font-medium font-mono text-[10px] text-[#f8fafc]">
                        {iss.category || 'sql_logic'}
                      </span>
                    </div>
                    <div className="mt-1 text-[#94a3b8] leading-relaxed">{iss.description}</div>
                    {iss.suggested_fix && (
                      <div className="mt-1.5 text-cyan-300 font-mono text-[10px] flex items-center gap-1">
                        <Lightbulb className="w-3 h-3 text-[#00d2ee] shrink-0" />
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

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { formatSQL } from '../utils/formatters';

interface SQLBoxProps {
  queries: string[];
}

export const SQLBox: React.FC<SQLBoxProps> = ({ queries }) => {
  const [copied, setCopied] = useState(false);
  if (!queries || queries.length === 0) return null;

  const formatted = queries.map((q) => formatSQL(q)).join('\n\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-3 rounded-xl bg-[#0b1322] border border-[#1e3557] overflow-hidden">
      <div className="px-3 py-1.5 bg-[#0f1a2e] border-b border-[#1e3557] text-[10px] font-mono text-[#94a3b8] flex justify-between items-center select-none">
        <span className="tracking-wider">POSTGRESQL (SANITIZED & LIMIT 100)</span>
        <button
          type="button"
          onClick={handleCopy}
          className="hover:text-white transition flex items-center gap-1 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Tersalin!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Salin SQL</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 text-[11px] font-mono text-clay-300 whitespace-pre-wrap break-words leading-relaxed overflow-hidden select-text">
        {formatted}
      </pre>
    </div>
  );
};

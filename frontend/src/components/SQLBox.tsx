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
    <div className="mt-3 rounded-xl bg-[#141413] border border-[#2d2b27] overflow-hidden">
      <div className="px-3 py-1.5 bg-[#1b1a18] border-b border-[#2d2b27] text-[10px] font-mono text-[#9c9990] flex justify-between items-center select-none">
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

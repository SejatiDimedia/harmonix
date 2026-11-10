import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { formatSQL } from '../utils/formatters';
import { Card, Button } from './ui';

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
    <Card variant="dark" padding="none" className="mt-3 overflow-hidden shadow-sm">
      <div className="px-3 py-1.5 bg-[#0f1a2e] border-b border-white/[0.04] text-[10px] font-mono text-[#94a3b8] flex justify-between items-center select-none">
        <span className="tracking-wider">POSTGRESQL (SANITIZED &amp; LIMIT 100)</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={handleCopy}
          leftIcon={copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        >
          <span className={copied ? 'text-emerald-400' : ''}>
            {copied ? 'Tersalin!' : 'Salin SQL'}
          </span>
        </Button>
      </div>
      <pre className="p-3 text-[11px] font-mono text-clay-300 whitespace-pre-wrap break-words leading-relaxed overflow-hidden select-text">
        {formatted}
      </pre>
    </Card>
  );
};

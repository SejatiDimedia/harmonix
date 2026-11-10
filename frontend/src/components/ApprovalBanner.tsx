import React, { useState, useEffect } from 'react';
import { Shield, Check, Copy, ChevronUp, Minimize2 } from 'lucide-react';
import { ApprovalPayload } from '../types';
import { formatSQL } from '../utils/formatters';
import { Modal, Button, Badge, Card } from './ui';

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
        aria-label="Pending query authorization notice"
        className="fixed bottom-6 right-6 z-40 bg-[#0c1524] border border-slate-700/80 shadow-2xl rounded-xl p-3 flex items-center gap-3 animate-fade-in font-sans no-print print:hidden select-none"
      >
        <div className="flex items-center gap-2 text-xs">
          <Shield className="w-4 h-4 text-slate-300" />
          <span className="font-medium text-slate-200">1 Query Awaiting Authorization</span>
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setIsMinimized(false)}
          rightIcon={<ChevronUp className="w-3.5 h-3.5" />}
        >
          Review
        </Button>
      </aside>
    );
  }

  // Full Clean Review Dialog via reusable Modal
  return (
    <Modal
      isOpen={true}
      onClose={() => setIsMinimized(true)}
      size="lg"
      icon={<Shield className="w-4 h-4 text-slate-300" />}
      title="Database Query Authorization"
      subtitle="This query requires authorization because it accesses sensitive or restricted data"
      headerRight={
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setIsMinimized(true)}
          title="Minimize to bottom right"
          leftIcon={<Minimize2 className="w-3.5 h-3.5" />}
        />
      }
      hideCloseButton={true}
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="ghost" size="sm" onClick={onReject}>
            Reject Query
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onApprove}
            leftIcon={<Check className="w-3.5 h-3.5" />}
          >
            Authorize &amp; Execute
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Context & Risk Overview */}
        <Card variant="dark" className="p-3.5 space-y-2">
          {payload.user_query && (
            <div>
              <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider block">
                User Request
              </span>
              <p className="text-slate-200 font-medium mt-0.5 leading-relaxed text-xs">
                &quot;{payload.user_query}&quot;
              </p>
            </div>
          )}

          <div className="pt-2 border-t border-slate-800/70 space-y-1.5">
            <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider block">
              Security Notes
            </span>
            <p className="text-slate-300 leading-relaxed text-xs">
              {(payload.risk_reasons || []).join('; ')}
            </p>

            {payload.sensitive_columns && payload.sensitive_columns.length > 0 && (
              <div className="pt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-slate-400 font-mono">PII Columns:</span>
                {payload.sensitive_columns.map((col, idx) => (
                  <Badge key={idx} variant="neutral">
                    {col}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* SQL Code View */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Proposed SQL Query
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={handleCopySQL}
              leftIcon={
                copied ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )
              }
            >
              <span className={copied ? 'text-emerald-400 font-medium' : ''}>
                {copied ? 'Copied' : 'Copy'}
              </span>
            </Button>
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
    </Modal>
  );
};

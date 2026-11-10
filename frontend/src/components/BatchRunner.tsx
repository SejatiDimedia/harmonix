import React, { useState, useEffect, useRef } from 'react';
import {
  Layers,
  Play,
  RotateCcw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Cpu,
  Server,
  FileText,
  ChevronDown,
  ChevronRight,
  Upload,
  FileSpreadsheet,
  Check,
  Copy,
} from 'lucide-react';
import { BatchJobRecord, QueueStats, EngineType } from '../types';
import {
  submitBatchJob,
  listBatchJobs,
  getQueueStatus,
} from '../services/api';
import { BatchResultsModal } from './BatchResultsModal';

interface BatchRunnerProps {
  showToast: (msg: string) => void;
  activeProvider?: string;
  activeModel?: string;
  sessionId?: string;
}

interface QueryPreset {
  id: string;
  label: string;
  queries: string[];
}

const PRESETS: QueryPreset[] = [
  {
    id: 'ecommerce',
    label: 'E-Commerce Baseline',
    queries: [
      'What is the overall total revenue of delivered orders?',
      'Show the top 5 product categories by sales volume',
      'What is the average order value (AOV)?',
      'How many orders have been canceled?',
    ],
  },
  {
    id: 'logistics',
    label: 'Logistics & SLA',
    queries: [
      'What is the average delivery duration in days?',
      'List the top 3 states with the highest order volume',
      'What percentage of orders arrived before estimated delivery date?',
    ],
  },
  {
    id: 'payments',
    label: 'Payment Distributions',
    queries: [
      'Which payment method is most frequently used by customers?',
      'What is the average number of installments for credit card payments?',
      'Show transaction value breakdown by payment method',
    ],
  },
];

export const BatchRunner: React.FC<BatchRunnerProps> = ({
  showToast,
  activeProvider,
  activeModel,
  sessionId,
}) => {
  const [queriesInput, setQueriesInput] = useState('');
  const [selectedEngine, setSelectedEngine] = useState<EngineType>('manual');
  const [concurrency, setConcurrency] = useState<number>(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [batchJobs, setBatchJobs] = useState<BatchJobRecord[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'processing' | 'completed' | 'failed'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedQueryId, setCopiedQueryId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStatusAndJobs = async () => {
    try {
      const [batchRes, queueRes] = await Promise.all([
        listBatchJobs().catch(() => ({ total: 0, batches: [] })),
        getQueueStatus().catch(() => null),
      ]);
      const batches = batchRes.batches || [];
      setBatchJobs(batches);
      if (queueRes) setQueueStats(queueRes);
    } catch (err: any) {
      console.error('Failed to load batch/queue state:', err);
    }
  };

  useEffect(() => {
    fetchStatusAndJobs();
    const interval = setInterval(() => {
      fetchStatusAndJobs();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchStatusAndJobs();
    setIsRefreshing(false);
    showToast('Queue and batch status refreshed');
  };

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanQueries = queriesInput
      .split('\n')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    if (cleanQueries.length === 0) {
      showToast('Enter at least one analytical question');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitBatchJob({
        queries: cleanQueries,
        engine: selectedEngine,
        concurrency_limit: concurrency,
        provider: activeProvider,
        model: activeModel,
        session_id: sessionId,
      });
      showToast(`Batch job ${res.batch_id} scheduled`);
      setQueriesInput('');
      setExpandedBatchId(res.batch_id);
      await fetchStatusAndJobs();
    } catch (err: any) {
      showToast(`Failed to schedule batch: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = event.target?.result as string;
      if (!raw) return;

      if (file.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const list = parsed.map((item) =>
              typeof item === 'string' ? item : item.query || JSON.stringify(item)
            );
            setQueriesInput(list.join('\n'));
            showToast(`${list.length} questions loaded from JSON`);
            return;
          }
        } catch {
          // fallback to line parsing
        }
      }

      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/^["']|["']$/g, ''))
        .filter(
          (l) =>
            l.length > 0 &&
            !l.toLowerCase().startsWith('query,') &&
            !l.toLowerCase().startsWith('question,')
        );

      setQueriesInput(lines.join('\n'));
      showToast(`${lines.length} questions loaded from file`);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopySQL = (queryId: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedQueryId(queryId);
    setTimeout(() => setCopiedQueryId(null), 2000);
    showToast('SQL copied to clipboard');
  };

  const handleDownload = (batchId: string, format: 'csv' | 'jsonl') => {
    window.open(`/v1/batch/${batchId}/results?format=${format}`, '_blank');
  };

  const filteredBatches = batchJobs.filter((j) => {
    if (statusFilter === 'all') return true;
    return j.status === statusFilter;
  });

  return (
    <main className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth bg-[#080f1d] text-slate-200">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-sky-950/60 border border-sky-800/40 text-sky-400">
                <Layers className="w-4 h-4" />
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-white font-sans">
                Bulk Analytics & Worker Queue
              </h1>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl font-sans leading-relaxed">
              Asynchronous bulk analytical processing isolated from the HTTP web server using transactional PostgreSQL worker queues.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/60 text-xs text-slate-300 transition cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <div className="px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] font-mono text-slate-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Backend: {queueStats?.backend || 'postgres'}</span>
            </div>
          </div>
        </div>

        {/* Operational Telemetry Strip (Linear / Datadog style) */}
        <div className="bg-[#0b1526] border border-white/[0.07] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-y-3 gap-x-6 text-xs font-mono shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <Server className="w-3.5 h-3.5 text-slate-400" />
            <span>Active Workers:</span>
            <span className="text-white font-semibold">{queueStats?.active_workers ?? 1}</span>
          </div>
          <div className="h-4 w-px bg-slate-800 hidden md:block" />
          <div className="flex items-center gap-2 text-slate-400">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>In Queue:</span>
            <span className="text-slate-200 font-semibold">{queueStats?.queued ?? 0}</span>
          </div>
          <div className="h-4 w-px bg-slate-800 hidden md:block" />
          <div className="flex items-center gap-2 text-slate-400">
            <Cpu className="w-3.5 h-3.5 text-sky-400" />
            <span>Running:</span>
            <span className="text-sky-300 font-semibold">{queueStats?.processing ?? 0}</span>
          </div>
          <div className="h-4 w-px bg-slate-800 hidden md:block" />
          <div className="flex items-center gap-2 text-slate-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Completed:</span>
            <span className="text-emerald-300 font-semibold">{queueStats?.completed ?? 0}</span>
          </div>
          <div className="h-4 w-px bg-slate-800 hidden md:block" />
          <div className="flex items-center gap-2 text-slate-400">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>Dead-Letter (DLQ):</span>
            <span className="text-rose-400 font-semibold">{queueStats?.dead_letter ?? 0}</span>
          </div>
        </div>

        {/* Main Grid: Submission Card & History */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Submission Panel */}
          <section className="lg:col-span-5 bg-[#0b1526] border border-white/[0.08] rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <h2 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
                <Play className="w-3.5 h-3.5 text-sky-400" />
                <span>Submit Batch Questions</span>
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                Queue Worker
              </span>
            </div>

            {/* Presets */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400">Question Presets:</div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setQueriesInput(p.queries.join('\n'));
                      showToast(`Preset "${p.label}" applied`);
                    }}
                    className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 transition cursor-pointer"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmitBatch} className="space-y-4">
              {/* Queries Textarea */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-sans">
                  <label htmlFor="batch-queries-input">Question List (1 per line):</label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer transition"
                  >
                    <Upload className="w-3 h-3" />
                    <span>Upload File</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.csv,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
                <textarea
                  id="batch-queries-input"
                  rows={8}
                  value={queriesInput}
                  onChange={(e) => setQueriesInput(e.target.value)}
                  placeholder="What is total delivered revenue per month?&#10;Show top 5 customers by purchase volume&#10;What is the average order delivery duration?"
                  className="w-full p-3 rounded-lg bg-[#070d18] border border-slate-800 text-xs text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-sky-500/60 leading-relaxed resize-y"
                />
              </div>

              {/* Execution Controls */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-400 block">Orchestrator:</label>
                  <div className="flex p-0.5 rounded-lg bg-[#070d18] border border-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedEngine('manual')}
                      className={`flex-1 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                        selectedEngine === 'manual'
                          ? 'bg-slate-800 text-sky-300 font-semibold shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Manual
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEngine('swarm')}
                      className={`flex-1 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                        selectedEngine === 'swarm'
                          ? 'bg-slate-800 text-sky-300 font-semibold shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Swarm
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Concurrency:</span>
                    <span className="font-mono text-sky-400">{concurrency} parallel</span>
                  </div>
                  <div className="flex gap-1 pt-0.5">
                    {[1, 2, 3, 5].map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setConcurrency(lvl)}
                        className={`flex-1 py-1 rounded-md text-[11px] font-mono transition cursor-pointer border ${
                          concurrency === lvl
                            ? 'bg-sky-950/60 border-sky-600 text-sky-300 font-bold'
                            : 'bg-[#070d18] border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {lvl}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || !queriesInput.trim()}
                className="w-full py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 text-white text-xs font-semibold shadow-xs transition cursor-pointer flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    <span>Scheduling...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Run Batch Queue</span>
                  </>
                )}
              </button>
            </form>
          </section>

          {/* Right Column: Execution History & Inspection */}
          <section className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-white tracking-tight">
                  Job History ({batchJobs.length})
                </h2>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center bg-[#070d18] p-0.5 rounded-lg border border-slate-800 text-[11px] font-mono">
                {(['all', 'processing', 'completed', 'failed'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setStatusFilter(filter)}
                    className={`px-2.5 py-0.5 rounded capitalize transition cursor-pointer ${
                      statusFilter === filter
                        ? 'bg-slate-800 text-sky-300 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {filteredBatches.length === 0 ? (
              <div className="bg-[#0b1526] border border-white/[0.06] rounded-xl p-8 text-center text-slate-400 text-xs font-sans">
                <Layers className="w-8 h-8 text-slate-600 mx-auto mb-2.5 opacity-60" />
                <p className="font-medium text-slate-300">No batch history matches this filter.</p>
                <p className="text-slate-500 text-[11px] mt-1">
                  Submit questions using the form on the left to start execution.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredBatches.map((job) => {
                  const isExpanded = expandedBatchId === job.batch_id;
                  const progressPct =
                    job.total_queries > 0
                      ? Math.round(
                          ((job.completed_queries + job.failed_queries) / job.total_queries) * 100
                        )
                      : 0;

                  return (
                    <div
                      key={job.batch_id}
                      className="bg-[#0b1526] border border-white/[0.07] rounded-xl p-4 space-y-3 transition shadow-xs"
                    >
                      {/* Job Header */}
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-sky-400">
                            {job.batch_id}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase ${
                              job.status === 'completed'
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                                : job.status === 'processing'
                                ? 'bg-sky-950/60 text-sky-400 border border-sky-800/40'
                                : job.status === 'failed'
                                ? 'bg-rose-950/60 text-rose-400 border border-rose-800/40'
                                : 'bg-slate-900 text-slate-400 border border-slate-800'
                            }`}
                          >
                            {job.status}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-900/80 border border-slate-800/60">
                            {job.engine}
                          </span>
                        </div>

                        {/* Primary Action: View Results in Web UI */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setSelectedBatchId(job.batch_id)}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow-xs transition cursor-pointer"
                            title="Open interactive answers report"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>View Results</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setExpandedBatchId(isExpanded ? null : job.batch_id)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-sans transition cursor-pointer border ${
                              isExpanded
                                ? 'bg-slate-800 text-sky-300 border-slate-700'
                                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
                            }`}
                            title={isExpanded ? 'Close preview' : 'Peek details'}
                          >
                            <span>{isExpanded ? 'Close' : 'Peek'}</span>
                            {isExpanded ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                          </button>

                          {/* Secondary Utility Downloads */}
                          <button
                            type="button"
                            onClick={() => handleDownload(job.batch_id, 'csv')}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-[11px] font-mono transition cursor-pointer"
                            title="Unduh RFC 4180 CSV (Opsional)"
                          >
                            <Download className="w-3 h-3 text-emerald-400" />
                            <span>CSV</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownload(job.batch_id, 'jsonl')}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-[11px] font-mono transition cursor-pointer"
                            title="Unduh JSON Lines (Opsional)"
                          >
                            <Download className="w-3 h-3 text-sky-400" />
                            <span>JSONL</span>
                          </button>
                        </div>
                      </div>

                      {/* Progress Metrics & Bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                          <span>
                            Progress: {job.completed_queries + job.failed_queries}/{job.total_queries} queries ({progressPct}%)
                          </span>
                          <span>
                            {job.total_duration_sec
                              ? `Duration: ${job.total_duration_sec}s`
                              : 'Executing...'}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden border border-slate-800/60">
                          <div
                            className={`h-full transition-all duration-300 ${
                              job.status === 'completed'
                                ? 'bg-emerald-500'
                                : job.status === 'failed'
                                ? 'bg-rose-500'
                                : 'bg-sky-500'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>

                      {/* Expanded Sub-Queries Accordion */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2.5 font-sans">
                          <div className="text-[11px] font-medium text-slate-400">
                            Query Execution Details ({job.items?.length || 0}):
                          </div>
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {job.items?.map((item) => (
                              <div
                                key={item.query_id}
                                className="bg-[#070d18] p-3 rounded-lg border border-slate-800/80 text-xs space-y-2"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-medium text-slate-200 leading-snug">
                                    <span className="text-sky-400 font-mono mr-1.5">{item.query_id}.</span>
                                    {item.query}
                                  </div>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${
                                      item.status === 'completed'
                                        ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-800/40'
                                        : item.status === 'failed'
                                        ? 'bg-rose-950/70 text-rose-400 border border-rose-800/40'
                                        : 'bg-sky-950/70 text-sky-400 border border-sky-800/40'
                                    }`}
                                  >
                                    {item.status} ({item.duration_ms || 0}ms)
                                  </span>
                                </div>

                                {item.answer_text && (
                                  <div className="space-y-1.5">
                                    <div className="text-slate-300 text-xs bg-[#0b1629] p-3 rounded-lg border border-slate-800/80 leading-relaxed font-sans line-clamp-3">
                                      {item.answer_text.replace(/[#*`_]/g, '')}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedBatchId(job.batch_id)}
                                      className="text-[11px] font-sans text-sky-400 hover:text-sky-300 hover:underline cursor-pointer inline-flex items-center gap-1"
                                    >
                                      <span>Open Full Report in Modal</span>
                                      <span aria-hidden="true">&rarr;</span>
                                    </button>
                                  </div>
                                )}

                                {item.sql_queries && item.sql_queries.length > 0 && (
                                  <div className="relative group">
                                    <pre className="font-mono text-[10px] text-sky-300/90 bg-[#040810] p-2 rounded border border-slate-800/80 overflow-x-auto whitespace-pre-wrap leading-normal">
                                      <code>{item.sql_queries[0]}</code>
                                    </pre>
                                    <button
                                      type="button"
                                      onClick={() => handleCopySQL(item.query_id, item.sql_queries![0])}
                                      className="absolute top-1.5 right-1.5 p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                                      title="Copy SQL"
                                    >
                                      {copiedQueryId === item.query_id ? (
                                        <Check className="w-3 h-3 text-emerald-400" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                )}

                                {item.error && (
                                  <div className="text-rose-400 text-[11px] font-mono bg-rose-950/30 p-2 rounded border border-rose-900/40">
                                    {item.error}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Interactive In-App Full Results & Answers Modal */}
      {selectedBatchId && (
        <BatchResultsModal
          batchId={selectedBatchId}
          initialBatch={batchJobs.find((b) => b.batch_id === selectedBatchId) || null}
          onClose={() => setSelectedBatchId(null)}
          showToast={showToast}
        />
      )}
    </main>
  );
};

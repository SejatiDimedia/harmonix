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
  Sparkles,
} from 'lucide-react';
import { BatchJobRecord, QueueStats, EngineType } from '../types';
import {
  submitBatchJob,
  listBatchJobs,
  getQueueStatus,
  retryQueueJob,
} from '../services/api';

interface BatchRunnerProps {
  showToast: (msg: string) => void;
}

const SAMPLE_BATCHES = [
  {
    name: '📦 E-Commerce Overview',
    queries: [
      'Berapa total omzet keseluruhan pesanan delivered?',
      'Tampilkan 5 kategori produk dengan penjualan tertinggi',
      'Berapa rata-rata nilai transaksi (AOV) per pelanggan?',
      'Berapa jumlah pesanan yang statusnya canceled?',
    ],
  },
  {
    name: '🚚 Logistik & Pengiriman',
    queries: [
      'Berapa rata-rata waktu pengiriman pesanan ke pelanggan dalam hari?',
      'Negara bagian mana yang memiliki volume pesanan terbanyak?',
      'Berapa persentase pesanan yang sampai lebih cepat dari perkiraan waktu?',
    ],
  },
  {
    name: '💳 Analisis Pembayaran',
    queries: [
      'Metode pembayaran apa yang paling sering digunakan pelanggan?',
      'Berapa rata-rata cicilan pembayaran (installments) untuk kartu kredit?',
      'Tampilkan total nilai transaksi berdasarkan tipe pembayaran',
    ],
  },
];

export const BatchRunner: React.FC<BatchRunnerProps> = ({ showToast }) => {
  const [queriesInput, setQueriesInput] = useState('');
  const [selectedEngine, setSelectedEngine] = useState<EngineType>('manual');
  const [concurrency, setConcurrency] = useState<number>(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [batchJobs, setBatchJobs] = useState<BatchJobRecord[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStatusAndJobs = async () => {
    try {
      const [batchRes, queueRes] = await Promise.all([
        listBatchJobs().catch(() => ({ total: 0, batches: [] })),
        getQueueStatus().catch(() => null),
      ]);
      setBatchJobs(batchRes.batches || []);
      if (queueRes) setQueueStats(queueRes);
    } catch (err: any) {
      console.error('Failed to fetch batch/queue data:', err);
    }
  };

  useEffect(() => {
    fetchStatusAndJobs();
    // Poll every 3 seconds if any batch is in-progress
    const interval = setInterval(() => {
      fetchStatusAndJobs();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchStatusAndJobs();
    setIsRefreshing(false);
    showToast('Data antrian & batch diperbarui 🔄');
  };

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawLines = queriesInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (rawLines.length === 0) {
      showToast('Masukkan minimal satu pertanyaan analitik');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await submitBatchJob({
        queries: rawLines,
        engine: selectedEngine,
        concurrency_limit: concurrency,
      });
      showToast(`Batch "${created.batch_id}" berhasil dijadwalkan! 🚀`);
      setQueriesInput('');
      setExpandedBatchId(created.batch_id);
      await fetchStatusAndJobs();
    } catch (err: any) {
      showToast(`Gagal mengirim batch: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      if (file.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            const list = parsed.map((item) => (typeof item === 'string' ? item : item.query || JSON.stringify(item)));
            setQueriesInput(list.join('\n'));
            showToast(`Memuat ${list.length} kueri dari file JSON! 📄`);
            return;
          }
        } catch {
          // fallback to text lines
        }
      }

      // Handle TXT or CSV lines
      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/^["']|["']$/g, ''))
        .filter((l) => l.length > 0 && !l.toLowerCase().startsWith('query,') && !l.toLowerCase().startsWith('question,'));

      setQueriesInput(lines.join('\n'));
      showToast(`Memuat ${lines.length} pertanyaan dari file! 📄`);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleApplyPreset = (queries: string[]) => {
    setQueriesInput(queries.join('\n'));
    showToast(`Memuat ${queries.length} pertanyaan preset! ✨`);
  };

  const handleDownload = (batchId: string, format: 'csv' | 'jsonl') => {
    window.open(`/v1/batch/${batchId}/results?format=${format}`, '_blank');
  };

  return (
    <main className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth bg-[#080d1a]">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
                <Layers className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white font-sans">
                Bulk Analytics & Distributed Queue Runner
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Pemrosesan analitik massal asinkronus (FR-42) ditenagai worker queue terdistribusi (FR-43, Pilar 6.3).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs text-slate-200 transition cursor-pointer"
              title="Perbarui status"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Segarkan</span>
            </button>
            <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Queue Active ({queueStats?.backend || 'postgres'})</span>
            </div>
          </div>
        </div>

        {/* Telemetry Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-[#0f172a]/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Server className="w-3.5 h-3.5 text-sky-400" />
              <span>Active Workers</span>
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {queueStats?.active_workers ?? 1}
            </div>
          </div>

          <div className="bg-[#0f172a]/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Dalam Antrian</span>
            </div>
            <div className="text-xl font-bold font-mono text-amber-300">
              {queueStats?.queued ?? 0}
            </div>
          </div>

          <div className="bg-[#0f172a]/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Cpu className="w-3.5 h-3.5 text-blue-400" />
              <span>Sedang Proses</span>
            </div>
            <div className="text-xl font-bold font-mono text-blue-300">
              {queueStats?.processing ?? 0}
            </div>
          </div>

          <div className="bg-[#0f172a]/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tugas Selesai</span>
            </div>
            <div className="text-xl font-bold font-mono text-emerald-300">
              {queueStats?.completed ?? 0}
            </div>
          </div>

          <div className="bg-[#0f172a]/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>Dead Letter (DLQ)</span>
            </div>
            <div className="text-xl font-bold font-mono text-rose-400">
              {queueStats?.dead_letter ?? 0}
            </div>
          </div>

          <div className="bg-[#0f172a]/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              <span>Total Batch</span>
            </div>
            <div className="text-xl font-bold font-mono text-purple-300">
              {batchJobs.length}
            </div>
          </div>
        </div>

        {/* Two Columns: New Batch Form & Recent Batches List */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Form Submisi Batch */}
          <div className="lg:col-span-5 bg-[#0f172a]/90 border border-slate-800/90 rounded-2xl p-5 shadow-md flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Play className="w-4 h-4 text-sky-400" />
                <span>Buat Tugas Batch Baru</span>
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/40">
                FR-42 / FR-44
              </span>
            </div>

            {/* Presets Chips */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>Preset Pertanyaan Bisnis Cepat:</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLE_BATCHES.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyPreset(preset.queries)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800/70 hover:bg-slate-700/80 text-slate-300 border border-slate-700/50 transition cursor-pointer"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmitBatch} className="space-y-4 flex-1 flex flex-col">
              {/* Textarea Queries */}
              <div className="space-y-1.5 flex-1 flex flex-col">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <label htmlFor="queries-input">Daftar Pertanyaan (1 per baris):</label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-sky-400 hover:text-sky-300 cursor-pointer"
                  >
                    <Upload className="w-3 h-3" />
                    <span>Unggah File (CSV / TXT / JSON)</span>
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
                  id="queries-input"
                  rows={7}
                  value={queriesInput}
                  onChange={(e) => setQueriesInput(e.target.value)}
                  placeholder="Contoh:&#10;Berapa total pesanan delivered di tahun 2017?&#10;Kategori produk apa yang memiliki ulasan bintang 5 terbanyak?&#10;Tampilkan 5 pelanggan dengan pengeluaran belanja tertinggi"
                  className="w-full flex-1 p-3 rounded-xl bg-[#080d1a] border border-slate-800 text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500/50 resize-y"
                />
              </div>

              {/* Engine Switcher */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-400">Engine Eksekusi:</label>
                  <div className="flex bg-[#080d1a] p-1 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setSelectedEngine('manual')}
                      className={`flex-1 py-1 text-[11px] font-medium rounded-lg transition cursor-pointer ${
                        selectedEngine === 'manual'
                          ? 'bg-sky-600 text-white font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Manual Loop
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEngine('swarm')}
                      className={`flex-1 py-1 text-[11px] font-medium rounded-lg transition cursor-pointer ${
                        selectedEngine === 'swarm'
                          ? 'bg-purple-600 text-white font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Swarm
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                    <span>Konkurensi:</span>
                    <span className="font-mono text-sky-400 font-bold">{concurrency} Worker</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer mt-2"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || !queriesInput.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md transition cursor-pointer flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    <span>Menjadwalkan Batch...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Jalankan Batch Analytics</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Right Column: Riwayat & Progress Batch Jobs */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-sky-400" />
                <span>Riwayat Pekerjaan Batch ({batchJobs.length})</span>
              </h2>
              <span className="text-xs text-slate-400">Pembaruan otomatis tiap 3 detik</span>
            </div>

            {batchJobs.length === 0 ? (
              <div className="bg-[#0f172a]/60 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs">
                <Layers className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p>Belum ada tugas batch yang dijalankan.</p>
                <p className="text-slate-500 text-[11px] mt-1">
                  Kirim daftar pertanyaan di panel sebelah kiri untuk memulai pemrosesan massal.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {batchJobs.map((job) => {
                  const isExpanded = expandedBatchId === job.batch_id;
                  const progressPct =
                    job.total_queries > 0
                      ? Math.round(((job.completed_queries + job.failed_queries) / job.total_queries) * 100)
                      : 0;

                  return (
                    <div
                      key={job.batch_id}
                      className="bg-[#0f172a]/90 border border-slate-800/90 rounded-2xl p-4 shadow-sm space-y-3 transition"
                    >
                      {/* Top Row */}
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-semibold text-sky-400">
                            {job.batch_id}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium font-mono uppercase ${
                              job.status === 'completed'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : job.status === 'processing'
                                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30 animate-pulse'
                                : job.status === 'failed'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {job.status}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                            {job.engine}
                          </span>
                        </div>

                        {/* Download Buttons for Completed/Failed */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDownload(job.batch_id, 'csv')}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] transition cursor-pointer"
                            title="Unduh CSV standar RFC 4180"
                          >
                            <Download className="w-3 h-3 text-emerald-400" />
                            <span>CSV</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownload(job.batch_id, 'jsonl')}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] transition cursor-pointer"
                            title="Unduh format JSON Lines"
                          >
                            <Download className="w-3 h-3 text-sky-400" />
                            <span>JSONL</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedBatchId(isExpanded ? null : job.batch_id)}
                            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 transition cursor-pointer"
                            title={isExpanded ? 'Tutup Rincian' : 'Buka Rincian'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span>
                            Progress: {job.completed_queries + job.failed_queries}/{job.total_queries} kueri ({progressPct}%)
                          </span>
                          {job.total_duration_sec ? (
                            <span>Durasi: {job.total_duration_sec}s</span>
                          ) : (
                            <span>Sedang Berjalan...</span>
                          )}
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              job.status === 'completed'
                                ? 'bg-emerald-500'
                                : job.status === 'failed'
                                ? 'bg-rose-500'
                                : 'bg-gradient-to-r from-sky-500 to-indigo-500'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>

                      {/* Expanded Accordion: Individual Query Items */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2">
                          <div className="text-[11px] font-semibold text-slate-300">
                            Daftar Kueri Analitik ({job.items?.length || 0}):
                          </div>
                          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                            {job.items?.map((item) => (
                              <div
                                key={item.query_id}
                                className="bg-[#0b1220] p-2.5 rounded-xl border border-slate-800/80 text-xs space-y-1.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-medium text-slate-200">
                                    <span className="text-sky-400 font-mono mr-1.5">{item.query_id}.</span>
                                    {item.query}
                                  </div>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${
                                      item.status === 'completed'
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                                        : item.status === 'failed'
                                        ? 'bg-rose-950 text-rose-300 border border-rose-800/50'
                                        : 'bg-blue-950 text-blue-300 border border-blue-800/50'
                                    }`}
                                  >
                                    {item.status} ({item.duration_ms || 0}ms)
                                  </span>
                                </div>

                                {item.answer_text && (
                                  <div className="text-slate-300 text-[11px] bg-slate-900/60 p-2 rounded-lg leading-relaxed">
                                    {item.answer_text}
                                  </div>
                                )}

                                {item.sql_queries && item.sql_queries.length > 0 && (
                                  <div className="font-mono text-[10px] text-sky-300 bg-sky-950/40 p-1.5 rounded border border-sky-900/30 overflow-x-auto">
                                    {item.sql_queries[0]}
                                  </div>
                                )}

                                {item.error && (
                                  <div className="text-rose-400 text-[11px] bg-rose-950/40 p-1.5 rounded border border-rose-900/40">
                                    Error: {item.error}
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
          </div>
        </div>
      </div>
    </main>
  );
};

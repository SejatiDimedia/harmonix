import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FileText,
  AlertTriangle,
  Copy,
  Check,
  Search,
  Download,
  Database,
  Table as TableIcon,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Sparkles,
  ArrowUp,
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { BatchJobRecord } from '../types';
import { getBatchJob } from '../services/api';
import { formatPseudoTableToMarkdown } from '../utils/formatters';

interface BatchResultsModalProps {
  batchId: string | null;
  initialBatch?: BatchJobRecord | null;
  onClose: () => void;
  showToast: (msg: string) => void;
}

export const BatchResultsModal: React.FC<BatchResultsModalProps> = ({
  batchId,
  initialBatch,
  onClose,
  showToast,
}) => {
  const [liveBatch, setLiveBatch] = useState<BatchJobRecord | null>(initialBatch || null);
  const [selectedQueryId, setSelectedQueryId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'split' | 'document'>('split');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Technical accordions open/close states (keyed by queryId)
  const [openSqlSections, setOpenSqlSections] = useState<Record<string, boolean>>({});
  const [openTableSections, setOpenTableSections] = useState<Record<string, boolean>>({});

  const detailScrollRef = useRef<HTMLDivElement>(null);
  const docScrollRef = useRef<HTMLDivElement>(null);

  // Fetch fresh batch details when modal opens or batchId changes
  useEffect(() => {
    if (!batchId) return;

    let isMounted = true;
    const fetchFresh = async () => {
      try {
        const fresh = await getBatchJob(batchId);
        if (isMounted && fresh) {
          setLiveBatch(fresh);
        }
      } catch (err) {
        console.error('Failed to load fresh batch details:', err);
      }
    };

    fetchFresh();

    // Auto-poll every 2.5 seconds if processing
    const interval = setInterval(() => {
      if (liveBatch?.status === 'processing' || liveBatch?.status === 'pending') {
        fetchFresh();
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [batchId, liveBatch?.status]);

  // Preserve or intelligently pick selected query
  useEffect(() => {
    const currentItems = liveBatch?.items || [];
    if (currentItems.length > 0) {
      setSelectedQueryId((prev) => {
        if (prev && currentItems.some((it) => it.query_id === prev)) {
          return prev;
        }
        // Prefer first completed query with answer, or fallback to first item
        const firstWithAnswer = currentItems.find(
          (it) => it.status === 'completed' && it.answer_text && it.answer_text.trim().length > 0
        );
        return firstWithAnswer ? firstWithAnswer.query_id : currentItems[0].query_id;
      });
    }
  }, [liveBatch?.items]);

  const items = liveBatch?.items || [];
  const filteredItems = items.filter(
    (item) =>
      item.query.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.answer_text && item.answer_text.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.error && item.error.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const selectedIndex = items.findIndex((item) => item.query_id === selectedQueryId);
  const selectedItem = selectedIndex !== -1 ? items[selectedIndex] : items[0];

  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex !== -1 && selectedIndex < items.length - 1;

  const handlePrev = () => {
    if (hasPrev) {
      setSelectedQueryId(items[selectedIndex - 1].query_id);
      detailScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNext = () => {
    if (hasNext) {
      setSelectedQueryId(items[selectedIndex + 1].query_id);
      detailScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // If user is typing in an input, do not trigger arrow navigation
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }
      if (viewMode === 'split') {
        if (e.key === 'ArrowLeft') handlePrev();
        if (e.key === 'ArrowRight') handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, viewMode, selectedIndex, items]);

  if (!batchId || !liveBatch) return null;

  const handleCopy = (id: string, text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast(`${label} disalin ke clipboard`);
  };

  const handleCopyFullReportMarkdown = () => {
    const reportParts: string[] = [
      `# Laporan Hasil Analitik Batch (${liveBatch.batch_id})`,
      `Tanggal: ${new Date(liveBatch.created_at * 1000).toLocaleString('id-ID')}`,
      `Total Kueri: ${liveBatch.completed_queries}/${liveBatch.total_queries} Selesai | Durasi: ${liveBatch.total_duration_sec}s`,
      `Engine: ${liveBatch.engine} | Model: ${liveBatch.model || 'Default'} (${liveBatch.provider || 'auto'})`,
      '---\n',
    ];

    items.forEach((item, idx) => {
      reportParts.push(`## ${idx + 1}. ${item.query}`);
      reportParts.push(`Status: ${item.status.toUpperCase()} (${item.duration_ms} ms)\n`);
      if (item.answer_text) {
        reportParts.push(`### Jawaban:\n${item.answer_text}\n`);
      }
      if (item.error) {
        reportParts.push(`### Galat:\n${item.error}\n`);
      }
      if (item.sql_queries && item.sql_queries.length > 0) {
        reportParts.push(`\`\`\`sql\n${item.sql_queries[0]}\n\`\`\`\n`);
      }
      reportParts.push('---\n');
    });

    handleCopy('full_report', reportParts.join('\n'), 'Seluruh isi laporan batch');
  };

  const handleDownload = (format: 'csv' | 'jsonl') => {
    window.open(`/v1/batch/${liveBatch.batch_id}/results?format=${format}`, '_blank');
  };

  const handlePrint = () => {
    window.print();
  };

  const handleManualRefresh = async () => {
    if (!liveBatch.batch_id) return;
    setIsRefreshing(true);
    try {
      const fresh = await getBatchJob(liveBatch.batch_id);
      if (fresh) setLiveBatch(fresh);
      showToast('Hasil batch diperbarui');
    } catch {
      showToast('Gagal memperbarui hasil batch');
    } finally {
      setIsRefreshing(false);
    }
  };

  const toggleSql = (queryId: string) => {
    setOpenSqlSections((prev) => ({ ...prev, [queryId]: !prev[queryId] }));
  };

  const toggleTable = (queryId: string) => {
    setOpenTableSections((prev) => ({ ...prev, [queryId]: !prev[queryId] }));
  };

  const scrollToDocSection = (queryId: string) => {
    const el = document.getElementById(`doc-item-${queryId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Safe rich markdown renderer with GFM table support
  const renderRichMarkdown = (content?: string | null) => {
    if (!content || !content.trim()) return null;
    try {
      const formatted = formatPseudoTableToMarkdown(content);
      const html = DOMPurify.sanitize(marked.parse(formatted) as string);
      return (
        <div
          className="content markdown-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } catch {
      return <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-100">{content}</div>;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-results-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/80 backdrop-blur-sm animate-fade-in print:p-0 print:bg-white"
    >
      <div className="w-full max-w-6xl h-[92vh] bg-[#08101d] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200 print:h-auto print:border-none print:shadow-none print:bg-white print:text-black">
        {/* ==============================================================================
         * Modal Header & Action Toolbar
         * ============================================================================== */}
        <div className="px-5 py-3.5 border-b border-white/[0.08] bg-[#050b14] flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          {/* Left info & meta */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="p-1.5 rounded-lg bg-sky-950/80 border border-sky-800/60 text-sky-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="batch-results-title" className="text-sm sm:text-base font-bold text-white font-sans tracking-tight">
                  Laporan Hasil Analitik Batch
                </h2>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-900 text-sky-300 border border-slate-800">
                  {liveBatch.batch_id}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${
                    liveBatch.status === 'completed'
                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                      : liveBatch.status === 'processing'
                      ? 'bg-sky-950/80 text-sky-400 border border-sky-800/60 animate-pulse'
                      : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                  }`}
                >
                  {liveBatch.status}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono mt-0.5">
                <span>Total: {liveBatch.completed_queries}/{liveBatch.total_queries} selesai</span>
                {liveBatch.failed_queries > 0 && (
                  <span className="text-rose-400 font-medium">({liveBatch.failed_queries} gagal)</span>
                )}
                <span>•</span>
                <span>Durasi: {liveBatch.total_duration_sec ? `${liveBatch.total_duration_sec}s` : '—'}</span>
                {liveBatch.model && (
                  <>
                    <span>•</span>
                    <span className="text-sky-300 truncate max-w-[200px]" title={liveBatch.model}>
                      {liveBatch.model}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* View Mode Switcher */}
            <div className="flex bg-[#091322] p-0.5 rounded-lg border border-slate-800 text-xs font-sans">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`px-3 py-1 rounded text-xs transition cursor-pointer font-medium ${
                  viewMode === 'split'
                    ? 'bg-slate-800 text-sky-300 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Tampilan interaktif dengan daftar kueri di sebelah kiri"
              >
                Interaktif
              </button>
              <button
                type="button"
                onClick={() => setViewMode('document')}
                className={`px-3 py-1 rounded text-xs transition cursor-pointer font-medium ${
                  viewMode === 'document'
                    ? 'bg-slate-800 text-sky-300 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Tampilan dokumen berurutan untuk membaca seluruh laporan"
              >
                Semua Jawaban
              </button>
            </div>

            {/* Copy Full Report */}
            <button
              type="button"
              onClick={handleCopyFullReportMarkdown}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 font-sans transition cursor-pointer"
              title="Salin seluruh isi pertanyaan dan jawaban sebagai Markdown"
            >
              {copiedId === 'full_report' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span className="hidden sm:inline">Salin Laporan</span>
            </button>

            {/* Print / Save PDF */}
            <button
              type="button"
              onClick={handlePrint}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 font-sans transition cursor-pointer"
              title="Cetak atau simpan laporan sebagai dokumen PDF"
            >
              <Printer className="w-3.5 h-3.5 text-slate-400" />
              <span>Cetak / PDF</span>
            </button>

            {/* Download CSV */}
            <button
              type="button"
              onClick={() => handleDownload('csv')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 font-mono transition cursor-pointer"
              title="Unduh seluruh data sebagai spreadsheet CSV"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>CSV</span>
            </button>

            {/* Manual Refresh */}
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Perbarui data batch"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-sky-400' : ''}`} />
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer ml-1"
              aria-label="Tutup jendela laporan"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ==============================================================================
         * Modal Body: Mode 1 (Split Master-Detail) vs Mode 2 (Full Document)
         * ============================================================================== */}
        {viewMode === 'split' ? (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Sidebar: Query Master List */}
            {isSidebarOpen && (
              <aside className="w-80 md:w-88 border-r border-white/[0.08] bg-[#050b14] flex flex-col shrink-0 transition-all">
                {/* Search & Collapse bar */}
                <div className="p-3 border-b border-white/[0.06] flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter pertanyaan..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#08101d] border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500/60 font-sans"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                    title="Sembunyikan daftar untuk ruang baca lebih luas"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                </div>

                {/* Items List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                  {filteredItems.map((item) => {
                    const isSelected = item.query_id === selectedItem?.query_id;
                    const itemIndex = items.findIndex((it) => it.query_id === item.query_id) + 1;
                    return (
                      <button
                        key={item.query_id}
                        type="button"
                        onClick={() => {
                          setSelectedQueryId(item.query_id);
                          detailScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full text-left p-3 rounded-xl transition cursor-pointer border flex flex-col gap-2 ${
                          isSelected
                            ? 'bg-[#101e38] border-sky-500/70 text-white shadow-sm ring-1 ring-sky-500/30'
                            : 'bg-[#08101d]/60 border-slate-800/70 hover:bg-[#0c172a] text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className={`font-semibold ${isSelected ? 'text-sky-300' : 'text-slate-400'}`}>
                            #{itemIndex}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400">{item.duration_ms || 0}ms</span>
                            {item.status === 'completed' && (
                              <span className="w-2 h-2 rounded-full bg-emerald-400" title="Selesai" />
                            )}
                            {item.status === 'failed' && (
                              <span className="w-2 h-2 rounded-full bg-rose-400" title="Gagal" />
                            )}
                            {item.status === 'processing' && (
                              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" title="Sedang diproses" />
                            )}
                            {item.status === 'pending' && (
                              <span className="w-2 h-2 rounded-full bg-slate-500" title="Menunggu antrian" />
                            )}
                          </div>
                        </div>
                        <p className="text-xs font-sans font-medium line-clamp-2 leading-relaxed">
                          {item.query}
                        </p>
                      </button>
                    );
                  })}

                  {filteredItems.length === 0 && (
                    <div className="text-center py-12 text-slate-500 text-xs font-sans">
                      Tidak ada pertanyaan yang sesuai filter.
                    </div>
                  )}
                </div>

                {/* Footer Count */}
                <div className="p-2.5 border-t border-white/[0.06] text-[11px] font-mono text-slate-500 text-center">
                  Menampilkan {filteredItems.length} dari {items.length} kueri
                </div>
              </aside>
            )}

            {/* Right Pane: Focused Reader */}
            <main
              ref={detailScrollRef}
              className="flex-1 overflow-y-auto p-5 sm:p-8 bg-[#08101d] transition-all"
            >
              {selectedItem ? (
                <div className="max-w-4xl mx-auto space-y-6">
                  {/* Top Reader Navigation Bar */}
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.08] text-xs font-sans text-slate-400">
                    <div className="flex items-center gap-2">
                      {!isSidebarOpen && (
                        <button
                          type="button"
                          onClick={() => setIsSidebarOpen(true)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition cursor-pointer"
                          title="Buka kembali daftar pertanyaan di sebelah kiri"
                        >
                          <PanelLeftOpen className="w-4 h-4 text-sky-400" />
                          <span>Daftar</span>
                        </button>
                      )}
                      <span className="font-mono text-sky-400 font-semibold">
                        Pertanyaan {selectedIndex + 1} dari {items.length}
                      </span>
                    </div>

                    {/* Stepper Flipping (Prev / Next) */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handlePrev}
                        disabled={!hasPrev}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-sans transition ${
                          hasPrev
                            ? 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200 cursor-pointer'
                            : 'bg-transparent border-transparent text-slate-600 cursor-not-allowed'
                        }`}
                        title="Pertanyaan sebelumnya (Shortcut: Panah Kiri)"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Sebelumnya</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleNext}
                        disabled={!hasNext}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-sans transition ${
                          hasNext
                            ? 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200 cursor-pointer'
                            : 'bg-transparent border-transparent text-slate-600 cursor-not-allowed'
                        }`}
                        title="Pertanyaan berikutnya (Shortcut: Panah Kanan)"
                      >
                        <span className="hidden sm:inline">Berikutnya</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Question Banner Header */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-sky-950/70 border border-sky-800/50 text-sky-300">
                        Pertanyaan #{selectedIndex + 1}
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        Durasi Eksekusi: {selectedItem.duration_ms ? `${selectedItem.duration_ms} ms` : '—'}
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-2xl font-bold text-white font-sans leading-snug tracking-tight">
                      {selectedItem.query}
                    </h3>
                  </div>

                  {/* Live Processing Card */}
                  {selectedItem.status === 'processing' && (
                    <div className="p-5 rounded-2xl bg-sky-950/30 border border-sky-800/50 flex items-center gap-4 text-sky-200">
                      <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
                      <div className="text-sm font-sans space-y-0.5">
                        <span className="font-semibold block text-sky-300">Sedang Menganalisis Kueri</span>
                        <span className="text-slate-400 text-xs">AI Agent sedang mengeksekusi SQL analitik dan menyusun sintesis jawaban...</span>
                      </div>
                    </div>
                  )}

                  {/* Failure Warning Card */}
                  {selectedItem.status === 'failed' && (
                    <div className="p-5 rounded-2xl bg-rose-950/40 border border-rose-800/60 text-rose-200 space-y-3 font-sans">
                      <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
                        <AlertTriangle className="w-4 h-4 text-rose-400" />
                        <span>Eksekusi Kueri Gagal</span>
                      </div>
                      <div className="font-mono text-xs bg-black/50 p-3 rounded-xl border border-rose-900/60 text-rose-200 whitespace-pre-wrap leading-relaxed">
                        {selectedItem.error || 'Terjadi kesalahan teknis saat mengeksekusi kueri analitik.'}
                      </div>
                    </div>
                  )}

                  {/* Primary Narrative Answer Card */}
                  {selectedItem.status === 'completed' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-300 font-sans uppercase tracking-wider">
                          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                          <span>Jawaban & Kesimpulan Analitik</span>
                        </div>
                        {selectedItem.answer_text && (
                          <button
                            type="button"
                            onClick={() => handleCopy(selectedItem.query_id, selectedItem.answer_text!, 'Jawaban')}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 hover:text-sky-300 transition cursor-pointer font-sans"
                          >
                            {copiedId === selectedItem.query_id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>Salin Jawaban</span>
                          </button>
                        )}
                      </div>

                      {/* Main Rich Markdown Content Card */}
                      <div className="p-6 sm:p-8 rounded-2xl bg-[#0b1629] border border-white/[0.08] text-slate-100 shadow-lg overflow-x-auto">
                        {renderRichMarkdown(selectedItem.answer_text) || (
                          <span className="text-slate-400 italic text-sm font-sans">
                            Analisis selesai tanpa ringkasan teks naratif tambahan.
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ==============================================================================
                   * Technical Collapsible Section (SQL Queries & Raw Data Tables)
                   * ============================================================================== */}
                  <div className="space-y-3 pt-2">
                    {/* Collapsible SQL Query Box */}
                    {selectedItem.sql_queries && selectedItem.sql_queries.length > 0 && (
                      <div className="rounded-xl border border-white/[0.06] bg-[#060c17] overflow-hidden transition">
                        <button
                          type="button"
                          onClick={() => toggleSql(selectedItem.query_id)}
                          className="w-full px-4 py-3 flex items-center justify-between text-xs font-sans text-slate-300 hover:bg-slate-900/60 transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-sky-400" />
                            <span className="font-semibold">Kueri SQL yang Dijalankan ({selectedItem.sql_queries.length})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-500 font-mono">
                              {openSqlSections[selectedItem.query_id] ? 'Tutup' : 'Lihat SQL'}
                            </span>
                            {openSqlSections[selectedItem.query_id] ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {openSqlSections[selectedItem.query_id] && (
                          <div className="p-4 border-t border-white/[0.06] bg-[#040810] space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-mono text-slate-500">PostgreSQL Analytics Query:</span>
                              <button
                                type="button"
                                onClick={() => handleCopy(`sql_${selectedItem.query_id}`, selectedItem.sql_queries![0], 'SQL')}
                                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300 transition font-mono cursor-pointer"
                              >
                                {copiedId === `sql_${selectedItem.query_id}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>Salin SQL</span>
                              </button>
                            </div>
                            <pre className="p-3.5 rounded-xl bg-black/60 border border-slate-800 text-xs font-mono text-sky-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                              <code>{selectedItem.sql_queries[0]}</code>
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Collapsible Raw Table Box */}
                    {selectedItem.tables && selectedItem.tables.length > 0 && selectedItem.tables[0].columns && (
                      <div className="rounded-xl border border-white/[0.06] bg-[#060c17] overflow-hidden transition">
                        <button
                          type="button"
                          onClick={() => toggleTable(selectedItem.query_id)}
                          className="w-full px-4 py-3 flex items-center justify-between text-xs font-sans text-slate-300 hover:bg-slate-900/60 transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <TableIcon className="w-4 h-4 text-emerald-400" />
                            <span className="font-semibold">
                              Tabel Data Hasil Query ({selectedItem.tables[0].rows?.length || 0} baris)
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-500 font-mono">
                              {openTableSections[selectedItem.query_id] ? 'Tutup' : 'Lihat Data'}
                            </span>
                            {openTableSections[selectedItem.query_id] ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {openTableSections[selectedItem.query_id] && (
                          <div className="p-4 border-t border-white/[0.06] bg-[#040810] overflow-x-auto">
                            <table className="w-full text-left text-xs font-mono border-collapse">
                              <thead>
                                <tr className="bg-[#0f1a2e] text-sky-300 border-b border-slate-800">
                                  {selectedItem.tables[0].columns.map((col, idx) => (
                                    <th key={idx} className="px-3.5 py-2.5 font-semibold text-[11px]">
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {selectedItem.tables[0].rows.map((row, rIdx) => (
                                  <tr key={rIdx} className="hover:bg-slate-900/60 transition">
                                    {row.map((val, cIdx) => (
                                      <td key={cIdx} className="px-3.5 py-2 text-slate-300 text-xs">
                                        {val === null || val === undefined ? '—' : String(val)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-24 text-slate-500 text-sm font-sans">
                  Pilih salah satu pertanyaan di panel sebelah kiri untuk membaca jawaban.
                </div>
              )}
            </main>
          </div>
        ) : (
          /* ==============================================================================
           * Mode 2: Sequential Full Document View ("Semua Jawaban")
           * ============================================================================== */
          <div
            ref={docScrollRef}
            className="flex-1 overflow-y-auto p-5 sm:p-10 bg-[#08101d] print:p-0 print:bg-white"
          >
            <div className="max-w-4xl mx-auto space-y-10">
              {/* Executive Document Title Block */}
              <div className="pb-6 border-b border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="text-xl sm:text-2xl font-bold text-white font-sans tracking-tight">
                    Laporan Lengkap Hasil Analisis
                  </h3>
                  <button
                    type="button"
                    onClick={handleCopyFullReportMarkdown}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-sky-300 transition cursor-pointer font-sans"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Salin Laporan Markdown</span>
                  </button>
                </div>
                <p className="text-xs text-slate-400 font-sans leading-relaxed">
                  Laporan analisis untuk batch <span className="font-mono text-sky-300">{liveBatch.batch_id}</span> memuat seluruh {items.length} pertanyaan dan jawaban analitik terverifikasi.
                </p>

                {/* Quick Table of Contents Pills */}
                <div className="pt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Lompat ke:</span>
                  {items.map((item, idx) => (
                    <button
                      key={item.query_id}
                      type="button"
                      onClick={() => scrollToDocSection(item.query_id)}
                      className="px-2.5 py-1 rounded-lg bg-[#0e1a30] hover:bg-[#142340] border border-slate-800 text-slate-300 hover:text-sky-300 text-xs font-sans transition cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="font-mono text-sky-400 font-semibold">#{idx + 1}</span>
                      <span className="truncate max-w-[150px]">{item.query}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sequential Articles */}
              <div className="space-y-12">
                {items.map((item, idx) => (
                  <article
                    id={`doc-item-${item.query_id}`}
                    key={item.query_id}
                    className="space-y-4 pb-10 border-b border-white/[0.08] last:border-0 scroll-mt-6"
                  >
                    {/* Question Header */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-sky-950/70 border border-sky-800/50 text-sky-300">
                          Pertanyaan #{idx + 1}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono shrink-0 uppercase tracking-wider ${
                            item.status === 'completed'
                              ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50'
                              : item.status === 'failed'
                              ? 'bg-rose-950/80 text-rose-400 border border-rose-800/50'
                              : 'bg-sky-950/80 text-sky-400 border border-sky-800/50'
                          }`}
                        >
                          {item.status} ({item.duration_ms || 0}ms)
                        </span>
                      </div>
                      <h4 className="text-lg sm:text-xl font-bold text-white font-sans leading-snug">
                        {item.query}
                      </h4>
                    </div>

                    {/* Narrative Answer */}
                    {item.status === 'completed' && item.answer_text && (
                      <div className="p-6 sm:p-8 rounded-2xl bg-[#0b1629] border border-white/[0.08] text-slate-100 shadow-md overflow-x-auto">
                        {renderRichMarkdown(item.answer_text)}
                      </div>
                    )}

                    {/* Failure Message */}
                    {item.status === 'failed' && (
                      <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs font-mono whitespace-pre-wrap">
                        <span className="font-semibold block text-rose-300 mb-1">Galat:</span>
                        {item.error || 'Eksekusi kueri gagal.'}
                      </div>
                    )}

                    {/* Raw SQL & Tables (Collapsible in Document View) */}
                    {(item.sql_queries?.length || item.tables?.length) ? (
                      <div className="space-y-2 pt-2">
                        {item.sql_queries && item.sql_queries.length > 0 && (
                          <div className="rounded-xl border border-white/[0.06] bg-[#060c17] overflow-hidden">
                            <button
                              type="button"
                              onClick={() => toggleSql(`doc_${item.query_id}`)}
                              className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-sans text-slate-300 hover:bg-slate-900/60 cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <Database className="w-3.5 h-3.5 text-sky-400" />
                                <span>Kueri SQL ({item.sql_queries.length})</span>
                              </div>
                              <span className="text-[11px] font-mono text-slate-500">
                                {openSqlSections[`doc_${item.query_id}`] ? 'Sembunyikan' : 'Tampilkan'}
                              </span>
                            </button>
                            {openSqlSections[`doc_${item.query_id}`] && (
                              <pre className="p-3 border-t border-white/[0.06] bg-black/60 text-xs font-mono text-sky-300 overflow-x-auto whitespace-pre-wrap">
                                <code>{item.sql_queries[0]}</code>
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>

              {/* Back to top button */}
              <div className="pt-4 text-center">
                <button
                  type="button"
                  onClick={() => docScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 font-sans cursor-pointer transition"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>Kembali ke Atas</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==============================================================================
         * Modal Footer
         * ============================================================================== */}
        <div className="px-6 py-3 border-t border-white/[0.08] bg-[#050b14] flex items-center justify-between text-xs font-mono text-slate-400 shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <span>Shortcut: [ESC] Tutup</span>
            {viewMode === 'split' && <span className="hidden sm:inline">• [← / →] Pindah Pertanyaan</span>}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-sans text-xs transition cursor-pointer"
            >
              Tutup Laporan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

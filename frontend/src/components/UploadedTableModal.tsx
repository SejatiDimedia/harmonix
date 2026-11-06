import React, { useEffect, useState } from 'react';
import {
  Table,
  X,
  Copy,
  Check,
  ArrowRight,
  Activity,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  Info,
  Compass,
  RefreshCw,
  FileSpreadsheet,
  Trash2,
} from 'lucide-react';
import { UploadedTableSummary } from '../types';
import { useTableHealthQuery, useDeleteUploadedTableMutation } from '../hooks/useQueries';

interface UploadedTableModalProps {
  isOpen: boolean;
  table: UploadedTableSummary | null;
  sessionId?: string | null;
  onClose: () => void;
  onSelectPrompt?: (prompt: string) => void;
}

export const UploadedTableModal: React.FC<UploadedTableModalProps> = ({
  isOpen,
  table,
  sessionId,
  onClose,
  onSelectPrompt,
}) => {
  const [activeTab, setActiveTab] = useState<'health' | 'schema'>('health');
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteTableMutation = useDeleteUploadedTableMutation(sessionId || null);

  const {
    data: healthProfile,
    isLoading: isHealthLoading,
    isError: isHealthError,
    refetch: refetchHealth,
  } = useTableHealthQuery(sessionId || null, isOpen && table ? table.table_name : null);

  useEffect(() => {
    if (!isOpen) {
      setConfirmDelete(false);
      setIsDeleting(false);
    }
  }, [isOpen]);

  const handleDeleteTable = async () => {
    if (!table) return;
    try {
      setIsDeleting(true);
      await deleteTableMutation.mutateAsync(table.table_name);
      onClose();
    } catch {
      // handled
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !table) return null;

  const qualifiedName = `analytics.${table.table_name}`;

  const handleCopyName = () => {
    navigator.clipboard.writeText(qualifiedName);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAction = (prompt: string) => {
    if (onSelectPrompt) {
      onSelectPrompt(prompt);
    }
    onClose();
  };

  const getScoreTheme = (grade: string) => {
    switch (grade) {
      case 'Prima':
        return {
          badge: 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300',
          scoreText: 'text-emerald-400',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />,
        };
      case 'Perhatian':
        return {
          badge: 'bg-amber-950/40 border-amber-800/40 text-amber-300',
          scoreText: 'text-amber-400',
          icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
        };
      case 'Kritis':
      default:
        return {
          badge: 'bg-rose-950/40 border-rose-800/40 text-rose-300',
          scoreText: 'text-rose-400',
          icon: <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0" />,
        };
    }
  };

  const scoreTheme = healthProfile ? getScoreTheme(healthProfile.health_grade) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans no-print select-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="uploaded-table-title"
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0c1524] border border-slate-800/80 shadow-2xl overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-800/80 bg-[#0e192c]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-slate-800 text-sky-400 border border-slate-700/60 shadow-inner shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id="uploaded-table-title" className="text-base font-semibold text-slate-100 font-sans truncate">
                  {table.original_filename}
                </h3>
                {table.sheet_name && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-800 text-sky-300 border border-slate-700/60">
                    Sheet: {table.sheet_name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1 font-sans flex items-center gap-1.5 flex-wrap">
                <span>Tabel analitik:</span>
                <code className="text-slate-300 font-mono text-[11px] bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-800">
                  {qualifiedName}
                </code>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition cursor-pointer shrink-0 ml-3"
            aria-label="Tutup pratinjau tabel (Esc)"
            title="Tutup (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher & Subheader */}
        <div className="px-6 py-2.5 bg-[#0c1524] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('health')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                activeTab === 'health'
                  ? 'bg-slate-800 text-sky-300 font-semibold shadow-sm border border-slate-700/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Kesehatan Data &amp; Audit</span>
              {healthProfile && (
                <span className="ml-1 px-1.5 py-0.2 rounded-md text-[10px] font-mono font-medium bg-slate-950/80 border border-slate-800 text-slate-300">
                  {healthProfile.health_score}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('schema')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                activeTab === 'schema'
                  ? 'bg-slate-800 text-sky-300 font-semibold shadow-sm border border-slate-700/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Struktur Kolom</span>
              <span className="text-[10px] text-slate-400 font-mono">({table.columns.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyName}
              className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition cursor-pointer"
              title="Salin nama tabel SQL lengkap"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Tersalin' : 'Salin Nama'}</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'health' ? (
            /* TAB 1: DATA HEALTH & ANOMALY PROFILING */
            <div className="space-y-5">
              {isHealthLoading ? (
                <div className="py-12 text-center space-y-3">
                  <RefreshCw className="w-5 h-5 animate-spin text-sky-400 mx-auto" />
                  <p className="text-xs text-slate-400 font-mono">
                    Memindai kelengkapan data, duplikasi, dan pencilan statistik (IQR)...
                  </p>
                </div>
              ) : isHealthError || !healthProfile ? (
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
                  <p className="text-xs text-rose-300">Gagal memuat metrik profil kesehatan data.</p>
                  <button
                    type="button"
                    onClick={() => refetchHealth()}
                    className="px-3 py-1 text-xs rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition cursor-pointer border border-slate-700/60"
                  >
                    Coba Lagi
                  </button>
                </div>
              ) : (
                <>
                  {/* Health Score Summary Card */}
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700/60 text-slate-300 shrink-0">
                        {scoreTheme?.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                            Skor Kesehatan Data
                          </span>
                          <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded border ${scoreTheme?.badge}`}>
                            Status {healthProfile.health_grade}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 font-sans leading-relaxed">
                          {healthProfile.anomalies.length > 0
                            ? `Ditemukan ${healthProfile.anomalies.length} anomali potensial pada dataset ini.`
                            : 'Dataset terverifikasi bersih tanpa anomali struktural atau pencilan ekstrem.'}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0 sm:border-l sm:border-slate-800 sm:pl-5">
                      <div className={`text-2xl font-bold font-mono tracking-tight ${scoreTheme?.scoreText}`}>
                        {healthProfile.health_score}
                        <span className="text-xs font-normal text-slate-500">/100</span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono block mt-0.5">
                        {healthProfile.overall_completeness_pct}% Lengkap
                      </span>
                    </div>
                  </div>

                  {/* 4 Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1.5">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wide">Kelengkapan</span>
                      <div className="text-sm font-semibold font-mono text-slate-200">
                        {healthProfile.overall_completeness_pct}%
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-sky-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${healthProfile.overall_completeness_pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1.5">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wide">Total Baris</span>
                      <div className="text-sm font-semibold font-mono text-slate-200">
                        {healthProfile.total_rows.toLocaleString()}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block">
                        {healthProfile.total_columns} kolom
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1.5">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wide">Baris Duplikat</span>
                      <div className={`text-sm font-semibold font-mono ${healthProfile.duplicate_rows > 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                        {healthProfile.duplicate_rows.toLocaleString()}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block">
                        {healthProfile.duplicate_rate_pct}% duplikasi
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1.5">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wide">Anomali Terdeteksi</span>
                      <div className={`text-sm font-semibold font-mono ${healthProfile.anomalies.length > 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                        {healthProfile.anomalies.length} Temuan
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block">
                        {healthProfile.anomalies.filter((a) => a.severity === 'critical').length} Kritis
                      </span>
                    </div>
                  </div>

                  {/* Actionable Exploration Prompts */}
                  {healthProfile.quick_prompts.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-mono font-medium text-slate-300 uppercase tracking-wider">
                        <Compass className="w-3.5 h-3.5 text-sky-400" />
                        <span>Saran Analisis Data</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {healthProfile.quick_prompts.map((qp) => (
                          <button
                            key={qp.id}
                            type="button"
                            onClick={() => handleAction(qp.prompt)}
                            className="group p-3 rounded-xl bg-slate-900/50 hover:bg-slate-800/70 border border-slate-800 hover:border-slate-700/80 transition text-left cursor-pointer flex flex-col justify-between gap-2.5 shadow-sm"
                          >
                            <span className="text-xs font-medium text-slate-200 font-sans group-hover:text-sky-300 transition line-clamp-2">
                              {qp.title}
                            </span>
                            <div className="flex items-center justify-between text-[11px] text-slate-400 font-sans">
                              <span>Ajukan pertanyaan</span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 group-hover:translate-x-0.5 transition shrink-0" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Detected Anomalies List */}
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-mono font-medium text-slate-300 uppercase tracking-wider">
                      Daftar Temuan Anomali &amp; Outlier ({healthProfile.anomalies.length})
                    </h4>
                    {healthProfile.anomalies.length === 0 ? (
                      <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-xs text-slate-300 flex items-center gap-2.5 font-sans">
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Data bersih. Tidak ditemukan duplikasi baris, nilai kosong signifikan, atau outlier ekstrem.</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {healthProfile.anomalies.map((anom) => {
                          const isCrit = anom.severity === 'critical';
                          const isWarn = anom.severity === 'warning';
                          return (
                            <div
                              key={anom.anomaly_id}
                              className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 flex items-start gap-3 hover:bg-slate-900/70 transition"
                            >
                              <div className="mt-0.5 shrink-0">
                                {isCrit ? (
                                  <AlertOctagon className="w-4 h-4 text-rose-400" />
                                ) : isWarn ? (
                                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                                ) : (
                                  <Info className="w-4 h-4 text-sky-400" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-semibold text-slate-200 font-sans">
                                    {anom.title}
                                  </span>
                                  <span
                                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded uppercase font-semibold border ${
                                      isCrit
                                        ? 'bg-rose-950/50 text-rose-300 border-rose-800/50'
                                        : isWarn
                                        ? 'bg-amber-950/50 text-amber-300 border-amber-800/50'
                                        : 'bg-slate-800 text-slate-300 border-slate-700/60'
                                    }`}
                                  >
                                    {anom.severity}
                                  </span>
                                </div>
                                <p className="text-xs leading-relaxed font-sans text-slate-400">
                                  {anom.description}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Column Quality Mini-Table */}
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-mono font-medium text-slate-300 uppercase tracking-wider">
                      Ringkasan Kelengkapan Kolom
                    </h4>
                    <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                      <table className="w-full text-left text-xs font-mono">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-900 text-slate-400">
                            <th scope="col" className="py-2.5 px-3 font-medium">Kolom</th>
                            <th scope="col" className="py-2.5 px-3 font-medium">Tipe</th>
                            <th scope="col" className="py-2.5 px-3 font-medium">Kelengkapan</th>
                            <th scope="col" className="py-2.5 px-3 font-medium">Outlier / Nilai Unik</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {healthProfile.column_profiles.map((cp) => (
                            <tr key={cp.column_name} className="hover:bg-slate-900/50 transition">
                              <td className="py-2 px-3 font-semibold text-slate-200">
                                {cp.column_name}
                              </td>
                              <td className="py-2 px-3 text-slate-400 text-[11px]">
                                {cp.data_type}
                              </td>
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        cp.null_rate_pct === 0
                                          ? 'bg-emerald-500'
                                          : cp.null_rate_pct < 20
                                          ? 'bg-amber-500'
                                          : 'bg-rose-500'
                                      }`}
                                      style={{ width: `${100 - cp.null_rate_pct}%` }}
                                    />
                                  </div>
                                  <span className="text-[11px] font-mono text-slate-300">
                                    {cp.null_count > 0 ? `${cp.null_count} NULL` : '100%'}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-3 text-[11px]">
                                {cp.outlier_count > 0 ? (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-800/40 font-mono">
                                    {cp.outlier_count} outlier ({cp.outlier_rate_pct}%)
                                  </span>
                                ) : cp.is_unique ? (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 font-mono">
                                    100% Unik
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-mono">
                                    {cp.distinct_count.toLocaleString()} unik
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* TAB 2: SCHEMA & SAMPLE COLUMNS */
            <div className="space-y-5">
              <div>
                <h4 className="text-xs font-mono font-medium text-slate-300 uppercase tracking-wider mb-2.5">
                  Struktur Kolom &amp; Tipe Data
                </h4>
                <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900 text-slate-400">
                        <th scope="col" className="py-2.5 px-3.5 font-medium">Nama Kolom</th>
                        <th scope="col" className="py-2.5 px-3.5 font-medium">Tipe PostgreSQL</th>
                        <th scope="col" className="py-2.5 px-3.5 font-medium">Contoh Nilai</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {table.columns.map((col) => (
                        <tr key={col.name} className="hover:bg-slate-900/50 transition">
                          <td className="py-2 px-3.5 font-semibold text-slate-200">
                            {col.name}
                          </td>
                          <td className="py-2 px-3.5">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-sky-300 border border-slate-700/60">
                              {col.data_type}
                            </span>
                          </td>
                          <td className="py-2 px-3.5 text-slate-400 truncate max-w-[200px]" title={col.sample_values?.join(', ')}>
                            {col.sample_values && col.sample_values.length > 0
                              ? col.sample_values.slice(0, 3).join(', ')
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Quick Query Suggestions */}
              <div>
                <h4 className="text-xs font-mono font-medium text-slate-300 uppercase tracking-wider mb-2">
                  Contoh Pertanyaan Cepat
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleAction(`Tampilkan 5 baris pertama dari tabel ${qualifiedName} dalam bentuk tabel`)
                    }
                    className="group flex items-center justify-between p-3 rounded-xl bg-slate-900/50 hover:bg-slate-800/70 border border-slate-800 hover:border-slate-700/80 transition text-left cursor-pointer shadow-sm"
                  >
                    <span className="text-xs text-slate-300 group-hover:text-slate-100 font-sans">
                      Lihat 5 sampel data pertama
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 ml-2 transition" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleAction(`Hitung ringkasan statistik (jumlah, rata-rata, nilai min dan max) untuk tabel ${qualifiedName}`)
                    }
                    className="group flex items-center justify-between p-3 rounded-xl bg-slate-900/50 hover:bg-slate-800/70 border border-slate-800 hover:border-slate-700/80 transition text-left cursor-pointer shadow-sm"
                  >
                    <span className="text-xs text-slate-300 group-hover:text-slate-100 font-sans">
                      Hitung ringkasan statistik kolom
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 ml-2 transition" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleAction(`Bandingkan dan gabungkan data dari tabel ${qualifiedName} dengan data pesanan di tabel orders`)
                    }
                    className="group flex items-center justify-between p-3 rounded-xl bg-slate-900/50 hover:bg-slate-800/70 border border-slate-800 hover:border-slate-700/80 transition text-left cursor-pointer sm:col-span-2 shadow-sm"
                  >
                    <span className="text-xs text-slate-300 group-hover:text-slate-100 font-sans">
                      Cross-Join: Gabungkan data ini dengan data transaksi pesanan (orders)
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 ml-2 transition" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-800/80 bg-[#0e192c]">
          {confirmDelete ? (
            <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/50 px-3 py-1.5 rounded-xl">
              <span className="text-xs text-rose-300 font-sans font-medium">Hapus dataset ini dari sesi?</span>
              <button
                type="button"
                onClick={handleDeleteTable}
                disabled={isDeleting}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                Batal
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 hover:text-rose-200 bg-rose-950/30 hover:bg-rose-900/40 border border-rose-900/40 transition cursor-pointer"
              title="Hapus dataset ini dari database sesi"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Hapus Dataset</span>
            </button>
          )}

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-400 hidden sm:inline">
              <strong className="text-slate-200">{table.row_count.toLocaleString()}</strong> baris •{' '}
              <strong className="text-slate-200">{table.columns.length}</strong> kolom
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700/60 transition cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

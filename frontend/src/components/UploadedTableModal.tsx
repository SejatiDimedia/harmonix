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
  Sparkles,
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
          badgeBg: 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300',
          scoreText: 'text-emerald-400',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />,
        };
      case 'Perhatian':
        return {
          badgeBg: 'bg-amber-950/60 border-amber-700/50 text-amber-300',
          scoreText: 'text-amber-400',
          icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
        };
      case 'Kritis':
      default:
        return {
          badgeBg: 'bg-rose-950/60 border-rose-700/50 text-rose-300',
          scoreText: 'text-rose-400',
          icon: <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0" />,
        };
    }
  };

  const scoreTheme = healthProfile ? getScoreTheme(healthProfile.health_grade) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200 no-print print:hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="uploaded-table-title"
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0f1a2e] border border-white/[0.08] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between p-5 border-b border-white/[0.04] bg-[#0b1526]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-[#14223b] text-[#00d2ee] shrink-0 shadow-sm">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id="uploaded-table-title" className="text-base font-semibold text-[#f8fafc] font-sans truncate">
                  {table.original_filename}
                </h3>
                {table.sheet_name && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-[#14223b] text-[#7dd3fc]">
                    Sheet: {table.sheet_name}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#94a3b8] mt-0.5 font-sans truncate">
                Tabel analitik PostgreSQL: <code className="text-[#38bdf8] font-mono">{qualifiedName}</code>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] transition cursor-pointer shrink-0 ml-3"
            aria-label="Tutup pratinjau tabel (Esc)"
            title="Tutup (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher & Subheader */}
        <div className="px-5 py-2.5 bg-[#111e33] border-b border-white/[0.04] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('health')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                activeTab === 'health'
                  ? 'bg-[#008cd0] text-white shadow-sm'
                  : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Kesehatan Data &amp; Audit</span>
              {healthProfile && (
                <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                  healthProfile.health_grade === 'Prima'
                    ? 'bg-emerald-500/30 text-emerald-300'
                    : healthProfile.health_grade === 'Perhatian'
                    ? 'bg-amber-500/30 text-amber-200'
                    : 'bg-rose-500/30 text-rose-200'
                }`}>
                  {healthProfile.health_score}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('schema')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                activeTab === 'schema'
                  ? 'bg-[#008cd0] text-white shadow-sm'
                  : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b]'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Struktur Kolom</span>
              <span className="text-[10px] text-[#94a3b8] font-mono">({table.columns.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyName}
              className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-lg bg-[#14223b] text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer shadow-sm"
              title="Salin nama tabel SQL lengkap"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Tersalin' : 'Salin Nama'}</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'health' ? (
            /* TAB 1: DATA HEALTH & ANOMALY PROFILING */
            <div className="space-y-5">
              {isHealthLoading ? (
                <div className="py-12 text-center space-y-3">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#00d2ee] mx-auto" />
                  <p className="text-xs text-[#94a3b8] font-mono">
                    Memindai kelengkapan data, duplikasi, dan pencilan statistik (IQR)...
                  </p>
                </div>
              ) : isHealthError || !healthProfile ? (
                <div className="p-4 rounded-xl bg-[#14223b] border border-[#1e3557] text-center space-y-2">
                  <p className="text-xs text-rose-300">Gagal memuat metrik profil kesehatan data.</p>
                  <button
                    type="button"
                    onClick={() => refetchHealth()}
                    className="px-3 py-1 text-xs rounded-lg bg-[#1e3557] text-[#f8fafc] hover:bg-[#25416c] transition cursor-pointer"
                  >
                    Coba Lagi
                  </button>
                </div>
              ) : (
                <>
                  {/* Health Score Banner */}
                  <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${scoreTheme?.badgeBg}`}>
                    <div className="flex items-center gap-3.5">
                      <div className="p-2.5 rounded-xl bg-black/20 border border-white/10 shrink-0">
                        {scoreTheme?.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono uppercase tracking-wider opacity-80">
                            Skor Kesehatan Data
                          </span>
                          <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-black/25">
                            Status {healthProfile.health_grade}
                          </span>
                        </div>
                        <p className="text-xs text-[#94a3b8] mt-1 font-sans">
                          {healthProfile.anomalies.length > 0
                            ? `Ditemukan ${healthProfile.anomalies.length} anomali potensial pada dataset ini.`
                            : 'Dataset sangat bersih tanpa anomali struktural atau nilai pencilan ekstrem.'}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0 sm:border-l sm:border-white/10 sm:pl-5">
                      <div className={`text-3xl font-extrabold font-mono tracking-tight ${scoreTheme?.scoreText}`}>
                        {healthProfile.health_score}
                        <span className="text-sm font-normal text-[#94a3b8]">/100</span>
                      </div>
                      <span className="text-[10px] text-[#94a3b8] font-mono">
                        {healthProfile.overall_completeness_pct}% Lengkap
                      </span>
                    </div>
                  </div>

                  {/* 4 Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-[#111e33] space-y-1 shadow-sm">
                      <span className="text-[10px] font-mono text-[#94a3b8] uppercase">Kelengkapan</span>
                      <div className="text-sm font-semibold font-mono text-[#f8fafc]">
                        {healthProfile.overall_completeness_pct}%
                      </div>
                      <div className="w-full bg-[#1e3557] h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#00d2ee] h-full rounded-full transition-all duration-500"
                          style={{ width: `${healthProfile.overall_completeness_pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#111e33] space-y-1 shadow-sm">
                      <span className="text-[10px] font-mono text-[#94a3b8] uppercase">Total Data</span>
                      <div className="text-sm font-semibold font-mono text-[#f8fafc]">
                        {healthProfile.total_rows.toLocaleString()}
                      </div>
                      <span className="text-[10px] text-[#94a3b8] font-mono">
                        {healthProfile.total_columns} kolom
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-[#111e33] space-y-1 shadow-sm">
                      <span className="text-[10px] font-mono text-[#94a3b8] uppercase">Baris Duplikat</span>
                      <div className={`text-sm font-semibold font-mono ${healthProfile.duplicate_rows > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {healthProfile.duplicate_rows.toLocaleString()}
                      </div>
                      <span className="text-[10px] text-[#94a3b8] font-mono">
                        {healthProfile.duplicate_rate_pct}% duplikasi
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-[#111e33] space-y-1 shadow-sm">
                      <span className="text-[10px] font-mono text-[#94a3b8] uppercase">Anomali Terdeteksi</span>
                      <div className={`text-sm font-semibold font-mono ${healthProfile.anomalies.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {healthProfile.anomalies.length} Temuan
                      </div>
                      <span className="text-[10px] text-[#94a3b8] font-mono">
                        {healthProfile.anomalies.filter((a) => a.severity === 'critical').length} Kritis
                      </span>
                    </div>
                  </div>

                  {/* Actionable Quick-Action Prompts (Instant Discovery) */}
                  {healthProfile.quick_prompts.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-[#f8fafc] uppercase tracking-wider">
                        <Sparkles className="w-3.5 h-3.5 text-[#00d2ee]" />
                        <span>Investigasi Cepat dengan Harmonix</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {healthProfile.quick_prompts.map((qp) => (
                          <button
                            key={qp.id}
                            type="button"
                            onClick={() => handleAction(qp.prompt)}
                            className="group p-3 rounded-xl bg-[#111e33] hover:bg-[#14223b] transition text-left cursor-pointer flex flex-col justify-between gap-2 shadow-sm"
                          >
                            <span className="text-xs font-medium text-[#f8fafc] font-sans group-hover:text-[#00d2ee] transition">
                              {qp.title}
                            </span>
                            <div className="flex items-center justify-between text-[11px] text-[#94a3b8] font-sans">
                              <span className="truncate pr-1">Tanyakan langsung</span>
                              <ArrowRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-[#00d2ee] group-hover:translate-x-0.5 transition shrink-0" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Detected Anomalies List */}
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-mono font-medium text-[#f8fafc] uppercase tracking-wider">
                      Daftar Temuan Anomali &amp; Outlier
                    </h4>
                    {healthProfile.anomalies.length === 0 ? (
                      <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/30 text-xs text-emerald-300 flex items-center gap-2.5 font-sans">
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Data sangat bersih! Tidak ditemukan duplikasi baris, data kosong signifikan, atau nilai pencilan ekstrem.</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {healthProfile.anomalies.map((anom) => {
                          const isCrit = anom.severity === 'critical';
                          const isWarn = anom.severity === 'warning';
                          return (
                            <div
                              key={anom.anomaly_id}
                              className={`p-3 rounded-xl border flex items-start gap-3 ${
                                isCrit
                                  ? 'bg-rose-950/30 border-rose-800/40 text-rose-200'
                                  : isWarn
                                  ? 'bg-amber-950/30 border-amber-800/40 text-amber-200'
                                  : 'bg-[#14223b] border-[#1e3557] text-[#94a3b8]'
                              }`}
                            >
                              <div className="mt-0.5 shrink-0">
                                {isCrit ? (
                                  <AlertOctagon className="w-4 h-4 text-rose-400" />
                                ) : isWarn ? (
                                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                                ) : (
                                  <Info className="w-4 h-4 text-[#00d2ee]" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0 space-y-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-semibold text-[#f8fafc] font-sans">
                                    {anom.title}
                                  </span>
                                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded uppercase ${
                                    isCrit ? 'bg-rose-500/20 text-rose-300' : isWarn ? 'bg-amber-500/20 text-amber-300' : 'bg-cyan-500/20 text-cyan-300'
                                  }`}>
                                    {anom.severity}
                                  </span>
                                </div>
                                <p className="text-xs leading-relaxed font-sans opacity-90">
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
                  <div className="space-y-2">
                    <h4 className="text-xs font-mono font-medium text-[#f8fafc] uppercase tracking-wider">
                      Ringkasan Kelengkapan Kolom
                    </h4>
                    <div className="rounded-xl border border-white/[0.06] overflow-hidden bg-[#0b1322]">
                      <table className="w-full text-left text-xs font-mono">
                        <thead>
                          <tr className="border-b border-white/[0.04] bg-[#14223b] text-[#94a3b8]">
                            <th scope="col" className="py-2 px-3">Kolom</th>
                            <th scope="col" className="py-2 px-3">Tipe</th>
                            <th scope="col" className="py-2 px-3">Kelengkapan</th>
                            <th scope="col" className="py-2 px-3">Outlier / Nilai Unik</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.03]">
                          {healthProfile.column_profiles.map((cp) => (
                            <tr key={cp.column_name} className="hover:bg-[#14223b]/60 transition">
                              <td className="py-2 px-3 font-semibold text-[#f8fafc]">
                                {cp.column_name}
                              </td>
                              <td className="py-2 px-3 text-[#94a3b8] text-[11px]">
                                {cp.data_type}
                              </td>
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 bg-[#1e3557] h-1.5 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        cp.null_rate_pct === 0
                                          ? 'bg-emerald-400'
                                          : cp.null_rate_pct < 20
                                          ? 'bg-amber-400'
                                          : 'bg-rose-400'
                                      }`}
                                      style={{ width: `${100 - cp.null_rate_pct}%` }}
                                    />
                                  </div>
                                  <span className="text-[11px] font-mono text-[#f8fafc]">
                                    {cp.null_count > 0 ? `${cp.null_count} NULL` : '100%'}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-3 text-[11px]">
                                {cp.outlier_count > 0 ? (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono">
                                    {cp.outlier_count} outlier ({cp.outlier_rate_pct}%)
                                  </span>
                                ) : cp.is_unique ? (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
                                    100% Unik
                                  </span>
                                ) : (
                                  <span className="text-[#94a3b8] font-mono">
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
            /* TAB 2: SCHEMA & SAMPLE COLUMNS (EXISTING) */
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-mono font-medium text-[#f8fafc] uppercase tracking-wider mb-2.5">
                  Struktur Kolom &amp; Tipe Data
                </h4>
                <div className="rounded-xl border border-white/[0.06] overflow-hidden bg-[#0b1322]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-white/[0.04] bg-[#14223b] text-[#94a3b8]">
                        <th scope="col" className="py-2.5 px-3.5 font-medium">Nama Kolom</th>
                        <th scope="col" className="py-2.5 px-3.5 font-medium">Tipe PostgreSQL</th>
                        <th scope="col" className="py-2.5 px-3.5 font-medium">Contoh Nilai</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {table.columns.map((col) => (
                        <tr key={col.name} className="hover:bg-[#14223b]/70 transition">
                          <td className="py-2 px-3.5 font-semibold text-[#f8fafc]">
                            {col.name}
                          </td>
                          <td className="py-2 px-3.5">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-[#14223b] text-[#00d2ee]">
                              {col.data_type}
                            </span>
                          </td>
                          <td className="py-2 px-3.5 text-[#94a3b8] truncate max-w-[200px]" title={col.sample_values?.join(', ')}>
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
                <h4 className="text-xs font-mono font-medium text-[#f8fafc] uppercase tracking-wider mb-2">
                  Contoh Pertanyaan Cepat
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleAction(`Tampilkan 5 baris pertama dari tabel ${qualifiedName} dalam bentuk tabel`)
                    }
                    className="group flex items-center justify-between p-2.5 rounded-xl bg-[#111e33] hover:bg-[#14223b] transition text-left cursor-pointer shadow-sm"
                  >
                    <span className="text-xs text-[#94a3b8] group-hover:text-[#f8fafc] font-sans">
                      Lihat 5 sampel data pertama
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-[#00d2ee] shrink-0 ml-2 transition" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleAction(`Hitung ringkasan statistik (jumlah, rata-rata, nilai min dan max) untuk tabel ${qualifiedName}`)
                    }
                    className="group flex items-center justify-between p-2.5 rounded-xl bg-[#111e33] hover:bg-[#14223b] transition text-left cursor-pointer shadow-sm"
                  >
                    <span className="text-xs text-[#94a3b8] group-hover:text-[#f8fafc] font-sans">
                      Hitung ringkasan statistik kolom
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-[#00d2ee] shrink-0 ml-2 transition" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleAction(`Bandingkan dan gabungkan data dari tabel ${qualifiedName} dengan data pesanan di tabel orders`)
                    }
                    className="group flex items-center justify-between p-2.5 rounded-xl bg-[#111e33] hover:bg-[#14223b] transition text-left cursor-pointer sm:col-span-2 shadow-sm"
                  >
                    <span className="text-xs text-[#94a3b8] group-hover:text-[#f8fafc] font-sans">
                      Cross-Join: Gabungkan data ini dengan data transaksi pesanan (orders)
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-[#00d2ee] shrink-0 ml-2 transition" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-white/[0.04] bg-[#0b1526]">
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
                className="px-2 py-1 rounded-lg text-xs text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
              >
                Batal
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-300 hover:text-rose-200 bg-rose-950/30 hover:bg-rose-900/40 transition cursor-pointer shadow-sm"
              title="Hapus dataset ini dari database sesi"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Hapus Dataset</span>
            </button>
          )}

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-[#94a3b8] hidden sm:inline">
              <strong className="text-[#f8fafc]">{table.row_count.toLocaleString()}</strong> baris •{' '}
              <strong className="text-[#f8fafc]">{table.columns.length}</strong> kolom
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[#94a3b8] bg-[#14223b] hover:bg-[#182a47] hover:text-[#f8fafc] transition cursor-pointer shadow-sm"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

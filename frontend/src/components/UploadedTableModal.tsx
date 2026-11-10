import React, { useEffect, useState } from 'react';
import {
  Table,
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
import { Modal, Button, Badge, Card, Tabs } from './ui';

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

  if (!isOpen || !table) return null;

  const qualifiedName = `analytics.${table.table_name}`;

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
          badgeVariant: 'success' as const,
          scoreText: 'text-emerald-400',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />,
        };
      case 'Perhatian':
        return {
          badgeVariant: 'warning' as const,
          scoreText: 'text-amber-400',
          icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
        };
      case 'Kritis':
      default:
        return {
          badgeVariant: 'danger' as const,
          scoreText: 'text-rose-400',
          icon: <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0" />,
        };
    }
  };

  const scoreTheme = healthProfile ? getScoreTheme(healthProfile.health_grade) : null;

  const tabs = [
    {
      id: 'health',
      label: 'Kesehatan Data & Audit',
      icon: <Activity className="w-3.5 h-3.5" />,
      count: healthProfile ? healthProfile.health_score : undefined,
    },
    {
      id: 'schema',
      label: 'Struktur Kolom',
      icon: <Table className="w-3.5 h-3.5" />,
      count: table.columns.length,
    },
  ];

  const modalFooter = (
    <div className="flex flex-wrap items-center justify-between gap-3 w-full">
      {confirmDelete ? (
        <div className="flex items-center gap-2 bg-rose-500/15 px-3 py-1.5 rounded-xl border border-rose-500/20">
          <span className="text-xs text-rose-300 font-sans font-medium">Hapus dataset ini dari sesi?</span>
          <Button
            variant="danger"
            size="xs"
            isLoading={isDeleting}
            onClick={handleDeleteTable}
          >
            Ya, Hapus
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setConfirmDelete(false)}
          >
            Batal
          </Button>
        </div>
      ) : (
        <Button
          variant="danger"
          size="sm"
          leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          onClick={() => setConfirmDelete(true)}
          title="Hapus dataset ini dari database sesi"
        >
          Hapus Dataset
        </Button>
      )}

      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-slate-400 hidden sm:inline">
          <strong className="text-slate-200">{table.row_count.toLocaleString()}</strong> baris •{' '}
          <strong className="text-slate-200">{table.columns.length}</strong> kolom
        </span>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Tutup
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      title={table.original_filename}
      description={`Tabel analitik: ${qualifiedName}`}
      icon={<FileSpreadsheet className="w-5 h-5 text-sky-400" />}
      badge={
        table.sheet_name ? (
          <Badge variant="neutral" size="xs">
            Sheet: {table.sheet_name}
          </Badge>
        ) : undefined
      }
      footer={modalFooter}
    >
      <div className="space-y-5">
        {/* Subheader & Tabs */}
        <div className="-mt-2 -mx-6 px-6 py-2.5 bg-[#0b1526]/50 border-b border-white/[0.04] flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={tabs}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as 'health' | 'schema')}
          />

          <Button
            variant="secondary"
            size="xs"
            leftIcon={copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            onClick={handleCopyName}
            title="Salin nama tabel SQL lengkap"
          >
            {copied ? 'Tersalin' : 'Salin Nama'}
          </Button>
        </div>

        {/* Tab 1: Health & Audit */}
        {activeTab === 'health' ? (
          <div className="space-y-5">
            {isHealthLoading ? (
              <div className="py-12 text-center space-y-3">
                <RefreshCw className="w-5 h-5 animate-spin text-sky-400 mx-auto" />
                <p className="text-xs text-slate-400 font-mono">
                  Memindai kelengkapan data, duplikasi, dan pencilan statistik (IQR)...
                </p>
              </div>
            ) : isHealthError || !healthProfile ? (
              <Card variant="default" padding="md" className="text-center space-y-2">
                <p className="text-xs text-rose-300">Gagal memuat metrik profil kesehatan data.</p>
                <Button variant="secondary" size="xs" onClick={() => refetchHealth()}>
                  Coba Lagi
                </Button>
              </Card>
            ) : (
              <>
                {/* Health Score Summary Card */}
                <Card variant="surface" padding="md" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700/60 text-slate-300 shrink-0">
                      {scoreTheme?.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                          Skor Kesehatan Data
                        </span>
                        {scoreTheme && (
                          <Badge variant={scoreTheme.badgeVariant} size="xs" dot>
                            Status {healthProfile.health_grade}
                          </Badge>
                        )}
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
                </Card>

                {/* 4 Summary Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <Card variant="default" padding="sm" className="space-y-1.5">
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
                  </Card>

                  <Card variant="default" padding="sm" className="space-y-1.5">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wide">Total Baris</span>
                    <div className="text-sm font-semibold font-mono text-slate-200">
                      {healthProfile.total_rows.toLocaleString()}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {healthProfile.total_columns} kolom
                    </span>
                  </Card>

                  <Card variant="default" padding="sm" className="space-y-1.5">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wide">Baris Duplikat</span>
                    <div className={`text-sm font-semibold font-mono ${healthProfile.duplicate_rows > 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                      {healthProfile.duplicate_rows.toLocaleString()}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {healthProfile.duplicate_rate_pct}% duplikasi
                    </span>
                  </Card>

                  <Card variant="default" padding="sm" className="space-y-1.5">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wide">Anomali Terdeteksi</span>
                    <div className={`text-sm font-semibold font-mono ${healthProfile.anomalies.length > 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                      {healthProfile.anomalies.length} Temuan
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {healthProfile.anomalies.filter((a) => a.severity === 'critical').length} Kritis
                    </span>
                  </Card>
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
                        <Card
                          key={qp.id}
                          variant="surface"
                          padding="sm"
                          isInteractive
                          onClick={() => handleAction(qp.prompt)}
                          className="flex flex-col justify-between gap-2.5 text-left group"
                        >
                          <span className="text-xs font-medium text-slate-200 font-sans group-hover:text-sky-300 transition line-clamp-2">
                            {qp.title}
                          </span>
                          <div className="flex items-center justify-between text-[11px] text-slate-400 font-sans">
                            <span>Ajukan pertanyaan</span>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 group-hover:translate-x-0.5 transition shrink-0" />
                          </div>
                        </Card>
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
                    <Card variant="surface" padding="md" className="text-xs text-slate-300 flex items-center gap-2.5 font-sans">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Data bersih. Tidak ditemukan duplikasi baris, nilai kosong signifikan, atau outlier ekstrem.</span>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {healthProfile.anomalies.map((anom) => {
                        const isCrit = anom.severity === 'critical';
                        const isWarn = anom.severity === 'warning';
                        return (
                          <Card
                            key={anom.anomaly_id}
                            variant="surface"
                            padding="sm"
                            className="flex items-start gap-3"
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
                                <Badge
                                  variant={isCrit ? 'danger' : isWarn ? 'warning' : 'neutral'}
                                  size="xs"
                                >
                                  {anom.severity}
                                </Badge>
                              </div>
                              <p className="text-xs leading-relaxed font-sans text-slate-400">
                                {anom.description}
                              </p>
                            </div>
                          </Card>
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
                                <Badge variant="warning" size="xs">
                                  {cp.outlier_count} outlier ({cp.outlier_rate_pct}%)
                                </Badge>
                              ) : cp.is_unique ? (
                                <Badge variant="success" size="xs">
                                  100% Unik
                                </Badge>
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
          /* Tab 2: Schema & Sample Columns */
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
                          <Badge variant="neutral" size="xs">
                            {col.data_type}
                          </Badge>
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
                <Card
                  variant="surface"
                  padding="sm"
                  isInteractive
                  onClick={() =>
                    handleAction(`Tampilkan 5 baris pertama dari tabel ${qualifiedName} dalam bentuk tabel`)
                  }
                  className="flex items-center justify-between text-left group"
                >
                  <span className="text-xs text-slate-300 group-hover:text-slate-100 font-sans">
                    Lihat 5 sampel data pertama
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 ml-2 transition" />
                </Card>

                <Card
                  variant="surface"
                  padding="sm"
                  isInteractive
                  onClick={() =>
                    handleAction(`Hitung ringkasan statistik (jumlah, rata-rata, nilai min dan max) untuk tabel ${qualifiedName}`)
                  }
                  className="flex items-center justify-between text-left group"
                >
                  <span className="text-xs text-slate-300 group-hover:text-slate-100 font-sans">
                    Hitung ringkasan statistik kolom
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 ml-2 transition" />
                </Card>

                <Card
                  variant="surface"
                  padding="sm"
                  isInteractive
                  onClick={() =>
                    handleAction(`Bandingkan dan gabungkan data dari tabel ${qualifiedName} dengan data pesanan di tabel orders`)
                  }
                  className="flex items-center justify-between text-left group sm:col-span-2"
                >
                  <span className="text-xs text-slate-300 group-hover:text-slate-100 font-sans">
                    Cross-Join: Gabungkan data ini dengan data transaksi pesanan (orders)
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 ml-2 transition" />
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

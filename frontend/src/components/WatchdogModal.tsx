import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldAlert,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Clock,
  BrainCircuit,
  Send,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  useWatchdogRulesQuery,
  useWatchdogLogsQuery,
  useCreateWatchdogRuleMutation,
  useUpdateWatchdogRuleMutation,
  useDeleteWatchdogRuleMutation,
  useRunWatchdogRuleMutation,
} from '../hooks/useQueries';
import { WatchdogRule } from '../types';

interface WatchdogModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (msg: string) => void;
}

export const WatchdogModal: React.FC<WatchdogModalProps> = ({
  isOpen,
  onClose,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'logs'>('rules');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<WatchdogRule | null>(null);

  // Form State
  const [ruleName, setRuleName] = useState('');
  const [description, setDescription] = useState('');
  const [sqlQuery, setSqlQuery] = useState('');
  const [targetColumn, setTargetColumn] = useState('');
  const [operator, setOperator] = useState('>');
  const [thresholdValue, setThresholdValue] = useState<number>(0);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(60);
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [channelType, setChannelType] = useState('slack');
  const [aiDiagnosisEnabled, setAiDiagnosisEnabled] = useState(true);

  // Queries & Mutations
  const { data: rulesData, isLoading: isLoadingRules, refetch: refetchRules } = useWatchdogRulesQuery();
  const { data: logsData, isLoading: isLoadingLogs, refetch: refetchLogs } = useWatchdogLogsQuery(50);
  const createMutation = useCreateWatchdogRuleMutation();
  const updateMutation = useUpdateWatchdogRuleMutation();
  const deleteMutation = useDeleteWatchdogRuleMutation();
  const runMutation = useRunWatchdogRuleMutation();

  // Escape key closes modal & form (Antislop R-32 Keyboard Accessibility)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (ruleToDelete) {
          setRuleToDelete(null);
        } else if (isFormOpen) {
          setIsFormOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isFormOpen, ruleToDelete]);

  if (!isOpen) return null;

  const rules = rulesData?.rules || [];
  const logs = logsData?.logs || [];
  const triggeredCount = rules.filter((r) => r.last_status === 'triggered').length;

  const handleOpenCreate = () => {
    setEditingRuleId(null);
    setRuleName('');
    setDescription('');
    setSqlQuery('SELECT ROUND((COUNT(*) FILTER (WHERE order_status IN (\'canceled\', \'unavailable\'))::NUMERIC / NULLIF(COUNT(*), 0)) * 100, 2) AS canceled_pct FROM analytics.orders;');
    setTargetColumn('canceled_pct');
    setOperator('>');
    setThresholdValue(3.5);
    setIntervalMinutes(60);
    setSeverity('warning');
    setWebhookUrl('');
    setChannelType('slack');
    setAiDiagnosisEnabled(true);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (rule: WatchdogRule) => {
    setEditingRuleId(rule.id);
    setRuleName(rule.rule_name);
    setDescription(rule.description || '');
    setSqlQuery(rule.sql_query);
    setTargetColumn(rule.target_column);
    setOperator(rule.operator);
    setThresholdValue(rule.threshold_value);
    setIntervalMinutes(rule.cron_interval_minutes);
    setSeverity(rule.severity);
    setWebhookUrl(rule.webhook_url || '');
    setChannelType(rule.channel_type || 'slack');
    setAiDiagnosisEnabled(rule.ai_diagnosis_enabled);
    setIsFormOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim() || !sqlQuery.trim() || !targetColumn.trim()) {
      showToast?.('Nama aturan, SQL, dan kolom target wajib diisi');
      return;
    }

    const payload: Partial<WatchdogRule> = {
      rule_name: ruleName.trim(),
      description: description.trim() || undefined,
      sql_query: sqlQuery.trim(),
      target_column: targetColumn.trim(),
      operator,
      threshold_value: Number(thresholdValue),
      cron_interval_minutes: Number(intervalMinutes),
      severity,
      webhook_url: webhookUrl.trim() || undefined,
      channel_type: channelType,
      ai_diagnosis_enabled: aiDiagnosisEnabled,
    };

    try {
      if (editingRuleId) {
        await updateMutation.mutateAsync({ ruleId: editingRuleId, rule: payload });
        showToast?.(`Aturan #${editingRuleId} berhasil diperbarui`);
      } else {
        await createMutation.mutateAsync(payload);
        showToast?.('Aturan pemantauan watchdog baru berhasil dibuat');
      }
      setIsFormOpen(false);
    } catch (err: any) {
      showToast?.(`Error: ${err.message}`);
    }
  };

  const handleToggleEnable = async (rule: WatchdogRule) => {
    try {
      await updateMutation.mutateAsync({
        ruleId: rule.id,
        rule: { enabled: !rule.enabled },
      });
      showToast?.(`Aturan #${rule.id} sekarang ${!rule.enabled ? 'diaktifkan' : 'dinonaktifkan'}`);
    } catch (err: any) {
      showToast?.(`Gagal mengubah status aturan: ${err.message}`);
    }
  };

  const handleRunRule = async (ruleId: number) => {
    try {
      showToast?.(`Menjalankan evaluasi aturan #${ruleId}...`);
      const res = await runMutation.mutateAsync(ruleId);
      const isTrig = res.result.is_triggered;
      showToast?.(
        isTrig
          ? `Alert terpicu! Nilai ${res.result.metric_value} memenuhi ambang batas`
          : `Kondisi aman (Nilai: ${res.result.metric_value})`
      );
    } catch (err: any) {
      showToast?.(`Gagal mengeksekusi watchdog: ${err.message}`);
    }
  };

  const handleConfirmDelete = async () => {
    if (!ruleToDelete) return;
    const id = ruleToDelete.id;
    setRuleToDelete(null);
    try {
      await deleteMutation.mutateAsync(id);
      showToast?.(`Aturan #${id} berhasil dihapus`);
    } catch (err: any) {
      showToast?.(`Gagal menghapus aturan: ${err.message}`);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
            <CheckCircle2 className="w-3 h-3" />
            Normal
          </span>
        );
      case 'triggered':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 font-mono">
            <AlertOctagon className="w-3 h-3 text-rose-400" />
            Terpicu
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700/80 text-slate-300 border border-slate-600 font-mono">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Error
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
            <Clock className="w-3 h-3" />
            Menunggu
          </span>
        );
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'critical':
        return <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">Kritis</span>;
      case 'warning':
        return <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Peringatan</span>;
      default:
        return <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">Informasi</span>;
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0c1424] border border-white/[0.08] shadow-2xl overflow-hidden font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#0f1a2e] gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/25 text-rose-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base font-semibold text-white tracking-tight">
                  Metric Watchdog & Anomaly Alerting
                </h2>
                {triggeredCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    {triggeredCount} Anomali Terpicu
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                    Semua Normal
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                Evaluasi otomatis ambang batas SQL analitik & integrasi webhook eksternal
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup jendela watchdog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer shrink-0"
            title="Tutup (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher & Actions Bar */}
        <div className="flex items-center justify-between px-6 py-2.5 border-b border-white/[0.06] bg-[#0b1424]">
          <div className="flex items-center bg-[#14223b]/90 border border-white/[0.08] rounded-lg p-0.5 text-xs">
            <button
              type="button"
              onClick={() => { setActiveTab('rules'); setIsFormOpen(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-sans transition cursor-pointer ${activeTab === 'rules'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30 font-medium'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
            >
              <span>Aturan Pemantauan</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/30 text-slate-300 font-semibold">
                {rules.length}
              </span>
            </button>
            <div className="h-3 w-px bg-white/[0.08]" />
            <button
              type="button"
              onClick={() => { setActiveTab('logs'); setIsFormOpen(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-sans transition cursor-pointer ${activeTab === 'logs'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30 font-medium'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
            >
              <span>Riwayat Log & Alert</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/30 text-slate-300 font-semibold">
                {logs.length}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (activeTab === 'rules' ? refetchRules() : refetchLogs())}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer"
              title="Segarkan data"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {activeTab === 'rules' && !isFormOpen && (
              <button
                type="button"
                onClick={handleOpenCreate}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-clay-600 hover:bg-clay-500 text-white text-xs font-medium transition cursor-pointer shadow-sm active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Aturan</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Form Drawer: Tambah / Edit Rule */}
          {isFormOpen && (
            <form onSubmit={handleSaveRule} className="p-5 rounded-2xl border border-white/[0.08] bg-[#14223b]/90 space-y-4 shadow-lg mb-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <span className="text-sm font-semibold text-white">
                    {editingRuleId ? `Edit Aturan #${editingRuleId}` : 'Konfigurasi Aturan Watchdog Baru'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer px-2 py-1 rounded hover:bg-white/[0.06] transition"
                >
                  Batal
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Nama Aturan
                  </label>
                  <input
                    type="text"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="Contoh: Tingkat Pembatalan Pesanan Tinggi"
                    className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Tingkat Keparahan (Severity)
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-400 transition cursor-pointer"
                  >
                    <option value="info">Informasi (Info)</option>
                    <option value="warning">Peringatan (Warning)</option>
                    <option value="critical">Kritis (Critical)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Deskripsi / Konteks Bisnis
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Penjelasan latar belakang atau target operasional yang dipantau"
                  className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400 transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Query SQL Analitik
                </label>
                <textarea
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  rows={3}
                  placeholder="SELECT ... AS target_column FROM analytics.orders..."
                  className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-400 transition"
                  required
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Kolom Target
                  </label>
                  <input
                    type="text"
                    value={targetColumn}
                    onChange={(e) => setTargetColumn(e.target.value)}
                    placeholder="Contoh: late_pct"
                    className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Operator
                  </label>
                  <select
                    value={operator}
                    onChange={(e) => setOperator(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-sky-400 transition cursor-pointer"
                  >
                    <option value=">">&gt; (Lebih Dari)</option>
                    <option value=">=">&gt;= (Lebih Dari / Sama)</option>
                    <option value="<">&lt; (Kurang Dari)</option>
                    <option value="<=">&lt;= (Kurang Dari / Sama)</option>
                    <option value="==">== (Sama Dengan)</option>
                    <option value="!=">!= (Tidak Sama Dengan)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Nilai Ambang (Threshold)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={thresholdValue}
                    onChange={(e) => setThresholdValue(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-sky-400 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Interval Evaluasi
                  </label>
                  <select
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-400 transition cursor-pointer"
                  >
                    <option value="15">Setiap 15 Menit</option>
                    <option value="30">Setiap 30 Menit</option>
                    <option value="60">Setiap 1 Jam</option>
                    <option value="120">Setiap 2 Jam</option>
                    <option value="360">Setiap 6 Jam</option>
                    <option value="1440">Setiap 24 Jam</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.04]">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Webhook Alert URL (Opsional)
                  </label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/... atau Discord Webhook"
                    className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400 transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Format Kanal Webhook
                  </label>
                  <select
                    value={channelType}
                    onChange={(e) => setChannelType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#080f1d] border border-white/[0.08] text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-400 transition cursor-pointer"
                  >
                    <option value="slack">Slack Blocks Format</option>
                    <option value="discord">Discord Embeds Format</option>
                    <option value="generic">Generic JSON Webhook</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={aiDiagnosisEnabled}
                    onChange={(e) => setAiDiagnosisEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-500 bg-[#080f1d] border-white/[0.2] focus:ring-sky-500 cursor-pointer"
                  />
                  <span className="text-xs text-slate-300 flex items-center gap-1.5 font-sans">
                    <BrainCircuit className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>Aktifkan diagnosis otomatis akar penyebab masalah saat anomali terpicu</span>
                  </span>
                </label>

                <div className="flex items-center justify-end gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-3.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="px-4 py-1.5 rounded-xl bg-clay-600 hover:bg-clay-500 text-white text-xs font-medium transition cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {editingRuleId ? 'Perbarui Aturan' : 'Simpan Aturan'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* TAB 1: Rules List */}
          {activeTab === 'rules' && (
            <div className="space-y-3">
              {isLoadingRules ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  Memuat aturan pemantauan watchdog...
                </div>
              ) : rules.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-white/[0.06] rounded-xl text-slate-400 text-xs">
                  Belum ada aturan watchdog yang terdaftar. Klik &quot;Tambah Aturan&quot; untuk memulai.
                </div>
              ) : (
                rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-4 rounded-xl border border-white/[0.06] bg-[#0f1a2e] hover:border-white/[0.12] transition space-y-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white truncate">
                            {rule.rule_name}
                          </span>
                          {getSeverityBadge(rule.severity)}
                          {getStatusBadge(rule.last_status)}
                          {!rule.enabled && (
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                              Nonaktif
                            </span>
                          )}
                        </div>
                        {rule.description && (
                          <p className="text-xs text-slate-400 leading-relaxed">{rule.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRunRule(rule.id)}
                          disabled={runMutation.isPending}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 transition cursor-pointer disabled:opacity-50"
                          title="Jalankan evaluasi aturan ini sekarang"
                        >
                          <Play className="w-3 h-3 text-sky-400 fill-sky-400" />
                          <span>Uji Sekarang</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleEnable(rule)}
                          className={`px-2.5 py-1 text-xs rounded-lg border transition cursor-pointer ${rule.enabled
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                            }`}
                          title={rule.enabled ? 'Nonaktifkan aturan' : 'Aktifkan aturan'}
                        >
                          {rule.enabled ? 'Aktif' : 'Mati'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(rule)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05] transition cursor-pointer"
                          title="Edit aturan"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRuleToDelete(rule)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                          title="Hapus aturan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Rule Condition & Metadata Bar */}
                    <div className="flex items-center gap-4 text-xs bg-[#080f1d] px-3 py-2 rounded-lg border border-white/[0.04] text-slate-300 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Kondisi:</span>
                        <code className="font-mono text-sky-300 font-medium">
                          {rule.target_column} {rule.operator} {rule.threshold_value}
                        </code>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Nilai Terakhir:</span>
                        <span className={`font-mono font-medium ${rule.last_status === 'triggered' ? 'text-rose-400 font-bold' : 'text-slate-200'}`}>
                          {rule.last_metric_value !== null ? rule.last_metric_value : '-'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Interval:</span>
                        <span className="text-slate-300">{rule.cron_interval_minutes} menit</span>
                      </div>
                      {rule.webhook_url && (
                        <div className="flex items-center gap-1 text-slate-400" title={rule.webhook_url}>
                          <Send className="w-3 h-3 text-sky-400" />
                          <span className="text-[11px] uppercase font-mono">{rule.channel_type}</span>
                        </div>
                      )}
                      {rule.ai_diagnosis_enabled && (
                        <div className="flex items-center gap-1 text-sky-400 text-[11px]" title="Diagnosis Otomatis AI Aktif">
                          <BrainCircuit className="w-3 h-3" />
                          <span>AI Diagnosis</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 2: Execution Logs List */}
          {activeTab === 'logs' && (
            <div className="space-y-3">
              {isLoadingLogs ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  Memuat riwayat log eksekusi watchdog...
                </div>
              ) : logs.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-white/[0.06] rounded-xl text-slate-400 text-xs">
                  Belum ada log eksekusi. Jalankan uji aturan di tab Aturan Pemantauan.
                </div>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <div
                      key={log.id}
                      className="rounded-xl border border-white/[0.06] bg-[#0f1a2e] overflow-hidden transition shadow-sm"
                    >
                      <div
                        className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] cursor-pointer"
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      >
                        <div className="flex items-center gap-3">
                          {getStatusBadge(log.status)}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-white">
                                {log.rule_name || `Aturan #${log.rule_id}`}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {log.created_at ? new Date(log.created_at).toLocaleString('id-ID') : '-'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                              <span>Nilai Metrik: <strong className="text-slate-200 font-mono">{log.metric_value !== null ? log.metric_value : '-'}</strong></span>
                              <span>(Ambang: <code className="text-slate-300 font-mono">{log.operator} {log.threshold_value}</code>)</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {log.webhook_sent && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Webhook Terkirim (HTTP {log.webhook_response_code})
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                      </div>

                      {/* Expandable Details: AI Diagnosis & Errors */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t border-white/[0.04] bg-[#080f1d] space-y-3 text-xs">
                          {log.ai_diagnosis_summary && (
                            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-slate-200 space-y-1.5">
                              <div className="flex items-center gap-1.5 text-sky-300 font-medium text-[11px]">
                                <BrainCircuit className="w-3.5 h-3.5 text-sky-400" />
                                <span>Diagnosis & Analisis Akar Masalah Harmonix</span>
                              </div>
                              <p className="whitespace-pre-line text-xs text-slate-300 leading-relaxed font-sans">
                                {log.ai_diagnosis_summary}
                              </p>
                            </div>
                          )}

                          {log.error_message && (
                            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                              <strong>Error:</strong> {log.error_message}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.06] bg-[#0f1a2e] text-xs text-slate-400">
          <span>Harmonix Autonomous Background Scheduler berjalan aktif di latar belakang server.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#14223b] hover:bg-slate-700 text-white font-medium transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Custom Destructive Confirmation Dialog for Deleting Rule */}
      {ruleToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="w-full max-w-sm bg-[#0f1b2d] border border-rose-900/40 rounded-2xl shadow-2xl p-5 space-y-3">
            <div className="flex items-center gap-2.5 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-semibold text-slate-100 font-sans">
                Hapus Aturan Watchdog?
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              Aturan <strong>&quot;{ruleToDelete.rule_name}&quot;</strong> (ID #{ruleToDelete.id}) beserta seluruh riwayat log eksekusinya akan dihapus permanen dari sistem.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => setRuleToDelete(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition cursor-pointer shadow-sm"
              >
                Ya, Hapus Aturan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

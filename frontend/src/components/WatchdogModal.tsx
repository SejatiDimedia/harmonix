import React, { useState } from 'react';
import {
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
import { Modal, Button, Badge, Input, Select, Textarea, Card, Tabs } from './ui';

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

  const rules = rulesData?.rules || [];
  const logs = logsData?.logs || [];
  const triggeredCount = rules.filter((r) => r.last_status === 'triggered').length;
  const activeCount = rules.filter((r) => r.enabled).length;

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
    try {
      await deleteMutation.mutateAsync(id);
      showToast?.(`Aturan #${id} berhasil dihapus`);
      setRuleToDelete(null);
    } catch (err: any) {
      showToast?.(`Gagal menghapus aturan: ${err.message}`);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return (
          <Badge variant="success" icon={<CheckCircle2 className="w-3 h-3" />}>
            Normal
          </Badge>
        );
      case 'triggered':
        return (
          <Badge variant="danger" pulse icon={<AlertOctagon className="w-3 h-3" />}>
            Terpicu
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="neutral" icon={<AlertTriangle className="w-3 h-3" />}>
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="warning" icon={<Clock className="w-3 h-3" />}>
            Menunggu
          </Badge>
        );
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'critical':
        return <Badge variant="danger">Kritis</Badge>;
      case 'warning':
        return <Badge variant="warning">Peringatan</Badge>;
      default:
        return <Badge variant="info">Informasi</Badge>;
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="4xl"
        icon={<ShieldAlert className="w-5 h-5 text-rose-400" />}
        title="Metric Watchdog & Anomaly Alerting"
        subtitle="Pemantau otomatis metrik gudang data dengan diagnosis akar masalah AI & webhook integrasi"
        footer={
          <>
            <span>Harmonix Autonomous Background Scheduler berjalan aktif di latar belakang server.</span>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Tutup
            </Button>
          </>
        }
      >
        {/* Metric Summary Cards */}
        <div className="grid grid-cols-4 gap-3">
          <Card variant="dark" className="p-3">
            <span className="text-[11px] text-slate-400">Total Aturan</span>
            <div className="text-lg font-bold text-white mt-0.5">{rules.length}</div>
          </Card>
          <Card variant="dark" className="p-3">
            <span className="text-[11px] text-slate-400">Aturan Aktif</span>
            <div className="text-lg font-bold text-sky-400 mt-0.5">{activeCount}</div>
          </Card>
          <Card variant="dark" className="p-3">
            <span className="text-[11px] text-slate-400">Anomali Terpicu</span>
            <div className={`text-lg font-bold mt-0.5 ${triggeredCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
              {triggeredCount}
            </div>
          </Card>
          <Card variant="dark" className="p-3">
            <span className="text-[11px] text-slate-400">Total Log Eksekusi</span>
            <div className="text-lg font-bold text-emerald-400 mt-0.5">{logs.length}</div>
          </Card>
        </div>

        {/* Tab Switcher & Header Actions */}
        <div className="flex items-center justify-between pt-1">
          <Tabs
            tabs={[
              { id: 'rules', label: 'Aturan Pemantauan', count: rules.length },
              { id: 'logs', label: 'Riwayat Log & Alert', count: logs.length },
            ]}
            activeTab={activeTab}
            onChange={(tabId) => {
              setActiveTab(tabId);
              setIsFormOpen(false);
            }}
          />

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (activeTab === 'rules' ? refetchRules() : refetchLogs())}
              title="Segarkan data"
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            />
            {activeTab === 'rules' && !isFormOpen && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenCreate}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Tambah Aturan
              </Button>
            )}
          </div>
        </div>

        {/* Form Drawer: Tambah / Edit Rule */}
        {isFormOpen && (
          <form onSubmit={handleSaveRule} className="p-5 rounded-xl border border-white/[0.08] bg-[#0f1d36] space-y-4 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span className="text-sm font-semibold text-white">
                  {editingRuleId ? `Edit Aturan #${editingRuleId}` : 'Konfigurasi Aturan Watchdog Baru'}
                </span>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setIsFormOpen(false)}>
                Batal
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Nama Aturan"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Contoh: Tingkat Pembatalan Pesanan Tinggi"
                required
              />
              <Select
                label="Tingkat Keparahan (Severity)"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as any)}
                options={[
                  { value: 'info', label: 'Informasi (Info)' },
                  { value: 'warning', label: 'Peringatan (Warning)' },
                  { value: 'critical', label: 'Kritis (Critical)' },
                ]}
              />
            </div>

            <Input
              label="Deskripsi / Konteks Bisnis"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Penjelasan latar belakang atau target operasional yang dipantau"
            />

            <Textarea
              label="Query SQL Analitik"
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              rows={3}
              isMonospace
              placeholder="SELECT ... AS target_column FROM analytics.orders..."
              required
            />

            <div className="grid grid-cols-4 gap-3">
              <Input
                label="Kolom Target"
                value={targetColumn}
                onChange={(e) => setTargetColumn(e.target.value)}
                placeholder="Contoh: late_pct"
                isMonospace
                required
              />
              <Select
                label="Operator"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                isMonospace
                options={[
                  { value: '>', label: '> (Lebih Dari)' },
                  { value: '>=', label: '>= (Lebih Dari / Sama)' },
                  { value: '<', label: '< (Kurang Dari)' },
                  { value: '<=', label: '<= (Kurang Dari / Sama)' },
                  { value: '==', label: '== (Sama Dengan)' },
                  { value: '!=', label: '!= (Tidak Sama Dengan)' },
                ]}
              />
              <Input
                label="Nilai Ambang (Threshold)"
                type="number"
                step="any"
                value={thresholdValue}
                onChange={(e) => setThresholdValue(parseFloat(e.target.value) || 0)}
                isMonospace
                required
              />
              <Select
                label="Interval Pengecekan"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(parseInt(e.target.value, 10))}
                options={[
                  { value: 15, label: 'Setiap 15 Menit' },
                  { value: 30, label: 'Setiap 30 Menit' },
                  { value: 60, label: 'Setiap 1 Jam' },
                  { value: 120, label: 'Setiap 2 Jam' },
                  { value: 360, label: 'Setiap 6 Jam' },
                  { value: 1440, label: 'Setiap 24 Jam' },
                ]}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/[0.04]">
              <Input
                label="Webhook Alert URL (Opsional)"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/... atau Discord Webhook"
              />
              <Select
                label="Format Kanal Webhook"
                value={channelType}
                onChange={(e) => setChannelType(e.target.value)}
                options={[
                  { value: 'slack', label: 'Slack Blocks Format' },
                  { value: 'discord', label: 'Discord Embeds Format' },
                  { value: 'generic', label: 'Generic JSON Webhook' },
                ]}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={aiDiagnosisEnabled}
                  onChange={(e) => setAiDiagnosisEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-500 bg-[#0b1322] border-white/[0.2] focus:ring-sky-500"
                />
                <span className="text-xs text-slate-300 flex items-center gap-1.5">
                  <BrainCircuit className="w-3.5 h-3.5 text-sky-400" />
                  Aktifkan diagnosis otomatis akar penyebab masalah oleh Model AI saat anomali terpicu
                </span>
              </label>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setIsFormOpen(false)}>
                  Batal
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  isLoading={createMutation.isPending || updateMutation.isPending}
                >
                  {editingRuleId ? 'Perbarui Aturan' : 'Simpan Aturan'}
                </Button>
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
                <Card
                  key={rule.id}
                  variant="default"
                  className="p-4 hover:border-white/[0.12] transition space-y-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">
                          {rule.rule_name}
                        </span>
                        {getSeverityBadge(rule.severity)}
                        {getStatusBadge(rule.last_status)}
                        {!rule.enabled && <Badge variant="neutral">Nonaktif</Badge>}
                      </div>
                      {rule.description && (
                        <p className="text-xs text-slate-400">{rule.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleRunRule(rule.id)}
                        isLoading={runMutation.isPending}
                        leftIcon={<Play className="w-3 h-3 text-sky-400 fill-sky-400" />}
                        title="Jalankan evaluasi aturan ini sekarang"
                      >
                        Uji Sekarang
                      </Button>
                      <Button
                        variant={rule.enabled ? 'success' : 'secondary'}
                        size="xs"
                        onClick={() => handleToggleEnable(rule)}
                        title={rule.enabled ? 'Nonaktifkan aturan' : 'Aktifkan aturan'}
                      >
                        {rule.enabled ? 'Aktif' : 'Mati'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleOpenEdit(rule)}
                        title="Edit aturan"
                        leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                      />
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setRuleToDelete(rule)}
                        title="Hapus aturan"
                        className="text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      />
                    </div>
                  </div>

                  {/* Rule Condition & Metadata Bar */}
                  <div className="flex items-center gap-4 text-xs bg-[#0b1322] px-3 py-2 rounded-lg border border-white/[0.04] text-slate-300 flex-wrap font-sans">
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
                      <div className="flex items-center gap-1 text-sky-300 text-[11px] bg-sky-500/15 px-2 py-0.5 rounded-full" title="AI Diagnosis Otomatis Aktif">
                        <BrainCircuit className="w-3.5 h-3.5" />
                        <span>AI Diagnosis</span>
                      </div>
                    )}
                  </div>
                </Card>
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
                  <Card
                    key={log.id}
                    variant="default"
                    className="p-0 overflow-hidden"
                  >
                    <div
                      className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] cursor-pointer transition select-none"
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
                          <Badge variant="success">
                            Webhook Terkirim (HTTP {log.webhook_response_code})
                          </Badge>
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
                      <div className="px-4 pb-4 pt-1 border-t border-white/[0.04] bg-[#0a101d] space-y-3 text-xs">
                        {log.ai_diagnosis_summary && (
                          <div className="p-3 rounded-lg bg-sky-500/15 text-slate-200 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-sky-300 font-medium text-[11px]">
                              <BrainCircuit className="w-3.5 h-3.5 text-sky-400" />
                              <span>Diagnosis & Rekomendasi AI Harmonix</span>
                            </div>
                            <p className="whitespace-pre-line text-xs text-slate-300 leading-relaxed font-sans">
                              {log.ai_diagnosis_summary}
                            </p>
                          </div>
                        )}

                        {log.error_message && (
                          <div className="p-3 rounded-lg bg-rose-500/20 text-rose-300 text-xs">
                            <strong>Error:</strong> {log.error_message}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        )}
      </Modal>

      {/* Confirmation Modal for Rule Deletion */}
      <Modal
        isOpen={!!ruleToDelete}
        onClose={() => setRuleToDelete(null)}
        size="sm"
        title="Konfirmasi Hapus Aturan"
        icon={<AlertTriangle className="w-5 h-5 text-rose-400" />}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="ghost" size="sm" onClick={() => setRuleToDelete(null)}>
              Batal
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={deleteMutation.isPending}
              onClick={handleConfirmDelete}
            >
              Hapus Aturan
            </Button>
          </div>
        }
      >
        <p className="text-xs text-slate-300 leading-relaxed">
          Apakah Anda yakin ingin menghapus aturan pemantauan{' '}
          <strong className="text-white">&quot;{ruleToDelete?.rule_name}&quot;</strong>?
          Seluruh riwayat log eksekusi terkait aturan ini akan dihapus secara permanen.
        </p>
      </Modal>
    </>
  );
};

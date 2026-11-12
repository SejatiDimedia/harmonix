import React, { useState } from 'react';
import {
  Bell,
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
  sessionId?: string | null;
  showToast?: (msg: string) => void;
}

export const WatchdogModal: React.FC<WatchdogModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'logs'>('rules');
  const [scopeFilter, setScopeFilter] = useState<'context' | 'session' | 'global' | 'all'>('context');
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
  const [ruleScope, setRuleScope] = useState<'global' | 'session'>('global');
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

  const allRules = rulesData?.rules || [];
  const allLogs = logsData?.logs || [];

  // Scoped filtering logic
  const filteredRules = allRules.filter((r) => {
    if (scopeFilter === 'session') {
      return r.scope === 'session' && (!sessionId || r.session_id === sessionId);
    }
    if (scopeFilter === 'global') {
      return r.scope === 'global';
    }
    if (scopeFilter === 'context') {
      return r.scope === 'global' || (sessionId && r.session_id === sessionId);
    }
    return true;
  });

  const filteredLogs = allLogs.filter((l) => {
    if (scopeFilter === 'session') {
      return l.scope === 'session' && (!sessionId || l.session_id === sessionId);
    }
    if (scopeFilter === 'global') {
      return l.scope === 'global';
    }
    if (scopeFilter === 'context') {
      return l.scope === 'global' || (sessionId && l.session_id === sessionId);
    }
    return true;
  });

  const rules = filteredRules;
  const logs = filteredLogs;
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
    setRuleScope(sessionId ? 'session' : 'global');
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
    setRuleScope(rule.scope || 'global');
    setWebhookUrl(rule.webhook_url || '');
    setChannelType(rule.channel_type || 'slack');
    setAiDiagnosisEnabled(rule.ai_diagnosis_enabled);
    setIsFormOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim() || !sqlQuery.trim() || !targetColumn.trim()) {
      showToast?.('Rule name, SQL query, and target column are required.');
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
      scope: ruleScope,
      session_id: ruleScope === 'session' ? (sessionId || undefined) : null,
      webhook_url: webhookUrl.trim() || undefined,
      channel_type: channelType,
      ai_diagnosis_enabled: aiDiagnosisEnabled,
    };

    try {
      if (editingRuleId) {
        await updateMutation.mutateAsync({ ruleId: editingRuleId, rule: payload });
        showToast?.(`Rule #${editingRuleId} updated successfully.`);
      } else {
        await createMutation.mutateAsync(payload);
        showToast?.('New monitoring rule created successfully.');
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
      showToast?.(`Rule #${rule.id} is now ${!rule.enabled ? 'active' : 'disabled'}.`);
    } catch (err: any) {
      showToast?.(`Failed to update rule status: ${err.message}`);
    }
  };

  const handleRunRule = async (ruleId: number) => {
    try {
      showToast?.(`Evaluating rule #${ruleId}...`);
      const res = await runMutation.mutateAsync(ruleId);
      const isTrig = res.result.is_triggered;
      showToast?.(
        isTrig
          ? `Alert triggered: metric value ${res.result.metric_value} breached threshold.`
          : `Healthy: metric value ${res.result.metric_value} is within bounds.`
      );
    } catch (err: any) {
      showToast?.(`Execution failed: ${err.message}`);
    }
  };

  const handleConfirmDelete = async () => {
    if (!ruleToDelete) return;
    const id = ruleToDelete.id;
    try {
      await deleteMutation.mutateAsync(id);
      showToast?.(`Rule #${id} deleted successfully.`);
      setRuleToDelete(null);
    } catch (err: any) {
      showToast?.(`Failed to delete rule: ${err.message}`);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return (
          <Badge variant="success" icon={<CheckCircle2 className="w-3 h-3" />}>
            Healthy
          </Badge>
        );
      case 'triggered':
        return (
          <Badge variant="danger" pulse icon={<AlertOctagon className="w-3 h-3" />}>
            Triggered
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
            Pending
          </Badge>
        );
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'critical':
        return <Badge variant="danger">Critical</Badge>;
      case 'warning':
        return <Badge variant="warning">Warning</Badge>;
      default:
        return <Badge variant="info">Info</Badge>;
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="4xl"
        icon={<Bell className="w-5 h-5 text-rose-400" />}
        title="Data Anomaly Alerts"
        subtitle="Automated threshold monitoring, root-cause diagnosis, and notification routing for warehouse metrics."
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-slate-400">
              {sessionId ? `Scope bound to session: ${sessionId.slice(0, 8)}...` : 'Core warehouse monitoring'}
            </span>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        }
      >
        {/* Metric Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-[#0b1322] border border-white/[0.06]">
            <div className="text-[11px] font-medium tracking-wide uppercase text-slate-400">
              Total Rules
            </div>
            <div className="text-xl font-semibold text-white mt-1">
              {rules.length}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#0b1322] border border-white/[0.06]">
            <div className="text-[11px] font-medium tracking-wide uppercase text-slate-400">
              Active Rules
            </div>
            <div className="text-xl font-semibold text-sky-400 mt-1">
              {activeCount}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#0b1322] border border-white/[0.06]">
            <div className="text-[11px] font-medium tracking-wide uppercase text-slate-400">
              Triggered Anomalies
            </div>
            <div className={`text-xl font-semibold mt-1 ${triggeredCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
              {triggeredCount}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#0b1322] border border-white/[0.06]">
            <div className="text-[11px] font-medium tracking-wide uppercase text-slate-400">
              Recorded Logs
            </div>
            <div className="text-xl font-semibold text-slate-200 mt-1">
              {logs.length}
            </div>
          </div>
        </div>

        {/* Tab Switcher & Header Actions */}
        <div className="flex items-center justify-between pt-1">
          <Tabs
            tabs={[
              { id: 'rules', label: 'Monitoring Rules', count: rules.length },
              { id: 'logs', label: 'Execution Logs', count: logs.length },
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
              title="Refresh data"
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
            {activeTab === 'rules' && !isFormOpen && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenCreate}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Add Rule
              </Button>
            )}
          </div>
        </div>

        {/* Unified Scope Segmented Control */}
        <div className="flex items-center justify-between gap-3 p-1.5 bg-[#0b1322] rounded-xl border border-white/[0.06] text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setScopeFilter('context')}
              className={`px-3 py-1.5 rounded-lg transition font-medium cursor-pointer text-xs ${
                scopeFilter === 'context'
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              Active Context ({allRules.filter((r) => r.scope === 'global' || (sessionId && r.session_id === sessionId)).length})
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('session')}
              className={`px-3 py-1.5 rounded-lg transition font-medium cursor-pointer text-xs ${
                scopeFilter === 'session'
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              Session Only ({allRules.filter((r) => r.scope === 'session' && (!sessionId || r.session_id === sessionId)).length})
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('global')}
              className={`px-3 py-1.5 rounded-lg transition font-medium cursor-pointer text-xs ${
                scopeFilter === 'global'
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              Warehouse Global ({allRules.filter((r) => r.scope === 'global').length})
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition font-medium cursor-pointer text-xs ${
                scopeFilter === 'all'
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              All ({allRules.length})
            </button>
          </div>
          {sessionId && (
            <span className="text-[11px] text-slate-500 font-mono hidden md:inline px-2">
              Session: {sessionId.substring(0, 16)}...
            </span>
          )}
        </div>

        {/* Rule Form Panel */}
        {isFormOpen && (
          <form
            onSubmit={handleSaveRule}
            className="p-5 rounded-xl border border-white/[0.08] bg-[#0c1527] space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span className="text-sm font-semibold text-white">
                  {editingRuleId ? `Edit Rule #${editingRuleId}` : 'Create Monitoring Rule'}
                </span>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setIsFormOpen(false)}>
                Cancel
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Rule Name"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="High Order Cancellation Rate"
                required
              />
              <Select
                label="Severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as any)}
                options={[
                  { value: 'info', label: 'Info' },
                  { value: 'warning', label: 'Warning' },
                  { value: 'critical', label: 'Critical' },
                ]}
              />
              <Select
                label="Monitoring Scope"
                value={ruleScope}
                onChange={(e) => setRuleScope(e.target.value as 'global' | 'session')}
                options={[
                  {
                    value: 'global',
                    label: 'Core Warehouse (Global)',
                  },
                  {
                    value: 'session',
                    label: `Session Data (${sessionId ? sessionId.substring(0, 12) + '...' : 'Current Session'})`,
                  },
                ]}
              />
            </div>

            <Input
              label="Business Context & Purpose"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this metric matters or operational action required if breached"
            />

            <Textarea
              label="Analytics SQL Query"
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              rows={3}
              isMonospace
              placeholder="SELECT ... AS target_column FROM analytics.orders..."
              required
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Input
                label="Target Column"
                value={targetColumn}
                onChange={(e) => setTargetColumn(e.target.value)}
                placeholder="canceled_pct"
                isMonospace
                required
              />
              <Select
                label="Operator"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                isMonospace
                options={[
                  { value: '>', label: '> (Greater Than)' },
                  { value: '>=', label: '>= (Greater or Equal)' },
                  { value: '<', label: '< (Less Than)' },
                  { value: '<=', label: '<= (Less or Equal)' },
                  { value: '==', label: '== (Equal)' },
                  { value: '!=', label: '!= (Not Equal)' },
                ]}
              />
              <Input
                label="Threshold Value"
                type="number"
                step="any"
                value={thresholdValue}
                onChange={(e) => setThresholdValue(parseFloat(e.target.value) || 0)}
                isMonospace
                required
              />
              <Select
                label="Check Interval"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(parseInt(e.target.value, 10))}
                options={[
                  { value: 15, label: 'Every 15 minutes' },
                  { value: 30, label: 'Every 30 minutes' },
                  { value: 60, label: 'Every 1 hour' },
                  { value: 120, label: 'Every 2 hours' },
                  { value: 360, label: 'Every 6 hours' },
                  { value: 1440, label: 'Every 24 hours' },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.04]">
              <Input
                label="Webhook Notification URL (Optional)"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/... or Discord Webhook"
              />
              <Select
                label="Webhook Channel Format"
                value={channelType}
                onChange={(e) => setChannelType(e.target.value)}
                options={[
                  { value: 'slack', label: 'Slack Blocks' },
                  { value: 'discord', label: 'Discord Embeds' },
                  { value: 'generic', label: 'Generic JSON Payload' },
                ]}
              />
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={aiDiagnosisEnabled}
                  onChange={(e) => setAiDiagnosisEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-500 bg-[#0b1322] border-white/[0.2] focus:ring-sky-500"
                />
                <span className="text-xs text-slate-300 flex items-center gap-1.5">
                  <BrainCircuit className="w-3.5 h-3.5 text-sky-400" />
                  Perform automated root-cause diagnosis upon anomaly trigger
                </span>
              </label>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <Button variant="ghost" size="sm" onClick={() => setIsFormOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  isLoading={createMutation.isPending || updateMutation.isPending}
                >
                  {editingRuleId ? 'Save Changes' : 'Create Rule'}
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* TAB 1: Rules List */}
        {activeTab === 'rules' && (
          <div className="space-y-3">
            {isLoadingRules ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                Loading monitoring rules...
              </div>
            ) : rules.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-white/[0.06] rounded-xl text-slate-400 text-xs space-y-2">
                <p>No monitoring rules found for this scope.</p>
                <Button variant="secondary" size="xs" onClick={handleOpenCreate} leftIcon={<Plus className="w-3 h-3" />}>
                  Create Rule
                </Button>
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
                        <Badge variant={rule.scope === 'session' ? 'purple' : 'info'} size="xs">
                          {rule.scope === 'session' ? 'Session' : 'Global'}
                        </Badge>
                        {getStatusBadge(rule.last_status)}
                        {!rule.enabled && <Badge variant="neutral">Disabled</Badge>}
                      </div>
                      {rule.description && (
                        <p className="text-xs text-slate-400 leading-relaxed">{rule.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleRunRule(rule.id)}
                        isLoading={runMutation.isPending}
                        leftIcon={<Play className="w-3 h-3 text-sky-400" />}
                        title="Evaluate this rule now"
                      >
                        Run Check
                      </Button>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleToggleEnable(rule)}
                        title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                        className={rule.enabled ? 'text-emerald-400' : 'text-slate-400'}
                      >
                        {rule.enabled ? 'Active' : 'Off'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleOpenEdit(rule)}
                        title="Edit rule"
                        leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                      />
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setRuleToDelete(rule)}
                        title="Delete rule"
                        className="text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      />
                    </div>
                  </div>

                  {/* Condition & Evaluation Metadata */}
                  <div className="flex items-center justify-between gap-3 text-xs bg-[#0b1322] px-3.5 py-2.5 rounded-lg border border-white/[0.04] text-slate-300 flex-wrap">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 font-medium">Condition:</span>
                        <code className="font-mono text-sky-300">
                          {rule.target_column} {rule.operator} {rule.threshold_value}
                        </code>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 font-medium">Last Measured:</span>
                        <span className={`font-mono font-medium ${rule.last_status === 'triggered' ? 'text-rose-400 font-semibold' : 'text-slate-200'}`}>
                          {rule.last_metric_value !== null ? rule.last_metric_value : '-'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 font-medium">Frequency:</span>
                        <span className="text-slate-300 font-mono">Every {rule.cron_interval_minutes}m</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {rule.webhook_url && (
                        <div className="flex items-center gap-1 text-slate-400" title={rule.webhook_url}>
                          <Send className="w-3 h-3 text-sky-400" />
                          <span className="text-[11px] uppercase font-mono">{rule.channel_type}</span>
                        </div>
                      )}
                      {rule.ai_diagnosis_enabled && (
                        <div className="flex items-center gap-1 text-slate-400 text-[11px]" title="AI Root-Cause Diagnosis Active">
                          <BrainCircuit className="w-3.5 h-3.5 text-sky-400" />
                          <span>AI Diagnosis</span>
                        </div>
                      )}
                    </div>
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
              <div className="text-center py-12 text-slate-400 text-xs">
                Loading execution logs...
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-white/[0.06] rounded-xl text-slate-400 text-xs">
                No execution logs recorded yet. Run a check from the Monitoring Rules tab.
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
                              {log.rule_name || `Rule #${log.rule_id}`}
                            </span>
                            <Badge variant={log.scope === 'session' ? 'purple' : 'info'} size="xs">
                              {log.scope === 'session' ? 'Session' : 'Global'}
                            </Badge>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {log.created_at ? new Date(log.created_at).toLocaleString('en-US') : '-'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                            <span>Measured: <strong className="text-slate-200 font-mono">{log.metric_value !== null ? log.metric_value : '-'}</strong></span>
                            <span className="text-slate-500">(Threshold: <code className="text-slate-400 font-mono">{log.operator} {log.threshold_value}</code>)</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {log.webhook_sent && (
                          <Badge variant="success">
                            Webhook {log.webhook_response_code}
                          </Badge>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {/* Expandable Details: Root-Cause Diagnosis */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-white/[0.04] bg-[#090f1a] space-y-3 text-xs">
                        {log.ai_diagnosis_summary && (
                          <div className="p-3.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-slate-200 space-y-2">
                            <div className="flex items-center gap-1.5 text-sky-400 font-medium text-xs">
                              <BrainCircuit className="w-3.5 h-3.5" />
                              <span>Root-Cause Analysis &amp; Suggested Action</span>
                            </div>
                            <p className="whitespace-pre-line text-xs text-slate-300 leading-relaxed font-sans">
                              {log.ai_diagnosis_summary}
                            </p>
                          </div>
                        )}

                        {log.error_message && (
                          <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                            <span className="font-semibold">Error:</span> {log.error_message}
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
        title="Confirm Rule Deletion"
        icon={<AlertTriangle className="w-5 h-5 text-rose-400" />}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="ghost" size="sm" onClick={() => setRuleToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={deleteMutation.isPending}
              onClick={handleConfirmDelete}
            >
              Delete Rule
            </Button>
          </div>
        }
      >
        <p className="text-xs text-slate-300 leading-relaxed">
          Are you sure you want to delete monitoring rule{' '}
          <strong className="text-white">&quot;{ruleToDelete?.rule_name}&quot;</strong>?
          All historical logs associated with this rule will be permanently deleted.
        </p>
      </Modal>
    </>
  );
};

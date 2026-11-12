import React, { useState } from 'react';
import {
  BookOpen,
  Plus,
  Trash2,
  Sparkles,
  ArrowUpRight,
  FileText,
  Code,
  Tag,
  Info,
} from 'lucide-react';
import {
  useSessionContextQuery,
  useUpdateSessionContextMutation,
  usePromoteToGlossaryMutation,
} from '../hooks/useQueries';
import { Modal, Button, Input, Textarea, Card, Tabs } from './ui';
import { CustomContext } from '../types';

interface SessionContextDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  showToast?: (msg: string) => void;
}

export const SessionContextDrawer: React.FC<SessionContextDrawerProps> = ({
  isOpen,
  onClose,
  sessionId,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'columns' | 'formulas' | 'rules'>('columns');

  // Form states
  const [colKey, setColKey] = useState('');
  const [colDesc, setColDesc] = useState('');
  const [colValues, setColValues] = useState('');

  const [formulaName, setFormulaName] = useState('');
  const [formulaExpr, setFormulaExpr] = useState('');
  const [formulaDesc, setFormulaDesc] = useState('');

  const [ruleText, setRuleText] = useState('');

  // Promote Modal state
  const [promoteItem, setPromoteItem] = useState<{
    name: string;
    formula: string;
    desc: string;
  } | null>(null);

  const { data: contextData } = useSessionContextQuery(sessionId);
  const updateMutation = useUpdateSessionContextMutation(sessionId);
  const promoteMutation = usePromoteToGlossaryMutation(sessionId);

  const customContext: CustomContext = contextData?.custom_context || {
    column_mappings: {},
    custom_formulas: {},
    business_rules: [],
  };

  const tokenEstimate = contextData?.token_count_estimate || 0;
  const maxTokens = contextData?.max_token_budget || 1000;
  const tokenPct = Math.min(100, Math.round((tokenEstimate / maxTokens) * 100));

  const handleAddColumnMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!colKey.trim()) return;

    const valuesObj: Record<string, string> = {};
    if (colValues.trim()) {
      // Parse key=value or comma-separated pairs
      const pairs = colValues.split(/[,;\n]/);
      for (const p of pairs) {
        const [k, ...v] = p.split(/[=:]/);
        if (k && v.length) {
          valuesObj[k.trim()] = v.join(':').trim();
        }
      }
    }

    const updatedContext: CustomContext = {
      ...customContext,
      column_mappings: {
        ...customContext.column_mappings,
        [colKey.trim()]: {
          description: colDesc.trim(),
          values: valuesObj,
        },
      },
    };

    try {
      await updateMutation.mutateAsync(updatedContext);
      setColKey('');
      setColDesc('');
      setColValues('');
      showToast?.(`Column mapping for '${colKey.trim()}' added.`);
    } catch (err: any) {
      showToast?.(`Failed to add mapping: ${err.message}`);
    }
  };

  const handleDeleteColumnMapping = async (key: string) => {
    const updated = { ...customContext.column_mappings };
    delete updated[key];
    try {
      await updateMutation.mutateAsync({
        ...customContext,
        column_mappings: updated,
      });
      showToast?.(`Column mapping '${key}' removed.`);
    } catch (err: any) {
      showToast?.(`Error: ${err.message}`);
    }
  };

  const handleAddFormula = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formulaName.trim() || !formulaExpr.trim()) return;

    const updatedContext: CustomContext = {
      ...customContext,
      custom_formulas: {
        ...customContext.custom_formulas,
        [formulaName.trim()]: {
          formula: formulaExpr.trim(),
          description: formulaDesc.trim(),
        },
      },
    };

    try {
      await updateMutation.mutateAsync(updatedContext);
      setFormulaName('');
      setFormulaExpr('');
      setFormulaDesc('');
      showToast?.(`Custom formula '${formulaName.trim()}' added.`);
    } catch (err: any) {
      showToast?.(`Failed to add formula: ${err.message}`);
    }
  };

  const handleDeleteFormula = async (key: string) => {
    const updated = { ...customContext.custom_formulas };
    delete updated[key];
    try {
      await updateMutation.mutateAsync({
        ...customContext,
        custom_formulas: updated,
      });
      showToast?.(`Formula '${key}' removed.`);
    } catch (err: any) {
      showToast?.(`Error: ${err.message}`);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleText.trim()) return;

    const updatedContext: CustomContext = {
      ...customContext,
      business_rules: [...customContext.business_rules, ruleText.trim()],
    };

    try {
      await updateMutation.mutateAsync(updatedContext);
      setRuleText('');
      showToast?.('Business rule added to session.');
    } catch (err: any) {
      showToast?.(`Failed to add rule: ${err.message}`);
    }
  };

  const handleDeleteRule = async (index: number) => {
    const updated = customContext.business_rules.filter((_, i) => i !== index);
    try {
      await updateMutation.mutateAsync({
        ...customContext,
        business_rules: updated,
      });
      showToast?.('Business rule removed.');
    } catch (err: any) {
      showToast?.(`Error: ${err.message}`);
    }
  };

  const handleConfirmPromote = async () => {
    if (!promoteItem) return;
    try {
      await promoteMutation.mutateAsync({
        metric_name: promoteItem.name,
        sql_formula: promoteItem.formula,
        description: promoteItem.desc || `Metric formula: ${promoteItem.formula}`,
        domain: 'Finance & Operations',
      });
      showToast?.(`Metric '${promoteItem.name}' promoted to Global Knowledge Base.`);
      setPromoteItem(null);
    } catch (err: any) {
      showToast?.(`Promotion failed: ${err.message}`);
    }
  };

  const columnCount = Object.keys(customContext.column_mappings).length;
  const formulaCount = Object.keys(customContext.custom_formulas).length;
  const ruleCount = customContext.business_rules.length;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="2xl"
        icon={<BookOpen className="w-5 h-5 text-sky-400" />}
        title="Session Business Context"
        subtitle="Define session-specific column mappings, formulas, and operational rules without altering warehouse DDL."
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-slate-400">
              Rules active for session: <code className="text-sky-300 font-mono">{sessionId ? sessionId.slice(0, 12) + '...' : 'Active'}</code>
            </span>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        }
      >
        {/* Token Budget Indicator Bar */}
        <div className="p-3 rounded-xl bg-[#0b1322] border border-white/[0.06] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Prompt Context Budget</span>
            <span className={`font-mono font-medium ${tokenPct > 80 ? 'text-amber-400' : 'text-slate-300'}`}>
              {tokenEstimate} / {maxTokens} Tokens ({tokenPct}%)
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                tokenPct > 80 ? 'bg-amber-400' : 'bg-sky-400'
              }`}
              style={{ width: `${tokenPct}%` }}
            />
          </div>
        </div>

        {/* Tab Navigation */}
        <Tabs
          tabs={[
            { id: 'columns', label: 'Column Mappings', count: columnCount },
            { id: 'formulas', label: 'Custom Formulas', count: formulaCount },
            { id: 'rules', label: 'Business Notes', count: ruleCount },
          ]}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as any)}
        />

        {/* Contextual Case Usage Guide Banner */}
        <div className="p-3.5 rounded-xl bg-[#091120] border border-sky-500/20 text-xs text-slate-300 space-y-2 select-none shadow-sm">
          <div className="flex items-center gap-2 text-sky-400 font-semibold font-sans text-xs">
            <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>
              {activeTab === 'columns' && 'Use Case Guide: When to Use Column Mappings?'}
              {activeTab === 'formulas' && 'Use Case Guide: When to Use Custom Formulas?'}
              {activeTab === 'rules' && 'Use Case Guide: When to Use Business Notes?'}
            </span>
          </div>

          {activeTab === 'columns' && (
            <div className="text-[11px] text-slate-300 space-y-1.5 font-sans leading-relaxed">
              <p className="text-slate-200">
                Use this tab when your database tables or imported Excel/Sheets files contain:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                <li>
                  <strong className="text-slate-200">Abbreviated or cryptic column names</strong>: E.g., mapping column <code className="text-sky-300 font-mono">net_amt</code> to <em>Net Payable Amount</em>, or <code className="text-sky-300 font-mono">br_code</code> to <em>Store Branch Code</em>.
                </li>
                <li>
                  <strong className="text-slate-200">Integer or status codes without metadata</strong>: E.g., status column <code className="text-sky-300 font-mono">fld_st</code> with values <code className="text-sky-300 font-mono">9 = Completed, 3 = Cancelled, 4 = Refunded</code>.
                </li>
                <li>
                  <strong className="text-slate-200">Ambiguous competing columns</strong>: Disambiguating which timestamp or metric is primary (e.g., <code className="text-sky-300 font-mono">order_date</code> vs <code className="text-sky-300 font-mono">estimated_delivery_date</code>).
                </li>
              </ul>
            </div>
          )}

          {activeTab === 'formulas' && (
            <div className="text-[11px] text-slate-300 space-y-1.5 font-sans leading-relaxed">
              <p className="text-slate-200">
                Use this tab when defining session-specific metric formulas or department calculations:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                <li>
                  <strong className="text-slate-200">Department-specific metric definitions</strong>: Calculating <code className="text-sky-300 font-mono">Gross Margin = revenue - cogs - operational_rebate</code> based on your Finance team's standard.
                </li>
                <li>
                  <strong className="text-slate-200">Derived KPI formulas</strong>: Calculations such as <code className="text-sky-300 font-mono">ARPU = total_revenue / active_users</code> or specialized conversion ratios.
                </li>
                <li>
                  <strong className="text-slate-200">Promotion to global standard</strong>: Verified formulas can be published to the enterprise metric catalog via the <em>Promote to Global</em> action.
                </li>
              </ul>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="text-[11px] text-slate-300 space-y-1.5 font-sans leading-relaxed">
              <p className="text-slate-200">
                Use this tab for operational filtering constraints, assumptions, and analytical boundaries:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                <li>
                  <strong className="text-slate-200">Historical data exclusions & migrations</strong>: E.g., <em>"Exclude all transactions prior to January 1, 2024 due to legacy system migration."</em>
                </li>
                <li>
                  <strong className="text-slate-200">Internal test accounts & bot filters</strong>: E.g., <em>"Exclude organization ID 999 or @internal.corp email domains from retention analysis."</em>
                </li>
                <li>
                  <strong className="text-slate-200">Currency or operational assumptions</strong>: E.g., <em>"Apply fixed FX rate of 1 USD = 16,000 IDR for international transactions."</em>
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* TAB 1: Column Mappings */}
        {activeTab === 'columns' && (
          <div className="space-y-4">
            <form onSubmit={handleAddColumnMapping} className="p-4 rounded-xl bg-[#0c1527] border border-white/[0.06] space-y-3">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-sky-400" />
                Add Column or Status Code Mapping
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Column Identifier"
                  value={colKey}
                  onChange={(e) => setColKey(e.target.value)}
                  placeholder="orders.fld_st or status_code"
                  isMonospace
                  required
                />
                <Input
                  label="Business Meaning / Description"
                  value={colDesc}
                  onChange={(e) => setColDesc(e.target.value)}
                  placeholder="Transaction Status Column"
                />
              </div>
              <Input
                label="Status Values Mapping (Optional)"
                value={colValues}
                onChange={(e) => setColValues(e.target.value)}
                placeholder="9 = Selesai, 3 = Batal, 4 = Refund"
                helperText="Format: 9 = Completed, 3 = Canceled"
              />
              <div className="flex justify-end pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  isLoading={updateMutation.isPending}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add Mapping
                </Button>
              </div>
            </form>

            {/* List of Column Mappings */}
            <div className="space-y-2">
              {columnCount === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500 border border-dashed border-white/[0.06] rounded-xl">
                  No column mappings registered for this session yet.
                </div>
              ) : (
                Object.entries(customContext.column_mappings).map(([key, rawVal]) => {
                  const isObj = typeof rawVal === 'object' && rawVal !== null;
                  const desc = isObj ? (rawVal as any).description : '';
                  const values = isObj ? (rawVal as any).values || {} : {};
                  return (
                    <Card key={key} variant="default" className="p-3.5 flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-xs text-sky-300 font-mono font-semibold">{key}</code>
                          {desc && <span className="text-xs text-slate-300 font-medium">({desc})</span>}
                        </div>
                        {Object.keys(values).length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap pt-1">
                            {Object.entries(values).map(([vk, vv]) => (
                              <span
                                key={vk}
                                className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#0b1322] border border-white/[0.04] text-slate-300"
                              >
                                <strong className="text-white">{vk}</strong>: {String(vv)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleDeleteColumnMapping(key)}
                        title="Delete mapping"
                        className="text-slate-400 hover:text-rose-400 shrink-0"
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      />
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Custom Formulas */}
        {activeTab === 'formulas' && (
          <div className="space-y-4">
            <form onSubmit={handleAddFormula} className="p-4 rounded-xl bg-[#0c1527] border border-white/[0.06] space-y-3">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-sky-400" />
                Define Custom Business Metric Formula
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Metric Name"
                  value={formulaName}
                  onChange={(e) => setFormulaName(e.target.value)}
                  placeholder="gross_margin"
                  isMonospace
                  required
                />
                <Input
                  label="Description"
                  value={formulaDesc}
                  onChange={(e) => setFormulaDesc(e.target.value)}
                  placeholder="Operational Gross Margin"
                />
              </div>
              <Input
                label="SQL Formula Expression"
                value={formulaExpr}
                onChange={(e) => setFormulaExpr(e.target.value)}
                placeholder="revenue - cogs - rebate"
                isMonospace
                required
              />
              <div className="flex justify-end pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  isLoading={updateMutation.isPending}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Save Formula
                </Button>
              </div>
            </form>

            {/* List of Custom Formulas */}
            <div className="space-y-2">
              {formulaCount === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500 border border-dashed border-white/[0.06] rounded-xl">
                  No custom formulas registered for this session yet.
                </div>
              ) : (
                Object.entries(customContext.custom_formulas).map(([key, rawVal]) => {
                  const isObj = typeof rawVal === 'object' && rawVal !== null;
                  const expr = isObj ? (rawVal as any).formula : String(rawVal);
                  const desc = isObj ? (rawVal as any).description : '';
                  return (
                    <Card key={key} variant="default" className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-white">{key}</span>
                            {desc && <span className="text-xs text-slate-400">({desc})</span>}
                          </div>
                          <code className="text-xs text-sky-300 font-mono block mt-1 bg-[#0b1322] px-2.5 py-1 rounded border border-white/[0.04]">
                            {expr}
                          </code>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() =>
                              setPromoteItem({
                                name: key,
                                formula: expr,
                                desc,
                              })
                            }
                            title="Promote to global glossary"
                            leftIcon={<ArrowUpRight className="w-3 h-3 text-sky-400" />}
                          >
                            Promote to Global
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleDeleteFormula(key)}
                            title="Delete formula"
                            className="text-slate-400 hover:text-rose-400"
                            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                          />
                        </div>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Business Notes / Rules */}
        {activeTab === 'rules' && (
          <div className="space-y-4">
            <form onSubmit={handleAddRule} className="p-4 rounded-xl bg-[#0c1527] border border-white/[0.06] space-y-3">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-sky-400" />
                Add Session Business Rule / Filter Instruction
              </span>
              <Textarea
                value={ruleText}
                onChange={(e) => setRuleText(e.target.value)}
                rows={2}
                placeholder="Example: Filter out internal testing transactions or ignore customer records created prior to 2024"
                required
              />
              <div className="flex justify-end pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  isLoading={updateMutation.isPending}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add Rule
                </Button>
              </div>
            </form>

            {/* List of Business Rules */}
            <div className="space-y-2">
              {ruleCount === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500 border border-dashed border-white/[0.06] rounded-xl">
                  No business notes registered for this session yet.
                </div>
              ) : (
                customContext.business_rules.map((rule, idx) => (
                  <Card key={idx} variant="default" className="p-3 flex items-start justify-between gap-3">
                    <p className="text-xs text-slate-300 leading-relaxed font-sans">{rule}</p>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleDeleteRule(idx)}
                      title="Delete rule"
                      className="text-slate-400 hover:text-rose-400 shrink-0"
                      leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                    />
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Confirmation Modal: Promote to Global Glossary */}
      <Modal
        isOpen={!!promoteItem}
        onClose={() => setPromoteItem(null)}
        size="sm"
        title="Promote to Global Metric Glossary"
        icon={<Sparkles className="w-5 h-5 text-sky-400" />}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="ghost" size="sm" onClick={() => setPromoteItem(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={promoteMutation.isPending}
              onClick={handleConfirmPromote}
            >
              Confirm Promotion
            </Button>
          </div>
        }
      >
        <p className="text-xs text-slate-300 leading-relaxed">
          Promoting <strong className="text-white">&quot;{promoteItem?.name}&quot;</strong> will make this formula permanently available across all sessions in the global knowledge base.
        </p>
      </Modal>
    </>
  );
};

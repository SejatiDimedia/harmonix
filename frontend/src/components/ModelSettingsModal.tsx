import React, { useState, useEffect } from 'react';
import {
  Sliders,
  CheckCircle2,
  AlertCircle,
  Key,
  Cpu,
  Eye,
  EyeOff,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { ModelCatalogResponse } from '../types';
import { useApiKeysQuery, useUpdateApiKeysMutation } from '../hooks/useQueries';
import { Modal, Button, Badge, Input, Select, Card, Tabs } from './ui';

interface ModelSettingsModalProps {
  isOpen: boolean;
  catalog: ModelCatalogResponse | null;
  activeAnalystProvider: string;
  activeAnalystModel: string;
  activeAuditorProvider: string;
  activeAuditorModel: string;
  onSave: (payload: {
    analyst_provider: string;
    analyst_model: string;
    auditor_provider: string;
    auditor_model?: string | null;
  }) => Promise<void>;
  onClose: () => void;
}

export const ModelSettingsModal: React.FC<ModelSettingsModalProps> = ({
  isOpen,
  catalog,
  activeAnalystProvider,
  activeAnalystModel,
  activeAuditorProvider,
  activeAuditorModel,
  onSave,
  onClose,
}) => {
  const [modalTab, setModalTab] = useState<'models' | 'keys'>('models');
  const [analystProv, setAnalystProv] = useState(activeAnalystProvider);
  const [analystMod, setAnalystMod] = useState(activeAnalystModel);
  const [auditorProv, setAuditorProv] = useState(activeAuditorProvider);
  const [auditorMod, setAuditorMod] = useState(activeAuditorModel);
  const [isSaving, setIsSaving] = useState(false);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);
  const [successFeedback, setSuccessFeedback] = useState<string | null>(null);

  // API Keys state
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [showGroq, setShowGroq] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenRouter, setShowOpenRouter] = useState(false);

  const { data: apiKeysData, refetch: refetchApiKeys } = useApiKeysQuery();
  const updateApiKeysMutation = useUpdateApiKeysMutation();

  useEffect(() => {
    if (isOpen) {
      setAnalystProv(activeAnalystProvider);
      setAnalystMod(activeAnalystModel);
      setAuditorProv(activeAuditorProvider);
      setAuditorMod(activeAuditorModel);
      setErrorFeedback(null);
      setSuccessFeedback(null);
      setGroqKey('');
      setGeminiKey('');
      setOpenrouterKey('');
      refetchApiKeys();
    }
  }, [isOpen, activeAnalystProvider, activeAnalystModel, activeAuditorProvider, activeAuditorModel, refetchApiKeys]);

  if (!isOpen || !catalog) return null;

  const currentAnalystProviderData = catalog.providers.find((p) => p.provider === analystProv);
  const currentAuditorProviderData = catalog.providers.find((p) => p.provider === auditorProv);

  const analystModelData = currentAnalystProviderData?.available_models.find((m) => m.id === analystMod);
  const auditorModelData = currentAuditorProviderData?.available_models.find((m) => m.id === auditorMod);

  const handleAnalystProvChange = (prov: string) => {
    setAnalystProv(prov);
    const pData = catalog.providers.find((p) => p.provider === prov);
    if (pData && pData.available_models.length > 0) {
      setAnalystMod(pData.available_models[0].id);
    } else {
      setAnalystMod('');
    }
  };

  const handleAuditorProvChange = (prov: string) => {
    setAuditorProv(prov);
    if (prov === 'auto') {
      setAuditorMod('');
      return;
    }
    const pData = catalog.providers.find((p) => p.provider === prov);
    if (pData && pData.available_models.length > 0) {
      setAuditorMod(pData.available_models[0].id);
    } else {
      setAuditorMod('');
    }
  };

  const handleSaveModels = async () => {
    setIsSaving(true);
    setErrorFeedback(null);
    setSuccessFeedback(null);
    try {
      await onSave({
        analyst_provider: analystProv,
        analyst_model: analystMod,
        auditor_provider: auditorProv,
        auditor_model: auditorProv === 'auto' ? null : auditorMod || null,
      });
      onClose();
    } catch (err: any) {
      setErrorFeedback(err.message || 'Failed to save model configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveKeys = async () => {
    setIsSaving(true);
    setErrorFeedback(null);
    setSuccessFeedback(null);
    try {
      const payload: { groq_api_key?: string; gemini_api_key?: string; openrouter_api_key?: string } = {};
      if (groqKey.trim()) payload.groq_api_key = groqKey.trim();
      if (geminiKey.trim()) payload.gemini_api_key = geminiKey.trim();
      if (openrouterKey.trim()) payload.openrouter_api_key = openrouterKey.trim();

      if (Object.keys(payload).length === 0) {
        setErrorFeedback('Please enter at least one API Key to save.');
        setIsSaving(false);
        return;
      }

      await updateApiKeysMutation.mutateAsync(payload);
      setSuccessFeedback('API Keys successfully saved, updated in .env, and immediately active!');
      setGroqKey('');
      setGeminiKey('');
      setOpenrouterKey('');
      refetchApiKeys();
    } catch (err: any) {
      setErrorFeedback(err.message || 'Failed to save API keys');
    } finally {
      setIsSaving(false);
    }
  };

  const groqInfo = apiKeysData?.keys?.groq;
  const geminiInfo = apiKeysData?.keys?.gemini;
  const openrouterInfo = apiKeysData?.keys?.openrouter;

  const modalTabs = [
    { id: 'models', label: 'Active Models', icon: <Cpu className="w-4 h-4" /> },
    { id: 'keys', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
  ];

  const modalFooter = (
    <div className="flex items-center justify-end gap-3 w-full">
      <Button variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
      {modalTab === 'models' ? (
        <Button
          variant="primary"
          size="sm"
          isLoading={isSaving}
          onClick={handleSaveModels}
          leftIcon={<CheckCircle2 className="w-4 h-4" />}
        >
          Save &amp; Apply Models
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          isLoading={isSaving}
          disabled={!groqKey.trim() && !geminiKey.trim() && !openrouterKey.trim()}
          onClick={handleSaveKeys}
          leftIcon={<Key className="w-4 h-4" />}
        >
          Save API Keys
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      title="Manage LLM Models & API Keys"
      description="Configure providers, active models, and API keys directly from the interface"
      icon={<Sliders className="w-5 h-5 text-sky-400" />}
      footer={modalFooter}
    >
      <div className="space-y-6">
        {/* Navigation Tabs */}
        <div className="-mt-2 -mx-6 px-6 border-b border-white/[0.04] bg-[#0b1526]/50">
          <Tabs
            tabs={modalTabs}
            activeTab={modalTab}
            onChange={(id) => {
              setModalTab(id as 'models' | 'keys');
              setErrorFeedback(null);
              setSuccessFeedback(null);
            }}
          />
        </div>

        {/* Feedback Alerts */}
        {errorFeedback && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-xs text-rose-200 flex items-center gap-2 shadow-sm">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorFeedback}</span>
          </div>
        )}

        {successFeedback && (
          <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-800/40 text-xs text-sky-200 flex items-center gap-2 shadow-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successFeedback}</span>
          </div>
        )}

        {modalTab === 'models' ? (
          <>
            {/* Provider status cards */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-[#94a3b8] mb-2.5 select-none">
                Connected Provider Status
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {catalog.providers.map((p) => (
                  <Card
                    key={p.provider}
                    variant="surface"
                    padding="sm"
                    className={p.is_ready ? 'border-white/[0.12]' : 'opacity-60'}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-[#f8fafc] text-xs font-sans tracking-wide">
                        {p.provider.toUpperCase()}
                      </span>
                      <Badge variant={p.is_ready ? 'success' : 'neutral'} size="xs" dot>
                        {p.is_ready ? 'READY' : 'OFFLINE'}
                      </Badge>
                    </div>
                    <span className={`text-[11px] truncate font-mono block ${p.is_ready ? 'text-sky-300/80' : 'text-[#64748b]'}`}>
                      {p.status_message}
                    </span>
                  </Card>
                ))}
              </div>
            </div>

            {/* Section 1: Data Analyst Agent */}
            <div className="space-y-3 pt-4 border-t border-[#1e3557]">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[#f8fafc]">
                  Primary Analyst Model (Text-to-SQL)
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Provider"
                  value={analystProv}
                  onChange={(e) => handleAnalystProvChange(e.target.value)}
                  options={catalog.providers.map((p) => ({
                    value: p.provider,
                    label: `${p.display_name} ${p.is_ready ? '' : '(Key Missing)'}`,
                  }))}
                />

                <Select
                  label="Selected Model"
                  value={analystMod}
                  onChange={(e) => setAnalystMod(e.target.value)}
                  options={(currentAnalystProviderData?.available_models || []).map((m) => ({
                    value: m.id,
                    label: m.name,
                  }))}
                />
              </div>

              {analystModelData && (
                <p className="text-[11px] text-[#94a3b8] font-mono">
                  {analystModelData.description} • Context:{' '}
                  {(analystModelData.context_length || 8192).toLocaleString()} tokens
                </p>
              )}
            </div>

            {/* Section 2: Data Auditor Agent */}
            <div className="space-y-3 pt-4 border-t border-[#1e3557]">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[#f8fafc]">
                  Data Auditor Model (Cross-Verification)
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Provider"
                  value={auditorProv}
                  onChange={(e) => handleAuditorProvChange(e.target.value)}
                  options={[
                    { value: 'auto', label: 'Auto (Model Diversity)' },
                    ...catalog.providers.map((p) => ({
                      value: p.provider,
                      label: `${p.display_name} ${p.is_ready ? '' : '(Key Missing)'}`,
                    })),
                  ]}
                />

                <Select
                  label="Selected Model"
                  value={auditorMod}
                  onChange={(e) => setAuditorMod(e.target.value)}
                  disabled={auditorProv === 'auto'}
                  options={
                    auditorProv === 'auto'
                      ? [{ value: '', label: 'Auto / Fallback Provider' }]
                      : (currentAuditorProviderData?.available_models || []).map((m) => ({
                          value: m.id,
                          label: m.name,
                        }))
                  }
                />
              </div>

              <p className="text-[11px] text-[#94a3b8] font-mono">
                {auditorProv === 'auto'
                  ? 'The auditor will automatically select an independent model to validate data accuracy.'
                  : auditorModelData
                  ? `${auditorModelData.description} • Context: ${(auditorModelData.context_length || 8192).toLocaleString()} tokens`
                  : ''}
              </p>
            </div>
          </>
        ) : (
          /* Tab 2: Kunci API (API Keys) */
          <div className="space-y-5">
            <Card variant="surface" padding="md" className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-xs text-[#f8fafc]">Configuring API Keys</p>
                <p className="text-[#94a3b8] text-xs mt-0.5 leading-relaxed">
                  API keys can be entered directly below or set in the server's <code className="text-sky-300 bg-[#0f1a2e] px-1 py-0.5 rounded">.env</code> file. Keys saved from this modal are automatically updated in <code className="text-sky-300 bg-[#0f1a2e] px-1 py-0.5 rounded">.env</code> and active immediately without restart.
                </p>
              </div>
            </Card>

            {/* 1. Groq Cloud */}
            <Card variant="default" padding="md" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-xs text-[#f8fafc]">1. Groq Cloud (LPU Ultra-Fast)</span>
                  <span className="text-[10px] font-mono text-[#94a3b8]">GROQ_API_KEY</span>
                </div>
                <Badge variant={groqInfo?.is_set ? 'success' : 'neutral'} size="xs" dot>
                  {groqInfo?.is_set ? `Active (${groqInfo.masked_key})` : 'Not Set'}
                </Badge>
              </div>

              <Input
                type={showGroq ? 'text' : 'password'}
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder={groqInfo?.is_set ? 'Enter new key to replace...' : 'gsk_...'}
                monospace
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowGroq(!showGroq)}
                    aria-label={showGroq ? 'Hide Groq API key' : 'Show Groq API key'}
                    className="text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
                  >
                    {showGroq ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />

              <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                <span>OpenAI GPT-OSS 120B &amp; Qwen models on LPU (~500 t/s)</span>
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:text-sky-300 flex items-center gap-1 transition"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Card>

            {/* 2. Google AI Studio (Gemini) */}
            <Card variant="default" padding="md" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-xs text-[#f8fafc]">2. Google AI Studio (Gemini)</span>
                  <span className="text-[10px] font-mono text-[#94a3b8]">GEMINI_API_KEY</span>
                </div>
                <Badge variant={geminiInfo?.is_set ? 'success' : 'neutral'} size="xs" dot>
                  {geminiInfo?.is_set ? `Active (${geminiInfo.masked_key})` : 'Not Set'}
                </Badge>
              </div>

              <Input
                type={showGemini ? 'text' : 'password'}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder={geminiInfo?.is_set ? 'Enter new key to replace...' : 'AIzaSy...'}
                monospace
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowGemini(!showGemini)}
                    aria-label={showGemini ? 'Hide Gemini API key' : 'Show Gemini API key'}
                    className="text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
                  >
                    {showGemini ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />

              <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                <span>Gemini 2.0 Flash &amp; Gemini 1.5 Flash (Google AI Cloud)</span>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:text-sky-300 flex items-center gap-1 transition"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Card>

            {/* 3. OpenRouter */}
            <Card variant="default" padding="md" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-xs text-[#f8fafc]">3. OpenRouter AI Gateway</span>
                  <span className="text-[10px] font-mono text-[#94a3b8]">OPENROUTER_API_KEY</span>
                </div>
                <Badge variant={openrouterInfo?.is_set ? 'success' : 'neutral'} size="xs" dot>
                  {openrouterInfo?.is_set ? `Active (${openrouterInfo.masked_key})` : 'Not Set'}
                </Badge>
              </div>

              <Input
                type={showOpenRouter ? 'text' : 'password'}
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
                placeholder={openrouterInfo?.is_set ? 'Enter new key to replace...' : 'sk-or-v1-...'}
                monospace
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowOpenRouter(!showOpenRouter)}
                    aria-label={showOpenRouter ? 'Hide OpenRouter API key' : 'Show OpenRouter API key'}
                    className="text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
                  >
                    {showOpenRouter ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />

              <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                <span>Access Llama 3, Gemma 4, and Nvidia Nemotron models via OpenRouter</span>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:text-sky-300 flex items-center gap-1 transition"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Card>
          </div>
        )}
      </div>
    </Modal>
  );
};

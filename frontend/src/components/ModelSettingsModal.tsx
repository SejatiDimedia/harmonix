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
      setErrorFeedback(err.message || 'Gagal menyimpan konfigurasi model');
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
        setErrorFeedback('Silakan masukkan minimal satu API Key untuk disimpan.');
        setIsSaving(false);
        return;
      }

      await updateApiKeysMutation.mutateAsync(payload);
      setSuccessFeedback('Kunci API berhasil disimpan, diperbarui di .env, dan langsung aktif!');
      setGroqKey('');
      setGeminiKey('');
      setOpenrouterKey('');
      refetchApiKeys();
    } catch (err: any) {
      setErrorFeedback(err.message || 'Gagal menyimpan kunci API');
    } finally {
      setIsSaving(false);
    }
  };

  const groqInfo = apiKeysData?.keys?.groq;
  const geminiInfo = apiKeysData?.keys?.gemini;
  const openrouterInfo = apiKeysData?.keys?.openrouter;

  const modalTabs = [
    { id: 'models', label: 'Pilihan Model Aktif', icon: <Cpu className="w-4 h-4" /> },
    { id: 'keys', label: 'Kunci API (API Keys)', icon: <Key className="w-4 h-4" /> },
  ];

  const modalFooter = (
    <div className="flex items-center justify-end gap-3 w-full">
      <Button variant="ghost" size="sm" onClick={onClose}>
        Batal
      </Button>
      {modalTab === 'models' ? (
        <Button
          variant="primary"
          size="sm"
          isLoading={isSaving}
          onClick={handleSaveModels}
          leftIcon={<CheckCircle2 className="w-4 h-4" />}
        >
          Simpan &amp; Terapkan Model
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
          Simpan Kunci API
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      title="Kelola Model LLM & Kunci API"
      description="Konfigurasi provider, model aktif, dan API key langsung dari antarmuka web"
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
                Status Provider Terhubung
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
                        {p.is_ready ? 'SIAP' : 'OFFLINE'}
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
                  Model Primary Analyst (Text-to-SQL)
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Provider"
                  value={analystProv}
                  onChange={(e) => handleAnalystProvChange(e.target.value)}
                  options={catalog.providers.map((p) => ({
                    value: p.provider,
                    label: `${p.display_name} ${p.is_ready ? '' : '(Key Belum Ada)'}`,
                  }))}
                />

                <Select
                  label="Model Pilihan"
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
                  {analystModelData.description} • Konteks:{' '}
                  {(analystModelData.context_length || 8192).toLocaleString()} token
                </p>
              )}
            </div>

            {/* Section 2: Data Auditor Agent */}
            <div className="space-y-3 pt-4 border-t border-[#1e3557]">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[#f8fafc]">
                  Model Data Auditor (Verifikasi Silang)
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
                      label: `${p.display_name} ${p.is_ready ? '' : '(Key Belum Ada)'}`,
                    })),
                  ]}
                />

                <Select
                  label="Model Pilihan"
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
                  ? 'Auditor akan memilih model independen yang berbeda secara otomatis untuk validasi akurasi data.'
                  : auditorModelData
                  ? `${auditorModelData.description} • Konteks: ${(auditorModelData.context_length || 8192).toLocaleString()} token`
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
                <p className="font-medium text-xs text-[#f8fafc]">Dua Cara Mengatur Kunci API</p>
                <p className="text-[#94a3b8] text-xs mt-0.5 leading-relaxed">
                  Kunci API dapat diisi langsung di bawah ini atau melalui berkas <code className="text-sky-300 bg-[#0f1a2e] px-1 py-0.5 rounded">.env</code> di root server. Kunci yang disimpan dari form ini otomatis diperbarui ke file <code className="text-sky-300 bg-[#0f1a2e] px-1 py-0.5 rounded">.env</code> dan langsung aktif tanpa restart.
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
                  {groqInfo?.is_set ? `Aktif (${groqInfo.masked_key})` : 'Belum Diisi'}
                </Badge>
              </div>

              <Input
                type={showGroq ? 'text' : 'password'}
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder={groqInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'gsk_...'}
                monospace
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowGroq(!showGroq)}
                    aria-label={showGroq ? 'Sembunyikan kunci API Groq' : 'Tampilkan kunci API Groq'}
                    className="text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
                  >
                    {showGroq ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />

              <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                <span>Model OpenAI GPT-OSS 120B &amp; Qwen 3.8 di LPU (~500 t/s)</span>
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:text-sky-300 flex items-center gap-1 transition"
                >
                  <span>Dapatkan API Key</span>
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
                  {geminiInfo?.is_set ? `Aktif (${geminiInfo.masked_key})` : 'Belum Diisi'}
                </Badge>
              </div>

              <Input
                type={showGemini ? 'text' : 'password'}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder={geminiInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'AIzaSy...'}
                monospace
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowGemini(!showGemini)}
                    aria-label={showGemini ? 'Sembunyikan kunci API Gemini' : 'Tampilkan kunci API Gemini'}
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
                  <span>Dapatkan API Key</span>
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
                  {openrouterInfo?.is_set ? `Aktif (${openrouterInfo.masked_key})` : 'Belum Diisi'}
                </Badge>
              </div>

              <Input
                type={showOpenRouter ? 'text' : 'password'}
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
                placeholder={openrouterInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'sk-or-v1-...'}
                monospace
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowOpenRouter(!showOpenRouter)}
                    aria-label={showOpenRouter ? 'Sembunyikan kunci API OpenRouter' : 'Tampilkan kunci API OpenRouter'}
                    className="text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
                  >
                    {showOpenRouter ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />

              <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                <span>Akses model Llama 3, Gemma 4, Nvidia Nemotron via OpenRouter</span>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:text-sky-300 flex items-center gap-1 transition"
                >
                  <span>Dapatkan API Key</span>
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

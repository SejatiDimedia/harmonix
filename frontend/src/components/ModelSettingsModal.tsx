import React, { useState, useEffect } from 'react';
import {
  X,
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans no-print print:hidden"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-[#0f1a2e] border border-[#1e3557] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e3557] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-clay-500/10 text-clay-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 id="model-modal-title" className="text-base font-semibold text-[#f8fafc]">
                Kelola Model LLM & Kunci API
              </h3>
              <p className="text-xs text-[#94a3b8]">
                Konfigurasi provider, model aktif, dan API key langsung dari antarmuka web
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal pengaturan model (Esc)"
            className="p-1.5 rounded-lg text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div role="tablist" aria-label="Navigasi Pengaturan Model" className="flex items-center px-6 border-b border-[#1e3557] bg-[#0b1526]">
          <button
            type="button"
            role="tab"
            aria-selected={modalTab === 'models'}
            onClick={() => {
              setModalTab('models');
              setErrorFeedback(null);
              setSuccessFeedback(null);
            }}
            className={`px-4 py-3 text-xs font-medium border-b-2 transition flex items-center gap-2 cursor-pointer ${
              modalTab === 'models'
                ? 'border-clay-500 text-[#f8fafc]'
                : 'border-transparent text-[#94a3b8] hover:text-[#f8fafc]'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Pilihan Model Aktif</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modalTab === 'keys'}
            onClick={() => {
              setModalTab('keys');
              setErrorFeedback(null);
              setSuccessFeedback(null);
            }}
            className={`px-4 py-3 text-xs font-medium border-b-2 transition flex items-center gap-2 cursor-pointer ${
              modalTab === 'keys'
                ? 'border-clay-500 text-[#f8fafc]'
                : 'border-transparent text-[#94a3b8] hover:text-[#f8fafc]'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Kunci API (API Keys)</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {errorFeedback && (
            <div className="p-3 rounded-xl bg-[#1a1222] border border-rose-500/30 text-xs text-rose-200 flex items-center gap-2 shadow-sm">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorFeedback}</span>
            </div>
          )}

          {successFeedback && (
            <div className="p-3 rounded-xl bg-[#0c1e33] border border-cyan-500/30 text-xs text-cyan-200 flex items-center gap-2 shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-[#00d2ee] shrink-0" />
              <span>{successFeedback}</span>
            </div>
          )}

          {modalTab === 'models' ? (
            <>
              {/* Provider status badges */}
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[#94a3b8] mb-2.5 select-none">
                  Status Provider Terhubung
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {catalog.providers.map((p) => (
                    <div
                      key={p.provider}
                      className={`p-3 rounded-xl border flex flex-col justify-between gap-1.5 transition-all shadow-sm ${
                        p.is_ready
                          ? 'bg-[#14223b] border-[#1e3557] hover:border-cyan-500/40'
                          : 'bg-[#101b2e]/80 border-[#1a2d47] opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#f8fafc] text-xs font-sans tracking-wide">
                          {p.provider.toUpperCase()}
                        </span>
                        {p.is_ready ? (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d2ee]" />
                          </span>
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-slate-500" />
                        )}
                      </div>
                      <span className={`text-[11px] truncate font-mono ${p.is_ready ? 'text-cyan-300/80' : 'text-[#64748b]'}`}>
                        {p.status_message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 1: Data Analyst Agent */}
              <div className="space-y-3 pt-4 border-t border-[#1e3557]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-clay-500" />
                  <h4 className="text-sm font-medium text-[#f8fafc]">
                    Model Primary Analyst (Text-to-SQL)
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono text-[#94a3b8] mb-1">
                      Provider
                    </label>
                    <select
                      value={analystProv}
                      onChange={(e) => handleAnalystProvChange(e.target.value)}
                      className="w-full bg-[#14223b] border border-[#1e3557] rounded-xl px-3 py-2 text-xs text-[#f8fafc] focus:outline-none focus:border-clay-500 cursor-pointer"
                    >
                      {catalog.providers.map((p) => (
                        <option key={p.provider} value={p.provider}>
                          {p.display_name} {p.is_ready ? '' : '(Key Belum Ada)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[#94a3b8] mb-1">
                      Model Pilihan
                    </label>
                    <select
                      value={analystMod}
                      onChange={(e) => setAnalystMod(e.target.value)}
                      className="w-full bg-[#14223b] border border-[#1e3557] rounded-xl px-3 py-2 text-xs text-[#f8fafc] focus:outline-none focus:border-clay-500 cursor-pointer"
                    >
                      {(currentAnalystProviderData?.available_models || []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
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
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                  <h4 className="text-sm font-medium text-[#f8fafc]">
                    Model Data Auditor (Verifikasi Silang)
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono text-[#94a3b8] mb-1">
                      Provider
                    </label>
                    <select
                      value={auditorProv}
                      onChange={(e) => handleAuditorProvChange(e.target.value)}
                      className="w-full bg-[#14223b] border border-[#1e3557] rounded-xl px-3 py-2 text-xs text-[#f8fafc] focus:outline-none focus:border-clay-500 cursor-pointer"
                    >
                      <option value="auto">Auto (Model Diversity)</option>
                      {catalog.providers.map((p) => (
                        <option key={p.provider} value={p.provider}>
                          {p.display_name} {p.is_ready ? '' : '(Key Belum Ada)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[#94a3b8] mb-1">
                      Model Pilihan
                    </label>
                    <select
                      disabled={auditorProv === 'auto'}
                      value={auditorMod}
                      onChange={(e) => setAuditorMod(e.target.value)}
                      className="w-full bg-[#14223b] border border-[#1e3557] rounded-xl px-3 py-2 text-xs text-[#f8fafc] focus:outline-none focus:border-clay-500 disabled:opacity-50 cursor-pointer"
                    >
                      {auditorProv === 'auto' ? (
                        <option value="">Auto / Fallback Provider</option>
                      ) : (
                        (currentAuditorProviderData?.available_models || []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
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
              <div className="p-3.5 rounded-xl bg-[#14223b] border border-[#1e3557] text-xs text-[#f8fafc] flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-clay-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-[#f8fafc]">Dua Cara Mengatur Kunci API</p>
                  <p className="text-[#94a3b8] mt-0.5 leading-relaxed">
                    Kunci API dapat diisi langsung di bawah ini atau melalui berkas <code className="text-clay-300 bg-[#0f1a2e] px-1 py-0.5 rounded">.env</code> di root server. Kunci yang disimpan dari form ini otomatis diperbarui ke file <code className="text-clay-300 bg-[#0f1a2e] px-1 py-0.5 rounded">.env</code> dan langsung aktif tanpa restart.
                  </p>
                </div>
              </div>

              {/* 1. Groq Cloud */}
              <div className="p-4 rounded-xl bg-[#111e33] border border-[#1e3557] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-[#f8fafc]">1. Groq Cloud (LPU Ultra-Fast)</span>
                    <span className="text-[10px] font-mono text-[#94a3b8]">GROQ_API_KEY</span>
                  </div>
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full border font-mono flex items-center gap-1.5 ${
                      groqInfo?.is_set
                        ? 'bg-cyan-950/50 border-cyan-800/40 text-cyan-300'
                        : 'bg-[#14223b] border-[#1e3557] text-[#94a3b8]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${groqInfo?.is_set ? 'bg-[#00d2ee]' : 'bg-slate-500'}`} />
                    <span>{groqInfo?.is_set ? `Aktif (${groqInfo.masked_key})` : 'Belum Diisi'}</span>
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showGroq ? 'text' : 'password'}
                    value={groqKey}
                    onChange={(e) => setGroqKey(e.target.value)}
                    aria-label="Kunci API Groq (gsk_...)"
                    placeholder={groqInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'gsk_...'}
                    className="w-full bg-[#0f1a2e] border border-[#1e3557] rounded-xl px-3 py-2 pr-10 text-xs text-[#f8fafc] focus:outline-none focus:border-clay-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGroq(!showGroq)}
                    aria-label={showGroq ? 'Sembunyikan kunci API Groq' : 'Tampilkan kunci API Groq'}
                    className="absolute right-3 text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
                  >
                    {showGroq ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                  <span>Model OpenAI GPT-OSS 120B &amp; Qwen 3.8 di LPU (~500 t/s)</span>
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-clay-400 hover:text-clay-300 flex items-center gap-1 transition"
                  >
                    <span>Dapatkan API Key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {/* 2. Google AI Studio (Gemini) */}
              <div className="p-4 rounded-xl bg-[#111e33] border border-[#1e3557] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-[#f8fafc]">2. Google AI Studio (Gemini)</span>
                    <span className="text-[10px] font-mono text-[#94a3b8]">GEMINI_API_KEY</span>
                  </div>
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full border font-mono flex items-center gap-1.5 ${
                      geminiInfo?.is_set
                        ? 'bg-cyan-950/50 border-cyan-800/40 text-cyan-300'
                        : 'bg-[#14223b] border-[#1e3557] text-[#94a3b8]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${geminiInfo?.is_set ? 'bg-[#00d2ee]' : 'bg-slate-500'}`} />
                    <span>{geminiInfo?.is_set ? `Aktif (${geminiInfo.masked_key})` : 'Belum Diisi'}</span>
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showGemini ? 'text' : 'password'}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    aria-label="Kunci API Google Gemini (AIzaSy...)"
                    placeholder={geminiInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'AIzaSy...'}
                    className="w-full bg-[#0f1a2e] border border-[#1e3557] rounded-xl px-3 py-2 pr-10 text-xs text-[#f8fafc] focus:outline-none focus:border-clay-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGemini(!showGemini)}
                    aria-label={showGemini ? 'Sembunyikan kunci API Gemini' : 'Tampilkan kunci API Gemini'}
                    className="absolute right-3 text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
                  >
                    {showGemini ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                  <span>Gemini 2.0 Flash &amp; Gemini 1.5 Flash (Google AI Cloud)</span>
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-clay-400 hover:text-clay-300 flex items-center gap-1 transition"
                  >
                    <span>Dapatkan API Key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {/* 3. OpenRouter */}
              <div className="p-4 rounded-xl bg-[#111e33] border border-[#1e3557] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-[#f8fafc]">3. OpenRouter AI Gateway</span>
                    <span className="text-[10px] font-mono text-[#94a3b8]">OPENROUTER_API_KEY</span>
                  </div>
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full border font-mono flex items-center gap-1.5 ${
                      openrouterInfo?.is_set
                        ? 'bg-cyan-950/50 border-cyan-800/40 text-cyan-300'
                        : 'bg-[#14223b] border-[#1e3557] text-[#94a3b8]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${openrouterInfo?.is_set ? 'bg-[#00d2ee]' : 'bg-slate-500'}`} />
                    <span>{openrouterInfo?.is_set ? `Aktif (${openrouterInfo.masked_key})` : 'Belum Diisi'}</span>
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showOpenRouter ? 'text' : 'password'}
                    value={openrouterKey}
                    onChange={(e) => setOpenrouterKey(e.target.value)}
                    aria-label="Kunci API OpenRouter (sk-or-v1-...)"
                    placeholder={openrouterInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'sk-or-v1-...'}
                    className="w-full bg-[#0f1a2e] border border-[#1e3557] rounded-xl px-3 py-2 pr-10 text-xs text-[#f8fafc] focus:outline-none focus:border-clay-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenRouter(!showOpenRouter)}
                    aria-label={showOpenRouter ? 'Sembunyikan kunci API OpenRouter' : 'Tampilkan kunci API OpenRouter'}
                    className="absolute right-3 text-[#94a3b8] hover:text-[#f8fafc] transition cursor-pointer"
                  >
                    {showOpenRouter ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#94a3b8]">
                  <span>Akses model Llama 3, Gemma 4, Nvidia Nemotron via OpenRouter</span>
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-clay-400 hover:text-clay-300 flex items-center gap-1 transition"
                  >
                    <span>Dapatkan API Key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#1e3557] flex items-center justify-end gap-3 bg-[#0b1526]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] transition cursor-pointer"
          >
            Batal
          </button>
          {modalTab === 'models' ? (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveModels}
              className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-clay-600 hover:bg-clay-500 transition shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan & Terapkan Model'}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isSaving || (!groqKey.trim() && !geminiKey.trim() && !openrouterKey.trim())}
              onClick={handleSaveKeys}
              className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-clay-600 hover:bg-clay-500 transition shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Key className="w-4 h-4" />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan Kunci API'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

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
        className="relative w-full max-w-2xl bg-[#1b1a18] border border-[#2e2c28] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2e2c28] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-clay-500/10 text-clay-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 id="model-modal-title" className="text-base font-semibold text-[#f5f4ef]">
                Kelola Model LLM & Kunci API
              </h3>
              <p className="text-xs text-[#9c9990]">
                Konfigurasi provider, model aktif, dan API key langsung dari antarmuka web
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal pengaturan model (Esc)"
            className="p-1.5 rounded-lg text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#282623] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div role="tablist" aria-label="Navigasi Pengaturan Model" className="flex items-center px-6 border-b border-[#2e2c28] bg-[#161513]">
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
                ? 'border-clay-500 text-[#f5f4ef]'
                : 'border-transparent text-[#8e8b82] hover:text-[#dedcd5]'
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
                ? 'border-clay-500 text-[#f5f4ef]'
                : 'border-transparent text-[#8e8b82] hover:text-[#dedcd5]'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Kunci API (API Keys)</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {errorFeedback && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorFeedback}</span>
            </div>
          )}

          {successFeedback && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successFeedback}</span>
            </div>
          )}

          {modalTab === 'models' ? (
            <>
              {/* Provider status badges */}
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[#9c9990] mb-2 select-none">
                  Status Provider Terhubung
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {catalog.providers.map((p) => (
                    <div
                      key={p.provider}
                      className={`p-2.5 rounded-xl border flex flex-col justify-between gap-1 ${
                        p.is_ready
                          ? 'bg-[#18231c] border-emerald-900/60 text-emerald-300'
                          : 'bg-[#221c1a] border-[#3d2a26] text-[#9c9990]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[#f5f4ef] text-xs">
                          {p.provider.toUpperCase()}
                        </span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            p.is_ready ? 'bg-emerald-400' : 'bg-amber-500'
                          }`}
                        />
                      </div>
                      <span className="text-[10px] truncate text-[#a3a097]">
                        {p.status_message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 1: Data Analyst Agent */}
              <div className="space-y-3 pt-4 border-t border-[#2e2c28]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-clay-500" />
                  <h4 className="text-sm font-medium text-[#f5f4ef]">
                    Model Primary Analyst (Text-to-SQL)
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono text-[#9c9990] mb-1">
                      Provider
                    </label>
                    <select
                      value={analystProv}
                      onChange={(e) => handleAnalystProvChange(e.target.value)}
                      className="w-full bg-[#141413] border border-[#383632] rounded-xl px-3 py-2 text-xs text-[#f5f4ef] focus:outline-none focus:border-clay-500 cursor-pointer"
                    >
                      {catalog.providers.map((p) => (
                        <option key={p.provider} value={p.provider}>
                          {p.display_name} {p.is_ready ? '' : '(Key Belum Ada)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[#9c9990] mb-1">
                      Model Pilihan
                    </label>
                    <select
                      value={analystMod}
                      onChange={(e) => setAnalystMod(e.target.value)}
                      className="w-full bg-[#141413] border border-[#383632] rounded-xl px-3 py-2 text-xs text-[#f5f4ef] focus:outline-none focus:border-clay-500 cursor-pointer"
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
                  <p className="text-[11px] text-[#8e8b82] font-mono">
                    {analystModelData.description} • Konteks:{' '}
                    {(analystModelData.context_length || 8192).toLocaleString()} token
                  </p>
                )}
              </div>

              {/* Section 2: Data Auditor Agent */}
              <div className="space-y-3 pt-4 border-t border-[#2e2c28]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                  <h4 className="text-sm font-medium text-[#f5f4ef]">
                    Model Data Auditor (Verifikasi Silang)
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono text-[#9c9990] mb-1">
                      Provider
                    </label>
                    <select
                      value={auditorProv}
                      onChange={(e) => handleAuditorProvChange(e.target.value)}
                      className="w-full bg-[#141413] border border-[#383632] rounded-xl px-3 py-2 text-xs text-[#f5f4ef] focus:outline-none focus:border-clay-500 cursor-pointer"
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
                    <label className="block text-[11px] font-mono text-[#9c9990] mb-1">
                      Model Pilihan
                    </label>
                    <select
                      disabled={auditorProv === 'auto'}
                      value={auditorMod}
                      onChange={(e) => setAuditorMod(e.target.value)}
                      className="w-full bg-[#141413] border border-[#383632] rounded-xl px-3 py-2 text-xs text-[#f5f4ef] focus:outline-none focus:border-clay-500 disabled:opacity-50 cursor-pointer"
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

                <p className="text-[11px] text-[#8e8b82] font-mono">
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
              <div className="p-3.5 rounded-xl bg-[#141413] border border-[#2e2c28] text-xs text-[#dedcd5] flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-clay-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-[#f5f4ef]">Dua Cara Mengatur Kunci API</p>
                  <p className="text-[#9c9990] mt-0.5 leading-relaxed">
                    Kunci API dapat diisi langsung di bawah ini atau melalui berkas <code className="text-clay-300 bg-[#201f1d] px-1 py-0.5 rounded">.env</code> di root server. Kunci yang disimpan dari form ini otomatis diperbarui ke file <code className="text-clay-300 bg-[#201f1d] px-1 py-0.5 rounded">.env</code> dan langsung aktif tanpa restart.
                  </p>
                </div>
              </div>

              {/* 1. Groq Cloud */}
              <div className="p-4 rounded-xl bg-[#161513] border border-[#2e2c28] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-[#f5f4ef]">1. Groq Cloud (LPU Ultra-Fast)</span>
                    <span className="text-[10px] font-mono text-[#9c9990]">GROQ_API_KEY</span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${
                      groqInfo?.is_set
                        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                        : 'bg-amber-950/60 border-amber-800 text-amber-300'
                    }`}
                  >
                    {groqInfo?.is_set ? `Aktif (${groqInfo.masked_key})` : 'Belum Diisi'}
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showGroq ? 'text' : 'password'}
                    value={groqKey}
                    onChange={(e) => setGroqKey(e.target.value)}
                    aria-label="Kunci API Groq (gsk_...)"
                    placeholder={groqInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'gsk_...'}
                    className="w-full bg-[#1b1a18] border border-[#383632] rounded-xl px-3 py-2 pr-10 text-xs text-[#f5f4ef] focus:outline-none focus:border-clay-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGroq(!showGroq)}
                    aria-label={showGroq ? 'Sembunyikan kunci API Groq' : 'Tampilkan kunci API Groq'}
                    className="absolute right-3 text-[#9c9990] hover:text-[#dedcd5] transition cursor-pointer"
                  >
                    {showGroq ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#9c9990]">
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
              <div className="p-4 rounded-xl bg-[#161513] border border-[#2e2c28] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-[#f5f4ef]">2. Google AI Studio (Gemini)</span>
                    <span className="text-[10px] font-mono text-[#9c9990]">GEMINI_API_KEY</span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${
                      geminiInfo?.is_set
                        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                        : 'bg-amber-950/60 border-amber-800 text-amber-300'
                    }`}
                  >
                    {geminiInfo?.is_set ? `Aktif (${geminiInfo.masked_key})` : 'Belum Diisi'}
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showGemini ? 'text' : 'password'}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    aria-label="Kunci API Google Gemini (AIzaSy...)"
                    placeholder={geminiInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'AIzaSy...'}
                    className="w-full bg-[#1b1a18] border border-[#383632] rounded-xl px-3 py-2 pr-10 text-xs text-[#f5f4ef] focus:outline-none focus:border-clay-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGemini(!showGemini)}
                    aria-label={showGemini ? 'Sembunyikan kunci API Gemini' : 'Tampilkan kunci API Gemini'}
                    className="absolute right-3 text-[#9c9990] hover:text-[#dedcd5] transition cursor-pointer"
                  >
                    {showGemini ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#9c9990]">
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
              <div className="p-4 rounded-xl bg-[#161513] border border-[#2e2c28] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-[#f5f4ef]">3. OpenRouter AI Gateway</span>
                    <span className="text-[10px] font-mono text-[#9c9990]">OPENROUTER_API_KEY</span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${
                      openrouterInfo?.is_set
                        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                        : 'bg-amber-950/60 border-amber-800 text-amber-300'
                    }`}
                  >
                    {openrouterInfo?.is_set ? `Aktif (${openrouterInfo.masked_key})` : 'Belum Diisi'}
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showOpenRouter ? 'text' : 'password'}
                    value={openrouterKey}
                    onChange={(e) => setOpenrouterKey(e.target.value)}
                    aria-label="Kunci API OpenRouter (sk-or-v1-...)"
                    placeholder={openrouterInfo?.is_set ? 'Ketik kunci baru untuk mengganti...' : 'sk-or-v1-...'}
                    className="w-full bg-[#1b1a18] border border-[#383632] rounded-xl px-3 py-2 pr-10 text-xs text-[#f5f4ef] focus:outline-none focus:border-clay-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenRouter(!showOpenRouter)}
                    aria-label={showOpenRouter ? 'Sembunyikan kunci API OpenRouter' : 'Tampilkan kunci API OpenRouter'}
                    className="absolute right-3 text-[#9c9990] hover:text-[#dedcd5] transition cursor-pointer"
                  >
                    {showOpenRouter ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#9c9990]">
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
        <div className="px-6 py-4 border-t border-[#2e2c28] flex items-center justify-end gap-3 bg-[#161513]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#282623] transition cursor-pointer"
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

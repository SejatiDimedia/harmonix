import React, { useState, useEffect } from 'react';
import { X, Sliders, CheckCircle2, AlertCircle } from 'lucide-react';
import { ModelCatalogResponse } from '../types';

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
  const [analystProv, setAnalystProv] = useState(activeAnalystProvider);
  const [analystMod, setAnalystMod] = useState(activeAnalystModel);
  const [auditorProv, setAuditorProv] = useState(activeAuditorProvider);
  const [auditorMod, setAuditorMod] = useState(activeAuditorModel);
  const [isSaving, setIsSaving] = useState(false);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAnalystProv(activeAnalystProvider);
      setAnalystMod(activeAnalystModel);
      setAuditorProv(activeAuditorProvider);
      setAuditorMod(activeAuditorModel);
      setErrorFeedback(null);
    }
  }, [isOpen, activeAnalystProvider, activeAnalystModel, activeAuditorProvider, activeAuditorModel]);

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

  const handleSave = async () => {
    setIsSaving(true);
    setErrorFeedback(null);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
      <div className="relative w-full max-w-2xl bg-[#1b1a18] border border-[#2e2c28] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2e2c28] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-clay-500/10 text-clay-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#f5f4ef]">
                Kelola Model LLM (Zero-Cost Multi-Tier)
              </h3>
              <p className="text-xs text-[#9c9990]">
                Ganti model Analyst dan Data Auditor secara dinamis tanpa restart server
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#282623] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {errorFeedback && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorFeedback}</span>
            </div>
          )}

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
                Model Data Auditor (Maker-Checker Gate)
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
                ? 'Auditor akan memilih model independen yang berbeda secara otomatis untuk validasi maker-checker.'
                : auditorModelData
                ? `${auditorModelData.description} • Konteks: ${(auditorModelData.context_length || 8192).toLocaleString()} token`
                : ''}
            </p>
          </div>
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
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-clay-600 hover:bg-clay-500 transition shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSaving ? 'Menyimpan...' : 'Simpan & Terapkan'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

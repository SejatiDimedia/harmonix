import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, ChevronDown, Paperclip, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { EngineType, ModelCatalogResponse, UploadedTableSummary } from '../types';
import { formatModelNameShort } from '../utils/formatters';
import { ModelPickerPopover } from './ModelPickerPopover';
import { UploadedTableModal } from './UploadedTableModal';
import { useSessionUploadedTablesQuery } from '../hooks/useQueries';
import { uploadSessionFiles } from '../services/api';

interface ChatInputProps {
  isLoading: boolean;
  engine: EngineType;
  catalog: ModelCatalogResponse | null;
  activeProvider: string;
  activeModel: string;
  sessionId: string | null;
  onEnsureSession: () => string;
  onSetEngine: (engine: EngineType) => void;
  onSelectModel: (provider: string, modelId: string) => void;
  onOpenFullModelModal: () => void;
  onSubmit: (query: string) => void;
  showToast?: (message: string) => void;
}

const ChatInputComponent: React.FC<ChatInputProps> = ({
  isLoading,
  engine,
  catalog,
  activeProvider,
  activeModel,
  sessionId,
  onEnsureSession,
  onSetEngine,
  onSelectModel,
  onOpenFullModelModal,
  onSubmit,
  showToast,
}) => {
  const [query, setQuery] = useState('');
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedTableForModal, setSelectedTableForModal] = useState<UploadedTableSummary | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Load active session-scoped uploaded tables
  const { data: uploadedData } = useSessionUploadedTablesQuery(sessionId);
  const uploadedTables = uploadedData?.tables || [];

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        180
      )}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFormSubmit();
    }
  };

  const handleFormSubmit = () => {
    const q = query.trim();
    if (!q || isLoading || isUploading) return;
    onSubmit(q);
    setQuery('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const fileList = Array.from(files);
      if (fileList.length > 5) {
        showToast?.('Maksimal 5 file yang dapat diunggah sekaligus.');
        e.target.value = '';
        return;
      }

      const oversized = fileList.find((f) => f.size > 15 * 1024 * 1024);
      if (oversized) {
        showToast?.(`File "${oversized.name}" melebihi batas ukuran maksimal (15 MB).`);
        e.target.value = '';
        return;
      }

      const targetSessionId = sessionId || onEnsureSession();

      try {
        setIsUploading(true);
        const result = await uploadSessionFiles(targetSessionId, fileList);
        await queryClient.invalidateQueries({
          queryKey: ['session-uploaded-tables', targetSessionId],
        });
        showToast?.(
          `Berhasil memuat ${result.total_tables_created} tabel dari ${result.total_files} file.`
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Gagal mengunggah file data.';
        showToast?.(errorMsg);
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [sessionId, onEnsureSession, queryClient, showToast]
  );

  const shortModelName = formatModelNameShort(activeModel) || activeModel;

  return (
    <div className="border-t border-[#2e2c28] bg-[#161513] p-4 shrink-0">
      <div className="max-w-4xl mx-auto relative">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleFormSubmit();
          }}
          className="relative bg-[#1b1a18] border border-[#2e2c28] focus-within:border-clay-500/80 rounded-2xl shadow-xl transition-all"
        >
          {/* Active Uploaded Tables Bar */}
          {uploadedTables.length > 0 && (
            <div className="px-3.5 pt-2.5 pb-2 flex items-center gap-1.5 overflow-x-auto text-xs font-mono scrollbar-none border-b border-[#262421]/60">
              <span className="text-[#8e8b82] text-[11px] flex items-center gap-1 shrink-0 mr-1 select-none">
                <FileSpreadsheet className="w-3.5 h-3.5 text-clay-400" />
                <span className="font-sans font-medium text-[#b0ada3]">Dataset Aktif:</span>
              </span>
              {uploadedTables.map((tbl) => {
                const displayName =
                  tbl.sheet_name && tbl.sheet_name !== 'data' && tbl.sheet_name !== tbl.original_filename
                    ? `${tbl.original_filename} (${tbl.sheet_name})`
                    : tbl.original_filename;

                return (
                  <button
                    key={tbl.table_name}
                    type="button"
                    onClick={() => setSelectedTableForModal(tbl)}
                    className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#22211e] hover:bg-[#282623] border border-[#383632] hover:border-clay-500/60 text-[#d6d4cb] transition cursor-pointer shrink-0"
                    title={`Klik untuk melihat detail skema kolom (${tbl.columns.length} kolom)`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-[#f5f4ef] font-medium font-sans truncate max-w-[130px] sm:max-w-[200px]">
                      {displayName}
                    </span>
                    <span className="text-[10px] text-[#8e8b82] font-mono">
                      {tbl.row_count.toLocaleString()} baris
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Text input */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Pertanyaan analisis data"
            placeholder={
              uploadedTables.length > 0
                ? "Tanyakan analisis dataset Anda atau gabungkan dengan data warehouse..."
                : "Tanyakan analisis data... (contoh: 'Tampilkan tren penjualan bulanan dalam grafik bar')"
            }
            className="w-full bg-transparent px-4 pt-3.5 pb-2 text-sm text-[#f5f4ef] placeholder-[#9c9990] focus:outline-none resize-none leading-relaxed font-sans max-h-44"
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1 border-t border-[#262421]/60">
            {/* Left Controls: File Upload, Model Picker & Engine Toggle */}
            <div className="flex items-center gap-2 relative">
              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv, .xlsx, .xls"
                onChange={handleFileChange}
                aria-label="Pilih file spreadsheet CSV atau Excel untuk diunggah"
                className="hidden"
              />

              {/* Upload Data Button */}
              <button
                type="button"
                disabled={isUploading || isLoading}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Unggah file data CSV atau Excel"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono bg-[#22211e] hover:bg-[#282623] border border-[#383632] text-[#d6d4cb] hover:text-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Unggah CSV atau Excel (.xlsx, .xls) untuk dianalisis bersama database warehouse (Maks 5 file, 15MB/file)"
              >
                {isUploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-clay-400" />
                ) : (
                  <Paperclip className="w-3.5 h-3.5 text-[#8e8b82]" />
                )}
                <span className="hidden sm:inline">
                  {isUploading ? 'Memproses...' : 'Upload Data'}
                </span>
              </button>

              {/* Model Picker Button & Popover */}
              <button
                type="button"
                onClick={() => setIsPopoverOpen(!isPopoverOpen)}
                aria-label={`Pilih model analitik. Model saat ini: ${activeProvider.toUpperCase()} (${activeModel})`}
                aria-haspopup="dialog"
                aria-expanded={isPopoverOpen}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono bg-[#22211e] hover:bg-[#282623] border border-[#383632] text-[#d6d4cb] hover:text-white transition cursor-pointer"
                title={`Model Aktif: ${activeProvider.toUpperCase()} (${activeModel})`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-clay-400" />
                <span className="truncate max-w-[120px] sm:max-w-[180px]">
                  {activeProvider.toUpperCase()}: {shortModelName}
                </span>
                <ChevronDown className="w-3 h-3 text-[#8e8b82]" />
              </button>

              <ModelPickerPopover
                isOpen={isPopoverOpen}
                catalog={catalog}
                activeProvider={activeProvider}
                activeModel={activeModel}
                onSelectModel={(p, m) => {
                  onSelectModel(p, m);
                  setIsPopoverOpen(false);
                }}
                onOpenFullModal={() => {
                  setIsPopoverOpen(false);
                  onOpenFullModelModal();
                }}
                onClose={() => setIsPopoverOpen(false)}
              />

              {/* Engine Toggle */}
              <div role="group" aria-label="Pilihan Engine Orchestrator" className="hidden md:flex items-center bg-[#22211e] border border-[#383632] rounded-xl p-0.5 text-xs font-mono select-none">
                <button
                  type="button"
                  onClick={() => onSetEngine('manual')}
                  className={`px-2 py-0.5 rounded-lg font-medium transition cursor-pointer ${
                    engine === 'manual'
                      ? 'text-white bg-clay-600 shadow-sm'
                      : 'text-[#9c9990] hover:text-white'
                  }`}
                  title="Engine Eksekusi Cepat (Deterministic Loop)"
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => onSetEngine('langgraph')}
                  className={`px-2 py-0.5 rounded-lg font-medium transition cursor-pointer ${
                    engine === 'langgraph'
                      ? 'text-white bg-clay-600 shadow-sm'
                      : 'text-[#9c9990] hover:text-white'
                  }`}
                  title="LangGraph Workflow Engine"
                >
                  LangGraph
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || isUploading || !query.trim()}
              aria-label="Kirim pertanyaan (Enter)"
              className="p-2 rounded-xl bg-clay-600 hover:bg-clay-500 disabled:opacity-30 disabled:hover:bg-clay-600 text-white transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              title="Kirim (Enter)"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </form>

        <div className="text-center text-[10px] text-[#9c9990] pt-2 font-mono select-none">
          Harnessly Enterprise Analytics — AI Data Analyst with Multi-Model Intelligence &amp; Privacy Guardrails
        </div>
      </div>

      {/* Uploaded Table Schema Inspector Modal */}
      <UploadedTableModal
        isOpen={!!selectedTableForModal}
        table={selectedTableForModal}
        onClose={() => setSelectedTableForModal(null)}
        onSelectPrompt={(p) => {
          setQuery(p);
          if (textareaRef.current) {
            textareaRef.current.focus();
          }
        }}
      />
    </div>
  );
};

export const ChatInput = React.memo(ChatInputComponent);

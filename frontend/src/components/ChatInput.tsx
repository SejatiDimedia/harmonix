import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, ChevronDown, Paperclip, FileSpreadsheet, Loader2, X, Square, Cpu } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { EngineType, ModelCatalogResponse, UploadedTableSummary } from '../types';
import { formatModelNameShort } from '../utils/formatters';
import { ModelPickerPopover } from './ModelPickerPopover';
import { UploadedTableModal } from './UploadedTableModal';
import { useSessionUploadedTablesQuery, useDeleteUploadedTableMutation } from '../hooks/useQueries';
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
  onCancel?: () => void;
  showToast?: (message: string) => void;
  inputPrefill?: string;
  onClearPrefill?: () => void;
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
  onCancel,
  showToast,
  inputPrefill,
  onClearPrefill,
}) => {
  const [query, setQuery] = useState('');
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedTableForModal, setSelectedTableForModal] = useState<UploadedTableSummary | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Auto-fill query when user clicks "Edit" on a previous question
  useEffect(() => {
    if (inputPrefill !== undefined && inputPrefill !== null && inputPrefill !== '') {
      setQuery(inputPrefill);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = inputPrefill.length;
          textareaRef.current.selectionEnd = inputPrefill.length;
          adjustTextareaHeight();
        }
      }, 50);
    }
  }, [inputPrefill]);

  // Load active session-scoped uploaded tables
  const { data: uploadedData } = useSessionUploadedTablesQuery(sessionId);
  const uploadedTables = uploadedData?.tables || [];
  const deleteTableMutation = useDeleteUploadedTableMutation(sessionId);

  const handleDeleteSingleTable = async (tableName: string, displayName: string) => {
    try {
      await deleteTableMutation.mutateAsync(tableName);
      showToast?.(`Dataset "${displayName}" successfully removed.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove dataset';
      showToast?.(msg);
    }
  };

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
    if (e.key === 'Escape' && isLoading && onCancel) {
      e.preventDefault();
      onCancel();
      return;
    }
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
    onClearPrefill?.();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const fileList = Array.from(files);
      if (fileList.length > 10) {
        showToast?.('Maximum 10 files can be uploaded at once.');
        e.target.value = '';
        return;
      }

      const oversized = fileList.find((f) => f.size > 15 * 1024 * 1024);
      if (oversized) {
        showToast?.(`File "${oversized.name}" exceeds the maximum size limit (15 MB).`);
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
          `Successfully loaded ${result.total_tables_created} tables from ${result.total_files} files.`
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to upload data files.';
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
    <div className="bg-[#080f1d] p-4 shrink-0">
      <div className="max-w-4xl mx-auto relative">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleFormSubmit();
          }}
          className="relative bg-[#0f1a2e] border border-white/[0.08] focus-within:border-[#008cd0]/80 rounded-2xl shadow-xl transition-all"
        >
          {/* Active Uploaded Tables Bar */}
          {uploadedTables.length > 0 && (
            <div className="px-3.5 pt-2.5 pb-2 flex items-center gap-1.5 overflow-x-auto text-xs font-mono scrollbar-none border-b border-white/[0.04]">
              <span className="text-[#94a3b8] text-[11px] flex items-center gap-1 shrink-0 mr-1 select-none">
                <FileSpreadsheet className="w-3.5 h-3.5 text-clay-400" />
                <span className="font-sans font-medium text-[#f8fafc]">Active Datasets:</span>
              </span>
              {uploadedTables.map((tbl) => {
                const displayName =
                  tbl.sheet_name && tbl.sheet_name !== 'data' && tbl.sheet_name !== tbl.original_filename
                    ? `${tbl.original_filename} (${tbl.sheet_name})`
                    : tbl.original_filename;

                return (
                  <div
                    key={tbl.table_name}
                    className="group inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-[#14223b] hover:bg-[#182a47] text-[#f8fafc] transition shrink-0 shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTableForModal(tbl)}
                      className="flex items-center gap-1.5 cursor-pointer text-left focus:outline-none"
                      title={`Click to view data health & column schema (${tbl.columns.length} columns)`}
                    >
                      <span className="text-[#f8fafc] font-medium font-sans truncate max-w-[120px] sm:max-w-[180px]">
                        {displayName}
                      </span>
                      <span className="text-[10px] text-[#94a3b8] font-mono">
                        {tbl.row_count.toLocaleString()} rows
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSingleTable(tbl.table_name, displayName);
                      }}
                      className="p-1 rounded-md text-[#94a3b8] hover:text-rose-300 hover:bg-rose-500/25 transition cursor-pointer shrink-0 ml-0.5"
                      title={`Remove dataset "${displayName}"`}
                      aria-label={`Remove dataset "${displayName}"`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
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
            aria-label="Data analytics prompt"
            placeholder={
              uploadedTables.length > 0
                ? "Ask questions about your dataset or join with data warehouse..."
                : "Ask any data question... (e.g., 'Show monthly sales trend in a bar chart')"
            }
            className="w-full bg-transparent px-4 pt-3.5 pb-2 text-sm text-[#f8fafc] placeholder-[#94a3b8] focus:outline-none resize-none leading-relaxed font-sans max-h-44"
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1.5 border-t border-white/[0.04]">
            {/* Left Controls: Model & Engine Selector */}
            <div className="flex items-center gap-1.5 relative">
              {/* Model & Engine Selector Chip */}
              <button
                type="button"
                onClick={() => setIsPopoverOpen(!isPopoverOpen)}
                aria-label={`Select model and analytics engine. Model: ${shortModelName}, Engine: ${engine}`}
                aria-haspopup="dialog"
                aria-expanded={isPopoverOpen}
                className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-sans transition cursor-pointer border ${isPopoverOpen
                  ? 'bg-[#14223b] text-slate-100 border-slate-700/60 shadow-sm'
                  : 'bg-transparent text-slate-300 hover:text-white hover:bg-[#14223b] border-transparent hover:border-slate-800/80'
                  }`}
                title={`Model: ${activeProvider.toUpperCase()} (${activeModel}) | Engine: ${engine}`}
              >
                <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="font-medium text-xs text-slate-200 truncate max-w-[140px] sm:max-w-[220px]">
                  {shortModelName}
                </span>
                <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                  • {engine === 'manual' ? 'Manual' : engine === 'langgraph' ? 'LangGraph' : 'Swarm'}
                </span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform duration-150 shrink-0 ${isPopoverOpen ? 'rotate-180 text-sky-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                />
              </button>

              <ModelPickerPopover
                isOpen={isPopoverOpen}
                catalog={catalog}
                activeProvider={activeProvider}
                activeModel={activeModel}
                engine={engine}
                onSetEngine={onSetEngine}
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
            </div>

            {/* Right Actions: File Upload & Submit / Cancel Action Button */}
            <div className="flex items-center gap-1.5">
              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv, .xlsx, .xls"
                onChange={handleFileChange}
                aria-label="Select CSV or Excel spreadsheet files to upload"
                className="hidden"
              />

              {/* Upload Data Button (Positioned next to send button) */}
              <button
                type="button"
                disabled={isUploading || isLoading}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload CSV or Excel data files"
                className="group p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-[#14223b] border border-transparent hover:border-slate-800/80 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="Upload CSV or Excel (.xlsx, .xls) files to analyze alongside database warehouse (Max 10 files, 15MB/file)"
              >
                {isUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                ) : (
                  <Paperclip className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                )}
              </button>

              {isLoading && (
                <span className="hidden sm:inline-flex text-[11px] font-mono text-slate-400 select-none mr-0.5">
                  Press <kbd className="px-1 py-0.5 text-[10px] bg-slate-800 rounded border border-slate-700 text-slate-300">Esc</kbd>
                </span>
              )}
              {isLoading ? (
                <button
                  type="button"
                  onClick={onCancel}
                  aria-label="Cancel analytical process (Esc)"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 hover:text-white transition-all shadow-sm cursor-pointer border border-slate-700/80 active:scale-95 shrink-0"
                  title="Cancel analytical process (Esc)"
                >
                  <Square className="w-3 h-3 fill-rose-400 text-rose-400" />
                  <span className="text-xs font-medium font-sans">Cancel</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isUploading || !query.trim()}
                  aria-label="Send query (Enter)"
                  className="p-2 rounded-xl bg-clay-600 hover:bg-clay-500 disabled:opacity-30 disabled:hover:bg-clay-600 text-white transition shadow-sm cursor-pointer disabled:cursor-not-allowed shrink-0"
                  title="Send (Enter)"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>
        </form>

        {/* AI Disclaimer / Safety Notice */}
        <p className="mt-2 text-center text-[11px] text-slate-500 font-sans select-none tracking-normal">
          Harmonix can make mistakes. Always verify critical data and analytical calculations.
        </p>
      </div>

      {/* Uploaded Table Schema Inspector & Data Health Modal */}
      <UploadedTableModal
        isOpen={!!selectedTableForModal}
        table={selectedTableForModal}
        sessionId={sessionId}
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

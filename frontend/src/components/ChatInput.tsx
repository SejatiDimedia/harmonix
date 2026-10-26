import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, ChevronDown } from 'lucide-react';
import { EngineType, ModelCatalogResponse } from '../types';
import { formatModelNameShort } from '../utils/formatters';
import { ModelPickerPopover } from './ModelPickerPopover';

interface ChatInputProps {
  isLoading: boolean;
  engine: EngineType;
  catalog: ModelCatalogResponse | null;
  activeProvider: string;
  activeModel: string;
  onSetEngine: (engine: EngineType) => void;
  onSelectModel: (provider: string, modelId: string) => void;
  onOpenFullModelModal: () => void;
  onSubmit: (query: string) => void;
}

const ChatInputComponent: React.FC<ChatInputProps> = ({
  isLoading,
  engine,
  catalog,
  activeProvider,
  activeModel,
  onSetEngine,
  onSelectModel,
  onOpenFullModelModal,
  onSubmit,
}) => {
  const [query, setQuery] = useState('');
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (!q || isLoading) return;
    onSubmit(q);
    setQuery('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

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
          {/* Text input */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tanyakan analisis data... (contoh: 'Tampilkan tren penjualan bulanan dalam grafik bar')"
            className="w-full bg-transparent px-4 pt-3.5 pb-2 text-sm text-[#f5f4ef] placeholder-[#78756d] focus:outline-none resize-none leading-relaxed font-sans max-h-44"
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1 border-t border-[#262421]/60">
            {/* Left Controls: Model Picker & Engine Toggle */}
            <div className="flex items-center gap-2 relative">
              {/* Model Picker Button & Popover */}
              <button
                type="button"
                onClick={() => setIsPopoverOpen(!isPopoverOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono bg-[#22211e] hover:bg-[#282623] border border-[#383632] text-[#d6d4cb] hover:text-white transition cursor-pointer"
                title={`Model Aktif: ${activeProvider.toUpperCase()} (${activeModel})`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-clay-400" />
                <span className="truncate max-w-[140px] sm:max-w-[200px]">
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
              <div className="hidden sm:flex items-center bg-[#22211e] border border-[#383632] rounded-xl p-0.5 text-xs font-mono select-none">
                <button
                  type="button"
                  onClick={() => onSetEngine('manual')}
                  className={`px-2 py-0.5 rounded-lg font-medium transition cursor-pointer ${
                    engine === 'manual'
                      ? 'text-white bg-clay-600 shadow-sm'
                      : 'text-[#9c9990] hover:text-white'
                  }`}
                  title="Manual Agent Loop (Zero-Latency, Bound Steps)"
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
                  title="LangGraph StateGraph Engine"
                >
                  LangGraph
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="p-2 rounded-xl bg-clay-600 hover:bg-clay-500 disabled:opacity-30 disabled:hover:bg-clay-600 text-white transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
              title="Kirim (Enter)"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </form>

        <div className="text-center text-[10px] text-[#7a7770] pt-2 font-mono select-none">
          Harnessly v1.5 — 100% Zero-Cost Multi-Tier (Ollama / Groq / Gemini / OpenRouter Free / 9Router)
        </div>
      </div>
    </div>
  );
};

export const ChatInput = React.memo(ChatInputComponent);

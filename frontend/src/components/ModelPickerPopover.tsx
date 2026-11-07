import React, { useEffect, useRef } from 'react';
import { Sliders, Check, Cpu } from 'lucide-react';
import { EngineType, ModelCatalogResponse } from '../types';
import { formatModelNameShort } from '../utils/formatters';

interface ModelPickerPopoverProps {
  isOpen: boolean;
  catalog: ModelCatalogResponse | null;
  activeProvider: string;
  activeModel: string;
  engine: EngineType;
  onSetEngine: (engine: EngineType) => void;
  onSelectModel: (provider: string, modelId: string) => void;
  onOpenFullModal: () => void;
  onClose: () => void;
}

export const ModelPickerPopover: React.FC<ModelPickerPopoverProps> = ({
  isOpen,
  catalog,
  activeProvider,
  activeModel,
  engine,
  onSetEngine,
  onSelectModel,
  onOpenFullModal,
  onClose,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !catalog) return null;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Pilih Model dan Engine Analisis"
      className="absolute bottom-full left-0 mb-2 w-84 max-h-[420px] bg-[#0f1a2e] border border-white/[0.08] rounded-2xl shadow-2xl p-2 z-50 overflow-hidden flex flex-col font-sans"
    >
      <div className="px-3 py-2 border-b border-white/[0.04] flex items-center justify-between text-xs font-medium text-[#f8fafc] select-none">
        <span className="font-sans font-semibold flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-sky-400" />
          <span>Model & Engine</span>
        </span>
        <button
          type="button"
          onClick={onOpenFullModal}
          className="text-[11px] font-mono text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer transition"
        >
          <Sliders className="w-3 h-3" />
          <span>Kelola Detail</span>
        </button>
      </div>

      {/* Execution Engine Selector */}
      <div className="p-2 border-b border-white/[0.06] bg-[#0b1424]/80 rounded-xl m-1 mb-2">
        <div className="flex items-center justify-between text-[10px] font-mono font-medium text-slate-400 mb-1.5 px-0.5 select-none">
          <span className="uppercase tracking-wider">Engine Orkestrasi</span>
          <span className="text-sky-300 font-sans text-[11px] font-medium">
            {engine === 'manual' ? 'Manual Loop' : engine === 'langgraph' ? 'LangGraph' : 'Multi-Agent Swarm'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#070d18] rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => onSetEngine('manual')}
            className={`py-1.5 px-2 rounded-md text-xs font-sans font-medium transition cursor-pointer text-center ${
              engine === 'manual'
                ? 'bg-slate-800 text-sky-300 font-semibold shadow-sm border border-slate-700/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
            title="Deterministic Loop: Cepat & hemat kuota"
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => onSetEngine('langgraph')}
            className={`py-1.5 px-2 rounded-md text-xs font-sans font-medium transition cursor-pointer text-center ${
              engine === 'langgraph'
                ? 'bg-slate-800 text-sky-300 font-semibold shadow-sm border border-slate-700/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
            title="LangGraph Graph Workflow"
          >
            LangGraph
          </button>
          <button
            type="button"
            onClick={() => onSetEngine('swarm')}
            className={`py-1.5 px-2 rounded-md text-xs font-sans font-medium transition cursor-pointer text-center ${
              engine === 'swarm'
                ? 'bg-slate-800 text-sky-300 font-semibold shadow-sm border border-slate-700/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
            title="Multi-Agent Swarm: Planner-Executor & Spesialis"
          >
            Swarm
          </button>
        </div>
      </div>

      <div className="overflow-y-auto max-h-72 p-1 space-y-2">
        {catalog.providers.map((p) => {
          if (!p.available_models || p.available_models.length === 0) return null;
          return (
            <div key={p.provider} className="border-b border-white/[0.04] pb-2 last:border-b-0 last:pb-0">
              <div className="px-3 py-1 flex items-center justify-between text-[10px] font-mono font-medium text-[#94a3b8] uppercase tracking-wider select-none">
                <span>{p.display_name}</span>
                <span className={`text-[9px] ${p.is_ready ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {p.is_ready ? 'SIAP' : 'OFFLINE'}
                </span>
              </div>

              <div className="space-y-0.5 mt-1">
                {p.available_models.map((m) => {
                  const isSelected =
                    p.provider === activeProvider && m.id === activeModel;
                  const shortName = formatModelNameShort(m.id) || m.name;

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectModel(p.provider, m.id)}
                      className={`w-full text-left px-3 py-1.5 rounded-xl text-xs flex items-center justify-between transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#182a47] text-[#f8fafc] font-medium shadow-sm'
                          : 'text-[#94a3b8] hover:bg-[#14223b] hover:text-[#f8fafc]'
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="truncate font-sans">{shortName}</span>
                        <span className="text-[10px] text-[#94a3b8] font-mono truncate">
                          {m.id}
                        </span>
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-clay-400 shrink-0 font-mono" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

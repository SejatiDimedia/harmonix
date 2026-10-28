import React, { useEffect, useRef } from 'react';
import { Sliders, Check } from 'lucide-react';
import { ModelCatalogResponse } from '../types';
import { formatModelNameShort } from '../utils/formatters';

interface ModelPickerPopoverProps {
  isOpen: boolean;
  catalog: ModelCatalogResponse | null;
  activeProvider: string;
  activeModel: string;
  onSelectModel: (provider: string, modelId: string) => void;
  onOpenFullModal: () => void;
  onClose: () => void;
}

export const ModelPickerPopover: React.FC<ModelPickerPopoverProps> = ({
  isOpen,
  catalog,
  activeProvider,
  activeModel,
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
      aria-label="Pilih Model Analisis"
      className="absolute bottom-full left-0 mb-2 w-80 max-h-96 bg-[#1e1d1a] border border-[#383632] rounded-2xl shadow-2xl p-2 z-50 overflow-hidden flex flex-col font-sans"
    >
      <div className="px-3 py-2 border-b border-[#2d2b27] flex items-center justify-between text-xs font-medium text-[#f5f4ef] select-none">
        <span className="font-sans font-semibold">Pilih Model Analisis</span>
        <button
          type="button"
          onClick={onOpenFullModal}
          className="text-[11px] font-mono text-clay-400 hover:text-clay-300 flex items-center gap-1 cursor-pointer transition"
        >
          <Sliders className="w-3 h-3" />
          <span>Kelola Detail</span>
        </button>
      </div>

      <div className="overflow-y-auto max-h-72 p-1 space-y-2">
        {catalog.providers.map((p) => {
          if (!p.available_models || p.available_models.length === 0) return null;
          return (
            <div key={p.provider} className="border-b border-[#2d2b27] pb-2 last:border-b-0 last:pb-0">
              <div className="px-3 py-1 flex items-center justify-between text-[10px] font-mono font-medium text-[#9c9990] uppercase tracking-wider select-none">
                <span>{p.display_name}</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    p.is_ready ? 'bg-emerald-400' : 'bg-amber-500'
                  }`}
                />
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
                          ? 'bg-clay-600/20 text-[#f5f4ef] font-medium border border-clay-500/40 shadow-sm'
                          : 'text-[#d6d4cb] hover:bg-[#282623] hover:text-white border border-transparent'
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="truncate font-sans">{shortName}</span>
                        <span className="text-[10px] text-[#8e8b82] font-mono truncate">
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

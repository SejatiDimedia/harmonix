import React from 'react';
import { Compass, CornerDownRight } from 'lucide-react';

interface FollowUpChipsProps {
  suggestions?: string[];
  onSelect: (text: string) => void;
}

export const FollowUpChips: React.FC<FollowUpChipsProps> = ({ suggestions, onSelect }) => {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="mt-3.5 pt-3 border-t border-[#1e3557]">
      <div className="text-[11px] font-medium text-[#94a3b8] flex items-center gap-1.5 mb-2 font-mono">
        <Compass className="w-3.5 h-3.5 text-clay-400" />
        <span>Eksplorasi Analisis Lanjutan</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((text, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelect(text)}
            className="text-left text-xs text-[#94a3b8] hover:text-[#f8fafc] bg-[#14223b] hover:bg-[#182a47] border border-[#1e3557] hover:border-clay-500/50 rounded-xl px-3 py-1.5 transition-all shadow-sm flex items-center gap-1.5 group cursor-pointer"
          >
            <CornerDownRight className="w-3.5 h-3.5 text-clay-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            <span>{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

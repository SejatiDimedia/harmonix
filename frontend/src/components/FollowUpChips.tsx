import React from 'react';
import { Compass, ArrowRight } from 'lucide-react';

interface FollowUpChipsProps {
  suggestions?: string[];
  onSelect: (text: string) => void;
}

export const FollowUpChips: React.FC<FollowUpChipsProps> = ({ suggestions, onSelect }) => {
  if (!suggestions || suggestions.length === 0) return null;

  const cleanText = (raw: string) => {
    return raw
      .replace(/^[↳→•\-\*\s]+/, '')
      .replace(/^\[+(.*?)\]+$/, '$1')
      .replace(/^\(+(.*?)\)+$/, '$1')
      .replace(/^["']+|["']+$/g, '')
      .trim();
  };

  const cleanedSuggestions = suggestions
    .map(cleanText)
    .filter(Boolean);

  if (cleanedSuggestions.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-white/[0.06]">
      <div className="text-[11px] font-medium text-[#94a3b8] flex items-center gap-1.5 mb-2.5 font-mono">
        <Compass className="w-3.5 h-3.5 text-clay-400" />
        <span>Eksplorasi Analisis Lanjutan</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {cleanedSuggestions.map((text, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelect(text)}
            className="group text-left text-xs text-[#cbd5e1] hover:text-[#f8fafc] bg-[#101b30] hover:bg-[#15243f] border border-white/[0.06] hover:border-clay-400/40 rounded-xl px-3.5 py-2 transition-all shadow-sm flex items-center justify-between gap-2.5 cursor-pointer"
          >
            <span className="font-sans leading-snug">{text}</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#64748b] group-hover:text-clay-400 group-hover:translate-x-0.5 transition-all shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};

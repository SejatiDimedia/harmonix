import React from 'react';
import { Compass, ArrowRight } from 'lucide-react';
import { Button } from './ui';

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
      <div className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mb-2.5 font-mono">
        <Compass className="w-3.5 h-3.5 text-sky-400" />
        <span>Eksplorasi Analisis Lanjutan</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {cleanedSuggestions.map((text, idx) => (
          <Button
            key={idx}
            variant="secondary"
            size="sm"
            onClick={() => onSelect(text)}
            className="text-left font-normal text-slate-200 hover:text-white rounded-xl py-2 px-3.5 shadow-sm"
            rightIcon={
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all shrink-0" />
            }
          >
            <span className="leading-snug">{text}</span>
          </Button>
        ))}
      </div>
    </div>
  );
};

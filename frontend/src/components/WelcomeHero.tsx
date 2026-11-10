import React from 'react';
import { ArrowUpRight } from 'lucide-react';

interface WelcomeHeroProps {
  onSelectPrompt: (query: string) => void;
}

const QUICK_PROMPTS = [
  'What is the total revenue and order volume in the latest quarter?',
  'Show top 5 customers by total transaction amount',
  'Compare sales revenue per product category in a bar chart',
  'Analyze order fulfillment status trends (delivered, shipped, canceled)',
];

const WelcomeHeroComponent: React.FC<WelcomeHeroProps> = ({ onSelectPrompt }) => {
  return (
    <div className="py-12 md:py-16 text-center space-y-7 max-w-2xl mx-auto px-4 select-none">
      <div className="inline-block">
        <img
          src="/static/logo.png?v=2"
          alt="Harmonix Logo"
          className="w-16 h-16 rounded-2xl mx-auto shadow-xl object-cover"
        />
      </div>

      <div className="space-y-2.5">
        <h2 className="text-2xl md:text-3xl font-serif italic text-[#f8fafc] tracking-tight">
          Enterprise Data Analytics Intelligence
        </h2>
        <p className="text-xs md:text-sm text-[#94a3b8] leading-relaxed max-w-lg mx-auto font-sans">
          Ask business questions in natural language. Powered by secure Text-to-SQL execution, strict privacy protection, automated audit verification, and interactive visualizations.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 text-left">
        {QUICK_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectPrompt(prompt)}
            className="group flex items-start justify-between gap-3 p-3.5 rounded-xl bg-[#0f1a2e] hover:bg-[#14223b] transition shadow-sm hover:shadow-md cursor-pointer"
          >
            <span className="text-xs text-[#94a3b8] group-hover:text-[#f8fafc] leading-relaxed font-sans transition">
              {prompt}
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-clay-400 shrink-0 mt-0.5 transition" />
          </button>
        ))}
      </div>
    </div>
  );
};

export const WelcomeHero = React.memo(WelcomeHeroComponent);

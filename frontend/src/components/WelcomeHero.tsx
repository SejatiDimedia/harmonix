import React from 'react';
import { Sparkles } from 'lucide-react';

interface WelcomeHeroProps {
  onSelectPrompt: (query: string) => void;
}

const QUICK_PROMPTS = [
  'Berapa total GMV dan jumlah pesanan di kuartal terakhir?',
  'Tampilkan 5 pelanggan teratas berdasarkan total belanja',
  'Buatkan grafik batang penjualan per kategori produk',
  'Analisis tren status pengiriman pesanan (delivered, shipped, canceled)',
];

export const WelcomeHero: React.FC<WelcomeHeroProps> = ({ onSelectPrompt }) => {
  return (
    <div className="py-12 md:py-16 text-center space-y-6 max-w-xl mx-auto px-4 select-none">
      <div className="relative inline-block">
        <img
          src="/static/favicon.png"
          alt="Harnessly Logo"
          className="w-16 h-16 rounded-2xl mx-auto shadow-2xl border border-clay-500/40 p-0.5 object-cover"
        />
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-clay-500 border-2 border-[#161513] flex items-center justify-center text-[10px] text-white">
          <Sparkles className="w-3 h-3" />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl md:text-3xl font-serif italic text-[#f5f4ef] tracking-tight">
          Asisten Analitik Data Enterprise
        </h2>
        <p className="text-xs md:text-sm text-[#9c9990] leading-relaxed max-w-md mx-auto font-sans">
          Ajukan pertanyaan bisnis dalam bahasa alami. Sistem mengeksekusi Text-to-SQL dengan 5 lapis pengaman: AST guardrails, PII masking, maker-checker auditor, dan visualisasi interaktif.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {QUICK_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectPrompt(prompt)}
            className="text-xs bg-[#1b1a18] hover:bg-[#242320] text-[#a3a097] hover:text-[#f5f4ef] border border-[#2e2c28] hover:border-clay-500/50 rounded-xl px-3.5 py-2 transition-all shadow-sm cursor-pointer text-left"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
};

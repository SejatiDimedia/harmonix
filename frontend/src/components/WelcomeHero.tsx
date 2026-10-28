import React from 'react';
import { ArrowUpRight } from 'lucide-react';

interface WelcomeHeroProps {
  onSelectPrompt: (query: string) => void;
}

const QUICK_PROMPTS = [
  'Berapa total GMV dan jumlah pesanan di kuartal terakhir?',
  'Tampilkan 5 pelanggan teratas berdasarkan total belanja',
  'Buatkan grafik batang penjualan per kategori produk',
  'Analisis tren status pengiriman pesanan (delivered, shipped, canceled)',
];

const WelcomeHeroComponent: React.FC<WelcomeHeroProps> = ({ onSelectPrompt }) => {
  return (
    <div className="py-12 md:py-16 text-center space-y-7 max-w-2xl mx-auto px-4 select-none">
      <div className="inline-block">
        <img
          src="/static/favicon.png"
          alt="Harmonix Logo"
          className="w-16 h-16 rounded-2xl mx-auto shadow-xl border border-[#1e3557] p-0.5 object-cover"
        />
      </div>

      <div className="space-y-2.5">
        <h2 className="text-2xl md:text-3xl font-serif italic text-[#f8fafc] tracking-tight">
          Asisten Analitik Data Enterprise
        </h2>
        <p className="text-xs md:text-sm text-[#94a3b8] leading-relaxed max-w-lg mx-auto font-sans">
          Ajukan pertanyaan bisnis dalam bahasa alami. Sistem mengeksekusi Text-to-SQL dengan proteksi privasi ketat, verifikasi akurasi data otomatis, dan visualisasi interaktif.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 text-left">
        {QUICK_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectPrompt(prompt)}
            className="group flex items-start justify-between gap-3 p-3.5 rounded-xl bg-[#0f1a2e] hover:bg-[#14223b] border border-[#1e3557] hover:border-[#25416c] transition shadow-sm cursor-pointer"
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

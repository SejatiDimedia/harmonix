import React, { useState, useEffect, useRef } from 'react';
import {
  Palette,
  Check,
  Copy,
  LayoutDashboard,
  SlidersHorizontal,
  Maximize2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  ChevronDown,
  FileText,
  Sliders,
  Send,
  Loader2,
  Trash2,
  Eye,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface DesignSystemCatalogProps {
  showToast?: (msg: string) => void;
  onBack?: () => void;
}

export const DesignSystemCatalog: React.FC<DesignSystemCatalogProps> = ({ showToast, onBack }) => {
  const [activeCategory, setActiveCategory] = useState<'all' | 'colors' | 'buttons' | 'cards' | 'modals' | 'forms' | 'states'>('all');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Live Interactive Modal States
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isDemoConfirmOpen, setIsDemoConfirmOpen] = useState(false);
  const [isDemoPopoverOpen, setIsDemoPopoverOpen] = useState(false);
  const [demoPopoverValue, setDemoPopoverValue] = useState('30 detik');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Live Button Demo States
  const [buttonLoading, setButtonLoading] = useState(false);
  const [segmentedActive, setSegmentedActive] = useState<'fit' | 'layout'>('fit');

  // Live Form Demo States
  const [demoInputText, setDemoInputText] = useState('');
  const [demoSelect, setDemoSelect] = useState('groq');

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(label);
    if (showToast) showToast(`Disalin: ${text}`);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  // Close popover on outside click
  useEffect(() => {
    if (!isDemoPopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsDemoPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDemoPopoverOpen]);

  // Escape key closes modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDemoModalOpen(false);
        setIsDemoConfirmOpen(false);
        setIsDemoPopoverOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const colorTokens = [
    { name: 'Canvas Base', hex: '#080f1d', tailwind: 'bg-[#080f1d]', role: 'Latar belakang dasar seluruh aplikasi' },
    { name: 'Nav / Header', hex: '#0b1424', tailwind: 'bg-[#0b1424]', role: 'Navbar sticky, header TV command center' },
    { name: 'Container Surface', hex: '#0f1a2e', tailwind: 'bg-[#0f1a2e]', role: 'Kartu canvas, kontainer panel utama' },
    { name: 'Elevated Surface', hex: '#14223b', tailwind: 'bg-[#14223b]', role: 'Pill segmented, popover model, active items' },
    { name: 'Surface Hover', hex: '#1a2d4e', tailwind: 'hover:bg-[#1a2d4e]', role: 'Status hover pada elemen interaktif' },
    { name: 'Primary Action', hex: '#0277bd', tailwind: 'bg-clay-600', role: 'Tombol aksi utama (Submit, Eksekusi)' },
    { name: 'Primary Hover', hex: '#0284c7', tailwind: 'hover:bg-clay-500', role: 'Status hover tombol utama' },
    { name: 'Accent / Focus', hex: '#38bdf8', tailwind: 'text-sky-400 / #38bdf8', role: 'Ring fokus aksesibilitas & ikon aktif' },
    { name: 'Inline Code / Link', hex: '#7dd3fc', tailwind: 'text-sky-300', role: 'Teks sintaks kode dan tautan aksen' },
    { name: 'Semantic Success', hex: '#34d399', tailwind: 'text-emerald-400', role: 'Database sehat, verifikasi read-only' },
    { name: 'Semantic Warning', hex: '#fbbf24', tailwind: 'text-amber-400', role: 'Peringatan kuota, status degraded' },
    { name: 'Semantic Danger', hex: '#f87171', tailwind: 'text-rose-400', role: 'Hapus sesi, batalkan proses, galat' },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 scroll-smooth bg-[#080f1d] text-[#f8fafc]">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header Hero Section */}
        <div className="p-6 rounded-2xl bg-[#0f1a2e] border border-white/[0.06] shadow-sm">
          {onBack && (
            <div className="mb-4">
              <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#14223b] hover:bg-[#1a2d4e] text-slate-300 hover:text-white border border-white/[0.06] text-xs font-sans transition cursor-pointer shadow-sm"
              >
                <ArrowRight className="w-3.5 h-3.5 rotate-180 text-sky-400" />
                <span>Kembali ke Aplikasi Utama</span>
              </button>
            </div>
          )}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400">
                  <Palette className="w-5 h-5" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-[#f8fafc]">
                  Harmonix Design System
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 font-semibold">
                  v2.4 • Anti-Slop
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 font-sans leading-relaxed max-w-3xl">
                Katalog token desain, palet warna, tipografi, dan komponen antarmuka resmi Harmonix. Dibuat dengan standar ketat <strong>Anti-Slop Craftsmanship (C-1 sampai C-5)</strong> untuk memastikan seluruh antarmuka terasa tenang, berbobot, konsisten, dan bebas dari AI slop.
              </p>
            </div>

            {/* Quick Principles Pill */}
            <div className="flex flex-wrap md:flex-col items-start md:items-end gap-1.5 text-[11px] font-mono text-slate-400 shrink-0">
              <span className="px-2 py-0.5 rounded bg-[#14223b] border border-white/[0.06]">
                ENERGY: 2 • Refined
              </span>
              <span className="px-2 py-0.5 rounded bg-[#14223b] border border-white/[0.06]">
                RHYTHM: 2 • Structured
              </span>
              <span className="px-2 py-0.5 rounded bg-[#14223b] border border-white/[0.06]">
                WCAG 2.1 AA Compliant
              </span>
            </div>
          </div>

          {/* Navigation Category Filters */}
          <div className="flex items-center gap-1.5 mt-6 pt-4 border-t border-white/[0.06] overflow-x-auto pb-1 text-xs select-none">
            {[
              { id: 'all', label: 'Semua Komponen' },
              { id: 'colors', label: 'Palet Warna' },
              { id: 'buttons', label: 'Tombol & Aksi' },
              { id: 'cards', label: 'Kartu & Kontainer' },
              { id: 'modals', label: 'Modal & Popover' },
              { id: 'forms', label: 'Form & Input' },
              { id: 'states', label: 'UI States (R-27)' },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id as any)}
                className={`px-3 py-1.5 rounded-lg font-sans font-medium transition cursor-pointer shrink-0 ${
                  activeCategory === cat.id
                    ? 'bg-sky-500/20 text-sky-300 shadow-sm'
                    : 'bg-[#14223b]/60 text-slate-400 hover:text-white hover:bg-[#14223b]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* SECTION 1: COLOR TOKENS */}
        {(activeCategory === 'all' || activeCategory === 'colors') && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold font-sans text-slate-100 flex items-center gap-2">
                  <span>1. Palet Warna & Token Permukaan</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Palet midnight navy yang tenang dengan rasio kontras tinggi, menolak gradien pelangi dan neon berlebihan.
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                Klik kartu untuk menyalin Hex
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {colorTokens.map((c) => (
                <div
                  key={c.name}
                  onClick={() => handleCopy(c.hex, c.name)}
                  className="group relative p-3.5 rounded-xl bg-[#0f1a2e] border border-white/[0.06] hover:border-white/[0.15] transition-all cursor-pointer shadow-sm flex flex-col justify-between"
                  title="Klik untuk menyalin kode Hex"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className="w-10 h-10 rounded-lg shadow-inner border border-white/10 shrink-0"
                      style={{ backgroundColor: c.hex }}
                    />
                    <button
                      type="button"
                      aria-label={`Salin kode hex ${c.name}`}
                      className="p-1 rounded text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition"
                    >
                      {copiedToken === c.name ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div>
                    <span className="text-xs font-semibold text-slate-200 block truncate font-sans">
                      {c.name}
                    </span>
                    <span className="text-[11px] font-mono text-sky-400 font-medium block mt-0.5">
                      {c.hex}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {c.role}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* SECTION 2: BUTTONS & INTERACTIVE CONTROLS */}
        {(activeCategory === 'all' || activeCategory === 'buttons') && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold font-sans text-slate-100 flex items-center gap-2">
                <span>2. Sistem Tombol & Segmented Control</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Hirarki tombol deterministik dengan status aktif, loading, dan fokus aksesibilitas.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#0f1a2e] border border-white/[0.06] space-y-6">
              {/* Row A: Action Buttons */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono uppercase text-slate-400 font-semibold tracking-wider">
                  A. Tingkatan Tombol Aksi (Button Variants)
                </span>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {/* Primary CTA */}
                  <button
                    type="button"
                    onClick={() => {
                      setButtonLoading(true);
                      setTimeout(() => setButtonLoading(false), 1200);
                      if (showToast) showToast('Aksi Utama dieksekusi');
                    }}
                    disabled={buttonLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-clay-600 hover:bg-clay-500 active:bg-clay-700 text-white font-medium text-xs shadow-sm transition cursor-pointer disabled:opacity-50"
                  >
                    {buttonLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                    ) : (
                      <Send className="w-3.5 h-3.5 stroke-[2.5]" />
                    )}
                    <span>Primary Action</span>
                  </button>

                  {/* Secondary Outline */}
                  <button
                    type="button"
                    onClick={() => showToast?.('Secondary Button diklik')}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 hover:text-white font-medium text-xs border border-slate-700/80 transition cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5 text-slate-300" />
                    <span>Secondary Button</span>
                  </button>

                  {/* Subtle / Ghost */}
                  <button
                    type="button"
                    onClick={() => showToast?.('Ghost Button diklik')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-[#14223b] border border-transparent hover:border-slate-800/80 text-xs font-sans transition cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Ghost Action</span>
                  </button>

                  {/* Destructive */}
                  <button
                    type="button"
                    onClick={() => showToast?.('Destructive Button diklik')}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-medium text-xs font-sans transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Destructive</span>
                  </button>

                  {/* Disabled Demo */}
                  <button
                    type="button"
                    disabled
                    className="px-3.5 py-2 rounded-xl bg-slate-800/40 text-slate-500 border border-slate-800 text-xs font-sans cursor-not-allowed opacity-50"
                  >
                    Disabled State
                  </button>
                </div>
              </div>

              {/* Row B: TV / Kiosk Minimalist Segmented Pill */}
              <div className="space-y-2 pt-4 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase text-slate-400 font-semibold tracking-wider">
                    B. Unified Segmented Capsule (TV & Kiosk Toolbar)
                  </span>
                  <span className="text-[11px] text-slate-400 font-sans">
                    Solusi anti "box soup": menggabungkan tombol terkait dalam satu pill
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {/* Mode Selector Capsule */}
                  <div className="flex items-center bg-[#14223b]/90 border border-white/[0.08] rounded-lg p-0.5 text-xs shadow-sm">
                    <button
                      type="button"
                      onClick={() => setSegmentedActive('fit')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans transition cursor-pointer ${
                        segmentedActive === 'fit'
                          ? 'bg-sky-500/20 text-sky-300 font-medium'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
                      }`}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Fit Layar</span>
                    </button>
                    <div className="h-3 w-px bg-white/[0.08]" />
                    <button
                      type="button"
                      onClick={() => setSegmentedActive('layout')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans transition cursor-pointer ${
                        segmentedActive === 'layout'
                          ? 'bg-sky-500/20 text-sky-300 font-medium'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Tata Letak</span>
                    </button>
                  </div>

                  {/* Compact Icon Strip */}
                  <div className="flex items-center bg-[#14223b]/90 border border-white/[0.08] rounded-lg p-0.5 text-xs shadow-sm">
                    <button
                      type="button"
                      onClick={() => showToast?.('Icon action 1')}
                      aria-label="Contoh aksi ikon 1"
                      className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/[0.05] transition cursor-pointer"
                      title="Contoh tombol utilitas"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => showToast?.('Icon action 2')}
                      aria-label="Contoh aksi ikon 2"
                      className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/[0.05] transition cursor-pointer"
                      title="Contoh tombol utilitas"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                    </button>
                    <div className="h-3 w-px bg-white/[0.08]" />
                    <button
                      type="button"
                      onClick={() => showToast?.('Close button')}
                      aria-label="Tutup utilitas"
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition cursor-pointer"
                      title="Tutup"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 3: CARDS & SURFACES */}
        {(activeCategory === 'all' || activeCategory === 'cards') && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold font-sans text-slate-100 flex items-center gap-2">
                <span>3. Kartu & Permukaan Analitik (Cards & Surfaces)</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Elevasi terukur tanpa bayangan besar melayang atau garis border ganda yang kacau.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* KPI Executive Card */}
              <div className="kpi-summary-card">
                <div>
                  <span className="kpi-summary-label">Total Pendapatan Q3</span>
                  <div className="kpi-summary-value text-slate-100 mt-1">
                    Rp 4,82 Miliar
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs pt-3 mt-3 border-t border-white/[0.04]">
                  <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3 h-3" /> +18.4% YoY
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Audited DB
                  </span>
                </div>
              </div>

              {/* Standard Panel Card */}
              <div className="p-4 rounded-xl bg-[#0f1a2e] border border-white/[0.06] flex flex-col justify-between shadow-sm">
                <div>
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.04]">
                    <span className="text-xs font-semibold text-slate-200 font-sans">
                      Panel Container Standard
                    </span>
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Struktur kartu dasar untuk membungkus tabel, daftar data, atau rangkuman naratif analitik.
                  </p>
                </div>
                <div className="mt-4 pt-2 text-[11px] font-mono text-slate-500">
                  Padding: p-4 • Radius: rounded-xl
                </div>
              </div>

              {/* Interactive Widget Wrapper */}
              <div className="p-4 rounded-xl bg-[#0b1424] border border-white/[0.08] flex flex-col justify-between shadow-md">
                <div>
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/[0.06]">
                    <span className="text-xs font-semibold text-slate-100 font-sans truncate">
                      Widget Visualisasi
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-[#14223b]">
                        SQL Verified
                      </span>
                    </div>
                  </div>
                  <div className="h-20 rounded-lg bg-[#080f1d] border border-white/[0.04] flex items-center justify-center text-slate-500 text-xs font-mono">
                    [Area Rendering Grafik]
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                  <span>12 Kolom Responsive</span>
                  <span className="text-sky-400">Interaktif</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 4: MODALS & OVERLAYS */}
        {(activeCategory === 'all' || activeCategory === 'modals') && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold font-sans text-slate-100 flex items-center gap-2">
                <span>4. Modal, Popover & Dialog Interaktif</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Komponen overlay dengan backdrop blur terukur, fokus keyboard, dan penutupan dengan tombol Escape.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#0f1a2e] border border-white/[0.06] flex flex-wrap items-center gap-4">
              {/* Trigger Standard Modal */}
              <button
                type="button"
                onClick={() => setIsDemoModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/80 text-xs font-medium transition cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span>Uji Standard Modal</span>
              </button>

              {/* Trigger Confirmation Modal */}
              <button
                type="button"
                onClick={() => setIsDemoConfirmOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium transition cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span>Uji Confirmation Modal</span>
              </button>

              {/* Popover Dropdown Demo */}
              <div className="relative inline-block" ref={popoverRef}>
                <button
                  type="button"
                  onClick={() => setIsDemoPopoverOpen((prev) => !prev)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#14223b] hover:bg-[#1a2d4e] text-slate-200 border border-white/[0.08] text-xs font-medium transition cursor-pointer shadow-sm"
                >
                  <span>Pilihan: {demoPopoverValue}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isDemoPopoverOpen ? 'rotate-180' : ''}`} />
                </button>

                {isDemoPopoverOpen && (
                  <div className="absolute left-0 mt-2 w-44 bg-[#0f1b2d] border border-white/[0.1] rounded-xl shadow-2xl py-1 z-50 text-xs backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-3 py-1.5 text-[10px] uppercase font-mono text-slate-400 font-semibold border-b border-white/[0.06]">
                      Opsi Popover
                    </div>
                    {['Nonaktif (Off)', '30 detik', '60 detik', '5 menit'].map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setDemoPopoverValue(item);
                          setIsDemoPopoverOpen(false);
                          showToast?.(`Memilih: ${item}`);
                        }}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between text-xs transition cursor-pointer hover:bg-sky-500/10 ${
                          demoPopoverValue === item ? 'text-sky-400 font-medium bg-sky-500/5' : 'text-slate-300'
                        }`}
                      >
                        <span>{item}</span>
                        {demoPopoverValue === item && <Check className="w-3.5 h-3.5 text-sky-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Standard Modal Dialog */}
            {isDemoModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
                <div className="w-full max-w-lg bg-[#0f1b2d] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-sky-400" />
                      <h3 className="text-base font-semibold text-slate-100 font-sans">
                        Harmonix Standard Modal
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsDemoModalOpen(false)}
                      className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#14223b] transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    Ini adalah cetak biru dialog modal standar Harmonix. Menggunakan latar belakang gelap solid <code>#0f1b2d</code>, padding <code>p-6</code>, tombol penutup keyboard (Escape), dan pembatas halus <code>border-white/[0.06]</code>.
                  </p>

                  <div className="p-3 rounded-xl bg-[#080f1d] border border-white/[0.04] text-xs font-mono text-slate-400">
                    ESC untuk menutup • Fokus otomatis terperangkap di dalam modal
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => setIsDemoModalOpen(false)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-sans transition"
                    >
                      Tutup
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDemoModalOpen(false);
                        showToast?.('Aksi modal berhasil dieksekusi');
                      }}
                      className="px-4 py-1.5 rounded-xl bg-clay-600 hover:bg-clay-500 text-white text-xs font-medium font-sans transition"
                    >
                      Konfirmasi
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Confirmation Destructive Modal Dialog */}
            {isDemoConfirmOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
                <div className="w-full max-w-md bg-[#0f1b2d] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-400 shrink-0">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-100 font-sans">
                        Konfirmasi Tindakan Kritis
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Tindakan ini tidak dapat dibatalkan.
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    Apakah Anda yakin ingin menghapus data atau sesi ini secara permanen dari sistem?
                  </p>

                  <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => setIsDemoConfirmOpen(false)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-sans transition"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDemoConfirmOpen(false);
                        showToast?.('Tindakan kritis disetujui');
                      }}
                      className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium font-sans transition shadow-sm"
                    >
                      Ya, Lanjutkan
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* SECTION 5: FORM CONTROLS & INPUTS */}
        {(activeCategory === 'all' || activeCategory === 'forms') && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold font-sans text-slate-100 flex items-center gap-2">
                <span>5. Kontrol Formulir & Input Data</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Input teks, area teks, dan dropdown dengan focus ring WCAG 2.1 AA (#38bdf8).
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#0f1a2e] border border-white/[0.06] grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Text Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 font-sans block">
                  Input Teks Standar
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={demoInputText}
                    onChange={(e) => setDemoInputText(e.target.value)}
                    placeholder="Ketik pertanyaan atau parameter analitik..."
                    className="w-full bg-[#080f1d] border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-[#f8fafc] placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400 transition"
                  />
                  {demoInputText && (
                    <button
                      type="button"
                      onClick={() => setDemoInputText('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  Helper teks atau instruksi input
                </span>
              </div>

              {/* Select Dropdown */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 font-sans block">
                  Dropdown Pilihan Model / Provider
                </label>
                <select
                  value={demoSelect}
                  onChange={(e) => setDemoSelect(e.target.value)}
                  className="w-full bg-[#080f1d] border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-sky-400 transition cursor-pointer"
                >
                  <option value="groq">Groq • Llama 3.3 70B Versatile</option>
                  <option value="gemini">Google Gemini • 2.5 Flash</option>
                  <option value="openai">OpenAI • GPT-4o Mini</option>
                  <option value="anthropic">Anthropic • Claude 3.5 Sonnet</option>
                </select>
                <span className="text-[10px] text-slate-500 font-mono">
                  State terpilih: {demoSelect.toUpperCase()}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 6: MANDATORY UI STATES (ANTISLOP R-27) */}
        {(activeCategory === 'all' || activeCategory === 'states') && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold font-sans text-slate-100 flex items-center gap-2">
                <span>6. Tiga State Wajib UI (Antislop R-27 Compliance)</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Antislop R-27 mewajibkan setiap komponen data memiliki Empty State, Loading State, dan Error State yang jujur dan informatif.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Empty State */}
              <div className="p-6 rounded-2xl bg-[#0f1a2e] border border-white/[0.06] text-center flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-xl bg-[#14223b] flex items-center justify-center text-slate-400">
                  <LayoutDashboard className="w-6 h-6 text-sky-400" />
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-slate-200 block font-sans">
                    Belum Ada Widget Tersemat
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs">
                    Mulai percakapan data di tab chat, lalu sematkan grafik kunci ke dashboard ini.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => showToast?.('Navigasi ke Chat')}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 font-medium text-xs font-sans transition cursor-pointer"
                >
                  Buka Chat Sekarang
                </button>
              </div>

              {/* Loading State */}
              <div className="p-6 rounded-2xl bg-[#0f1a2e] border border-white/[0.06] text-center flex flex-col items-center justify-center space-y-3">
                <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-slate-200 block font-sans">
                    Menghubungkan ke Data Warehouse
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs">
                    Memverifikasi skema tabel dan integritas read-only PostgreSQL...
                  </p>
                </div>
                <span className="text-[10px] font-mono text-slate-500 px-2 py-0.5 rounded bg-[#14223b]">
                  Latency: 42ms
                </span>
              </div>

              {/* Error State */}
              <div className="p-6 rounded-2xl bg-[#0f1a2e] border border-white/[0.06] text-center flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-xl bg-rose-500/15 flex items-center justify-center text-rose-400">
                  <XCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-rose-200 block font-sans">
                    Gagal Mengeksekusi Analitik
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs">
                    Koneksi database terputus atau batas kuota model terlampaui.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => showToast?.('Mencoba menyambungkan kembali...')}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 font-medium text-xs font-sans hover:bg-rose-500/30 transition cursor-pointer"
                >
                  Coba Ulang
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};


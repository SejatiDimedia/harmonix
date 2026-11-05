import React from 'react';
import { PanelLeft, Activity, MessageSquare, LayoutDashboard } from 'lucide-react';
import { HealthStatus, ActiveTab } from '../types';

interface NavbarProps {
  health: HealthStatus | null;
  activeTab: ActiveTab;
  widgetCount?: number;
  onSelectTab: (tab: ActiveTab) => void;
  onToggleSidebar: () => void;
  onOpenMetrics: () => void;
}

const NavbarComponent: React.FC<NavbarProps> = ({
  health,
  activeTab,
  widgetCount = 0,
  onSelectTab,
  onToggleSidebar,
  onOpenMetrics,
}) => {
  return (
    <header className="h-14 border-b border-white/[0.06] bg-[#0b1526]/90 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0 gap-2">
      {/* Left: Brand & Sidebar Toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Buka atau tutup riwayat percakapan"
          className="p-1.5 rounded-lg text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] transition cursor-pointer"
          title="Buka / Tutup Riwayat"
        >
          <PanelLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 select-none">
          <img
            src="/static/logo.png?v=2"
            alt="Harmonix Logo"
            className="w-8 h-8 rounded-lg object-cover shadow-sm shrink-0"
          />
          <div className="flex flex-col hidden sm:flex">
            <span className="text-sm font-semibold tracking-tight text-[#f8fafc] leading-tight font-sans">
              Harmonix
            </span>
            <span className="text-[10px] text-[#94a3b8] font-mono leading-none">
              Analytics Agent
            </span>
          </div>
        </div>
      </div>

      {/* Center: Navigation Tabs (Chat vs Live BI Dashboard) */}
      <div role="tablist" aria-label="Tampilan Utama" className="flex items-center rounded-xl bg-[#0f1a2e] p-1 shadow-inner shadow-black/20">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'chat'}
          onClick={() => onSelectTab('chat')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${activeTab === 'chat'
            ? 'bg-clay-600 text-white shadow-sm'
            : 'text-[#94a3b8] hover:text-[#f8fafc]'
            }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Percakapan</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'dashboard'}
          onClick={() => onSelectTab('dashboard')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${activeTab === 'dashboard'
            ? 'bg-clay-600 text-white shadow-sm'
            : 'text-[#94a3b8] hover:text-[#f8fafc]'
            }`}
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          <span>Live Dashboard</span>
          {widgetCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono font-bold">
              {widgetCount}
            </span>
          )}
        </button>
      </div>

      {/* Right: Health Badge & Observability Trigger */}
      <div className="flex items-center gap-2">
        <div
          className="hidden md:flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono bg-[#0f1a2e] text-[#94a3b8] select-none"
          title={
            health
              ? `Provider: ${health.llm_provider} | Database: ${health.database_connected ? 'Connected' : 'Disconnected'
              }`
              : 'Memuat status...'
          }
        >
          {/* <span>
            {health ? `${health.llm_provider.toUpperCase()} (${health.status})` : 'CHECKING...'}
          </span> */}
        </div>

        <button
          type="button"
          onClick={onOpenMetrics}
          aria-label="Buka observabilitas dan metrik sistem"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] transition cursor-pointer"
          title="Observabilitas & Metrik"
        >
          <Activity className="w-3.5 h-3.5 text-clay-400" />
          <span className="hidden sm:inline">Metrik</span>
        </button>
      </div>
    </header>
  );
};

export const Navbar = React.memo(NavbarComponent);

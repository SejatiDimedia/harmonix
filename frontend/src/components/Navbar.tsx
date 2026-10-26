import React from 'react';
import { PanelLeft, Activity } from 'lucide-react';
import { HealthStatus } from '../types';

interface NavbarProps {
  health: HealthStatus | null;
  onToggleSidebar: () => void;
  onOpenMetrics: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  health,
  onToggleSidebar,
  onOpenMetrics,
}) => {
  return (
    <header className="h-14 border-b border-[#2e2c28] bg-[#161513]/90 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-1.5 rounded-lg text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#201f1d] transition cursor-pointer"
          title="Buka / Tutup Riwayat"
        >
          <PanelLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 select-none">
          <img
            src="/static/favicon.png"
            alt="Harnessly Logo"
            className="w-8 h-8 rounded-lg object-cover shadow-sm border border-clay-500/30 shrink-0"
          />
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-[#f5f4ef] leading-tight font-sans">
              Harnessly
            </span>
            <span className="text-[10px] text-[#8e8b82] font-mono leading-none">
              Data Analyst Agent
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-[#1b1a18] border border-[#2e2c28] text-[#9c9990] select-none"
          title={health ? `Provider: ${health.llm_provider} | Database: ${health.database_connected ? 'Connected' : 'Disconnected'}` : 'Memuat status...'}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              health?.status === 'healthy'
                ? 'bg-emerald-500 animate-pulse'
                : health?.status === 'degraded'
                ? 'bg-amber-500'
                : 'bg-rose-500'
            }`}
          />
          <span>{health ? `${health.llm_provider.toUpperCase()} (${health.status})` : 'CHECKING...'}</span>
        </div>

        <button
          type="button"
          onClick={onOpenMetrics}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono text-[#9c9990] hover:text-[#f5f4ef] hover:bg-[#201f1d] border border-transparent hover:border-[#2e2c28] transition cursor-pointer"
          title="Observabilitas & Metrik"
        >
          <Activity className="w-3.5 h-3.5 text-clay-400" />
          <span className="hidden sm:inline">Metrik</span>
        </button>
      </div>
    </header>
  );
};

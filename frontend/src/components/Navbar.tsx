import React from 'react';
import { PanelLeft, Activity } from 'lucide-react';
import { HealthStatus, ActiveTab } from '../types';

interface NavbarProps {
  health: HealthStatus | null;
  activeTab: ActiveTab;
  isSidebarOpen?: boolean;
  isMetricsOpen?: boolean;
  onToggleSidebar: () => void;
  onOpenMetrics: () => void;
}

const NavbarComponent: React.FC<NavbarProps> = ({
  health,
  activeTab,
  isSidebarOpen = true,
  isMetricsOpen = false,
  onToggleSidebar,
  onOpenMetrics,
}) => {
  const getTabTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return 'Live BI Dashboard';
      case 'batch':
        return 'Bulk Analytics';
      case 'chat':
      default:
        return 'Percakapan Analitik';
    }
  };

  return (
    <header className="h-14 border-b border-white/[0.06] bg-[#0b1526]/90 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0 gap-3">
      {/* Left: Sidebar Toggle (when sidebar is hidden) & Section Title Breadcrumb */}
      <div className="flex items-center gap-3 select-none">
        {!isSidebarOpen && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Buka menu samping"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer border border-transparent hover:border-slate-700/60"
            title="Buka Menu Samping"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-2 select-none">
          <span className="text-xs text-slate-400 font-sans hidden sm:inline">Harmonix</span>
          <span className="text-slate-600 text-xs hidden sm:inline">/</span>
          <span className="text-xs sm:text-sm font-semibold tracking-tight text-slate-100 leading-tight font-sans">
            {getTabTitle()}
          </span>
        </div>
      </div>

      {/* Right: Health Badge & Observability Trigger */}
      <div className="flex items-center gap-2">
        {/* Observability / Metrics Trigger */}
        <button
          type="button"
          onClick={onOpenMetrics}
          aria-label="Buka metrik observabilitas sistem"
          aria-expanded={isMetricsOpen}
          className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono transition cursor-pointer border ${
            isMetricsOpen
              ? 'bg-[#14223b] text-slate-100 border-slate-700/60 shadow-sm'
              : 'bg-transparent text-slate-400 hover:text-slate-100 hover:bg-[#14223b] border-transparent hover:border-slate-800/80 active:bg-[#101c31]'
          }`}
          title="Observabilitas & Latensi Sistem (OB-02)"
        >
          <Activity
            className={`w-3.5 h-3.5 transition-colors ${
              isMetricsOpen ? 'text-sky-400' : 'text-slate-400 group-hover:text-slate-200'
            }`}
          />
          <span className="hidden sm:inline font-mono">Metrik</span>
        </button>
      </div>
    </header>
  );
};

export const Navbar = React.memo(NavbarComponent);

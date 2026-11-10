import React from 'react';
import { PanelLeft, Activity, ShieldAlert } from 'lucide-react';
import { HealthStatus, ActiveTab } from '../types';
import { Button } from './ui';

interface NavbarProps {
  health: HealthStatus | null;
  activeTab: ActiveTab;
  isSidebarOpen?: boolean;
  isMetricsOpen?: boolean;
  triggeredWatchdogCount?: number;
  onToggleSidebar: () => void;
  onOpenMetrics: () => void;
  onOpenWatchdog?: () => void;
}

const NavbarComponent: React.FC<NavbarProps> = ({
  health: _health,
  activeTab,
  isSidebarOpen = true,
  isMetricsOpen = false,
  triggeredWatchdogCount = 0,
  onToggleSidebar,
  onOpenMetrics,
  onOpenWatchdog,
}) => {
  const getTabTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return 'Live BI Dashboard';
      case 'batch':
        return 'Bulk Analytics';
      case 'design-system':
        return 'Design System';
      case 'chat':
      default:
        return 'Percakapan Analitik';
    }
  };

  return (
    <header className="h-14 border-b border-white/[0.06] bg-[#0b1526]/90 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0 gap-3">
      {/* Left: Sidebar Toggle & Section Title Breadcrumb */}
      <div className="flex items-center gap-3 select-none">
        {!isSidebarOpen && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSidebar}
            aria-label="Buka menu samping"
            title="Buka Menu Samping"
            leftIcon={<PanelLeft className="w-4 h-4" />}
          />
        )}

        <div className="flex items-center gap-2 select-none">
          <span className="text-xs text-slate-400 font-sans font-bold tracking-tight hidden sm:inline">Harmonix</span>
          <span className="text-slate-600 text-xs hidden sm:inline">/</span>
          <span className="text-xs sm:text-sm font-semibold tracking-tight text-slate-100 leading-tight font-sans">
            {getTabTitle()}
          </span>
        </div>
      </div>

      {/* Right: System Monitoring & Alerts Cluster */}
      <div className="flex items-center gap-1.5">
        {onOpenWatchdog && (
          <Button
            variant={triggeredWatchdogCount > 0 ? 'danger' : 'ghost'}
            size="sm"
            onClick={onOpenWatchdog}
            aria-label={
              triggeredWatchdogCount > 0
                ? `${triggeredWatchdogCount} Anomali Terdeteksi di Data Warehouse`
                : 'Pemantauan Anomali Data (Watchdog)'
            }
            title={
              triggeredWatchdogCount > 0
                ? `Peringatan: ${triggeredWatchdogCount} anomali data terpicu.`
                : 'Pemantauan Anomali (Watchdog): Normal'
            }
            leftIcon={<ShieldAlert className={`w-4 h-4 ${triggeredWatchdogCount > 0 ? 'text-rose-400' : 'text-slate-400'}`} />}
          >
            {triggeredWatchdogCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/25 text-rose-200 font-mono leading-none">
                {triggeredWatchdogCount}
              </span>
            )}
          </Button>
        )}

        <Button
          variant={isMetricsOpen ? 'secondary' : 'ghost'}
          size="sm"
          onClick={onOpenMetrics}
          aria-label="Buka metrik observabilitas sistem"
          aria-expanded={isMetricsOpen}
          title="Observabilitas & Latensi Sistem (OB-02)"
          leftIcon={<Activity className={`w-3.5 h-3.5 ${isMetricsOpen ? 'text-sky-400' : 'text-slate-400'}`} />}
        >
          <span className="hidden sm:inline font-sans text-xs">Metrik</span>
        </Button>
      </div>
    </header>
  );
};

export const Navbar = React.memo(NavbarComponent);

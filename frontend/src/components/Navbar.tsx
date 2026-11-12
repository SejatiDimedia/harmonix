import React from 'react';
import { PanelLeft, Activity, Bell, BookOpen } from 'lucide-react';
import { HealthStatus, ActiveTab } from '../types';
import { Button } from './ui';

interface NavbarProps {
  health: HealthStatus | null;
  activeTab: ActiveTab;
  isSidebarOpen?: boolean;
  isMetricsOpen?: boolean;
  triggeredWatchdogCount?: number;
  activeContextCount?: number;
  onToggleSidebar: () => void;
  onOpenMetrics: () => void;
  onOpenWatchdog?: () => void;
  onOpenGoogleSheets?: () => void;
  onOpenContext?: () => void;
}

const NavbarComponent: React.FC<NavbarProps> = ({
  health: _health,
  activeTab,
  isSidebarOpen = true,
  isMetricsOpen = false,
  triggeredWatchdogCount = 0,
  activeContextCount = 0,
  onToggleSidebar,
  onOpenMetrics,
  onOpenWatchdog,
  onOpenGoogleSheets: _onOpenGoogleSheets,
  onOpenContext,
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
        return 'Analytics Chat';
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
            aria-label="Open sidebar"
            title="Open Sidebar"
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

      {/* Right Controls: Grouped by Session Scope vs System Telemetry */}
      <div className="flex items-center gap-2 select-none">
        {/* Cluster 1: Session Semantic Context (FR-51) */}
        {onOpenContext && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenContext}
            aria-label="Session Business Context (FR-51)"
            title="Session Business Context & Column Clarification (FR-51)"
            leftIcon={<BookOpen className="w-3.5 h-3.5 text-sky-400" />}
            className="border border-white/[0.06] hover:border-sky-500/30 hover:bg-sky-500/10 text-slate-300 hover:text-white transition"
          >
            <span className="font-sans text-xs">Context</span>
            {activeContextCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/20 text-sky-300 font-mono leading-none">
                {activeContextCount}
              </span>
            )}
          </Button>
        )}

        {/* Subtle Vertical Divider */}
        <div className="h-4 w-[1px] bg-white/[0.08]" aria-hidden="true" />

        {/* Cluster 2: System Health & Telemetry Capsule (FR-49 & OB-02) */}
        <div className="flex items-center bg-[#0c1527] border border-white/[0.06] rounded-lg p-0.5 shadow-sm">
          {onOpenWatchdog && (
            <button
              type="button"
              onClick={onOpenWatchdog}
              aria-label={
                triggeredWatchdogCount > 0
                  ? `${triggeredWatchdogCount} active data anomalies`
                  : 'Data Anomaly Alerts: All metrics normal'
              }
              title={
                triggeredWatchdogCount > 0
                  ? `Warning: ${triggeredWatchdogCount} active data anomalies triggered.`
                  : 'Data Anomaly Alerts: Normal'
              }
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans transition cursor-pointer ${
                triggeredWatchdogCount > 0
                  ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Bell className={`w-3.5 h-3.5 ${triggeredWatchdogCount > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-400'}`} />
              <span className="hidden sm:inline text-[11px] font-medium">Alerts</span>
              {triggeredWatchdogCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/30 text-rose-200 font-mono leading-none">
                  {triggeredWatchdogCount}
                </span>
              )}
            </button>
          )}

          <div className="h-3 w-[1px] bg-white/[0.06] mx-0.5" aria-hidden="true" />

          <button
            type="button"
            onClick={onOpenMetrics}
            aria-label="Open system observability metrics"
            aria-expanded={isMetricsOpen}
            title="System Observability & Latency (OB-02)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans transition cursor-pointer ${
              isMetricsOpen
                ? 'bg-sky-500/15 text-sky-200 border border-sky-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <Activity className={`w-3.5 h-3.5 ${isMetricsOpen ? 'text-sky-400' : 'text-slate-400'}`} />
            <span className="hidden sm:inline text-[11px] font-medium">Metrics</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export const Navbar = React.memo(NavbarComponent);

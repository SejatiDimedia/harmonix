import React from 'react';
import { Pin } from 'lucide-react';
import { ChartSpec, TableData } from '../types';
import { EChartsViewer } from './EChartsViewer';

interface DataChartProps {
  charts: ChartSpec[];
  tables?: TableData[];
  hideHeader?: boolean;
  onPinChart?: (spec: ChartSpec) => void;
  isKiosk?: boolean;
}

interface SingleChartProps {
  spec: ChartSpec;
  tables?: TableData[];
  index: number;
  hideHeader?: boolean;
  onPinChart?: (spec: ChartSpec) => void;
  isKiosk?: boolean;
}

const SingleChartCanvas: React.FC<SingleChartProps> = ({
  spec,
  tables,
  hideHeader = false,
  onPinChart,
  isKiosk = false,
}) => {
  return (
    <div
      className={
        hideHeader
          ? isKiosk
            ? 'relative w-full h-full flex-1 min-h-[360px] flex flex-col'
            : 'relative w-full h-full min-h-[260px]'
          : 'rounded-xl border border-white/[0.06] bg-[#0f1a2e] p-4 overflow-hidden shadow-sm'
      }
    >
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#f8fafc] font-sans">
              {spec.title || 'Visualisasi Data'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#14223b] text-clay-400">
              {spec.chart_type}
            </span>
            {onPinChart && (
              <button
                type="button"
                onClick={() => onPinChart(spec)}
                className="flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-lg bg-[#14223b] hover:bg-clay-600/30 text-[#f8fafc] hover:text-clay-300 transition cursor-pointer shadow-sm"
                title="Sematkan grafik ini ke Live Dashboard"
              >
                <Pin className="w-3 h-3 text-clay-400" />
                <span>Pin</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className={
          hideHeader
            ? isKiosk
              ? 'chart-wrapper w-full h-full flex-1 min-h-[360px]'
              : 'chart-wrapper w-full h-full min-h-[260px]'
            : 'chart-wrapper relative w-full h-64 md:h-72 print:h-[250px] print:max-w-xl print:mx-auto'
        }
      >
        <EChartsViewer
          spec={spec}
          tables={tables}
          showToolbox={true}
          isKiosk={isKiosk}
        />
      </div>
    </div>
  );
};

export const DataChart: React.FC<DataChartProps> = ({
  charts,
  tables,
  hideHeader = false,
  onPinChart,
  isKiosk = false,
}) => {
  if (!charts || charts.length === 0) return null;

  return (
    <div className={hideHeader ? (isKiosk ? 'w-full h-full flex-1 flex flex-col' : 'w-full') : 'space-y-4 mt-4'}>
      {charts.map((c, idx) => (
        <SingleChartCanvas
          key={idx}
          spec={c}
          tables={tables}
          index={idx}
          hideHeader={hideHeader}
          onPinChart={onPinChart}
          isKiosk={isKiosk}
        />
      ))}
    </div>
  );
};

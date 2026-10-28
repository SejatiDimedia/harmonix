import React, { useEffect, useRef } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { Pin } from 'lucide-react';
import { ChartSpec, TableData } from '../types';

ChartJS.register(...registerables);

interface DataChartProps {
  charts: ChartSpec[];
  tables?: TableData[];
  hideHeader?: boolean;
  onPinChart?: (spec: ChartSpec) => void;
}

interface SingleChartProps {
  spec: ChartSpec;
  tables?: TableData[];
  index: number;
  hideHeader?: boolean;
  onPinChart?: (spec: ChartSpec) => void;
}

const SingleChartCanvas: React.FC<SingleChartProps> = ({
  spec,
  tables,
  index,
  hideHeader = false,
  onPinChart,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    let chartData = spec.data || [];
    let xCol = spec.x_axis;
    let yCol = spec.y_axis;

    // Fallback data from tables if spec.data is empty
    if (chartData.length === 0 && tables && tables.length > 0) {
      const tbl = tables[0];
      if (tbl.columns && tbl.columns.length >= 2 && tbl.rows && tbl.rows.length > 0) {
        xCol = tbl.columns[0];
        yCol = tbl.columns[1];
        chartData = tbl.rows.map((r) => ({
          [xCol]: r[0] ?? '(NULL)',
          [yCol]: r[1] ?? 0,
        }));
      }
    }

    if (chartData.length === 0) return;

    const labels = chartData.map((d) => {
      let val = d[xCol];
      if (val === undefined) {
        const keys = Object.keys(d);
        val = keys.length > 0 ? d[keys[0]] : '';
      }
      return val === null || val === undefined ? '(NULL)' : String(val);
    });

    const values = chartData.map((d) => {
      let val = d[yCol];
      if (val === undefined) {
        const keys = Object.keys(d);
        val = keys.length > 1 ? d[keys[1]] : 0;
      }
      return Number(val) || 0;
    });

    const palette = [
      'rgba(0, 140, 208, 0.85)',
      'rgba(0, 210, 238, 0.85)',
      'rgba(52, 211, 153, 0.85)',
      'rgba(129, 140, 248, 0.85)',
      'rgba(244, 114, 182, 0.85)',
      'rgba(251, 191, 36, 0.85)',
    ];

    let cType = (spec.chart_type || 'bar').toLowerCase();
    if (cType === 'donut') cType = 'doughnut';
    if (cType === 'scatter') cType = 'line';

    const isPieOrDoughnut = cType === 'pie' || cType === 'doughnut';
    const bgColors = isPieOrDoughnut ? palette : 'rgba(0, 140, 208, 0.75)';
    const borderColors = isPieOrDoughnut ? '#080f1d' : 'rgb(0, 140, 208)';

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartInstanceRef.current = new ChartJS(ctx, {
      type: cType as any,
      data: {
        labels,
        datasets: [
          {
            label: spec.y_axis,
            data: values,
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: isPieOrDoughnut ? 2 : 1.5,
            borderRadius: cType === 'bar' ? 4 : 0,
            tension: cType === 'line' ? 0.35 : 0,
            fill:
              cType === 'line'
                ? { target: 'origin', above: 'rgba(0, 140, 208, 0.15)' }
                : false,
            pointBackgroundColor: 'rgb(0, 140, 208)',
            pointBorderColor: '#080f1d',
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: cType === 'doughnut' ? '60%' : undefined,
        plugins: {
          legend: {
            display: isPieOrDoughnut,
            position: 'bottom',
            labels: {
              color: '#94a3b8',
              font: { family: 'Plus Jakarta Sans', size: 11 },
              boxWidth: 12,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: '#0f1a2e',
            titleColor: '#f8fafc',
            bodyColor: '#f8fafc',
            borderColor: '#1e3557',
            borderWidth: 1,
            padding: 10,
            bodyFont: { family: 'JetBrains Mono', size: 11 },
            titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: 'bold' },
          },
        },
        scales: isPieOrDoughnut
          ? undefined
          : {
              x: {
                grid: { color: 'rgba(30, 53, 87, 0.5)' },
                ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } },
              },
              y: {
                grid: { color: 'rgba(30, 53, 87, 0.5)' },
                ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } },
              },
            },
      },
    });

    const handleBeforePrint = () => {
      const chart = chartInstanceRef.current;
      if (!chart) return;

      chart.data.datasets.forEach((ds) => {
        if (isPieOrDoughnut) {
          ds.borderColor = '#ffffff';
          ds.borderWidth = 2;
        } else {
          ds.borderColor = 'rgb(194, 65, 12)';
          (ds as any).pointBorderColor = '#ffffff';
        }
      });

      if (chart.options.plugins?.legend?.labels) {
        chart.options.plugins.legend.labels.color = '#111827';
      }
      if (chart.options.scales?.x) {
        chart.options.scales.x.grid = { color: '#e5e7eb' };
        if (chart.options.scales.x.ticks) {
          chart.options.scales.x.ticks.color = '#374151';
        }
      }
      if (chart.options.scales?.y) {
        chart.options.scales.y.grid = { color: '#e5e7eb' };
        if (chart.options.scales.y.ticks) {
          chart.options.scales.y.ticks.color = '#374151';
        }
      }
      chart.resize();
      chart.update('none');
    };

    const handleAfterPrint = () => {
      const chart = chartInstanceRef.current;
      if (!chart) return;

      chart.data.datasets.forEach((ds) => {
        if (isPieOrDoughnut) {
          ds.borderColor = '#080f1d';
          ds.borderWidth = 2;
        } else {
          ds.borderColor = 'rgb(0, 140, 208)';
          (ds as any).pointBorderColor = '#080f1d';
        }
      });

      if (chart.options.plugins?.legend?.labels) {
        chart.options.plugins.legend.labels.color = '#94a3b8';
      }
      if (chart.options.scales?.x) {
        chart.options.scales.x.grid = { color: 'rgba(30, 53, 87, 0.5)' };
        if (chart.options.scales.x.ticks) {
          chart.options.scales.x.ticks.color = '#94a3b8';
        }
      }
      if (chart.options.scales?.y) {
        chart.options.scales.y.grid = { color: 'rgba(30, 53, 87, 0.5)' };
        if (chart.options.scales.y.ticks) {
          chart.options.scales.y.ticks.color = '#94a3b8';
        }
      }
      chart.resize();
      chart.update('none');
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [spec, tables, index]);

  return (
    <div
      className={
        hideHeader
          ? 'relative w-full h-64 md:h-72'
          : 'rounded-xl border border-[#1e3557] bg-[#0f1a2e] p-4 overflow-hidden shadow-sm'
      }
    >
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[#1e3557]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-clay-500" />
            <span className="text-xs font-medium text-[#f8fafc] font-sans">
              {spec.title || 'Visualisasi Data'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#14223b] text-clay-400 border border-[#1e3557]">
              {spec.chart_type}
            </span>
            {onPinChart && (
              <button
                type="button"
                onClick={() => onPinChart(spec)}
                className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-[#14223b] hover:bg-clay-600/30 text-[#f8fafc] hover:text-clay-300 border border-[#1e3557] hover:border-clay-500/50 transition cursor-pointer"
                title="Sematkan grafik ini ke Live Dashboard"
              >
                <Pin className="w-3 h-3 text-clay-400" />
                <span>Pin</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className={hideHeader ? 'chart-wrapper w-full h-full print:h-[250px] print:max-w-xl print:mx-auto' : 'chart-wrapper relative w-full h-64 md:h-72 print:h-[250px] print:max-w-xl print:mx-auto'}>
        <canvas ref={canvasRef} role="img" aria-label={spec.title || `Grafik visualisasi ${spec.chart_type || 'data'}`} />
      </div>
    </div>
  );
};

export const DataChart: React.FC<DataChartProps> = ({
  charts,
  tables,
  hideHeader = false,
  onPinChart,
}) => {
  if (!charts || charts.length === 0) return null;

  return (
    <div className={hideHeader ? 'w-full' : 'space-y-4 mt-4'}>
      {charts.map((c, idx) => (
        <SingleChartCanvas
          key={idx}
          spec={c}
          tables={tables}
          index={idx}
          hideHeader={hideHeader}
          onPinChart={onPinChart}
        />
      ))}
    </div>
  );
};

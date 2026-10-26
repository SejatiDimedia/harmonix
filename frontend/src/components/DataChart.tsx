import React, { useEffect, useRef } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { ChartSpec, TableData } from '../types';

ChartJS.register(...registerables);

interface DataChartProps {
  charts: ChartSpec[];
  tables?: TableData[];
}

interface SingleChartProps {
  spec: ChartSpec;
  tables?: TableData[];
  index: number;
}

const SingleChartCanvas: React.FC<SingleChartProps> = ({ spec, tables, index }) => {
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
      'rgba(217, 119, 87, 0.85)',
      'rgba(52, 211, 153, 0.85)',
      'rgba(224, 168, 46, 0.85)',
      'rgba(129, 140, 248, 0.85)',
      'rgba(244, 114, 182, 0.85)',
      'rgba(56, 189, 248, 0.85)',
    ];

    let cType = (spec.chart_type || 'bar').toLowerCase();
    if (cType === 'donut') cType = 'doughnut';
    if (cType === 'scatter') cType = 'line';

    const isPieOrDoughnut = cType === 'pie' || cType === 'doughnut';
    const bgColors = isPieOrDoughnut ? palette : 'rgba(217, 119, 87, 0.75)';
    const borderColors = isPieOrDoughnut ? '#161513' : 'rgb(217, 119, 87)';

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
                ? { target: 'origin', above: 'rgba(217, 119, 87, 0.15)' }
                : false,
            pointBackgroundColor: 'rgb(217, 119, 87)',
            pointBorderColor: '#161513',
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
              color: '#a3a097',
              font: { family: 'Plus Jakarta Sans', size: 11 },
              boxWidth: 12,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: '#242320',
            titleColor: '#f5f4ef',
            bodyColor: '#dedcd5',
            borderColor: '#383632',
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
                grid: { color: 'rgba(46, 44, 40, 0.6)' },
                ticks: { color: '#8e8b82', font: { family: 'JetBrains Mono', size: 10 } },
              },
              y: {
                grid: { color: 'rgba(46, 44, 40, 0.6)' },
                ticks: { color: '#8e8b82', font: { family: 'JetBrains Mono', size: 10 } },
              },
            },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [spec, tables, index]);

  return (
    <div className="rounded-xl border border-[#2e2c28] bg-[#161513] p-4 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[#262421]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-clay-500" />
          <span className="text-xs font-medium text-[#dedcd5] font-sans">
            {spec.title || 'Visualisasi Data'}
          </span>
        </div>
        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#242320] text-clay-400 border border-[#383632]">
          {spec.chart_type}
        </span>
      </div>

      <div className="relative w-full h-64 md:h-72">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

export const DataChart: React.FC<DataChartProps> = ({ charts, tables }) => {
  if (!charts || charts.length === 0) return null;

  return (
    <div className="space-y-4 mt-4">
      {charts.map((c, idx) => (
        <SingleChartCanvas key={idx} spec={c} tables={tables} index={idx} />
      ))}
    </div>
  );
};

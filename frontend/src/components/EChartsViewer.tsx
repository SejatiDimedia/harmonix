import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Search, MapPin, CreditCard, Table, X, Sparkles, ExternalLink, Send, MessageSquare } from 'lucide-react';
import { ChartSpec, TableData } from '../types';
import { Modal, Button } from './ui';

export interface DrillDownPoint {
  dimension: string;
  metricName: string;
  metricValue: number | string;
  x: number;
  y: number;
}

export interface EChartsViewerProps {
  spec: ChartSpec;
  tables?: TableData[];
  height?: number | string;
  showToolbox?: boolean;
  className?: string;
  isKiosk?: boolean;
  onDrillDown?: (prompt: string) => void;
  onPrefillChat?: (text: string) => void;
}

const PALETTE = [
  '#008cd0', // Electric Azure (Primary)
  '#00d2ee', // Cyan
  '#10b981', // Emerald
  '#818cf8', // Indigo
  '#f472b6', // Pink
  '#fbbf24', // Amber
  '#38bdf8', // Sky Blue
  '#a78bfa', // Purple
];

export const EChartsViewer: React.FC<EChartsViewerProps> = ({
  spec,
  tables,
  height = '100%',
  showToolbox = true,
  className = '',
  isKiosk = false,
  onDrillDown,
  onPrefillChat,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [drilldownState, setDrilldownState] = useState<DrillDownPoint | null>(null);
  const [customQuestion, setCustomQuestion] = useState('');
  const [rawRowsModal, setRawRowsModal] = useState<{
    dimension: string;
    rows: any[];
    columns: string[];
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Prepare data (from spec.data or fallback to tables)
    let chartData = spec.data || [];
    let xCol = spec.x_axis;
    let yCol = spec.y_axis;

    if (chartData.length === 0 && tables && tables.length > 0) {
      // Find table that best matches xCol or yCol, otherwise default to tables[0]
      const matchingTbl =
        tables.find((t) =>
          (t.columns || []).some(
            (c) =>
              (xCol && c.toLowerCase() === xCol.toLowerCase()) ||
              (yCol && c.toLowerCase() === yCol.toLowerCase())
          )
        ) || tables[0];

      if (matchingTbl.columns && matchingTbl.columns.length >= 2 && matchingTbl.rows && matchingTbl.rows.length > 0) {
        xCol = matchingTbl.columns[0];
        yCol = matchingTbl.columns[1];
        chartData = matchingTbl.rows.map((r) => ({
          [xCol]: r[0] ?? '(NULL)',
          [yCol]: r[1] ?? 0,
        }));
      }
    }

    if (chartData.length === 0) {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.clear();
      }
      return;
    }

    // Initialize or retrieve ECharts instance
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(containerRef.current, 'dark', {
        renderer: 'canvas',
      });
    }

    const chartInstance = chartInstanceRef.current;

    // 2. Intelligent & Type-Aware Column Resolution
    const sampleRow = chartData[0] || {};
    const sampleKeys = Object.keys(sampleRow);

    const resolveColumnKey = (
      preferredCol?: string,
      preferType: 'string' | 'number' = 'string',
      excludeKey?: string
    ): string => {
      if (!sampleKeys.length) return '';

      // 1. Exact match
      if (preferredCol && preferredCol in sampleRow && preferredCol !== excludeKey) {
        return preferredCol;
      }

      // 2. Case-insensitive match
      if (preferredCol) {
        const prefLower = preferredCol.toLowerCase();
        const found = sampleKeys.find(
          (k) => k !== excludeKey && k.toLowerCase() === prefLower
        );
        if (found) return found;

        // 3. Substring match (e.g. "kategori" matches "product_category_name" or "kategori_produk")
        const subFound = sampleKeys.find(
          (k) =>
            k !== excludeKey &&
            (k.toLowerCase().includes(prefLower) || prefLower.includes(k.toLowerCase()))
        );
        if (subFound) return subFound;
      }

      // 4. Type-based search
      if (preferType === 'number') {
        const numKey = sampleKeys.find((k) => {
          if (k === excludeKey) return false;
          const v = sampleRow[k];
          return typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '');
        });
        if (numKey) return numKey;
      } else {
        const strKey = sampleKeys.find((k) => {
          if (k === excludeKey) return false;
          const v = sampleRow[k];
          return typeof v === 'string' && isNaN(Number(v));
        });
        if (strKey) return strKey;
      }

      // 5. Fallback to any remaining key
      const remaining = sampleKeys.find((k) => k !== excludeKey);
      return remaining || sampleKeys[0] || '';
    };

    const resolvedXKey = resolveColumnKey(xCol, 'string');
    const resolvedYKey = resolveColumnKey(yCol, 'number', resolvedXKey);

    const labels = chartData.map((d) => {
      const val = d[resolvedXKey];
      return val === null || val === undefined ? '(NULL)' : String(val);
    });

    const rawValues = chartData.map((d) => {
      const val = d[resolvedYKey];
      return Number(val) || 0;
    });

    let rawType = (spec.chart_type || 'bar').toLowerCase();
    if (rawType === 'donut') rawType = 'doughnut';

    const isPie = rawType === 'pie';
    const isDoughnut = rawType === 'doughnut';
    const isLine = rawType === 'line' || rawType === 'area';
    const isArea = rawType === 'area';
    const isGauge = rawType === 'gauge' || rawType === 'kpi';
    const isScatter = rawType === 'scatter';

    // 3. Assemble ECharts Configuration Option
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      color: PALETTE,
      animation: true,
      animationDuration: 800,
      animationEasing: 'cubicOut',
      textStyle: {
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      },
      tooltip: {
        trigger: isPie || isDoughnut || isGauge ? 'item' : 'axis',
        axisPointer: {
          type: isLine ? 'cross' : 'shadow',
          crossStyle: { color: '#94a3b8' },
          shadowStyle: { color: 'rgba(0, 140, 208, 0.08)' },
        },
        backgroundColor: 'rgba(11, 20, 36, 0.95)',
        borderColor: '#1e3557',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: {
          color: '#f8fafc',
          fontSize: isKiosk ? 14 : 12,
        },
        formatter: (params: any) => {
          if (isGauge) {
            const val = params.value;
            return `<div class="font-sans"><strong>${spec.title || 'Metrik'}</strong><br/><span style="color:#00d2ee;font-size:16px;font-weight:bold;">${val}%</span></div>`;
          }
          if (isPie || isDoughnut) {
            return `
              <div class="font-sans">
                <div class="text-slate-400 text-xs mb-1">${params.name}</div>
                <div class="flex items-center gap-2">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${params.color};"></span>
                  <span class="font-bold text-slate-100">${Number(params.value).toLocaleString('id-ID')}</span>
                  <span class="text-slate-400 text-xs">(${params.percent}%)</span>
                </div>
                <div class="text-[9.5px] text-sky-400 mt-1.5 border-t border-white/10 pt-1 font-sans flex items-center gap-1">
                  <span>Klik untuk drill-down ↗</span>
                </div>
              </div>
            `;
          }
          if (Array.isArray(params)) {
            const p = params[0];
            if (!p) return '';
            const num = Number(p.value);
            const formatted = isNaN(num) ? p.value : num.toLocaleString('id-ID');
            return `
              <div class="font-sans">
                <div class="text-slate-400 text-xs mb-1 font-mono">${p.axisValueLabel}</div>
                <div class="flex items-center gap-2">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${p.color};"></span>
                  <span class="text-slate-300 text-xs">${spec.y_axis || 'Nilai'}:</span>
                  <span class="font-bold text-slate-100 font-mono">${formatted}</span>
                </div>
                <div class="text-[9.5px] text-sky-400 mt-1.5 border-t border-white/10 pt-1 font-sans flex items-center gap-1">
                  <span>Klik untuk drill-down ↗</span>
                </div>
              </div>
            `;
          }
          return '';
        },
      },
    };

    // Toolbox (Simpan Gambar, Zoom, Data View)
    if (showToolbox && !isKiosk) {
      option.toolbox = {
        show: true,
        right: 12,
        top: 2,
        itemSize: 13,
        itemGap: 10,
        iconStyle: {
          borderColor: '#64748b',
        },
        emphasis: {
          iconStyle: {
            borderColor: '#00d2ee',
          },
        },
        feature: {
          saveAsImage: {
            title: 'Unduh PNG',
            pixelRatio: 2,
            backgroundColor: '#080f1d',
          },
          dataView: {
            title: 'Lihat Data',
            readOnly: true,
            lang: ['Data Tabel', 'Tutup', 'Segarkan'],
            textareaColor: '#0b1322',
            textareaBorderColor: '#1e3557',
            textColor: '#f8fafc',
            buttonColor: '#008cd0',
            buttonTextColor: '#ffffff',
          },
          restore: { title: 'Reset' },
        },
      };
    }

    // Specific Configurations per Chart Type
    if (isPie || isDoughnut) {
      const pieData = labels.map((name, i) => ({
        name,
        value: rawValues[i],
      }));

      option.legend = {
        orient: 'horizontal',
        bottom: 10,
        textStyle: { color: '#94a3b8', fontSize: 11 },
        type: labels.length > 5 ? 'scroll' : 'plain',
        pageTextStyle: { color: '#94a3b8' },
        pageIconColor: '#008cd0',
        pageIconInactiveColor: '#334155',
      };

      const showCalloutLabels = labels.length <= 6;

      option.series = [
        {
          name: spec.title || spec.y_axis,
          type: 'pie',
          cursor: 'pointer',
          radius: isDoughnut ? ['40%', '65%'] : ['0%', '65%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          minShowLabelAngle: 12,
          itemStyle: {
            borderRadius: isDoughnut ? 6 : 4,
            borderColor: '#0b1424',
            borderWidth: 2,
          },
          label: {
            show: showCalloutLabels,
            color: '#94a3b8',
            fontSize: 11,
            formatter: '{b}: {d}%',
          },
          labelLine: {
            show: showCalloutLabels,
            length: 8,
            length2: 10,
            lineStyle: {
              color: '#334155',
            },
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 13,
              fontWeight: 'bold',
              color: '#ffffff',
              formatter: '{b}\n{d}%',
            },
            itemStyle: {
              shadowBlur: 14,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
          data: pieData,
        },
      ];
    } else if (isGauge) {
      const gaugeVal = rawValues.length > 0 ? rawValues[0] : 0;
      option.series = [
        {
          type: 'gauge',
          center: ['50%', '55%'],
          radius: '85%',
          startAngle: 200,
          endAngle: -20,
          min: 0,
          max: 100,
          splitNumber: 5,
          itemStyle: {
            color: '#00d2ee',
          },
          progress: {
            show: true,
            width: 14,
            roundCap: true,
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: '#008cd0' },
                { offset: 1, color: '#00d2ee' },
              ]),
            },
          },
          pointer: {
            show: true,
            length: '65%',
            width: 4,
            itemStyle: { color: '#ffffff' },
          },
          axisLine: {
            lineStyle: {
              width: 14,
              color: [[1, '#14223b']],
            },
            roundCap: true,
          },
          axisTick: {
            distance: -20,
            splitNumber: 2,
            lineStyle: { width: 1, color: '#475569' },
          },
          splitLine: {
            distance: -24,
            length: 8,
            lineStyle: { width: 1.5, color: '#64748b' },
          },
          axisLabel: {
            distance: -36,
            color: '#94a3b8',
            fontSize: 10,
          },
          title: {
            show: true,
            offsetCenter: [0, '75%'],
            fontSize: isKiosk ? 14 : 12,
            color: '#94a3b8',
          },
          detail: {
            valueAnimation: true,
            fontSize: isKiosk ? 28 : 22,
            offsetCenter: [0, '40%'],
            formatter: '{value}%',
            color: '#f8fafc',
            fontWeight: 'bold',
          },
          data: [{ value: gaugeVal, name: spec.title || spec.y_axis }],
        },
      ];
    } else {
      // Cartesian (Bar, Line, Area, Scatter)
      option.grid = {
        left: '2%',
        right: '3%',
        bottom: labels.length > 8 ? 44 : 28,
        top: showToolbox && !isKiosk ? 36 : 24,
        containLabel: true,
      };

      option.xAxis = {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#1e3557' } },
        axisTick: { alignWithLabel: true, lineStyle: { color: '#1e3557' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: isKiosk ? 12 : 11,
          rotate: labels.length > 7 ? 25 : 0,
          interval: labels.length > 15 ? 'auto' : 0,
          formatter: (val: string) => (val.length > 16 ? `${val.slice(0, 14)}...` : val),
        },
      };

      option.yAxis = {
        type: 'value',
        name: spec.y_axis,
        nameTextStyle: {
          color: '#64748b',
          fontSize: 10,
          align: 'left',
          padding: [0, 0, 4, 0],
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          lineStyle: {
            color: 'rgba(255, 255, 255, 0.05)',
            type: 'dashed',
          },
        },
        axisLabel: {
          color: '#94a3b8',
          fontSize: isKiosk ? 12 : 11,
          formatter: (val: number) => {
            if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
            if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
            if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
            return String(val);
          },
        },
      };

      // Zoom slider if many data points
      if (labels.length > 12 && !isKiosk) {
        option.dataZoom = [
          {
            type: 'inside',
            start: 0,
            end: Math.min(100, Math.round((10 / labels.length) * 100)),
          },
          {
            type: 'slider',
            show: true,
            height: 12,
            bottom: 2,
            borderColor: '#1e3557',
            backgroundColor: '#0b1322',
            fillerColor: 'rgba(0, 140, 208, 0.2)',
            handleStyle: { color: '#008cd0' },
            textStyle: { color: '#64748b', fontSize: 9 },
          },
        ];
      }

      if (isScatter) {
        option.series = [
          {
            name: spec.y_axis,
            type: 'scatter',
            cursor: 'pointer',
            symbolSize: isKiosk ? 14 : 10,
            data: rawValues.map((v, i) => [i, v]),
            itemStyle: {
              color: '#00d2ee',
              shadowBlur: 8,
              shadowColor: 'rgba(0, 210, 238, 0.4)',
            },
          },
        ];
      } else if (isLine) {
        option.series = [
          {
            name: spec.y_axis,
            type: 'line',
            cursor: 'pointer',
            data: rawValues,
            smooth: true,
            showSymbol: rawValues.length <= 25,
            symbolSize: isKiosk ? 8 : 6,
            symbol: 'circle',
            itemStyle: {
              color: '#00d2ee',
              borderColor: '#080f1d',
              borderWidth: 2,
            },
            lineStyle: {
              width: isKiosk ? 3.5 : 2.5,
              color: '#008cd0',
            },
            areaStyle: isArea
              ? {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(0, 140, 208, 0.35)' },
                    { offset: 1, color: 'rgba(0, 140, 208, 0.02)' },
                  ]),
                }
              : undefined,
          },
        ];
      } else {
        // Standard Bar Chart
        option.series = [
          {
            name: spec.y_axis,
            type: 'bar',
            cursor: 'pointer',
            data: rawValues,
            barMaxWidth: isKiosk ? 48 : 36,
            itemStyle: {
              borderRadius: [4, 4, 0, 0],
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#00d2ee' },
                { offset: 1, color: '#008cd0' },
              ]),
            },
            emphasis: {
              itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: '#38bdf8' },
                  { offset: 1, color: '#0284c7' },
                ]),
              },
            },
          },
        ];
      }
    }

    chartInstance.setOption(option, true);

    // 4. Click event listener for interactive Drill-Down (FR-48)
    const handleChartClick = (params: any) => {
      if (!params) return;
      const dimName = params.name || (Array.isArray(params.value) ? String(params.value[0]) : '');
      const rawVal = Array.isArray(params.value) ? params.value[1] ?? params.value[0] : params.value;
      const sName = params.seriesName || spec.y_axis || 'Nilai';

      if (!dimName && rawVal === undefined) return;

      const mouseX = params.event?.event?.clientX || window.innerWidth / 2;
      const mouseY = params.event?.event?.clientY || window.innerHeight / 2;

      setDrilldownState({
        dimension: String(dimName),
        metricName: String(sName),
        metricValue: rawVal,
        x: mouseX,
        y: mouseY,
      });
      setCustomQuestion('');
    };

    chartInstance.on('click', handleChartClick);

    // 5. Auto-Resize on element resize
    const resizeObserver = new ResizeObserver(() => {
      chartInstance.resize();
    });
    resizeObserver.observe(containerRef.current);

    const handleWindowResize = () => {
      chartInstance.resize();
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.off('click');
      }
    };
  }, [spec, tables, showToolbox, isKiosk]);

  // Clean-up on unmount
  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  const handleTriggerDrillDown = (templateType: 'root_cause' | 'geo' | 'payment') => {
    if (!drilldownState) return;
    const { dimension, metricName, metricValue } = drilldownState;
    const formattedVal =
      typeof metricValue === 'number'
        ? metricValue.toLocaleString('id-ID')
        : String(metricValue);

    let prompt = '';
    if (templateType === 'root_cause') {
      prompt = `Analisis mendalam mengapa ${metricName} pada '${dimension}' bernilai ${formattedVal}. Apa faktor pendorong utama dan anomali pendukungnya?`;
    } else if (templateType === 'geo') {
      prompt = `Bedah transaksi pada '${dimension}' berdasarkan kota dan provinsi pelanggan (geografi) untuk melihat konsentrasi pasar utamanya.`;
    } else if (templateType === 'payment') {
      prompt = `Bedah transaksi pada '${dimension}' berdasarkan metode pembayaran (kredit, boleto, voucher) dan nilai cicilannya.`;
    }

    setDrilldownState(null);
    if (onDrillDown) {
      onDrillDown(prompt);
    }
  };

  const handleCustomQuestionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!drilldownState || !customQuestion.trim()) return;
    const { dimension, metricName, metricValue } = drilldownState;
    const formattedVal =
      typeof metricValue === 'number'
        ? metricValue.toLocaleString('id-ID')
        : String(metricValue);

    const prompt = `Mengenai data ${metricName} pada '${dimension}' (Nilai: ${formattedVal}): ${customQuestion.trim()}`;
    setDrilldownState(null);
    setCustomQuestion('');
    if (onDrillDown) {
      onDrillDown(prompt);
    }
  };

  const handlePrefillToChat = () => {
    if (!drilldownState) return;
    const { dimension, metricName, metricValue } = drilldownState;
    const formattedVal =
      typeof metricValue === 'number'
        ? metricValue.toLocaleString('id-ID')
        : String(metricValue);

    const basePrompt = customQuestion.trim()
      ? `Mengenai data ${metricName} pada '${dimension}' (Nilai: ${formattedVal}): ${customQuestion.trim()}`
      : `Mengenai data ${metricName} pada '${dimension}' (Nilai: ${formattedVal}), tolong analisis `;

    setDrilldownState(null);
    setCustomQuestion('');
    if (onPrefillChat) {
      onPrefillChat(basePrompt);
    } else if (onDrillDown) {
      onDrillDown(basePrompt);
    }
  };

  const handleOpenRawRows = () => {
    if (!drilldownState) return;
    const dim = drilldownState.dimension;

    let matchingRows: any[] = [];
    let cols: string[] = [];

    if (spec.data && spec.data.length > 0) {
      cols = Object.keys(spec.data[0]);
      matchingRows = spec.data.filter((row) =>
        Object.values(row).some((val) => String(val).toLowerCase() === dim.toLowerCase())
      );
      if (matchingRows.length === 0) {
        matchingRows = spec.data.slice(0, 25);
      }
    } else if (tables && tables.length > 0 && tables[0].rows) {
      cols = tables[0].columns || [];
      matchingRows = tables[0].rows.filter((r) =>
        r.some((val) => String(val).toLowerCase() === dim.toLowerCase())
      );
      if (matchingRows.length === 0) {
        matchingRows = tables[0].rows.slice(0, 25);
      }
    }

    setRawRowsModal({
      dimension: dim,
      rows: matchingRows,
      columns: cols,
    });
    setDrilldownState(null);
  };

  return (
    <>
      <div
        ref={containerRef}
        style={{ height, width: '100%', minHeight: typeof height === 'number' ? height : (isKiosk ? 0 : 200) }}
        className={`relative select-none ${className}`}
      />

      {/* Interactive Drill-Down Popover Menu (FR-48) */}
      {drilldownState && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px]"
            onClick={() => setDrilldownState(null)}
          />
          <div
            style={{
              position: 'fixed',
              left: `${Math.min(window.innerWidth - 330, Math.max(16, drilldownState.x - 150))}px`,
              top: `${Math.min(window.innerHeight - 440, Math.max(60, drilldownState.y - 20))}px`,
            }}
            className="z-50 w-80 max-w-[calc(100vw-32px)] rounded-xl bg-[#0b1424] border border-sky-500/40 p-3.5 shadow-2xl shadow-black/80 font-sans text-slate-100 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-white/[0.08]">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-sky-400 font-semibold tracking-wider">
                  <Sparkles className="w-3 h-3 text-sky-400" />
                  <span>Eksplorasi Drill-Down</span>
                </div>
                <h4 className="text-sm font-semibold text-white truncate mt-0.5" title={drilldownState.dimension}>
                  {drilldownState.dimension}
                </h4>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {drilldownState.metricName}:{' '}
                  <span className="text-sky-300 font-semibold">
                    {typeof drilldownState.metricValue === 'number'
                      ? drilldownState.metricValue.toLocaleString('id-ID')
                      : String(drilldownState.metricValue)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrilldownState(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                title="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-2.5 space-y-1.5 text-xs">
              <button
                type="button"
                onClick={() => handleTriggerDrillDown('root_cause')}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#14223b]/80 hover:bg-sky-600/30 hover:border-sky-500/50 text-slate-200 hover:text-white border border-white/[0.06] transition text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <Search className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="truncate">Selidiki Penyebab & Anomali</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-sky-300 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => handleTriggerDrillDown('geo')}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#14223b]/80 hover:bg-emerald-600/30 hover:border-emerald-500/50 text-slate-200 hover:text-white border border-white/[0.06] transition text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">Bedah Berdasarkan Wilayah</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-emerald-300 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => handleTriggerDrillDown('payment')}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#14223b]/80 hover:bg-amber-600/30 hover:border-amber-500/50 text-slate-200 hover:text-white border border-white/[0.06] transition text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <CreditCard className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">Bedah Metode Pembayaran</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-amber-300 shrink-0" />
              </button>

              <button
                type="button"
                onClick={handleOpenRawRows}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#14223b]/80 hover:bg-purple-600/30 hover:border-purple-500/50 text-slate-200 hover:text-white border border-white/[0.06] transition text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <Table className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span className="truncate">Lihat Baris Data Mentah</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-purple-300 shrink-0" />
              </button>
            </div>

            {/* Custom Question Form Section */}
            <div className="pt-2.5 mt-2.5 border-t border-white/[0.08]">
              <div className="text-[10px] font-mono uppercase text-slate-400 font-semibold mb-1.5 flex items-center justify-between">
                <span>Atau Ajukan Pertanyaan Sendiri</span>
              </div>
              <form onSubmit={handleCustomQuestionSubmit} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customQuestion}
                  onChange={(e) => setCustomQuestion(e.target.value)}
                  placeholder="Ketik pertanyaan kustom..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#070e1b] border border-white/[0.1] text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-sans"
                />
                <button
                  type="submit"
                  disabled={!customQuestion.trim()}
                  className="p-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 transition cursor-pointer shrink-0"
                  title="Kirim pertanyaan kustom ke chat analitik"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
              <div className="flex items-center justify-end mt-1.5">
                <button
                  type="button"
                  onClick={handlePrefillToChat}
                  className="text-[10.5px] text-sky-400 hover:text-sky-300 transition cursor-pointer flex items-center gap-1"
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>Ketik lebih leluasa di kolom chat</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Raw Data Modal */}
      {rawRowsModal && (
        <Modal
          isOpen={!!rawRowsModal}
          onClose={() => setRawRowsModal(null)}
          size="2xl"
          title={`Baris Data Mentah: ${rawRowsModal.dimension}`}
          description={`Menampilkan ${rawRowsModal.rows.length} baris data terkait`}
          icon={<Table className="w-5 h-5 text-purple-400" />}
          footer={
            <div className="flex justify-end w-full">
              <Button variant="secondary" size="sm" onClick={() => setRawRowsModal(null)}>
                Tutup
              </Button>
            </div>
          }
        >
          <div className="overflow-auto max-h-[60vh] -mx-6 -my-2 px-6">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="sticky top-0 bg-[#14223b] text-slate-300 font-mono text-[11px] uppercase z-10">
                <tr>
                  {rawRowsModal.columns.map((col, cIdx) => (
                    <th key={cIdx} className="p-2.5 border-b border-white/[0.08]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rawRowsModal.rows.map((row, rIdx) => {
                  const cells = Array.isArray(row) ? row : Object.values(row);
                  return (
                    <tr key={rIdx} className="hover:bg-white/[0.02] transition">
                      {cells.map((val, cellIdx) => (
                        <td key={cellIdx} className="p-2.5 text-slate-300 font-mono text-[11px]">
                          {typeof val === 'number' ? val.toLocaleString('id-ID') : String(val ?? '')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
};

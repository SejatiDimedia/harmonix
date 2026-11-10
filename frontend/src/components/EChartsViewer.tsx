import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Search, MapPin, CreditCard, Table, X, Layers, ChevronRight, Send, ArrowUpRight } from 'lucide-react';
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

    if (tables && tables.length > 0) {
      const isRawProbeTable = (t: TableData) =>
        (t.columns || []).some((c) => c === '_row_id' || c.startsWith('unnamed_'));

      // Find table that best matches xCol or yCol and is not a raw file probe
      let matchingTbl = tables.find((t) =>
        !isRawProbeTable(t) &&
        (t.columns || []).some(
          (c) =>
            (xCol && c.toLowerCase() === xCol.toLowerCase()) ||
            (yCol && c.toLowerCase() === yCol.toLowerCase())
        )
      );

      // If chartData is empty, accept any non-raw table
      if (!matchingTbl && chartData.length === 0) {
        matchingTbl = tables.find((t) => !isRawProbeTable(t));
      }

      if (
        matchingTbl &&
        matchingTbl.columns &&
        matchingTbl.columns.length >= 2 &&
        matchingTbl.rows &&
        matchingTbl.rows.length > 0 &&
        !isRawProbeTable(matchingTbl)
      ) {
        const chartDataColCount = chartData.length > 0 ? Object.keys(chartData[0]).length : 0;
        const hasMatchingCol = matchingTbl.columns.some(
          (c) =>
            (xCol && c.toLowerCase() === xCol.toLowerCase()) ||
            (yCol && c.toLowerCase() === yCol.toLowerCase())
        );

        // Fallback to table if chartData is empty or if table has richer multi-series columns with matching keys
        if (chartData.length === 0 || (matchingTbl.columns.length > chartDataColCount && hasMatchingCol)) {
          xCol = matchingTbl.columns[0];
          yCol = matchingTbl.columns[1];
          chartData = matchingTbl.rows.map((r) => {
            const rowObj: Record<string, any> = {};
            matchingTbl.columns.forEach((c, idx) => {
              rowObj[c] = r[idx] ?? null;
            });
            return rowObj;
          });
        }
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

    const isNumericCol = (data: Record<string, any>[], key: string): boolean => {
      let numCount = 0;
      let totalNonEmpty = 0;
      for (const row of data) {
        const val = row[key];
        if (val !== null && val !== undefined && val !== '') {
          totalNonEmpty++;
          if (typeof val === 'number' || (!isNaN(Number(val)) && !/^\s*$/.test(String(val)))) {
            numCount++;
          }
        }
      }
      return totalNonEmpty > 0 && numCount / totalNonEmpty >= 0.6;
    };

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

    let resolvedXKey = resolveColumnKey(xCol, 'string');

    // Intelligent Temporal Alignment:
    // If resolvedXKey is not a date/period column (e.g. it was assigned "org_id" or "client"),
    // but sampleKeys contains a temporal column (e.g. "month_period", "month", "date"),
    // check if the temporal column has multiple periods. If so, time belongs on the X-axis.
    const isTemporal = (key: string): boolean =>
      /(month|date|period|time|year|quarter|day|hari|bulan|tahun|tanggal|timestamp|created_at|periode)/i.test(key);

    if (!isTemporal(resolvedXKey)) {
      const temporalCandidate = sampleKeys.find(
        (k) => isTemporal(k) && !isNumericCol(chartData, k)
      );
      if (temporalCandidate) {
        resolvedXKey = temporalCandidate;
      }
    }

    interface SeriesItem {
      name: string;
      data: (number | null)[];
      color: string;
    }

    let labels: string[] = [];
    let seriesList: SeriesItem[] = [];

    const nonXKeys = sampleKeys.filter((k) => k !== resolvedXKey);
    const numCols = nonXKeys.filter((k) => isNumericCol(chartData, k));
    const catCols = nonXKeys.filter((k) => !numCols.includes(k));

    // Check if data is in Long / Grouped format (duplicate X categories with distinct series in a categorical column)
    const xValsRaw = chartData.map((d) => {
      const v = d[resolvedXKey];
      return v === null || v === undefined ? '(NULL)' : String(v);
    });
    const uniqueXVals = Array.from(new Set(xValsRaw));
    const hasDuplicateX = uniqueXVals.length < xValsRaw.length;

    let isGroupedLongFormat = false;
    let groupKey = '';
    let metricKey = '';

    if (hasDuplicateX && catCols.length > 0 && numCols.length > 0) {
      for (const cat of catCols) {
        const distinctVals = Array.from(
          new Set(chartData.map((d) => String(d[cat] ?? '')).filter(Boolean))
        );
        if (distinctVals.length >= 2 && distinctVals.length <= 30) {
          groupKey = cat;
          isGroupedLongFormat = true;
          break;
        }
      }
      if (isGroupedLongFormat) {
        metricKey =
          numCols.find((k) => yCol && k.toLowerCase() === yCol.toLowerCase()) ||
          numCols[0];
      }
    }

    // Check if X labels were concatenated with series names (e.g. "2025-06 (ORG-101)" or "2025-06: ORG-101")
    let isConcatenatedX = false;
    let unpackedXLabels: string[] = [];
    let unpackedSeriesNames: string[] = [];
    const concatRegex = /^(.+?)\s*(?:[\(\:\–\—\-]\s*|\s+)([A-Za-z0-9_-]+)\)?$/;

    if (!isGroupedLongFormat && xValsRaw.length >= 2) {
      const parsedRows = xValsRaw.map((v) => {
        const m = v.match(concatRegex);
        return m ? { x: m[1].trim(), s: m[2].trim() } : null;
      });
      const validMatches = parsedRows.filter((p): p is { x: string; s: string } => p !== null);
      if (validMatches.length / xValsRaw.length >= 0.7) {
        const distinctS = Array.from(new Set(validMatches.map((p) => p.s)));
        const distinctX = Array.from(new Set(validMatches.map((p) => p.x)));
        if (distinctS.length >= 2 && distinctS.length <= 20 && distinctX.length >= 1) {
          isConcatenatedX = true;
          unpackedXLabels = distinctX;
          unpackedSeriesNames = distinctS.sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
          );
        }
      }
    }

    if (isGroupedLongFormat) {
      // Long / Grouped Format (e.g. client_id = ORG-101, ORG-104)
      labels = uniqueXVals;
      const distinctGroups = Array.from(
        new Set(chartData.map((d) => String(d[groupKey] ?? '')).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      seriesList = distinctGroups.map((gVal, idx) => {
        const seriesData = labels.map((xVal) => {
          const match = chartData.find(
            (d) => String(d[resolvedXKey] ?? '') === xVal && String(d[groupKey] ?? '') === gVal
          );
          if (!match) return null;
          const raw = Number(match[metricKey]);
          return isNaN(raw) ? null : raw;
        });
        return {
          name: gVal,
          data: seriesData,
          color: PALETTE[idx % PALETTE.length],
        };
      });
    } else if (isConcatenatedX) {
      // Unpacked Concatenated Format (e.g. "2025-06 (ORG-101)" -> X: 2025-06, Series: ORG-101)
      labels = unpackedXLabels;
      const targetMetricKey =
        numCols.find((k) => yCol && k.toLowerCase() === yCol.toLowerCase()) ||
        numCols[0] ||
        resolveColumnKey(yCol, 'number', resolvedXKey);

      seriesList = unpackedSeriesNames.map((sName, idx) => {
        const seriesData = labels.map((xCat) => {
          const matchingRow = chartData.find((d) => {
            const v = String(d[resolvedXKey] ?? '');
            const m = v.match(concatRegex);
            return m && m[1].trim() === xCat && m[2].trim() === sName;
          });
          if (!matchingRow) return null;
          const raw = Number(matchingRow[targetMetricKey]);
          return isNaN(raw) ? null : raw;
        });
        return {
          name: sName,
          data: seriesData,
          color: PALETTE[idx % PALETTE.length],
        };
      });
    } else if (numCols.length >= 2) {
      // Wide Multi-Series Format (multiple numeric columns e.g. ["ORG-101", "ORG-104"])
      const filteredNumCols = numCols.filter(
        (c) => !/^(id|_id|row_id|index|rownum|row_number)$/i.test(c)
      );
      const effectiveNumCols = filteredNumCols.length >= 2 ? filteredNumCols : numCols;

      labels = xValsRaw;
      seriesList = effectiveNumCols.map((colName, idx) => {
        const seriesData = chartData.map((d) => {
          const v = Number(d[colName]);
          return isNaN(v) ? null : v;
        });
        return {
          name: colName,
          data: seriesData,
          color: PALETTE[idx % PALETTE.length],
        };
      });
    } else {
      // Single Series Format
      const resolvedYKey = resolveColumnKey(yCol, 'number', resolvedXKey);
      labels = xValsRaw;
      const singleData = chartData.map((d) => {
        const v = Number(d[resolvedYKey]);
        return isNaN(v) ? 0 : v;
      });
      seriesList = [
        {
          name: spec.y_axis || 'Value',
          data: singleData,
          color: PALETTE[0],
        },
      ];
    }

    let rawType = (spec.chart_type || 'bar').toLowerCase();
    if (rawType === 'donut') rawType = 'doughnut';

    const isPie = rawType === 'pie';
    const isDoughnut = rawType === 'doughnut';
    const isLine = rawType === 'line' || rawType === 'area';
    const isArea = rawType === 'area';
    const isGauge = rawType === 'gauge' || rawType === 'kpi';
    const isScatter = rawType === 'scatter';
    const isStacked = rawType.includes('stack') || Boolean(spec.title && /\b(stacked|tumpuk)\b/i.test(spec.title));

    // 3. Assemble ECharts Configuration Option with Responsive Adapters
    const buildOption = (isCompact: boolean, isUltraCompact: boolean): echarts.EChartsOption => {
      const effectiveShowToolbox = showToolbox && !isKiosk && !isUltraCompact;

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
          padding: isCompact || isUltraCompact ? [6, 10] : [10, 14],
          textStyle: {
            color: '#f8fafc',
            fontSize: isUltraCompact ? 10 : isCompact ? 11 : (isKiosk ? 14 : 12),
          },
          formatter: (params: any) => {
            if (isGauge) {
              const val = params.value;
              return `<div class="font-sans"><strong>${spec.title || 'Metric'}</strong><br/><span style="color:#00d2ee;font-size:16px;font-weight:bold;">${val}%</span></div>`;
            }
            if (isPie || isDoughnut) {
              return `
                <div class="font-sans">
                  <div class="text-slate-400 text-xs mb-1">${params.name}</div>
                  <div class="flex items-center gap-2">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${params.color};"></span>
                    <span class="font-bold text-slate-100">${Number(params.value).toLocaleString('en-US')}</span>
                    <span class="text-slate-400 text-xs">(${params.percent}%)</span>
                  </div>
                  <div class="text-[9.5px] text-sky-400 mt-1.5 border-t border-white/10 pt-1 font-sans flex items-center gap-1">
                    <span>Click for drill-down ↗</span>
                  </div>
                </div>
              `;
            }
            if (Array.isArray(params) && params.length > 0) {
              const axisLabel = params[0].axisValueLabel || params[0].name || '';
              const rowsHtml = params
                .filter((p: any) => p && p.value !== undefined && p.value !== null)
                .map((p: any) => {
                  const sName = p.seriesName || spec.y_axis || 'Value';
                  const num = Number(p.value);
                  const formatted = isNaN(num) ? p.value : num.toLocaleString('en-US');
                  return `
                    <div class="flex items-center justify-between gap-3 text-xs py-0.5">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${p.color};flex-shrink:0;"></span>
                        <span class="text-slate-300 truncate max-w-[150px]">${sName}</span>
                      </div>
                      <span class="font-bold text-slate-100 font-mono shrink-0">${formatted}</span>
                    </div>
                  `;
                })
                .join('');

              return `
                <div class="font-sans min-w-[140px]">
                  <div class="text-slate-400 text-[11px] mb-1.5 font-mono border-b border-white/10 pb-1">${axisLabel}</div>
                  <div class="space-y-0.5">${rowsHtml}</div>
                  <div class="text-[9.5px] text-sky-400 mt-2 border-t border-white/10 pt-1 font-sans flex items-center gap-1">
                    <span>Click for drill-down ↗</span>
                  </div>
                </div>
              `;
            }
            return '';
          },
        },
      };

      // Toolbox (Simpan Gambar, Zoom, Data View)
      if (effectiveShowToolbox) {
        option.toolbox = {
          show: true,
          right: isCompact ? 6 : 12,
          top: 2,
          itemSize: isCompact ? 11 : 13,
          itemGap: isCompact ? 8 : 10,
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
              title: 'Download PNG',
              pixelRatio: 2,
              backgroundColor: '#080f1d',
            },
            dataView: {
              title: 'View Data',
              readOnly: true,
              lang: ['Data Table', 'Close', 'Refresh'],
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
        let pieData: { name: string; value: number }[] = [];
        if (seriesList.length > 1) {
          pieData = seriesList.map((s) => ({
            name: s.name,
            value: s.data.reduce((acc: number, v) => acc + (v || 0), 0),
          }));
        } else {
          pieData = labels.map((name, i) => ({
            name,
            value: (seriesList[0]?.data[i] as number) ?? 0,
          }));
        }

        option.legend = {
          orient: 'horizontal',
          bottom: isUltraCompact ? 0 : 2,
          textStyle: { color: '#94a3b8', fontSize: isUltraCompact ? 8.5 : isCompact ? 9.5 : 11 },
          itemWidth: isUltraCompact ? 8 : isCompact ? 12 : 20,
          itemHeight: isUltraCompact ? 6 : isCompact ? 8 : 12,
          itemGap: isCompact ? 6 : 10,
          type: pieData.length > (isUltraCompact ? 2 : isCompact ? 3 : 5) ? 'scroll' : 'plain',
          pageTextStyle: { color: '#94a3b8', fontSize: 9 },
          pageIconColor: '#008cd0',
          pageIconInactiveColor: '#334155',
        };

        // Calibrated radius so doughnut/pie fills the card with balanced breathing room
        // and doesn't overlap the bottom legend.
        option.series = [
          {
            name: spec.title || spec.y_axis,
            type: 'pie',
            cursor: 'pointer',
            radius: isUltraCompact
              ? (isDoughnut ? ['36%', '66%'] : ['0%', '66%'])
              : isCompact
              ? (isDoughnut ? ['40%', '72%'] : ['0%', '72%'])
              : (isDoughnut ? ['44%', '78%'] : ['0%', '78%']),
            center: ['50%', isUltraCompact ? '42%' : isCompact ? '44%' : '46%'],
            avoidLabelOverlap: true,
            minShowLabelAngle: 10,
            itemStyle: {
              borderRadius: isDoughnut ? 4 : 2,
              borderColor: '#0b1424',
              borderWidth: 2,
            },
            label: {
              show: false,
            },
            labelLine: {
              show: false,
            },
            emphasis: {
              label: {
                show: true,
                fontSize: isUltraCompact ? 11 : isCompact ? 12 : 13,
                fontWeight: 'bold',
                color: '#ffffff',
                formatter: '{b}\n{d}%',
              },
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)',
              },
            },
            data: pieData,
          },
        ];
      } else if (isGauge) {
        const gaugeVal = (seriesList[0]?.data?.[0] as number) || 0;
        option.series = [
          {
            type: 'gauge',
            center: ['50%', '54%'],
            radius: isUltraCompact ? '60%' : isCompact ? '68%' : '75%',
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
              width: isUltraCompact ? 7 : isCompact ? 9 : 12,
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
              length: '60%',
              width: isCompact ? 3 : 4,
              itemStyle: { color: '#ffffff' },
            },
            axisLine: {
              lineStyle: {
                width: isUltraCompact ? 7 : isCompact ? 9 : 12,
                color: [[1, '#14223b']],
              },
              roundCap: true,
            },
            axisTick: {
              distance: isCompact ? -14 : -18,
              splitNumber: 2,
              lineStyle: { width: 1, color: '#475569' },
            },
            splitLine: {
              distance: isCompact ? -18 : -22,
              length: isCompact ? 5 : 7,
              lineStyle: { width: 1.5, color: '#64748b' },
            },
            axisLabel: {
              distance: isCompact ? -24 : -30,
              color: '#94a3b8',
              fontSize: isUltraCompact ? 8 : isCompact ? 9 : 10,
            },
            title: {
              show: true,
              offsetCenter: [0, '65%'],
              fontSize: isUltraCompact ? 9.5 : isCompact ? 10.5 : (isKiosk ? 14 : 12),
              color: '#94a3b8',
            },
            detail: {
              valueAnimation: true,
              fontSize: isUltraCompact ? 15 : isCompact ? 18 : (isKiosk ? 28 : 22),
              offsetCenter: [0, '32%'],
              formatter: '{value}%',
              color: '#f8fafc',
              fontWeight: 'bold',
            },
            data: [{ value: gaugeVal, name: spec.title || spec.y_axis }],
          },
        ];
      } else {
        // Cartesian (Bar, Line, Area, Scatter)
        const isMultiSeries = seriesList.length > 1;

        if (isMultiSeries) {
          option.legend = {
            show: true,
            orient: 'horizontal',
            top: isUltraCompact ? 0 : 2,
            left: 'center',
            textStyle: {
              color: '#94a3b8',
              fontSize: isUltraCompact ? 8.5 : isCompact ? 9.5 : 11,
            },
            itemWidth: isUltraCompact ? 8 : isCompact ? 12 : 16,
            itemHeight: isUltraCompact ? 6 : isCompact ? 8 : 10,
            itemGap: isCompact ? 8 : 12,
            type: seriesList.length > 4 ? 'scroll' : 'plain',
            pageTextStyle: { color: '#94a3b8', fontSize: 9 },
            pageIconColor: '#008cd0',
            pageIconInactiveColor: '#334155',
          };
        }

        option.grid = {
          left: isUltraCompact ? 6 : 10,
          right: isUltraCompact ? 8 : 14,
          bottom: isUltraCompact ? 8 : isCompact ? 12 : (labels.length > 8 ? 20 : 12),
          top: isMultiSeries
            ? (isUltraCompact ? 26 : isCompact ? 30 : (effectiveShowToolbox ? 38 : 32))
            : (isUltraCompact ? 18 : isCompact ? 22 : (effectiveShowToolbox ? 32 : 20)),
          containLabel: true,
        };

        option.xAxis = {
          type: 'category',
          data: labels,
          axisLine: { lineStyle: { color: '#1e3557' } },
          axisTick: { alignWithLabel: true, lineStyle: { color: '#1e3557' } },
          axisLabel: {
            color: '#94a3b8',
            fontSize: isUltraCompact ? 8.5 : isCompact ? 9.5 : (isKiosk ? 12 : 11),
            rotate: isUltraCompact ? (labels.length > 4 ? 18 : 0) : isCompact ? (labels.length > 6 ? 20 : 0) : (labels.length > 8 ? 25 : 0),
            interval: isUltraCompact && labels.length > 5 ? 'auto' : (isCompact && labels.length > 8 ? 'auto' : (labels.length > 14 ? 'auto' : 0)),
            overflow: 'truncate',
            width: isUltraCompact ? 45 : isCompact ? 60 : 75,
            ellipsis: '...',
            hideOverlap: true,
            formatter: (val: string) => {
              const maxLen = isUltraCompact ? 7 : isCompact ? 10 : 15;
              return val.length > maxLen ? `${val.slice(0, maxLen - 2)}...` : val;
            },
          },
        };

        option.yAxis = {
          type: 'value',
          name: undefined, // Omit yAxis title inside canvas to prevent top clipping; widget header already shows it
          axisLine: { show: false },
          axisTick: { show: false },
          splitNumber: isUltraCompact ? 2 : isCompact ? 3 : 4,
          splitLine: {
            lineStyle: {
              color: 'rgba(255, 255, 255, 0.05)',
              type: 'dashed',
            },
          },
          axisLabel: {
            color: '#94a3b8',
            fontSize: isUltraCompact ? 8.5 : isCompact ? 9.5 : (isKiosk ? 12 : 11),
            margin: isUltraCompact ? 4 : 6,
            showMinLabel: true,
            showMaxLabel: true,
            hideOverlap: true,
            formatter: (val: number) => {
              const abs = Math.abs(val);
              const sign = val < 0 ? '-' : '';
              if (abs >= 1_000_000_000) {
                const formatted = (abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '');
                return `${sign}${formatted}B`;
              }
              if (abs >= 1_000_000) {
                const formatted = (abs / 1_000_000).toFixed(1).replace(/\.0$/, '');
                return `${sign}${formatted}M`;
              }
              if (abs >= 1_000) {
                const formatted = (abs / 1_000).toFixed(1).replace(/\.0$/, '');
                return `${sign}${formatted}k`;
              }
              return `${sign}${abs}`;
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
            ...(!isCompact && !isUltraCompact
              ? [
                  {
                    type: 'slider' as const,
                    show: true,
                    height: 12,
                    bottom: 2,
                    borderColor: '#1e3557',
                    backgroundColor: '#0b1322',
                    fillerColor: 'rgba(0, 140, 208, 0.2)',
                    handleStyle: { color: '#008cd0' },
                    textStyle: { color: '#64748b', fontSize: 9 },
                  },
                ]
              : []),
          ];
        }

        if (isScatter) {
          const rawValues = seriesList[0]?.data ?? [];
          option.series = [
            {
              name: seriesList[0]?.name || spec.y_axis,
              type: 'scatter',
              cursor: 'pointer',
              symbolSize: isUltraCompact ? 7 : isCompact ? 8 : (isKiosk ? 14 : 10),
              data: rawValues.map((v, i) => [i, v]),
              itemStyle: {
                color: PALETTE[0],
                shadowBlur: 8,
                shadowColor: 'rgba(0, 210, 238, 0.4)',
              },
            },
          ];
        } else if (isLine) {
          option.series = seriesList.map((s) => ({
            name: s.name,
            type: 'line' as const,
            cursor: 'pointer',
            data: s.data,
            smooth: true,
            connectNulls: true,
            showSymbol: (s.data.length <= 25),
            symbolSize: isUltraCompact ? 5 : isCompact ? 6 : (isKiosk ? 8 : 6),
            symbol: 'circle',
            itemStyle: {
              color: s.color,
              borderColor: '#080f1d',
              borderWidth: 2,
            },
            lineStyle: {
              width: isCompact || isUltraCompact ? 2 : (isKiosk ? 3.5 : 2.5),
              color: s.color,
            },
            areaStyle: isArea
              ? {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: `${s.color}40` },
                    { offset: 1, color: `${s.color}05` },
                  ]),
                }
              : undefined,
          }));
        } else {
          // Standard Bar Chart (Multi-bar grouped or single bar, with stacked support)
          option.series = seriesList.map((s) => ({
            name: s.name,
            type: 'bar' as const,
            cursor: 'pointer',
            data: s.data,
            stack: isStacked ? 'total' : undefined,
            barMaxWidth: isUltraCompact
              ? (seriesList.length > 1 && !isStacked ? 16 : 24)
              : isCompact
              ? (seriesList.length > 1 && !isStacked ? 20 : 30)
              : (isKiosk ? 48 : 36),
            itemStyle: {
              borderRadius: isStacked ? 0 : [4, 4, 0, 0],
              color: seriesList.length > 1
                ? s.color
                : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: '#00d2ee' },
                    { offset: 1, color: '#008cd0' },
                  ]),
            },
            emphasis: {
              itemStyle: {
                shadowBlur: 8,
                shadowColor: 'rgba(0, 0, 0, 0.4)',
              },
            },
          }));
        }
      }

      return option;
    };

    const initialH = containerRef.current.clientHeight || (typeof height === 'number' ? height : 300);
    let lastIsUltraCompact = initialH > 0 && initialH < 210;
    let lastIsCompact = initialH >= 210 && initialH < 310;

    chartInstance.setOption(buildOption(lastIsCompact, lastIsUltraCompact), true);

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

    // 5. Auto-Resize & Responsive Re-layout on element resize
    const resizeObserver = new ResizeObserver((entries) => {
      chartInstance.resize();
      const entryH = entries[0]?.contentRect?.height ?? containerRef.current?.clientHeight ?? 0;
      if (entryH <= 0) return;
      const nowUltraCompact = entryH < 210;
      const nowCompact = entryH >= 210 && entryH < 310;
      if (nowUltraCompact !== lastIsUltraCompact || nowCompact !== lastIsCompact) {
        lastIsUltraCompact = nowUltraCompact;
        lastIsCompact = nowCompact;
        chartInstance.setOption(buildOption(nowCompact, nowUltraCompact), true);
      }
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

    const isEn = Boolean(
      (spec.title && /\b(sales|revenue|orders|trend|top|monthly|average|breakdown|category|product|customer|distribution|count|total)\b/i.test(spec.title)) ||
      (metricName && /\b(sales|revenue|orders|trend|top|monthly|average|breakdown|category|product|customer|distribution|count|total|value|price)\b/i.test(metricName))
    );

    let prompt = '';
    if (templateType === 'root_cause') {
      prompt = isEn
        ? `Deep dive into why ${metricName} for '${dimension}' is ${formattedVal}. What are the primary driving factors and supporting anomalies?`
        : `Analisis mendalam mengapa ${metricName} pada '${dimension}' bernilai ${formattedVal}. Apa faktor pendorong utama dan anomali pendukungnya?`;
    } else if (templateType === 'geo') {
      prompt = isEn
        ? `Analyze transactions for '${dimension}' by customer city and state (geography) to identify primary market concentration.`
        : `Bedah transaksi pada '${dimension}' berdasarkan kota dan provinsi pelanggan (geografi) untuk melihat konsentrasi pasar utamanya.`;
    } else if (templateType === 'payment') {
      prompt = isEn
        ? `Break down transactions for '${dimension}' by payment method (credit card, voucher, boleto) and installment values.`
        : `Bedah transaksi pada '${dimension}' berdasarkan metode pembayaran (kredit, boleto, voucher) dan nilai cicilannya.`;
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
        ? metricValue.toLocaleString('en-US')
        : String(metricValue);

    const isId = Boolean(/\b(apa|berapa|bagaimana|mengapa|kenapa|tolong|tampilkan|faktor|penyebab|pada|data)\b/i.test(customQuestion));

    const prompt = isId
      ? `Mengenai data ${metricName} pada '${dimension}' (Nilai: ${formattedVal}): ${customQuestion.trim()}`
      : `Regarding ${metricName} for '${dimension}' (Value: ${formattedVal}): ${customQuestion.trim()}`;
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
        ? metricValue.toLocaleString('en-US')
        : String(metricValue);

    const isId = Boolean(/\b(apa|berapa|bagaimana|mengapa|kenapa|tolong|tampilkan|faktor|penyebab|pada|data)\b/i.test(customQuestion));

    const basePrompt = customQuestion.trim()
      ? (isId
          ? `Mengenai data ${metricName} pada '${dimension}' (Nilai: ${formattedVal}): ${customQuestion.trim()}`
          : `Regarding ${metricName} for '${dimension}' (Value: ${formattedVal}): ${customQuestion.trim()}`)
      : (isId
          ? `Mengenai data ${metricName} pada '${dimension}' (Nilai: ${formattedVal}), tolong analisis `
          : `Regarding ${metricName} for '${dimension}' (Value: ${formattedVal}), please analyze `);

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
        style={{ height, width: '100%', minHeight: typeof height === 'number' ? height : 0 }}
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
            className="z-50 w-80 max-w-[calc(100vw-32px)] rounded-xl bg-[#0b1424] border border-white/[0.12] p-3.5 shadow-2xl shadow-black/90 font-sans text-slate-100 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-white/[0.08]">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-slate-400 font-semibold tracking-wider">
                  <Layers className="w-3 h-3 text-[#008cd0]" />
                  <span>Analytical Drill-Down</span>
                </div>
                <h4 className="text-sm font-semibold text-white truncate mt-0.5" title={drilldownState.dimension}>
                  {drilldownState.dimension}
                </h4>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {drilldownState.metricName}:{' '}
                  <span className="text-[#38bdf8] font-semibold">
                    {typeof drilldownState.metricValue === 'number'
                      ? drilldownState.metricValue.toLocaleString('en-US')
                      : String(drilldownState.metricValue)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrilldownState(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-2.5 space-y-1.5 text-xs">
              <button
                type="button"
                onClick={() => handleTriggerDrillDown('root_cause')}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#14223b]/80 hover:bg-[#1a2c4e] text-slate-200 hover:text-white border border-white/[0.06] hover:border-sky-500/30 transition text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 transition-colors" />
                  <span className="truncate">Analyze Factors & Anomalies</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-300 group-hover:translate-x-0.5 transition-all shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => handleTriggerDrillDown('geo')}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#14223b]/80 hover:bg-[#1a2c4e] text-slate-200 hover:text-white border border-white/[0.06] hover:border-sky-500/30 transition text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 transition-colors" />
                  <span className="truncate">Break Down by Region</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-300 group-hover:translate-x-0.5 transition-all shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => handleTriggerDrillDown('payment')}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#14223b]/80 hover:bg-[#1a2c4e] text-slate-200 hover:text-white border border-white/[0.06] hover:border-sky-500/30 transition text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <CreditCard className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 transition-colors" />
                  <span className="truncate">Break Down by Payment Method</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-300 group-hover:translate-x-0.5 transition-all shrink-0" />
              </button>

              <button
                type="button"
                onClick={handleOpenRawRows}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#14223b]/80 hover:bg-[#1a2c4e] text-slate-200 hover:text-white border border-white/[0.06] hover:border-sky-500/30 transition text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <Table className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 shrink-0 transition-colors" />
                  <span className="truncate">View Raw Data Rows</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-300 group-hover:translate-x-0.5 transition-all shrink-0" />
              </button>
            </div>

            {/* Custom Question Form Section */}
            <div className="pt-2.5 mt-2.5 border-t border-white/[0.08]">
              <div className="text-[10px] font-mono uppercase text-slate-400 font-semibold mb-1.5 flex items-center justify-between">
                <span>Specific Question</span>
              </div>
              <form onSubmit={handleCustomQuestionSubmit} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customQuestion}
                  onChange={(e) => setCustomQuestion(e.target.value)}
                  placeholder="Ask about anomalies, trends, or drivers..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#070e1b] border border-white/[0.1] text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 font-sans transition-colors"
                />
                <button
                  type="submit"
                  disabled={!customQuestion.trim()}
                  className="p-1.5 rounded-lg bg-[#0074b7] hover:bg-[#008cd0] text-white disabled:opacity-40 transition cursor-pointer shrink-0"
                  title="Send question to analytics"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
              <div className="flex items-center justify-end mt-1.5">
                <button
                  type="button"
                  onClick={handlePrefillToChat}
                  className="text-[10.5px] text-slate-400 hover:text-sky-300 transition cursor-pointer flex items-center gap-1 font-sans"
                >
                  <span>Open in main chat conversation</span>
                  <ArrowUpRight className="w-3 h-3" />
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
          title={`Raw Data Rows: ${rawRowsModal.dimension}`}
          description={`Showing ${rawRowsModal.rows.length} relevant data rows`}
          icon={<Table className="w-5 h-5 text-purple-400" />}
          footer={
            <div className="flex justify-end w-full">
              <Button variant="secondary" size="sm" onClick={() => setRawRowsModal(null)}>
                Close
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
                          {typeof val === 'number' ? val.toLocaleString('en-US') : String(val ?? '')}
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

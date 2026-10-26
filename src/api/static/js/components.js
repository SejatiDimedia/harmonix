/**
 * Modular Visual Components: SQL Box, Data Tables, Chart.js, Metrics & Audit Gates (FR-07, FR-34, FR-35)
 */

import { formatSQL, escapeHtml } from './state.js';

export function renderSQLBox(sqlQueries, container) {
    if (!sqlQueries || sqlQueries.length === 0) return;
    const sqlBox = document.createElement('div');
    sqlBox.className = 'mt-3 rounded-xl bg-[#141413] border border-[#2d2b27] overflow-hidden';
    const sqlHeader = document.createElement('div');
    sqlHeader.className = 'px-3 py-1.5 bg-[#1b1a18] border-b border-[#2d2b27] text-[10px] font-mono text-[#9c9990] flex justify-between items-center';
    sqlHeader.innerHTML = `
        <span class="tracking-wider">POSTGRESQL (SANITIZED & LIMIT 100)</span>
        <button class="copy-sql-btn hover:text-white transition flex items-center gap-1 cursor-pointer">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Salin SQL</span>
        </button>
    `;
    const formattedQueries = sqlQueries.map(q => formatSQL(q)).join('\n\n');
    const sqlContent = document.createElement('pre');
    sqlContent.className = 'p-3 text-[11px] font-mono text-clay-300 whitespace-pre-wrap break-words leading-relaxed overflow-hidden select-text';
    sqlContent.textContent = formattedQueries;

    const copyBtn = sqlHeader.querySelector('.copy-sql-btn');
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(formattedQueries);
        copyBtn.innerHTML = `
            <svg class="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <span class="text-emerald-400">Tersalin!</span>
        `;
        setTimeout(() => {
            copyBtn.innerHTML = `
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Salin SQL</span>
            `;
        }, 2000);
    });

    sqlBox.appendChild(sqlHeader);
    sqlBox.appendChild(sqlContent);
    container.appendChild(sqlBox);
}

export function renderTables(tables, container) {
    if (!tables || tables.length === 0) return;
    tables.forEach(t => {
        const tblWrap = document.createElement('div');
        tblWrap.className = 'mt-3 rounded-xl border border-[#2e2c28] overflow-hidden overflow-x-auto bg-[#1b1a18]';
        const tbl = document.createElement('table');
        tbl.className = 'w-full text-xs text-left border-collapse table-auto';
        let ths = (t.columns || []).map(c => `<th class="p-2.5 text-[11px] font-mono uppercase bg-[#242320] text-[#a3a097] border-b border-[#2e2c28] whitespace-normal break-words">${escapeHtml(c)}</th>`).join('');
        let trs = (t.rows || []).map((r, i) => `
            <tr class="${i % 2 === 0 ? 'bg-[#1b1a18]' : 'bg-[#1e1d1b]'} hover:bg-[#262522] transition">
                ${r.map(val => `<td class="p-2.5 border-b border-[#262421] text-[#dedcd5] font-mono text-[11px] whitespace-normal break-words max-w-xs leading-relaxed">${val !== null && val !== undefined ? escapeHtml(val) : '<span class="text-stone-600">NULL</span>'}</td>`).join('')}
            </tr>
        `).join('');
        tbl.innerHTML = `<thead><tr>${ths}</tr></thead><tbody>${trs}</tbody>`;
        tblWrap.appendChild(tbl);
        container.appendChild(tblWrap);
    });
}

export function renderCharts(charts, tables, container) {
    if (!charts || charts.length === 0) return;
    charts.forEach((ch, chIdx) => {
        let chartData = ch.data || [];
        let xCol = ch.x_axis;
        let yCol = ch.y_axis;

        // Auto-fallback from tables if chart.data is empty
        if (chartData.length === 0 && tables && tables.length > 0) {
            const tbl = tables[0];
            if (tbl.columns && tbl.columns.length >= 2 && tbl.rows && tbl.rows.length > 0) {
                xCol = tbl.columns[0];
                yCol = tbl.columns[1];
                chartData = tbl.rows.map(r => ({
                    [xCol]: r[0] ?? '(NULL)',
                    [yCol]: r[1] ?? 0
                }));
            }
        }

        if (chartData.length === 0) return;

        const chartCard = document.createElement('div');
        chartCard.className = 'mt-4 rounded-xl border border-[#2e2c28] bg-[#161513] p-4 overflow-hidden shadow-sm';
        
        const chartHeader = document.createElement('div');
        chartHeader.className = 'flex items-center justify-between mb-3 pb-2.5 border-b border-[#262421]';
        chartHeader.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-clay-500"></span>
                <span class="text-xs font-medium text-[#dedcd5] font-sans">${escapeHtml(ch.title || 'Visualisasi Data')}</span>
            </div>
            <span class="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#242320] text-clay-400 border border-[#383632]">
                ${escapeHtml(ch.chart_type)}
            </span>
        `;
        chartCard.appendChild(chartHeader);

        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'relative w-full h-64 md:h-72';
        const canvas = document.createElement('canvas');
        canvas.id = `chart_${Date.now()}_${chIdx}_${Math.random().toString(36).substring(2, 6)}`;
        canvasWrap.appendChild(canvas);
        chartCard.appendChild(canvasWrap);

        container.appendChild(chartCard);

        const labels = chartData.map(d => {
            let val = d[xCol];
            if (val === undefined) {
                const keys = Object.keys(d);
                val = keys.length > 0 ? d[keys[0]] : '';
            }
            return (val === null || val === undefined) ? '(NULL)' : String(val);
        });
        const values = chartData.map(d => {
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

        let cType = (ch.chart_type || 'bar').toLowerCase();
        if (cType === 'donut') cType = 'doughnut';
        if (cType === 'scatter') cType = 'line';

        const isPieOrDoughnut = cType === 'pie' || cType === 'doughnut';
        const bgColors = isPieOrDoughnut ? palette : 'rgba(217, 119, 87, 0.75)';
        const borderColors = isPieOrDoughnut ? '#161513' : 'rgb(217, 119, 87)';

        if (window.Chart) {
            new Chart(canvas.getContext('2d'), {
                type: cType,
                data: {
                    labels: labels,
                    datasets: [{
                        label: ch.y_axis,
                        data: values,
                        backgroundColor: bgColors,
                        borderColor: borderColors,
                        borderWidth: isPieOrDoughnut ? 2 : 1.5,
                        borderRadius: cType === 'bar' ? 4 : 0,
                        tension: cType === 'line' ? 0.35 : 0,
                        fill: cType === 'line' ? { target: 'origin', above: 'rgba(217, 119, 87, 0.15)' } : false,
                        pointBackgroundColor: 'rgb(217, 119, 87)',
                        pointBorderColor: '#161513',
                        pointRadius: 4,
                    }]
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
                            }
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
                        }
                    },
                    scales: isPieOrDoughnut ? undefined : {
                        x: {
                            grid: { color: 'rgba(46, 44, 40, 0.6)' },
                            ticks: { color: '#8e8b82', font: { family: 'JetBrains Mono', size: 10 } }
                        },
                        y: {
                            grid: { color: 'rgba(46, 44, 40, 0.6)' },
                            ticks: { color: '#8e8b82', font: { family: 'JetBrains Mono', size: 10 } }
                        }
                    }
                }
            });
        }
    });
}

export function renderMetrics(metrics, container) {
    if (!metrics) return;
    const perfBadge = document.createElement('div');
    perfBadge.className = 'text-[11px] text-[#8e8b82] font-mono mt-3 pt-2.5 border-t border-[#2e2c28] flex items-center justify-between';
    perfBadge.innerHTML = `
        <span>Latensi: ${metrics.total_latency_ms || 0}ms (TTFT: ${metrics.ttft_ms || 0}ms)</span>
        <span>Token: ${metrics.total_tokens || 0} (USD 0.00)</span>
    `;
    container.appendChild(perfBadge);
}

export function renderFollowUpSuggestions(suggestions, container, onSelectSuggestion) {
    if (!suggestions || suggestions.length === 0) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'mt-3.5 pt-3 border-t border-[#2e2c28]/80';
    
    const header = document.createElement('div');
    header.className = 'text-[11px] font-medium text-clay-400 flex items-center gap-1.5 mb-2 font-mono';
    header.innerHTML = `
        <svg class="w-3.5 h-3.5 text-clay-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>Rekomendasi Analisis Lanjutan</span>
    `;
    wrapper.appendChild(header);

    const chipContainer = document.createElement('div');
    chipContainer.className = 'flex flex-wrap gap-2';

    suggestions.forEach(text => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'text-left text-xs text-[#d6d4cb] hover:text-white bg-[#22211e] hover:bg-[#2c2a26] border border-[#383631] hover:border-clay-500/50 rounded-xl px-3 py-1.5 transition-all shadow-sm flex items-center gap-1.5 group cursor-pointer';
        chip.innerHTML = `
            <span class="text-clay-400 group-hover:translate-x-0.5 transition-transform text-[11px]">↳</span>
            <span>${escapeHtml(text)}</span>
        `;
        chip.addEventListener('click', () => {
            if (typeof onSelectSuggestion === 'function') {
                onSelectSuggestion(text);
            }
        });
        chipContainer.appendChild(chip);
    });

    wrapper.appendChild(chipContainer);
    container.appendChild(wrapper);
}

export function renderAuditResult(audit, container) {
    if (!audit) return;
    const status = (audit.status || 'PASSED').toUpperCase();
    const confidence = Math.round((audit.confidence_score || 1.0) * 100);
    const badgeText = audit.badge || 'Verified by Data Auditor';
    const critique = audit.critique || '';
    const issues = audit.issues || [];

    let badgeBg = 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300';
    let iconSvg = `
        <svg class="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
    `;

    if (status === 'FLAGGED') {
        badgeBg = 'bg-rose-950/30 border-rose-500/30 text-rose-300';
        iconSvg = `
            <svg class="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        `;
    } else if (status === 'WARNING') {
        badgeBg = 'bg-amber-950/30 border-amber-500/30 text-amber-300';
        iconSvg = `
            <svg class="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        `;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'mt-3 pt-2.5 border-t border-[#2e2c28]/80 text-xs';

    const card = document.createElement('div');
    card.className = `rounded-xl p-3 border transition-all ${badgeBg}`;

    const topRow = document.createElement('div');
    topRow.className = 'flex items-center justify-between cursor-pointer select-none';
    topRow.innerHTML = `
        <div class="flex items-center gap-2 font-mono font-medium text-xs">
            ${iconSvg}
            <span>${escapeHtml(badgeText)}</span>
            <span class="opacity-75 text-[10px]">(${confidence}%)</span>
        </div>
        <div class="flex items-center gap-1.5 opacity-80 hover:opacity-100 text-[11px]">
            <span class="font-mono text-[10px]">Detail Audit</span>
            <svg class="w-3.5 h-3.5 transition-transform duration-200 transform audit-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
        </div>
    `;

    const detailPanel = document.createElement('div');
    detailPanel.className = 'hidden mt-2 pt-2 border-t border-current/15 text-[11px] leading-relaxed space-y-1.5';
    
    let issuesHtml = '';
    if (issues && issues.length > 0) {
        issuesHtml = `
            <div class="mt-2 space-y-1.5">
                <div class="font-mono font-semibold text-[10px] uppercase opacity-90">Temuan Kritis Auditor:</div>
                ${issues.map(iss => `
                    <div class="bg-black/25 rounded-lg p-2 border border-current/10">
                        <div class="flex items-center gap-1.5">
                            <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-current/20">${escapeHtml(iss.severity || 'medium')}</span>
                            <span class="font-medium font-mono text-[10px]">${escapeHtml(iss.category || 'sql_logic')}</span>
                        </div>
                        <div class="mt-1 opacity-90">${escapeHtml(iss.description || '')}</div>
                        ${iss.suggested_fix ? `<div class="mt-1 text-emerald-300 font-mono text-[10px]">💡 Saran: ${escapeHtml(iss.suggested_fix)}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    detailPanel.innerHTML = `
        <div class="opacity-95">${escapeHtml(critique)}</div>
        ${issuesHtml}
    `;

    topRow.addEventListener('click', () => {
        detailPanel.classList.toggle('hidden');
        const chevron = topRow.querySelector('.audit-chevron');
        if (chevron) {
            chevron.classList.toggle('rotate-180');
        }
    });

    card.appendChild(topRow);
    card.appendChild(detailPanel);
    wrapper.appendChild(card);
    container.appendChild(wrapper);
}

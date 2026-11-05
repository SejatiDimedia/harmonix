export function formatSQL(sql?: string): string {
  if (!sql) return '';
  let s = sql.trim().replace(/\s+/g, ' ');
  s = s.replace(/\b(SELECT|FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET)\b/gi, '\n$1');
  s = s.replace(/\b(LEFT JOIN|RIGHT JOIN|INNER JOIN|FULL JOIN|CROSS JOIN|JOIN)\b/gi, '\n  $1');
  s = s.replace(/\b(AND|OR)\b/gi, '\n    $1');
  return s.trim();
}

export function formatSessionDate(isoStr?: string): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function formatModelNameShort(modelId?: string): string {
  if (!modelId) return '';
  if (modelId.includes('gpt-oss-120b')) return 'GPT-OSS 120B';
  if (modelId.includes('gpt-oss-20b')) return 'GPT-OSS 20B';
  if (modelId.includes('qwen3.8-27b')) return 'Qwen 3.8 27B';
  if (modelId.includes('nemotron')) return 'Nemotron 3.5';
  if (modelId.includes('gemma')) return 'Gemma 4';
  if (modelId.includes('qwen2.5-coder')) return 'Qwen 2.5 7B';
  if (modelId.includes('llama-3.3-70b')) return 'Llama 3.3 70B';
  if (modelId.includes('llama-3.1-8b')) return 'Llama 3.1 8B';
  if (modelId.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
  if (modelId.includes('gemini-1.5-flash')) return 'Gemini 1.5 Flash';
  if (modelId.includes('claude-3-7')) return 'Claude 3.7 Sonnet';
  if (modelId.includes('claude-3-5')) return 'Claude 3.5 Sonnet';
  if (modelId.includes('deepseek-r1')) return 'DeepSeek R1';
  if (modelId.includes('gpt-4o')) return 'GPT-4o';
  const parts = modelId.split('/');
  return parts[parts.length - 1];
}

export function escapeHtml(str?: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getChartDescriptiveTitle(
  spec?: { title?: string; x_axis?: string; y_axis?: string; chart_type?: string } | null,
  fallbackTitle?: string
): string {
  const genericTitles = [
    'chart',
    'grafik',
    'visualisasi',
    'visualisasi data',
    'data visualization',
    'visualisasi data chart',
    '',
  ];

  if (spec?.title && !genericTitles.includes(spec.title.trim().toLowerCase())) {
    return spec.title;
  }
  if (fallbackTitle && !genericTitles.includes(fallbackTitle.trim().toLowerCase())) {
    return fallbackTitle;
  }

  if (spec?.x_axis && spec?.y_axis) {
    const formatCol = (col: string) => {
      const map: Record<string, string> = {
        bulan: 'Bulan',
        month: 'Bulan',
        order_status: 'Status Pesanan',
        status: 'Status Pesanan',
        total_orders: 'Jumlah Pesanan',
        customer_name: 'Pelanggan',
        total_belanja: 'Total Belanja',
        category_name: 'Kategori Produk',
        product_category_name: 'Kategori Produk',
        total_products: 'Jumlah Produk',
        payment_type: 'Metode Pembayaran',
        review_score: 'Rating Ulasan',
        price: 'Harga',
        revenue: 'Pendapatan',
        freight_value: 'Ongkos Kirim',
        delivered: 'Pengiriman Terkirim',
      };
      const key = col.toLowerCase().trim();
      if (map[key]) return map[key];
      return col.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    };

    const x = formatCol(spec.x_axis);
    const y = formatCol(spec.y_axis);
    const type = (spec.chart_type || '').toLowerCase();

    if (['doughnut', 'donut', 'pie'].includes(type)) {
      return `Distribusi ${y} per ${x}`;
    }
    if (type === 'line') {
      return `Tren ${y} berdasarkan ${x}`;
    }
    return `Perbandingan ${y} per ${x}`;
  }

  return fallbackTitle || 'Visualisasi Analitik';
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'i': 'ᵢ', 'j': 'ⱼ', 'n': 'ₙ', 't': 'ₜ',
};

/**
 * Cleans and converts raw LaTeX math notations (e.g., $m^2$, $\rightarrow$, $\ge$, $\text{Rp ...}$, \frac{a}{b})
 * into clean, readable Unicode characters (m², →, ≥, ≤, Rp, a/b) for professional presentation.
 */
export function cleanLatexMathToUnicode(text?: string): string {
  if (!text) return '';
  let s = text;

  // 1. Fractions: \frac{a}{b} or \dfrac{a}{b} -> a / b
  s = s.replace(/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1 / $2');

  // 2. Roots: \sqrt[3]{x} -> ∛(x), \sqrt{x} -> √(x)
  s = s.replace(/\\sqrt\[3\]\{([^{}]+)\}/g, '∛($1)');
  s = s.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');

  // 3. Degrees: ^\circ C, ^\circ\text{C}, ^\circ, \degree
  s = s.replace(/\^\{?\\circ\}?\s*(?:\\text\{)?(?:C|Celsius)?\}?/gi, '°C');
  s = s.replace(/\\degree\s*(?:C)?/gi, '°C');
  s = s.replace(/\\circ\b/g, '°');

  // 4. Micro units & Greek letters
  s = s.replace(/\\mu\s*([a-zA-Z])/g, 'µ$1');
  s = s.replace(/\\mu\b/g, 'µ');

  const greekLetters: [RegExp, string][] = [
    [/\\alpha\b/g, 'α'], [/\\beta\b/g, 'β'], [/\\gamma\b/g, 'γ'], [/\\Gamma\b/g, 'Γ'],
    [/\\delta\b/g, 'δ'], [/\\Delta\b/g, 'Δ'], [/\\epsilon\b/g, 'ε'], [/\\varepsilon\b/g, 'ε'],
    [/\\zeta\b/g, 'ζ'], [/\\eta\b/g, 'η'], [/\\theta\b/g, 'θ'], [/\\vartheta\b/g, 'θ'],
    [/\\lambda\b/g, 'λ'], [/\\Lambda\b/g, 'Λ'], [/\\nu\b/g, 'ν'], [/\\xi\b/g, 'ξ'],
    [/\\pi\b/g, 'π'], [/\\Pi\b/g, 'Π'], [/\\rho\b/g, 'ρ'], [/\\sigma\b/g, 'σ'],
    [/\\Sigma\b/g, 'Σ'], [/\\tau\b/g, 'τ'], [/\\phi\b/g, 'φ'], [/\\varphi\b/g, 'φ'],
    [/\\Phi\b/g, 'Φ'], [/\\chi\b/g, 'χ'], [/\\psi\b/g, 'ψ'], [/\\Psi\b/g, 'Ψ'],
    [/\\omega\b/g, 'ω'], [/\\Omega\b/g, 'Ω'],
  ];
  for (const [regex, val] of greekLetters) {
    s = s.replace(regex, val);
  }

  // 5. Arrows
  s = s.replace(/\\leftrightarrow\b/g, '↔');
  s = s.replace(/\\Leftrightarrow\b|\\iff\b/g, '⇔');
  s = s.replace(/\\(?:rightarrow|to|longrightarrow)\b/g, '→');
  s = s.replace(/\\(?:leftarrow|longleftarrow)\b/g, '←');
  s = s.replace(/\\(?:Rightarrow|implies)\b/g, '⇒');
  s = s.replace(/\\Leftarrow\b/g, '⇐');
  s = s.replace(/\\uparrow\b/g, '↑');
  s = s.replace(/\\downarrow\b/g, '↓');

  // 6. Comparisons & Relations
  s = s.replace(/\\ge(?:q)?\b|\\geqslant\b/g, '≥');
  s = s.replace(/\\le(?:q)?\b|\\leqslant\b/g, '≤');
  s = s.replace(/\\neq\b|\\ne\b/g, '≠');
  s = s.replace(/\\approx\b/g, '≈');
  s = s.replace(/\\simeq\b/g, '≃');
  s = s.replace(/\\sim\b/g, '~');
  s = s.replace(/\\equiv\b/g, '≡');
  s = s.replace(/\\ll\b/g, '<<');
  s = s.replace(/\\gg\b/g, '>>');

  // 7. Math & Set Operators
  s = s.replace(/\\times\b/g, '×');
  s = s.replace(/\\div\b/g, '÷');
  s = s.replace(/\\pm\b/g, '±');
  s = s.replace(/\\mp\b/g, '∓');
  s = s.replace(/\\(?:cdot|centerdot)\b/g, '·');
  s = s.replace(/\\bullet\b/g, '•');
  s = s.replace(/\\infty\b/g, '∞');
  s = s.replace(/\\sum\b/g, '∑');
  s = s.replace(/\\prod\b/g, '∏');
  s = s.replace(/\\int\b/g, '∫');
  s = s.replace(/\\partial\b/g, '∂');
  s = s.replace(/\\nabla\b/g, '∇');
  s = s.replace(/\\forall\b/g, '∀');
  s = s.replace(/\\exists\b/g, '∃');
  s = s.replace(/\\in\b/g, '∈');
  s = s.replace(/\\notin\b/g, '∉');
  s = s.replace(/\\subset\b/g, '⊂');
  s = s.replace(/\\subseteq\b/g, '⊆');

  // 8. Superscripts & Subscripts (converts m^2 -> m², m^3 -> m³, 10^6 -> 10⁶, etc.)
  s = s.replace(/([a-zA-Z0-9\)])\^\{?([0-9\+\-nixy]+)\}?/g, (_match, base, exp) => {
    const converted = exp.split('').map((c: string) => SUPERSCRIPT_MAP[c] || c).join('');
    return `${base}${converted}`;
  });

  // Require explicit curly braces _{sub} to prevent corrupting database identifiers like prod_e04 or order_1
  s = s.replace(/([a-zA-Z0-9\)])_\{([0-9\+\-aeoxijnt]+)\}/g, (_match, base, sub) => {
    const converted = sub.split('').map((c: string) => SUBSCRIPT_MAP[c] || c).join('');
    return `${base}${converted}`;
  });

  // 9. LaTeX Text & Formatting unwrappers
  s = s.replace(/\\(?:text|mathrm|mathbf|textit|textsf|textbf|operatorname)\{\s*([^}]+)\s*\}/g, '$1');
  s = s.replace(/\\left\(/g, '(');
  s = s.replace(/\\right\)/g, ')');
  s = s.replace(/\\left\[/g, '[');
  s = s.replace(/\\right\]/g, ']');
  s = s.replace(/\\left\\\{/g, '{');
  s = s.replace(/\\right\\\}/g, '}');
  s = s.replace(/\\left\|/g, '|');
  s = s.replace(/\\right\|/g, '|');
  s = s.replace(/\\(?:dots|ldots|cdots)\b/g, '...');
  s = s.replace(/\\quad\b/g, '  ');
  s = s.replace(/\\qquad\b/g, '    ');
  s = s.replace(/\\[,;:!]/g, ' ');
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\\\\$/g, '$');
  s = s.replace(/\\&/g, '&');
  s = s.replace(/\\_/g, '_');

  // 10. Normalize double dollar and single dollar math wrappers
  s = s.replace(/\$\$(.*?)\$\$/gs, '$1');

  const nlConjunctions = /\b(?:dan|atau|hingga|sampai|ke|dari|per|dengan|and|or|to|from|with|between)\b/i;
  s = s.replace(/\$([^\$\n]+?)\$/g, (match, inner) => {
    const trimmed = inner.trim();
    if (nlConjunctions.test(trimmed)) {
      return match;
    }
    return trimmed;
  });

  // Clean redundant spaces around currency (e.g. "Rp  30.000.000" -> "Rp 30.000.000")
  s = s.replace(/\bRp\s{2,}/g, 'Rp ');

  // Normalize space-separated currency digits: "Rp 74 497 880,00" -> "Rp 74.497.880,00"
  s = s.replace(
    /\bRp\s*(\d{1,3}(?:\s+\d{3})+(?:,\d{1,2})?)\b/g,
    (_m, digits) => 'Rp ' + digits.replace(/\s+/g, '.')
  );

  // Fix concatenated date ranges: "2026-07-01sampai2026-09-30" -> "2026-07-01 sampai 2026-09-30"
  s = s.replace(
    /(\d{4}-\d{2}-\d{2})\s*(sampai|hingga|sd|s\/d)\s*(\d{4}-\d{2}-\d{2})/gi,
    '$1 $2 $3'
  );
  s = s.replace(
    /(\d{4}-\d{2}-\d{2})([a-zA-Z]+)(\d{4}-\d{2}-\d{2})/g,
    '$1 $2 $3'
  );

  return s;
}

/**
 * Transforms compact 2-column key-value tables (1-4 rows, e.g. Jumlah Pesanan, GMV)
 * into high-impact executive KPI stat cards.
 */
export function convertSmallTwoColTableToKpiCards(markdown: string): string {
  if (!markdown) return '';

  const tableRegex = /\|([^\n|]+)\|([^\n|]+)\|\r?\n\|(?:\s*:?-+:?\s*\|){2}\r?\n((?:\|[^\n|]+\|[^\n|]+\|\r?\n?){1,4})/gi;

  return markdown.replace(tableRegex, (fullMatch, rawH1, rawH2, rawRowsText) => {
    const h1 = rawH1.trim();
    const h2 = rawH2.trim();

    const isKpiHeader =
      /(?:keterangan|metrik|metric|indikator|parameter|item|label|nama)/i.test(h1) ||
      /(?:nilai|value|total|jumlah|omzet|omset|hasil|result|rp|pendapatan|gmv)/i.test(h2);

    const rows = rawRowsText
      .trim()
      .split('\n')
      .map((r: string) => {
        const parts = r.split('|').map((c) => c.trim()).filter(Boolean);
        return {
          col1: parts[0] || '',
          col2: parts[1] || '',
        };
      })
      .filter((r: { col1: string; col2: string }) => r.col1 && r.col2);

    if (rows.length === 0 || rows.length > 4) {
      return fullMatch;
    }

    // Check if col2 looks like concise KPI metrics (numbers, currency, short values under 30 chars)
    const isKpiContent = rows.every((r: { col2: string }) => {
      const c2 = r.col2.replace(/[`*]/g, '').trim();
      return c2.length < 35 && /(?:\d+|rp|%|\$|jt|juta|miliar|k)/i.test(c2);
    });

    if (!isKpiHeader && !isKpiContent) {
      return fullMatch;
    }

    const cardsHtml = rows.map((r: { col1: string; col2: string }) => {
      const cleanLabel = r.col1.replace(/[`*]/g, '').trim();
      let cleanVal = r.col2.replace(/[`*]/g, '').trim();
      // Format space-separated currency digits if present
      cleanVal = cleanVal.replace(/\bRp\s*(\d{1,3}(?:\s+\d{3})+(?:,\d{1,2})?)\b/g, (_m: string, digits: string) => 'Rp ' + digits.replace(/\s+/g, '.'));

      return `  <div class="kpi-summary-card">
    <div class="kpi-summary-label">${escapeHtml(cleanLabel)}</div>
    <div class="kpi-summary-value">${escapeHtml(cleanVal)}</div>
  </div>`;
    }).join('\n');

    const gridClass = rows.length === 1 ? 'kpi-summary-grid kpi-summary-grid-single' : 'kpi-summary-grid';
    return `\n<div class="${gridClass}">\n${cardsHtml}\n</div>\n`;
  });
}

/**
 * Normalizes pseudo-table text (space-separated column blocks) into standard
 * GitHub-Flavored Markdown tables so they render as rich, accessible HTML tables.
 */
export function formatPseudoTableToMarkdown(content?: string): string {
  if (!content) return '';
  const cleanedContent = cleanLatexMathToUnicode(content);
  const lines = cleanedContent.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let buffer: string[] = [];

  const splitRowIntelligently = (raw: string, expectedCols: number): string[] => {
    const rawParts = raw.trim().split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);
    if (rawParts.length === expectedCols) return rawParts;

    const refined: string[] = [];
    for (const p of rawParts) {
      // Split multiple currency occurrences (e.g. "Rp 1.082.908.650 Rp 1.154.714.150")
      const rpMatches = [...p.matchAll(/Rp\s*[\d\.,]+/gi)];
      if (rpMatches.length >= 2) {
        let lastIdx = 0;
        for (const m of rpMatches) {
          if (m.index !== undefined && m.index > lastIdx) {
            const pre = p.slice(lastIdx, m.index).trim();
            if (pre) refined.push(pre);
          }
          refined.push(m[0]);
          lastIdx = (m.index || 0) + m[0].length;
        }
        continue;
      }

      // Check if part ends with a month name (e.g. "Tertinggi Desember" or "Terendah Februari")
      const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
      ];
      let monthFound: string | null = null;
      for (const m of months) {
        const regex = new RegExp(`(^|\\s)(${m})(\\s|$)`, 'i');
        if (regex.test(p)) {
          monthFound = m;
          break;
        }
      }
      if (monthFound && p.length > monthFound.length + 2) {
        const idx = p.lastIndexOf(monthFound);
        const before = p.slice(0, idx).trim();
        const after = p.slice(idx).trim();
        refined.push(before);
        refined.push(after);
        continue;
      }

      // Check if header cell has two obvious column titles like "Peringkat Bulan"
      if (p.toLowerCase() === 'peringkat bulan') {
        refined.push('Peringkat', 'Bulan');
        continue;
      }

      // Check if header cell has "(Selesai) Total Penjualan" or "(Selesai)Total"
      if (p.includes('(Selesai)') && (p.includes('Total') || p.includes('Penjualan'))) {
        const idx = p.indexOf('(Selesai)') + '(Selesai)'.length;
        refined.push(p.slice(0, idx).trim());
        refined.push(p.slice(idx).trim());
        continue;
      }

      refined.push(p);
    }
    return refined;
  };

  const flushBuffer = () => {
    if (buffer.length === 0) return;

    if (buffer.length >= 2) {
      // First pass: inspect preliminary split to determine column count
      const initialRows = buffer.map((raw) =>
        raw.trim().split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean)
      );

      const maxInitialCols = Math.max(...initialRows.map((r) => r.length));
      if (maxInitialCols >= 2) {
        // Intelligently refine each row
        const rows = buffer.map((raw) => splitRowIntelligently(raw, maxInitialCols));
        const finalMaxCols = Math.max(...rows.map((r) => r.length));

        if (finalMaxCols >= 2) {
          const header = rows[0];
          while (header.length < finalMaxCols) header.push('');
          output.push('| ' + header.join(' | ') + ' |');
          output.push('| ' + Array(finalMaxCols).fill(':---').join(' | ') + ' |');

          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            while (row.length < finalMaxCols) row.push('');
            output.push('| ' + row.join(' | ') + ' |');
          }
          buffer = [];
          return;
        }
      }
    }

    output.push(...buffer);
    buffer = [];
  };

  for (const line of lines) {
    const stripped = line.trim();

    if (stripped.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      flushBuffer();
      output.push(line);
      continue;
    }

    if (inCodeBlock) {
      output.push(line);
      continue;
    }

    // Already a markdown table line
    if (stripped.startsWith('|') && stripped.endsWith('|')) {
      flushBuffer();
      output.push(line);
      continue;
    }

    // Markdown heading, blockquote, or numbered/bulleted list item
    if (
      !stripped ||
      /^#{1,6}\s/.test(stripped) ||
      /^>\s/.test(stripped) ||
      /^(\*|-|\+|\d+\.)\s/.test(stripped)
    ) {
      flushBuffer();
      output.push(line);
      continue;
    }

    // Check if line looks like a pseudo-table row:
    const cols = stripped.split(/\s{2,}|\t+/).filter(Boolean);
    const isTableCandidate =
      cols.length >= 2 ||
      (buffer.length > 0 && /^(?:[\.…\-–—]{2,}|(?:\.{3,}))$/.test(stripped));

    if (isTableCandidate) {
      buffer.push(line);
    } else {
      flushBuffer();
      output.push(line);
    }
  }

  flushBuffer();
  const rawMarkdown = output.join('\n');
  return convertSmallTwoColTableToKpiCards(rawMarkdown);
}

/**
 * Intelligently formats table cell values for human readability (thousands separators, currency, percentages).
 */
export function formatTableCellValue(
  val: any,
  colName?: string
): { formatted: string; isNumeric: boolean } {
  if (val === null || val === undefined) {
    return { formatted: 'NULL', isNumeric: false };
  }
  if (typeof val === 'boolean') {
    return { formatted: val ? 'Ya' : 'Tidak', isNumeric: false };
  }

  const strVal = String(val).trim();
  if (strVal === '') {
    return { formatted: '-', isNumeric: false };
  }

  const cleanCol = (colName || '').toLowerCase().trim();

  // If column indicates an ID, code, phone, or postal code, keep raw
  const isIdCol = /(_id|^id$|uuid|code|kode|phone|telepon|zip|postal|nik|resi)\b/i.test(cleanCol);
  if (isIdCol) {
    return { formatted: strVal, isNumeric: false };
  }

  // Check if value is a valid numeric representation
  const isNum = typeof val === 'number' || (/^-?\d+(?:\.\d+)?$/.test(strVal) && !isNaN(Number(strVal)));
  if (!isNum) {
    return { formatted: strVal, isNumeric: false };
  }

  const num = typeof val === 'number' ? val : Number(strVal);

  // Avoid formatting years (e.g. 2023, 2024) as "2.023"
  const isYearCol = /^(?:tahun|year)$/i.test(cleanCol);
  if (isYearCol && Number.isInteger(num) && num >= 1900 && num <= 2100) {
    return { formatted: String(num), isNumeric: true };
  }

  // Percentage formatting if column indicates percentage
  const isPercentCol = /(?:persen|percent|pct|rate|ratio|margin)\b/i.test(cleanCol);
  if (isPercentCol) {
    if (Math.abs(num) > 0 && Math.abs(num) < 1) {
      const pctVal = (num * 100).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
      return { formatted: `${pctVal}%`, isNumeric: true };
    }
    const pctVal = num.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return { formatted: `${pctVal}%`, isNumeric: true };
  }

  // Count / Quantity indicators take precedence to avoid prefixing Rp on order counts
  const isCountCol = /^(?:total_orders|order_count|total_items|item_count|qty|quantity|kuantitas|jumlah_|total_customers|customer_count|frekuensi|frequency)\b/i.test(cleanCol);

  // Currency formatting if column indicates monetary / financial metric
  const isCurrencyCol =
    !isCountCol &&
    /(?:sales_value|payment_value|order_value|total_sales|total_payment|total_belanja|avg_payment|average_payment|harga|price|revenue|pendapatan|omzet|gaji|biaya|cost|freight|nominal)/i.test(cleanCol);

  const isInt = Number.isInteger(num);
  const formattedNum = isInt
    ? num.toLocaleString('id-ID')
    : num.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (isCurrencyCol) {
    return { formatted: `Rp ${formattedNum}`, isNumeric: true };
  }

  return { formatted: formattedNum, isNumeric: true };
}


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

/**
 * Normalizes pseudo-table text (space-separated column blocks) into standard
 * GitHub-Flavored Markdown tables so they render as rich, accessible HTML tables.
 */
export function formatPseudoTableToMarkdown(content?: string): string {
  if (!content) return '';
  const lines = content.split('\n');
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
  return output.join('\n');
}


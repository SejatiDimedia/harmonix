import { TableData } from '../types';

/**
 * Exports a TableData structure to a standard RFC 4180 CSV file
 * with UTF-8 BOM to ensure flawless opening in Microsoft Excel and Google Sheets.
 */
export function exportTableToCSV(table: TableData, filename = 'harmonix_data'): void {
  if (!table || !table.columns || table.columns.length === 0) {
    console.warn('Cannot export empty table to CSV.');
    return;
  }

  const escapeCSVValue = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    // If string contains comma, double quote, or newline, wrap in quotes and escape internal quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerRow = table.columns.map(escapeCSVValue).join(',');
  const dataRows = (table.rows || []).map((row) =>
    row.map(escapeCSVValue).join(',')
  );

  const csvContent = [headerRow, ...dataRows].join('\r\n');

  // \uFEFF is the UTF-8 Byte Order Mark (BOM) for Excel compatibility
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const cleanFilename = filename
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${cleanFilename || 'harmonix_export'}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Triggers the browser's native print engine with executive styling to save as PDF.
 */
export function triggerExecutivePDFPrint(): void {
  // Give a short delay to allow any pending chart animations or DOM updates to settle
  setTimeout(() => {
    window.print();
  }, 250);
}

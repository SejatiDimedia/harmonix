import React, { useEffect, useState } from 'react';
import { Table, X, Database, Copy, Check, ArrowRight } from 'lucide-react';
import { UploadedTableSummary } from '../types';

interface UploadedTableModalProps {
  isOpen: boolean;
  table: UploadedTableSummary | null;
  onClose: () => void;
  onSelectPrompt?: (prompt: string) => void;
}

export const UploadedTableModal: React.FC<UploadedTableModalProps> = ({
  isOpen,
  table,
  onClose,
  onSelectPrompt,
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !table) return null;

  const qualifiedName = `analytics.${table.table_name}`;

  const handleCopyName = () => {
    navigator.clipboard.writeText(qualifiedName);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAction = (prompt: string) => {
    if (onSelectPrompt) {
      onSelectPrompt(prompt);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200 no-print print:hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="uploaded-table-title"
    >
      <div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-[#0f1a2e] border border-[#1e3557] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#1e3557] bg-[#0b1526]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-clay-950/70 border border-clay-800/40 text-clay-400 shrink-0">
              <Table className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="uploaded-table-title" className="text-base font-semibold text-[#f8fafc] font-sans">
                  {table.original_filename}
                </h3>
                {table.sheet_name && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-[#14223b] border border-[#1e3557] text-clay-300">
                    Sheet: {table.sheet_name}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#94a3b8] mt-0.5 font-sans">
                Tabel fisik di PostgreSQL telah dibuat dan siap dianalisis atau digabungkan dengan warehouse.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#14223b] transition cursor-pointer"
            aria-label="Tutup pratinjau tabel (Esc)"
            title="Tutup (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Subheader: SQL Table Reference & Stats */}
        <div className="px-5 py-3 bg-[#111e33] border-b border-[#1e3557] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-mono">
            <Database className="w-3.5 h-3.5 text-[#94a3b8]" />
            <span className="text-[#94a3b8]">Tabel SQL:</span>
            <code className="px-2 py-0.5 rounded bg-[#14223b] border border-[#1e3557] text-clay-300 font-semibold select-all">
              {qualifiedName}
            </code>
            <button
              type="button"
              onClick={handleCopyName}
              className="p-1 rounded hover:bg-[#14223b] text-[#94a3b8] hover:text-white transition cursor-pointer"
              aria-label="Salin nama tabel SQL"
              title="Salin nama tabel"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-[#94a3b8]">
            <span>
              <strong className="text-[#f8fafc]">{table.row_count.toLocaleString()}</strong> baris
            </span>
            <span>•</span>
            <span>
              <strong className="text-[#f8fafc]">{table.columns.length}</strong> kolom
            </span>
          </div>
        </div>

        {/* Modal Body: Column Schema List */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div>
            <h4 className="text-xs font-mono font-medium text-[#f8fafc] uppercase tracking-wider mb-2.5">
              Struktur Kolom &amp; Tipe Data
            </h4>
            <div className="rounded-xl border border-[#1e3557] overflow-hidden bg-[#0b1322]">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-[#1e3557] bg-[#14223b] text-[#94a3b8]">
                    <th scope="col" className="py-2.5 px-3.5 font-medium">Nama Kolom</th>
                    <th scope="col" className="py-2.5 px-3.5 font-medium">Tipe PostgreSQL</th>
                    <th scope="col" className="py-2.5 px-3.5 font-medium">Contoh Nilai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#162742]">
                  {table.columns.map((col) => (
                    <tr key={col.name} className="hover:bg-[#14223b]/70 transition">
                      <td className="py-2 px-3.5 font-semibold text-[#f8fafc]">
                        {col.name}
                      </td>
                      <td className="py-2 px-3.5">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-[#14223b] border border-[#1e3557] text-clay-400">
                          {col.data_type}
                        </span>
                      </td>
                      <td className="py-2 px-3.5 text-[#94a3b8] truncate max-w-[200px]" title={col.sample_values?.join(', ')}>
                        {col.sample_values && col.sample_values.length > 0
                          ? col.sample_values.slice(0, 3).join(', ')
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick Query Suggestions */}
          <div>
            <h4 className="text-xs font-mono font-medium text-[#f8fafc] uppercase tracking-wider mb-2">
              Analisis Cepat
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  handleAction(`Tampilkan 5 baris pertama dari tabel ${qualifiedName} dalam bentuk tabel`)
                }
                className="group flex items-center justify-between p-2.5 rounded-xl bg-[#111e33] hover:bg-[#14223b] border border-[#1e3557] hover:border-[#25416c] transition text-left cursor-pointer"
              >
                <span className="text-xs text-[#94a3b8] group-hover:text-[#f8fafc] font-sans">
                  Lihat 5 sampel data pertama
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-clay-400 shrink-0 ml-2 transition" />
              </button>

              <button
                type="button"
                onClick={() =>
                  handleAction(`Hitung ringkasan statistik (jumlah, rata-rata, nilai min dan max) untuk tabel ${qualifiedName}`)
                }
                className="group flex items-center justify-between p-2.5 rounded-xl bg-[#111e33] hover:bg-[#14223b] border border-[#1e3557] hover:border-[#25416c] transition text-left cursor-pointer"
              >
                <span className="text-xs text-[#94a3b8] group-hover:text-[#f8fafc] font-sans">
                  Hitung ringkasan statistik kolom
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-clay-400 shrink-0 ml-2 transition" />
              </button>

              <button
                type="button"
                onClick={() =>
                  handleAction(`Bandingkan dan gabungkan data dari tabel ${qualifiedName} dengan data pesanan di tabel orders`)
                }
                className="group flex items-center justify-between p-2.5 rounded-xl bg-[#111e33] hover:bg-[#14223b] border border-[#1e3557] hover:border-[#25416c] transition text-left cursor-pointer sm:col-span-2"
              >
                <span className="text-xs text-[#94a3b8] group-hover:text-[#f8fafc] font-sans">
                  Cross-Join: Gabungkan data ini dengan data transaksi pesanan (orders)
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-clay-400 shrink-0 ml-2 transition" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end p-4 border-t border-[#1e3557] bg-[#0b1526]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#94a3b8] bg-[#14223b] hover:bg-[#182a47] border border-[#1e3557] hover:text-[#f8fafc] transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};

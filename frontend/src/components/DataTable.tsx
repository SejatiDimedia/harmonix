import React from 'react';
import { Pin, Download } from 'lucide-react';
import { TableData } from '../types';
import { exportTableToCSV } from '../utils/exportUtils';

interface DataTableProps {
  tables: TableData[];
  onPinTable?: (table: TableData, title: string) => void;
}

export const DataTable: React.FC<DataTableProps> = ({ tables, onPinTable }) => {
  if (!tables || tables.length === 0) return null;

  return (
    <div className="space-y-3 mt-3">
      {tables.map((t, tIdx) => (
        <div
          key={tIdx}
          className="rounded-xl border border-[#1e3557] overflow-hidden bg-[#0f1a2e] shadow-sm"
        >
          <div className="flex items-center justify-between px-3 py-2 bg-[#14223b] border-b border-[#1e3557] gap-2">
            <span className="text-[11px] font-mono text-[#94a3b8]">
              Tabel Data ({t.rows?.length || 0} baris)
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => exportTableToCSV(t, `harmonix_tabel_${tIdx + 1}`)}
                aria-label={`Unduh data tabel ${tIdx + 1} sebagai file CSV`}
                className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-[#162742] hover:bg-[#1a2f4d] text-[#f8fafc] hover:text-white border border-[#1e3557] hover:border-[#25416c] transition cursor-pointer"
                title="Unduh data tabel sebagai file CSV untuk Excel / Google Sheets"
              >
                <Download className="w-3 h-3 text-clay-400" />
                <span>Unduh CSV</span>
              </button>

              {onPinTable && (
                <button
                  type="button"
                  onClick={() => onPinTable(t, `Tabel Hasil Analisis #${tIdx + 1}`)}
                  aria-label={`Sematkan tabel ${tIdx + 1} ke Live Dashboard`}
                  className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-[#162742] hover:bg-clay-600/30 text-[#f8fafc] hover:text-clay-300 border border-[#1e3557] hover:border-clay-500/50 transition cursor-pointer"
                  title="Sematkan tabel ini ke Live Dashboard"
                >
                  <Pin className="w-3 h-3 text-clay-400" />
                  <span>Pin</span>
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse table-auto" aria-label={`Tabel data hasil analitik nomor ${tIdx + 1}`}>
              <thead>
                <tr>
                  {(t.columns || []).map((col, cIdx) => (
                    <th
                      key={cIdx}
                      scope="col"
                      className="p-2.5 text-[11px] font-mono uppercase bg-[#14223b] text-[#94a3b8] border-b border-[#1e3557] whitespace-normal break-words"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(t.rows || []).map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    className={`${
                      rIdx % 2 === 0 ? 'bg-[#0f1a2e]' : 'bg-[#111e33]'
                    } hover:bg-[#162742] transition`}
                  >
                    {row.map((val, cellIdx) => (
                      <td
                        key={cellIdx}
                        className="p-2.5 border-b border-[#162742] text-[#f8fafc] font-mono text-[11px] tabular-nums whitespace-normal break-words max-w-xs leading-relaxed"
                      >
                        {val !== null && val !== undefined ? (
                          String(val)
                        ) : (
                          <span className="text-[#94a3b8] italic font-sans text-[10px]">NULL</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

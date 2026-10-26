import React from 'react';
import { Pin } from 'lucide-react';
import { TableData } from '../types';

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
          className="rounded-xl border border-[#2e2c28] overflow-hidden bg-[#1b1a18] shadow-sm"
        >
          <div className="flex items-center justify-between px-3 py-2 bg-[#201f1d] border-b border-[#2e2c28]">
            <span className="text-[11px] font-mono text-[#a3a097]">
              Tabel Data ({t.rows?.length || 0} baris)
            </span>
            {onPinTable && (
              <button
                type="button"
                onClick={() => onPinTable(t, `Tabel Hasil Analisis #${tIdx + 1}`)}
                className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-[#242320] hover:bg-clay-600/30 text-[#dedcd5] hover:text-clay-300 border border-[#383632] hover:border-clay-500/50 transition cursor-pointer"
                title="Sematkan tabel ini ke Live Dashboard"
              >
                <Pin className="w-3 h-3 text-clay-400" />
                <span>Pin ke Dashboard</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse table-auto">
              <thead>
                <tr>
                  {(t.columns || []).map((col, cIdx) => (
                    <th
                      key={cIdx}
                      className="p-2.5 text-[11px] font-mono uppercase bg-[#242320] text-[#a3a097] border-b border-[#2e2c28] whitespace-normal break-words"
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
                      rIdx % 2 === 0 ? 'bg-[#1b1a18]' : 'bg-[#1e1d1b]'
                    } hover:bg-[#262522] transition`}
                  >
                    {row.map((val, cellIdx) => (
                      <td
                        key={cellIdx}
                        className="p-2.5 border-b border-[#262421] text-[#dedcd5] font-mono text-[11px] whitespace-normal break-words max-w-xs leading-relaxed"
                      >
                        {val !== null && val !== undefined ? (
                          String(val)
                        ) : (
                          <span className="text-stone-600">NULL</span>
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

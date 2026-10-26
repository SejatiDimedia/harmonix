import React from 'react';
import { TableData } from '../types';

interface DataTableProps {
  tables: TableData[];
}

export const DataTable: React.FC<DataTableProps> = ({ tables }) => {
  if (!tables || tables.length === 0) return null;

  return (
    <div className="space-y-3 mt-3">
      {tables.map((t, tIdx) => (
        <div
          key={tIdx}
          className="rounded-xl border border-[#2e2c28] overflow-hidden overflow-x-auto bg-[#1b1a18]"
        >
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
      ))}
    </div>
  );
};

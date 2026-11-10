import React from 'react';
import { Pin, Download } from 'lucide-react';
import { TableData } from '../types';
import { exportTableToCSV } from '../utils/exportUtils';
import { formatTableCellValue } from '../utils/formatters';
import { Button, Card } from './ui';

interface DataTableProps {
  tables: TableData[];
  onPinTable?: (table: TableData, title: string) => void;
}

export const DataTable: React.FC<DataTableProps> = ({ tables, onPinTable }) => {
  if (!tables || tables.length === 0) return null;

  return (
    <div className="space-y-3 mt-3">
      {tables.map((t, tIdx) => (
        <Card
          key={tIdx}
          variant="surface"
          padding="none"
          className="overflow-hidden shadow-sm"
        >
          <div className="flex items-center justify-between px-3 py-2 bg-[#14223b] border-b border-white/[0.04] gap-2">
            <span className="text-[11px] font-mono text-[#94a3b8]">
              Data Table ({t.rows?.length || 0} rows)
            </span>

            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => exportTableToCSV(t, `harmonix_table_${tIdx + 1}`)}
                aria-label={`Download table data ${tIdx + 1} as CSV`}
                title="Download table data as CSV for Excel / Google Sheets"
                leftIcon={<Download className="w-3 h-3 text-clay-400" />}
              >
                Download CSV
              </Button>

              {onPinTable && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onPinTable(t, `Analytical Table Result #${tIdx + 1}`)}
                  aria-label={`Pin table ${tIdx + 1} to Live Dashboard`}
                  title="Pin this table to Live Dashboard"
                  leftIcon={<Pin className="w-3 h-3 text-clay-400" />}
                >
                  Pin
                </Button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse table-auto" aria-label={`Analytical data table number ${tIdx + 1}`}>
              <thead>
                <tr>
                  {(t.columns || []).map((col, cIdx) => (
                    <th
                      key={cIdx}
                      scope="col"
                      className="p-2.5 text-[11px] font-mono uppercase bg-[#14223b] text-[#94a3b8] border-b border-white/[0.06] whitespace-normal break-words"
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
                    {row.map((val, cellIdx) => {
                      const colName = t.columns?.[cellIdx];
                      const { formatted, isNumeric } = formatTableCellValue(val, colName);
                      return (
                        <td
                          key={cellIdx}
                          className={`p-2.5 border-b border-white/[0.03] text-[#f8fafc] font-mono text-[11px] tabular-nums whitespace-normal break-words max-w-xs leading-relaxed ${
                            isNumeric ? 'text-[#38bdf8] font-medium' : ''
                          }`}
                        >
                          {val !== null && val !== undefined ? (
                            formatted
                          ) : (
                            <span className="text-[#94a3b8] italic font-sans text-[10px]">NULL</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
};

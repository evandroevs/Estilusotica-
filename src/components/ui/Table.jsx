import { useState } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

function SortIcon({ direction }) {
  if (direction === "asc")  return <ChevronUp  size={14} className="text-accent" />;
  if (direction === "desc") return <ChevronDown size={14} className="text-accent" />;
  return <ChevronsUpDown size={14} className="text-gray-700" />;
}

function getValue(row, key) {
  return key.split(".").reduce((obj, k) => obj?.[k], row);
}

export default function Table({ columns = [], data = [], onRowClick }) {
  const [sort, setSort] = useState({ key: null, dir: null });

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc")  return { key, dir: "desc" };
      return { key: null, dir: null };
    });
  }

  const sorted = sort.key
    ? [...data].sort((a, b) => {
        const av = getValue(a, sort.key);
        const bv = getValue(b, sort.key);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sort.dir === "asc" ? cmp : -cmp;
      })
    : data;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "#2C2C33" }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <SortIcon direction={sort.key === col.key ? sort.dir : null} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sorted.map((row, idx) => (
              <tr
                key={row.id ?? idx}
                onClick={() => onRowClick?.(row)}
                className={`border-t border-gray-800 transition-colors ${
                  onRowClick ? "cursor-pointer" : ""
                } hover:bg-accent/5 ${idx % 2 === 0 ? "bg-gray-900" : "bg-gray-900/60"}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-gray-300 whitespace-nowrap">
                    {col.render
                      ? col.render(getValue(row, col.key), row)
                      : (getValue(row, col.key) ?? "—")}
                  </td>
                ))}
              </tr>
            ))}

            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-gray-600 text-sm"
                >
                  Nenhum dado encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

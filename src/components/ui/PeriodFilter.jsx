/**
 * PeriodFilter — pílulas de período (Hoje/Ontem/7d/30d/Personalizado)
 * + calendário de intervalo (estilo Meta) quando "Personalizado".
 * Mostra indicador de auto-sync ("Buscando na Meta…") quando o período
 * pedido está sendo baixado.
 */
import { useState } from "react";
import { RefreshCw, CalendarDays, ChevronDown } from "lucide-react";
import { PERIODS } from "../../lib/periods";
import { DateRangeCalendar } from "./DateRangeCalendar";

function fmtBr(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

export function PeriodFilter({
  period,
  custom,
  onPeriodChange,
  onCustomChange,
  syncing = false,
  syncProgress = null,
}) {
  const [calOpen, setCalOpen] = useState(false);

  function handlePeriod(value) {
    onPeriodChange(value);
    setCalOpen(value === "custom"); // Personalizado já abre o calendário
  }

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <div className="flex items-center gap-1 flex-wrap">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => handlePeriod(p.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
              period === p.value
                ? "bg-accent text-black shadow-sm"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setCalOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-gray-700 bg-gray-800 px-2.5 text-xs text-gray-200 hover:border-gray-600 transition-colors"
          >
            <CalendarDays size={12} className="text-gray-500" />
            {custom?.start === custom?.end
              ? fmtBr(custom?.start)
              : `${fmtBr(custom?.start)} – ${fmtBr(custom?.end)}`}
            <ChevronDown size={11} className={`text-gray-500 transition-transform ${calOpen ? "rotate-180" : ""}`} />
          </button>

          {calOpen && (
            <DateRangeCalendar
              value={custom}
              onApply={(range) => { onCustomChange(range); setCalOpen(false); }}
              onClose={() => setCalOpen(false)}
            />
          )}
        </div>
      )}

      {syncing && (
        <span className="flex items-center gap-1.5 text-xs text-accent whitespace-nowrap">
          <RefreshCw size={12} className="animate-spin" />
          {syncProgress ? `Sincronizado até ${fmtBr(syncProgress)}…` : "Buscando na Meta…"}
        </span>
      )}
    </div>
  );
}

/**
 * DateRangeCalendar — seletor de intervalo estilo Gerenciador da Meta:
 * presets à esquerda (Ontem / 7 / 14 / 30 dias) + dois meses lado a lado
 * + Cancelar / Aplicar. Usado pelo PeriodFilter quando "Personalizado".
 */
import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtDate, today } from "../../lib/periods";

const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const PRESETS = [
  { label: "Ontem",           make: () => { const d = fmtDate(addDays(today(), -1));  return { start: d, end: d }; } },
  { label: "Últimos 7 dias",  make: () => ({ start: fmtDate(addDays(today(), -6)),  end: fmtDate(today()) }) },
  { label: "Últimos 14 dias", make: () => ({ start: fmtDate(addDays(today(), -13)), end: fmtDate(today()) }) },
  { label: "Últimos 30 dias", make: () => ({ start: fmtDate(addDays(today(), -29)), end: fmtDate(today()) }) },
];

function MonthGrid({ year, month, draft, maxDate, onPick }) {
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const { start, end } = draft;

  const cells = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="w-56">
      <p className="text-center text-sm font-semibold text-gray-200 mb-2">
        {MESES[month]} {year}
      </p>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEK.map((w) => (
          <span key={w} className="text-[10px] text-gray-500 pb-1">{w}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />;
          const str      = fmtDate(new Date(year, month, day));
          const disabled = str > maxDate;
          const isEdge   = str === start || str === end;
          const inRange  = start && end && str > start && str < end;
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onPick(str)}
              className={`h-7 w-7 mx-auto rounded-lg text-xs tabular-nums transition-colors ${
                disabled        ? "text-gray-700 cursor-not-allowed"
                : isEdge        ? "bg-accent text-black font-bold"
                : inRange       ? "bg-accent-dim text-accent"
                                : "text-gray-300 hover:bg-gray-800"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangeCalendar({ value, onApply, onClose }) {
  const ref = useRef(null);
  const todayStr = fmtDate(today());

  // Rascunho local — só vira filtro no "Aplicar"
  const [draft, setDraft] = useState({
    start: value?.start ?? todayStr,
    end:   value?.end   ?? todayStr,
  });

  // Mês esquerdo: mês anterior ao da data final (direito = mês da data final)
  const [by, bm] = (value?.end ?? todayStr).split("-").map(Number);
  const baseLeft = new Date(by, bm - 2, 1);
  const [view, setView] = useState({ y: baseLeft.getFullYear(), m: baseLeft.getMonth() });

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  function pick(str) {
    setDraft((d) => {
      // intervalo completo (ou nada) → recomeça do dia clicado
      if (!d.start || d.end) return { start: str, end: null };
      // segunda ponta — inverte se veio antes do início
      return str < d.start ? { start: str, end: d.start } : { start: d.start, end: str };
    });
  }

  function shift(n) {
    setView(({ y, m }) => {
      const d = new Date(y, m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  const next = new Date(view.y, view.m + 1, 1);
  const presetActive = (p) => {
    const r = p.make();
    return draft.start === r.start && draft.end === r.end;
  };

  return (
    <div
      ref={ref}
      className="absolute top-full mt-2 left-0 z-40 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-4 flex gap-4"
    >
      {/* Presets */}
      <div className="flex flex-col gap-1 pr-4 border-r border-gray-800 shrink-0">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setDraft(p.make())}
            className={`px-3 py-2 rounded-lg text-xs font-semibold text-left whitespace-nowrap transition-colors ${
              presetActive(p)
                ? "bg-accent-dim text-accent border border-accent/40"
                : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Calendários + ações */}
      <div>
        <div className="flex items-start gap-6 relative">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="absolute left-0 top-0 p-1 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="absolute right-0 top-0 p-1 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            <ChevronRight size={15} />
          </button>

          <MonthGrid year={view.y} month={view.m} draft={draft} maxDate={todayStr} onPick={pick} />
          <MonthGrid year={next.getFullYear()} month={next.getMonth()} draft={draft} maxDate={todayStr} onPick={pick} />
        </div>

        <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-gray-700 text-xs font-semibold text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!draft.start}
            onClick={() => onApply({ start: draft.start, end: draft.end ?? draft.start })}
            className="px-4 py-1.5 rounded-lg bg-accent text-black text-xs font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

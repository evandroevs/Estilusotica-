/**
 * Períodos de análise — fonte única para Dashboard, Top Criativos e Análise.
 *
 * Opções: Hoje, Ontem, 7 dias, 30 dias e Personalizado (1 dia ou intervalo).
 * Datas formatadas em horário LOCAL (evita off-by-one do toISOString UTC).
 */

function pad(n) { return String(n).padStart(2, "0"); }

/** Date → "YYYY-MM-DD" no fuso local. */
export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** "YYYY-MM-DD" → Date (meia-noite local). */
function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const PERIODS = [
  { value: "hoje",   label: "Hoje"          },
  { value: "ontem",  label: "Ontem"         },
  { value: "7d",     label: "7 dias"        },
  { value: "30d",    label: "30 dias"       },
  { value: "custom", label: "Personalizado" },
];

/** Hoje (meia-noite local). */
export function today() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** Intervalo padrão sugerido ao abrir o "Personalizado": últimos 7 dias. */
export function defaultCustom() {
  const t = today();
  return { start: fmtDate(addDays(t, -6)), end: fmtDate(t) };
}

/**
 * Resolve um período para { s, e } (strings YYYY-MM-DD, inclusive).
 * @param period  "hoje" | "ontem" | "7d" | "30d" | "custom"
 * @param custom  { start, end } quando period === "custom"
 */
export function getPeriodDates(period, custom) {
  const t = today();
  switch (period) {
    case "hoje":
      return { s: fmtDate(t), e: fmtDate(t) };
    case "ontem": {
      const d = addDays(t, -1);
      return { s: fmtDate(d), e: fmtDate(d) };
    }
    case "7d":
      return { s: fmtDate(addDays(t, -6)), e: fmtDate(t) };
    case "30d":
      return { s: fmtDate(addDays(t, -29)), e: fmtDate(t) };
    case "custom": {
      const c = custom?.start && custom?.end ? custom : defaultCustom();
      // garante s <= e
      return c.start <= c.end
        ? { s: c.start, e: c.end }
        : { s: c.end, e: c.start };
    }
    default:
      return { s: fmtDate(addDays(t, -6)), e: fmtDate(t) };
  }
}

/**
 * Período imediatamente anterior, de mesma duração — usado para os deltas
 * "vs período anterior" do Dashboard. Funciona para qualquer período, custom incluso.
 */
export function getPrevDates(period, custom) {
  const { s, e } = getPeriodDates(period, custom);
  const sd = parseDate(s);
  const ed = parseDate(e);
  const lenDays = Math.round((ed - sd) / 86400000) + 1;
  const prevEnd = addDays(sd, -1);
  const prevStart = addDays(prevEnd, -(lenDays - 1));
  return { s: fmtDate(prevStart), e: fmtDate(prevEnd) };
}

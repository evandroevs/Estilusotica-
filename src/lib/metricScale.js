/**
 * metricScale — régua de níveis de cor para métricas de anúncios.
 *
 * Os limiares vêm dos benchmarks de Configurações (bom / excelente):
 *   < 2/3 do bom        → ruim        (vermelho)    ex.: CTR < 1,0 com bom = 1,5
 *   < bom               → alerta      (amarelo)
 *   < excelente         → bom         (verde claro)
 *   < 1,5 × excelente   → excelente   (verde)
 *   acima               → excepcional (verde forte)
 */

/** Mapeia os benchmarks da config para limiares por métrica. */
export function buildBenchMap(b = {}) {
  return {
    roas:            { bom: b.roas_qualificado ?? 3,  excelente: b.roas_excelente ?? 5 },
    ctr:             { bom: b.ctr_bom ?? 1.5,         excelente: b.ctr_excelente ?? 3 },
    thumbstop_rate:  { bom: b.thumbstop_bom ?? 25,    excelente: b.thumbstop_excelente ?? 40 },
    conversion_rate: { bom: 3.5, excelente: 7 },  // base: compras ÷ cliques no link
    connect_rate:    { bom: 60, excelente: 80 },
  };
}

/** Nível da métrica ("ruim" … "excepcional") ou null se não há benchmark. */
export function metricLevel(value, bench) {
  if (!bench?.bom || !bench?.excelente) return null;
  if (value == null || (typeof value === "number" && isNaN(value))) return null;
  if (value < bench.bom * (2 / 3))     return "ruim";
  if (value < bench.bom)               return "alerta";
  if (value < bench.excelente)         return "bom";
  if (value < bench.excelente * 1.5)   return "excelente";
  return "excepcional";
}

/** Classes Tailwind da pílula colorida de cada nível (tema dark). */
export const LEVEL_PILL = {
  ruim:        "bg-red-500/10 text-red-400 border border-red-500/40",
  alerta:      "bg-yellow-500/10 text-yellow-400 border border-yellow-500/40",
  bom:         "bg-green-500/10 text-green-500 border border-green-600/35",
  excelente:   "bg-green-500/15 text-green-400 border border-green-500/50",
  excepcional: "bg-green-400/20 text-green-300 border border-green-400/70 font-bold",
};

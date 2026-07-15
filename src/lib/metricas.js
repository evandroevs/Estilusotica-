/**
 * Chaves de métrica de performance de um anúncio (mesmos nomes em
 * meta_ads_cache, get_ads_metrics e no objeto `ad` consumido pelas páginas).
 * Usadas para tirar um "snapshot" das métricas no momento em que um criativo
 * é salvo numa pasta — assim a Biblioteca mostra os números do período em que
 * o vídeo foi salvo, mesmo depois que o cache muda ou o anúncio some da Meta.
 */
export const METRIC_KEYS = [
  "spend",
  "revenue",
  "roas",
  "purchases",
  "cpa",
  "cpm",
  "cpc",
  "ctr",
  "conversion_rate",
  "connect_rate",
  "thumbstop_rate",
  "impressions",
  "link_clicks",
  "landing_page_views",
];

/** Extrai apenas as chaves de métrica de um objeto `ad` (ignora null/undefined). */
export function pickMetricas(ad) {
  if (!ad) return null;
  const out = {};
  let has = false;
  for (const k of METRIC_KEYS) {
    if (ad[k] !== null && ad[k] !== undefined) {
      out[k] = ad[k];
      has = true;
    }
  }
  return has ? out : null;
}

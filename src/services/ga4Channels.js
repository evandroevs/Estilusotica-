/**
 * Normalizador de canais de tráfego do GA4 para e-commerce.
 * Recebe source/medium e devolve o canal real padronizado.
 * Regras aplicadas EM ORDEM — a primeira que casa vence.
 */

const norm = (s) => (s ?? "").toString().trim().toLowerCase();

export function normalizeChannel(sourceRaw, mediumRaw) {
  const source = norm(sourceRaw);
  const medium = norm(mediumRaw);
  const out = (canal, grupo, revisar = false) => ({
    source_original: sourceRaw ?? "",
    medium_original: mediumRaw ?? "",
    canal, grupo, revisar,
  });

  // 1. Meta — Pago (agrupa tudo em Meta Ads, sem separar placement)
  if (source === "influenciador" || source === "ig" || source === "fb" || source === "an") {
    return out("Meta Ads", "Pago");
  }

  // 2. Influencer — Orgânico
  if (medium === "influencer") return out("Influencer Orgânico", "Orgânico");

  // 3. Instagram — Orgânico
  if (source === "instagram.com" || source === "l.instagram.com") {
    return out("Instagram Orgânico", "Orgânico");
  }

  // 4 + 5. Google (Pago / Orgânico)
  if (source === "google") {
    if (medium === "cpc")          return out("Google Ads", "Pago");
    if (medium === "product_sync") return out("Google Shopping", "Pago");
    if (medium === "organic")      return out("Google Orgânico", "Orgânico");
    if (medium === "(not set)" || medium === "") return out("Google Ads", "Pago");
  }

  // 6. E-mail
  if (source === "edrone" || medium === "email") return out("E-mail", "Email");

  // 7. WhatsApp / CRM
  if (medium === "whatsapp") {
    return out(source === "martz" ? "Martz/Whats" : "WhatsApp", "WhatsApp");
  }

  // 8. Social Orgânico
  if (source === "social") return out("Social Orgânico", "Orgânico");

  // 9. Direto
  if (source === "(direct)" && medium === "(none)") return out("Direto", "Direto");

  // 10. Atribuição Perdida
  if (source === "(not set)" && medium === "(not set)") return out("Atribuição Perdida", "Não Atribuído");

  // 11. Fallback
  return out("Outros", "Outros", true);
}

/** Agrega linhas {sessionSource, sessionMedium, sessions, conversions, purchaseRevenue}
 *  por canal normalizado. Retorna ordenado por sessões desc. */
export function aggregateChannels(rows) {
  const map = new Map();
  for (const r of rows ?? []) {
    const n = normalizeChannel(r.sessionSource, r.sessionMedium);
    const cur = map.get(n.canal) ?? {
      canal: n.canal, grupo: n.grupo, revisar: n.revisar,
      sessions: 0, totalUsers: 0, conversions: 0, purchaseRevenue: 0,
    };
    cur.sessions       += +r.sessions || 0;
    cur.totalUsers     += +r.totalUsers || 0;
    cur.conversions    += +r.conversions || 0;
    cur.purchaseRevenue += +r.purchaseRevenue || 0;
    cur.revisar = cur.revisar || n.revisar;
    map.set(n.canal, cur);
  }
  return [...map.values()].sort((a, b) => b.sessions - a.sessions);
}

export const GRUPO_COR = {
  "Pago":           { bg: "rgba(200,255,0,0.14)",  text: "#C8FF00" },
  "Orgânico":       { bg: "rgba(74,222,128,0.16)", text: "#4ADE80" },
  "Direto":         { bg: "rgba(96,165,250,0.16)", text: "#60A5FA" },
  "Email":          { bg: "rgba(56,189,248,0.16)", text: "#38BDF8" },
  "WhatsApp":       { bg: "rgba(37,211,102,0.16)", text: "#25D366" },
  "Não Atribuído":  { bg: "rgba(148,163,184,0.14)", text: "#94A3B8" },
  "Outros":         { bg: "rgba(251,146,60,0.16)", text: "#FB923C" },
};

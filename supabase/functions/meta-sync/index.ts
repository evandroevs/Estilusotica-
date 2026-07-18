/**
 * meta-sync — Edge Function (Deno) — MULTI-TENANT
 *
 * Busca insights de anúncios na Meta Marketing API v21.0, deriva as métricas
 * do glossário do PRD (seção 4) e faz upsert em meta_ads_cache/meta_ads_daily
 * do WORKSPACE do usuário autenticado.
 *
 * O token e a conta de anúncios vêm da conexão OAuth do workspace
 * (meta_connections + meta_connection_secrets), criada pela function
 * meta-oauth — não existem mais secrets globais de token.
 *
 * Body (JSON):
 *   { date_start: "YYYY-MM-DD", date_stop: "YYYY-MM-DD" }
 *
 * Resposta:
 *   { synced: number, errors: Array<{ ad_id: string; error: string }> }
 */

import {
  resolveMetaConnection,
  TenantError,
  jsonResponse,
  CORS_HEADERS,
} from "../_shared/tenant.ts";
import {
  CREATIVE_MEDIA_FIELDS,
  extractVideoId,
  type CreativeMediaFields,
} from "../_shared/metaVideo.ts";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ActionEntry {
  action_type: string;
  value: string;
}

interface MetaInsight {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  spend: string;
  impressions: string;
  reach?: string;
  clicks: string;
  inline_link_clicks: string;
  inline_link_click_ctr: string;
  cpc: string;
  cpm: string;
  purchase_roas?: ActionEntry[];
  actions?: ActionEntry[];
  action_values?: ActionEntry[];
  cost_per_action_type?: ActionEntry[];
  date_start: string;
  date_stop: string;
}

interface Product {
  id: string;
  nome: string;
  slug: string;
  keywords: string[] | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actionVal(
  arr: ActionEntry[] | undefined,
  type: string,
): number {
  return parseFloat(arr?.find((a) => a.action_type === type)?.value ?? "0") || 0;
}

/**
 * Infere o funil (TOFU/MOFU/BOFU) pelo nome do anúncio/campanha.
 * Convenções comuns de nomenclatura de contas de e-commerce BR.
 */
function inferFunil(adName: string): string {
  const n = adName.toUpperCase();
  if (n.includes("BOFU") || n.includes("BOF")) return "BOFU";
  if (n.includes("MOFU") || n.includes("MOF")) return "MOFU";
  if (n.includes("TOFU") || n.includes("TOF")) return "TOFU";
  if (n.includes("RETARG") || n.includes("RMKT") || n.includes("REMARKETING") ||
      n.includes("PDP") || n.includes("CHECKOUT")) return "BOFU";
  if (n.includes("ENGAJ") || n.includes("QUALIF")) return "MOFU";
  return "TOFU";
}

function inferProductId(
  adName: string,
  products: Product[],
): string | null {
  const n = adName.toUpperCase();
  // Keywords vêm da coluna products.keywords do workspace (cada cliente define
  // as suas). Siglas curtas (≤3 chars) só casam como TOKEN inteiro — substring
  // geraria falso-positivo ("LM" dentro de "fiLMe"). Em empate, vence a
  // keyword mais longa/específica, independente da ordem no banco.
  let best: string | null = null;
  let bestLen = 0;
  for (const product of products) {
    const kws = product.keywords?.length
      ? product.keywords.map((k) => k.toUpperCase())
      : [product.nome.toUpperCase()];
    for (const kwRaw of kws) {
      const kw = kwRaw.trim();
      if (!kw) continue;
      const hit = kw.length <= 3
        ? new RegExp(`(^|[^A-Z0-9])${kw}([^A-Z0-9]|$)`).test(n)
        : n.includes(kw);
      if (hit && kw.length > bestLen) {
        best = product.id;
        bestLen = kw.length;
      }
    }
  }
  return best;
}

/** Contadores brutos (aditivos) de UM registro diário da Meta. */
interface Counters {
  spend: number;
  revenue: number;
  purchases: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  landing_page_views: number;
  video_views_3s: number;
  initiate_checkout: number;
  add_payment_info: number;
  messages: number;
  reach: number;
}

/** Extrai os contadores aditivos de um insight diário. */
function deriveCounters(insight: MetaInsight): Counters {
  const spend       = parseFloat(insight.spend)                || 0;
  const impressions = parseInt(insight.impressions, 10)        || 0;
  const clicks      = parseInt(insight.clicks, 10)             || 0;
  const linkClicks  = parseInt(insight.inline_link_clicks, 10) || 0;

  // Receita e compras (omni_purchase como fallback)
  const revenue   = actionVal(insight.action_values, "purchase") ||
                    actionVal(insight.action_values, "omni_purchase");
  const purchases = actionVal(insight.actions, "purchase") ||
                    actionVal(insight.actions, "omni_purchase");

  const landingPageViews = actionVal(insight.actions, "landing_page_view");

  // Hook rate (thumbstop): plays de 3s ÷ impressões — actions/video_view.
  // NÃO usar video_play_actions — conta qualquer play (autoplay) e infla a taxa p/ ~90%.
  const views3s = actionVal(insight.actions, "video_view");

  const initiateCheckout = actionVal(insight.actions, "initiate_checkout") ||
                           actionVal(insight.actions, "omni_initiated_checkout");
  const addPayment       = actionVal(insight.actions, "add_payment_info") ||
                           actionVal(insight.actions, "omni_add_payment_info");

  // Negócio local: conversas iniciadas por mensagem (WhatsApp/Messenger/Direct)
  const messages = actionVal(insight.actions, "onsite_conversion.messaging_conversation_started_7d") ||
                   actionVal(insight.actions, "onsite_conversion.total_messaging_connection");
  const reach    = parseInt(insight.reach ?? "0", 10) || 0;

  return {
    spend,
    revenue,
    purchases:          Math.round(purchases),
    impressions,
    clicks,
    link_clicks:        linkClicks,
    landing_page_views: Math.round(landingPageViews),
    video_views_3s:     views3s,
    initiate_checkout:  Math.round(initiateCheckout),
    add_payment_info:   Math.round(addPayment),
    messages:           Math.round(messages),
    reach,
  };
}

/** Soma contadores acumulados (b) em (a). */
function addCounters(a: Counters, b: Counters): void {
  a.spend              += b.spend;
  a.revenue            += b.revenue;
  a.purchases          += b.purchases;
  a.impressions        += b.impressions;
  a.clicks             += b.clicks;
  a.link_clicks        += b.link_clicks;
  a.landing_page_views += b.landing_page_views;
  a.video_views_3s     += b.video_views_3s;
  a.initiate_checkout  += b.initiate_checkout;
  a.add_payment_info   += b.add_payment_info;
  a.messages           += b.messages;
  a.reach              += b.reach;
}

function emptyCounters(): Counters {
  return {
    spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0,
    link_clicks: 0, landing_page_views: 0, video_views_3s: 0,
    initiate_checkout: 0, add_payment_info: 0, messages: 0, reach: 0,
  };
}

/** Deriva as taxas (glossário PRD seção 4) a partir de contadores somados. */
function snapshotMetrics(c: Counters) {
  return {
    spend:              c.spend,
    revenue:            c.revenue,
    roas:               c.spend > 0 ? c.revenue / c.spend : 0,
    purchases:          c.purchases,
    cpa:                c.purchases > 0 ? c.spend / c.purchases : 0,
    cpm:                c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
    cpc:                c.link_clicks > 0 ? c.spend / c.link_clicks : 0,
    ctr:                c.impressions > 0 ? (c.link_clicks / c.impressions) * 100 : 0,
    impressions:        c.impressions,
    link_clicks:        c.link_clicks,
    landing_page_views: c.landing_page_views,
    thumbstop_rate:     c.impressions > 0 ? (c.video_views_3s / c.impressions) * 100 : 0,
    connect_rate:       c.link_clicks > 0 ? (c.landing_page_views / c.link_clicks) * 100 : 0,
    conversion_rate:    c.link_clicks > 0 ? (c.purchases / c.link_clicks) * 100 : 0,
  };
}

// ─── Paginação Meta API ───────────────────────────────────────────────────────

/**
 * Divide [start, end] em sub-janelas de no máximo `days` dias.
 * A Meta retorna erro 500 (subcode 99) em pulls diários (time_increment=1)
 * de janelas longas; sub-janelas curtas evitam isso.
 */
function splitRange(start: string, end: string, days = 7): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  const toDate = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  let cur = toDate(start);
  const last = toDate(end);
  while (cur <= last) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + days - 1);
    const until = chunkEnd <= last ? chunkEnd : last;
    out.push({ since: fmt(cur), until: fmt(until) });
    cur = new Date(until);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function fetchAllInsights(
  firstUrl: string,
): Promise<MetaInsight[]> {
  const results: MetaInsight[] = [];
  let next: string | null = firstUrl;

  while (next) {
    const resp = await fetch(next);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Meta API ${resp.status}: ${text}`);
    }

    const json = await resp.json();

    if (json.error) {
      throw new Error(`Meta API error: ${json.error.message} (code ${json.error.code})`);
    }

    if (Array.isArray(json.data)) {
      results.push(...json.data);
    }

    next = json.paging?.next ?? null;
  }

  return results;
}

interface AdCreative {
  id: string;
  creative?: CreativeMediaFields;
}

/** Busca dados de criativo (thumbnail, video_id) para todos os anúncios do período. */
async function fetchCreativeMap(
  account: string,
  token: string,
  dateStart: string,
  dateStop: string,
): Promise<{
  map: Map<string, { thumbnail_url: string | null; video_id: string | null; media_type: string }>;
  error: string | null;
}> {
  const map = new Map<string, { thumbnail_url: string | null; video_id: string | null; media_type: string }>();

  const params = new URLSearchParams({
    // thumbnail_width/height: sem isso a Meta devolve thumbnail de 64×64 (embaçado nos cards)
    fields:       `id,creative.thumbnail_width(1080).thumbnail_height(1080){${CREATIVE_MEDIA_FIELDS}}`,
    time_range:   JSON.stringify({ since: dateStart, until: dateStop }),
    // 100 por página: com os campos de vídeo expandidos, 500 estoura o limite
    // de payload da Meta ("Please reduce the amount of data")
    limit:        "100",
    access_token: token,
  });

  let next: string | null =
    `https://graph.facebook.com/v21.0/act_${account}/ads?${params}`;
  let error: string | null = null;

  while (next) {
    const resp = await fetch(next);
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.error) {
      error = json.error?.message ?? `Meta API ${resp.status} ao buscar criativos`;
      break;
    }

    for (const ad of (json.data as AdCreative[] ?? [])) {
      const c = ad.creative ?? {};
      const videoId = extractVideoId(c);
      map.set(ad.id, {
        thumbnail_url: c.thumbnail_url ?? c.image_url ?? null,
        video_id:      videoId,
        media_type:    videoId ? "video" : "image",
      });
    }

    next = json.paging?.next ?? null;
  }

  return { map, error };
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ── 1. Workspace + conexão Meta do usuário autenticado ──
    const ctx = await resolveMetaConnection(req);
    const META_TOKEN   = ctx.accessToken;
    const META_ACCOUNT = ctx.accountId;
    const WORKSPACE    = ctx.workspaceId;
    const supabase     = ctx.admin;

    // ── 2. Parse do body ──
    let body: { date_start?: string; date_stop?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body JSON inválido." }, 400);
    }

    const { date_start, date_stop } = body;

    if (!date_start || !date_stop) {
      return json(
        { error: "Body deve conter date_start e date_stop no formato YYYY-MM-DD." },
        400,
      );
    }

    // ── 3. Montar URL Meta API ──
    const FIELDS = [
      "ad_id",
      "ad_name",
      "campaign_id",
      "campaign_name",
      "spend",
      "impressions",
      "reach",
      "clicks",
      "inline_link_clicks",
      "inline_link_click_ctr",
      "cpc",
      "cpm",
      "actions",
      "action_values",
      "purchase_roas",
      "cost_per_action_type",
    ].join(",");

    // ── 4. Buscar insights (paginação + sub-janelas de 7 dias) ──
    const insights: MetaInsight[] = [];
    for (const win of splitRange(date_start, date_stop, 7)) {
      const params = new URLSearchParams({
        level:          "ad",
        time_range:     JSON.stringify(win),
        time_increment: "1",   // breakdown diário: 1 linha por anúncio por dia
        fields:         FIELDS,
        limit:          "500",
        access_token:   META_TOKEN,
      });
      const metaUrl = `https://graph.facebook.com/v21.0/act_${META_ACCOUNT}/insights?${params}`;
      insights.push(...await fetchAllInsights(metaUrl));
    }

    // ── 4b. Buscar criativos (thumbnail, video_id) em paralelo ──
    const { map: creativeMap, error: creativeErr } =
      await fetchCreativeMap(META_ACCOUNT, META_TOKEN, date_start, date_stop);

    // ── 5. Carregar produtos do workspace para inferência de product_id ──
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, nome, slug, keywords")
      .eq("workspace_id", WORKSPACE)
      .eq("ativo", true);

    if (prodErr) {
      return json({ error: `Falha ao carregar produtos: ${prodErr.message}` }, 500);
    }

    // ── 6. Processar insights ──
    // Cada insight é um registro por anúncio POR DIA (time_increment=1).
    // Gravamos a série diária em meta_ads_daily e, em paralelo, acumulamos
    // os totais por anúncio para o snapshot em meta_ads_cache.
    const errors: Array<{ ad_id: string; error: string }> = [];
    const nowIso = new Date().toISOString();

    interface AdAccum {
      ad_name: string;
      campaign_id: string;
      campaign_name: string;
      product_id: string | null;
      funil: string;
      date_start: string;   // menor dia visto
      date_stop: string;    // maior dia visto
      counters: Counters;
    }

    const dailyRecords: Array<Record<string, unknown>> = [];
    const perAd = new Map<string, AdAccum>();

    for (const insight of insights) {
      try {
        const counters   = deriveCounters(insight);
        // Produto e funil aparecem ora no nome do anúncio, ora no da campanha
        const fullName   = `${insight.ad_name} ${insight.campaign_name}`;
        const funil      = inferFunil(fullName);
        const product_id = inferProductId(fullName, products ?? []);
        const day        = insight.date_start; // == date_stop com time_increment=1

        dailyRecords.push({
          workspace_id:       WORKSPACE,
          ad_id:              insight.ad_id,
          date:               day,
          campaign_id:        insight.campaign_id,
          product_id,
          funil,
          spend:              counters.spend,
          revenue:            counters.revenue,
          purchases:          counters.purchases,
          impressions:        counters.impressions,
          clicks:             counters.clicks,
          link_clicks:        counters.link_clicks,
          landing_page_views: counters.landing_page_views,
          video_views_3s:     counters.video_views_3s,
          initiate_checkout:  counters.initiate_checkout,
          add_payment_info:   counters.add_payment_info,
          messages:           counters.messages,
          reach:              counters.reach,
          synced_at:          nowIso,
        });

        let acc = perAd.get(insight.ad_id);
        if (!acc) {
          acc = {
            ad_name:       insight.ad_name,
            campaign_id:   insight.campaign_id,
            campaign_name: insight.campaign_name,
            product_id,
            funil,
            date_start:    day,
            date_stop:     day,
            counters:      emptyCounters(),
          };
          perAd.set(insight.ad_id, acc);
        }
        addCounters(acc.counters, counters);
        if (day < acc.date_start) acc.date_start = day;
        if (day > acc.date_stop)  acc.date_stop  = day;
      } catch (err) {
        errors.push({ ad_id: insight.ad_id ?? "unknown", error: String(err) });
      }
    }

    // ── 6a. Upsert da série diária (em lotes) ──
    const CHUNK = 500;
    for (let i = 0; i < dailyRecords.length; i += CHUNK) {
      const chunk = dailyRecords.slice(i, i + CHUNK);
      const { error: dErr } = await supabase
        .from("meta_ads_daily")
        .upsert(chunk, { onConflict: "workspace_id,ad_id,date" });
      if (dErr) errors.push({ ad_id: `daily[${i}]`, error: dErr.message });
    }

    // ── 6b. Upsert do snapshot por anúncio (metadados + criativo + totais), em lotes ──
    // Não inclui transcricao/analise_video → preservados em re-syncs.
    // Mídia (thumbnail/video_id/media_type) só entra no upsert quando a busca
    // de criativos retornou dados — falha na Meta NÃO apaga o que já existe.
    if (creativeErr) errors.push({ ad_id: "creatives", error: creativeErr });

    const comMidia: Array<Record<string, unknown>> = [];
    const semMidia: Array<Record<string, unknown>> = [];

    for (const [ad_id, acc] of perAd) {
      const m    = snapshotMetrics(acc.counters);
      const base = {
        workspace_id:       WORKSPACE,
        ad_id,
        ad_name:            acc.ad_name,
        campaign_id:        acc.campaign_id,
        campaign_name:      acc.campaign_name,
        product_id:         acc.product_id,
        funil:              acc.funil,
        date_start:         acc.date_start,
        date_stop:          acc.date_stop,
        spend:              m.spend,
        revenue:            m.revenue,
        roas:               m.roas,
        purchases:          m.purchases,
        cpa:                m.cpa,
        cpm:                m.cpm,
        cpc:                m.cpc,
        ctr:                m.ctr,
        impressions:        m.impressions,
        link_clicks:        m.link_clicks,
        landing_page_views: m.landing_page_views,
        thumbstop_rate:     m.thumbstop_rate,
        connect_rate:       m.connect_rate,
        conversion_rate:    m.conversion_rate,
        synced_at:          nowIso,
      };
      const creative = creativeMap.get(ad_id);
      if (creative) {
        comMidia.push({
          ...base,
          thumbnail_url: creative.thumbnail_url,
          video_id:      creative.video_id,
          media_type:    creative.media_type,
        });
      } else {
        semMidia.push(base);
      }
    }

    let synced = 0;
    for (const records of [comMidia, semMidia]) {
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        const { error: cErr } = await supabase
          .from("meta_ads_cache")
          .upsert(chunk, { onConflict: "workspace_id,ad_id" });
        if (cErr) errors.push({ ad_id: `cache[${i}]`, error: cErr.message });
        else synced += chunk.length;
      }
    }

    // ── 6c. Upsert de campanhas com status real da Meta (filtro de ativas) ──
    try {
      const camps: Array<Record<string, unknown>> = [];
      let campUrl: string | null =
        `https://graph.facebook.com/v21.0/act_${META_ACCOUNT}/campaigns?` +
        new URLSearchParams({
          fields:       "id,name,effective_status",
          limit:        "500",
          access_token: META_TOKEN,
        });
      while (campUrl) {
        const res  = await fetch(campUrl);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        for (const c of data.data ?? []) {
          camps.push({
            workspace_id:     WORKSPACE,
            campaign_id:      c.id,
            campaign_name:    c.name,
            effective_status: c.effective_status ?? null,
            synced_at:        nowIso,
          });
        }
        campUrl = data.paging?.next ?? null;
      }
      if (camps.length) {
        const { error: campErr } = await supabase
          .from("meta_campaigns")
          .upsert(camps, { onConflict: "workspace_id,campaign_id" });
        if (campErr) errors.push({ ad_id: "campaigns", error: campErr.message });
      }
    } catch (err) {
      errors.push({ ad_id: "campaigns", error: String(err) });
    }

    return json({ synced, days: dailyRecords.length, errors });
  } catch (err) {
    if (err instanceof TenantError) {
      return jsonResponse({ error: err.message }, err.status);
    }
    return json({ error: String(err) }, 500);
  }
});

// ─── Util ─────────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":                 "application/json",
      "Access-Control-Allow-Origin":  "*",
    },
  });
}

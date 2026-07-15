/**
 * sync-ad-status — Edge Function (Deno)
 *
 * Sincroniza o effective_status POR ANÚNCIO da Meta para meta_ads_cache.
 * Chamada leve (só id + effective_status, sem creative expandido), paginada.
 *
 * Disparada:
 *   • ao abrir a aba Matriz Criativa (fire-and-forget) — assim, se você
 *     pausou/ativou um anúncio ontem, os números da matriz já refletem
 *     na hora em que a tela abre;
 *   • por cron horário (minuto 45 — migration 0023).
 *
 * Secrets: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID,
 *          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injetados).
 *
 * Resposta: { fetched, updated, by_status: { ACTIVE: n, PAUSED: n, ... } }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UPDATE_CHUNK = 200; // ad_ids por UPDATE (limite prático do PostgREST .in)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const META_TOKEN   = Deno.env.get("META_ACCESS_TOKEN");
    const META_ACCOUNT = Deno.env.get("META_AD_ACCOUNT_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!META_TOKEN || !META_ACCOUNT) {
      return json({ error: "Secrets META_ACCESS_TOKEN e META_AD_ACCOUNT_ID são obrigatórios." }, 500);
    }

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Modo diagnóstico: { debugName: "trecho do nome" } ───────────────────
    // Retorna todas as ocorrências do anúncio na META (com conjunto/campanha/
    // status reais) e no CACHE — para investigar duplicatas "— Cópia" e
    // divergências de status sem precisar de acesso ao banco.
    let body: { debugName?: string } = {};
    try { body = await req.json(); } catch { /* vazio ok */ }
    if (body.debugName) {
      const dbg = new URLSearchParams({
        fields: "id,name,effective_status,adset{id,name,effective_status},campaign{name,effective_status}",
        filtering: JSON.stringify([{ field: "name", operator: "CONTAIN", value: body.debugName }]),
        limit: "50",
        access_token: META_TOKEN,
      });
      const metaResp = await fetch(`https://graph.facebook.com/v21.0/act_${META_ACCOUNT}/ads?${dbg}`);
      const metaData = await metaResp.json().catch(() => ({}));
      const { data: cacheRows } = await db
        .from("meta_ads_cache")
        .select("ad_id, ad_name, campaign_name, effective_status, status_synced_at")
        .ilike("ad_name", `%${body.debugName}%`);
      return json({
        meta: (metaData.data ?? []).map((a: Record<string, unknown>) => ({
          id: a.id, name: a.name, status: a.effective_status,
          adset: a.adset, campaign: a.campaign,
        })),
        cache: cacheRows ?? [],
      });
    }

    // ── 1. Busca id + effective_status de todos os anúncios da conta ────────
    // Inclui o status do CONJUNTO (adset): o effective_status do anúncio
    // DEVERIA virar ADSET_PAUSED quando o conjunto é desligado, mas há casos
    // em que a Meta devolve ACTIVE mesmo assim — verificamos explicitamente
    // e rebaixamos o anúncio se o conjunto não estiver ativo.
    const statusByAd = new Map<string, string>();
    const params = new URLSearchParams({
      fields:       "id,effective_status,adset{effective_status}",
      limit:        "250", // payload maior com o adset expandido → página menor
      access_token: META_TOKEN,
    });
    let next: string | null =
      `https://graph.facebook.com/v21.0/act_${META_ACCOUNT}/ads?${params}`;

    interface MetaAd {
      id: string;
      effective_status?: string;
      adset?: { effective_status?: string };
    }

    while (next) {
      const resp = await fetch(next);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        return json(
          { error: data.error?.message ?? `Meta API ${resp.status} ao buscar status dos anúncios` },
          502,
        );
      }
      for (const ad of (data.data ?? []) as MetaAd[]) {
        if (!ad.id || !ad.effective_status) continue;
        let status = ad.effective_status;
        const adsetStatus = ad.adset?.effective_status;
        if (status === "ACTIVE" && adsetStatus && adsetStatus !== "ACTIVE") {
          status = "ADSET_PAUSED"; // conjunto desligado → anúncio não está entregando
        }
        statusByAd.set(ad.id, status);
      }
      next = data.paging?.next ?? null;
    }

    if (statusByAd.size === 0) return json({ fetched: 0, updated: 0, by_status: {} });

    // ── 2. Atualiza só os anúncios que existem no cache ─────────────────────
    // PAGINADO: o PostgREST limita cada SELECT a 1000 linhas — sem o range()
    // em loop, só as primeiras 1000 linhas do cache eram comparadas e o resto
    // ficava com status null para sempre (aparecendo como "ativo" na Matriz).
    const cached: Array<{ ad_id: string; effective_status: string | null }> = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: cacheErr } = await db
        .from("meta_ads_cache")
        .select("ad_id, effective_status")
        .range(from, from + 999);
      if (cacheErr) throw new Error(cacheErr.message);
      cached.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }

    // Agrupa por status novo, pulando os que já estão corretos (menos writes).
    // Anúncio do cache que NÃO aparece mais na listagem da Meta foi excluído
    // da conta → marca DELETED (antes ficava null e era tolerado como ativo,
    // fazendo criativos desativados/excluídos continuarem contando na Matriz).
    const toUpdate = new Map<string, string[]>(); // status → ad_ids
    for (const row of cached ?? []) {
      const novo = statusByAd.get(row.ad_id) ?? "DELETED";
      if (novo === row.effective_status) continue;
      if (!toUpdate.has(novo)) toUpdate.set(novo, []);
      toUpdate.get(novo)!.push(row.ad_id);
    }

    let updated = 0;
    const byStatus: Record<string, number> = {};
    const nowIso = new Date().toISOString();

    for (const [status, adIds] of toUpdate) {
      for (let i = 0; i < adIds.length; i += UPDATE_CHUNK) {
        const chunk = adIds.slice(i, i + UPDATE_CHUNK);
        const { error: updErr } = await db
          .from("meta_ads_cache")
          .update({ effective_status: status, status_synced_at: nowIso })
          .in("ad_id", chunk);
        if (updErr) throw new Error(updErr.message);
        updated += chunk.length;
      }
      byStatus[status] = (byStatus[status] ?? 0) + adIds.length;
    }

    return json({ fetched: statusByAd.size, updated, by_status: byStatus });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

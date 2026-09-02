/**
 * sync-ad-status — Edge Function (Deno)
 *
 * Sincroniza o effective_status POR ANÚNCIO da Meta para meta_ads_cache.
 * Chamada leve (só id + effective_status, sem creative expandido), paginada.
 *
 * Disparada:
 *   • ao abrir Top Criativos e a Matriz Criativa (fire-and-forget) — assim,
 *     se você pausou/ativou um anúncio ontem, a tela já reflete isso;
 *   • pode ser chamada à mão para forçar a atualização.
 *
 * Multi-tenant: usa a conexão Meta do workspace (resolveMetaConnection), não
 * secrets globais. Cada loja sincroniza só os anúncios da própria conta.
 *
 * Resposta: { fetched, updated, by_status: { ACTIVE: n, PAUSED: n, ... } }
 */

import { resolveMetaConnection, CORS_HEADERS, jsonResponse } from "../_shared/tenant.ts";

const UPDATE_CHUNK = 200; // ad_ids por UPDATE (limite prático do PostgREST .in)
const PAGE = 1000;        // PostgREST devolve no máximo 1000 linhas por SELECT

interface MetaAd {
  id: string;
  effective_status?: string;
  adset?: { effective_status?: string };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const ctx = await resolveMetaConnection(req);
    const { admin: db, workspaceId, accountId, accessToken } = ctx;

    // ── 1. Busca id + effective_status de todos os anúncios da conta ────────
    // Inclui o status do CONJUNTO (adset): o effective_status do anúncio
    // DEVERIA virar ADSET_PAUSED quando o conjunto é desligado, mas há casos
    // em que a Meta devolve ACTIVE mesmo assim — verificamos explicitamente
    // e rebaixamos o anúncio se o conjunto não estiver ativo.
    const statusByAd = new Map<string, string>();
    const params = new URLSearchParams({
      fields:       "id,effective_status,adset{effective_status}",
      limit:        "250", // payload maior com o adset expandido → página menor
      access_token: accessToken,
    });
    let next: string | null =
      `https://graph.facebook.com/v21.0/act_${accountId}/ads?${params}`;

    // Anotação explícita: `next` é reatribuído a partir de `data`, e sem os
    // tipos o TS entra em inferência circular (TS7022).
    interface PaginaAds {
      data?: MetaAd[];
      paging?: { next?: string };
      error?: { message?: string };
    }

    while (next) {
      const resp: Response = await fetch(next);
      const data: PaginaAds = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        return jsonResponse(
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

    if (statusByAd.size === 0) {
      return jsonResponse({ fetched: 0, updated: 0, by_status: {} });
    }

    // ── 2. Atualiza só os anúncios desta loja que existem no cache ──────────
    // PAGINADO: sem o range() em loop só as primeiras 1000 linhas seriam
    // comparadas, e o resto ficaria com status null para sempre — aparecendo
    // como ativo nas telas que toleram null.
    const cached: Array<{ ad_id: string; effective_status: string | null }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: cacheErr } = await db
        .from("meta_ads_cache")
        .select("ad_id, effective_status")
        .eq("workspace_id", workspaceId)
        .range(from, from + PAGE - 1);
      if (cacheErr) throw new Error(cacheErr.message);
      cached.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
    }

    // Agrupa por status novo, pulando os que já estão corretos (menos writes).
    // Anúncio do cache que NÃO aparece mais na listagem da Meta foi excluído
    // da conta → marca DELETED, senão ficaria null e seria tolerado como ativo.
    const toUpdate = new Map<string, string[]>(); // status → ad_ids
    for (const row of cached) {
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
          .eq("workspace_id", workspaceId)
          .in("ad_id", chunk);
        if (updErr) throw new Error(updErr.message);
        updated += chunk.length;
      }
      byStatus[status] = (byStatus[status] ?? 0) + adIds.length;
    }

    return jsonResponse({ fetched: statusByAd.size, updated, by_status: byStatus });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status ?? 500;
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, status);
  }
});

/**
 * classify-batch — Edge Function (Deno)
 *
 * Classificação ADSUP automática em SEGUNDO PLANO (servidor). Encontra os
 * criativos do produto Laranja Moro em campanhas ATIVAS na Meta que ainda
 * não estão em creative_classifications e classifica um lote por execução,
 * invocando a função classify-creative para cada um (que tem guarda de
 * idempotência própria — corrida com o navegador nunca gasta IA em dobro).
 *
 * Invocada pelo cron do banco (pg_cron, a cada 5 min — migration 0022) e,
 * opcionalmente, à mão. Assim a Matriz Criativa se preenche sozinha, sem
 * depender de nenhuma aba do app estar aberta.
 *
 * Body (JSON, opcional):
 *   { batchSize?: number }          // default 4 — quantos classificar nesta execução
 *   { retryErrors?: boolean }       // reprocessa os marcados como falha (provider='erro')
 *   { retryIndeterminados?: boolean } // reprocessa os que a IA devolveu 'indeterminado'
 *   { audit?: boolean }             // só relata a cobertura do escopo, não processa nada
 *
 * Resposta:
 *   { pending, processed, ok, errors, skipped_cached }
 *   audit → { scoped, classificados_validos, indeterminados, erros, sem_classificacao }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH = 4;   // vídeos levam ~1-2 min cada; 4 cabem no limite da função
const CONCURRENCY = 2;
const TIME_BUDGET_MS = 300_000; // para com folga antes do teto de wall-clock

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

    let body: {
      batchSize?: number;
      retryErrors?: boolean;
      retryIndeterminados?: boolean;
      audit?: boolean;
      compareIds?: string[];
    } = {};
    try { body = await req.json(); } catch { /* body vazio é ok */ }
    const batchSize = Math.min(Math.max(body.batchSize ?? DEFAULT_BATCH, 1), 10);
    // retryErrors: reprocessa também os marcados como falha (provider='erro')
    const retryErrors = body.retryErrors === true;
    // retryIndeterminados: reprocessa os que a IA classificou como indeterminado
    // (sem eles a matriz fica com buracos permanentes — a view os filtra)
    const retryIndeterminados = body.retryIndeterminados === true;
    const auditOnly = body.audit === true;

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── 1. Escopo: campanhas ativas na Meta ───────────────────────────────
    const { data: activeCampaigns } = await db
      .from("meta_campaigns")
      .select("campaign_id")
      .eq("effective_status", "ACTIVE");
    // Sem linhas em meta_campaigns (antes do 1º sync) → tolera tudo como ativo
    const activeIds = activeCampaigns?.length
      ? new Set(activeCampaigns.map((c) => c.campaign_id))
      : null;

    // ── 2. Anúncios do escopo: campanha cujo NOME contém "laranja moro" ────
    //    (regra determinística da Matriz — dispensa a inferência de produto,
    //    que era ambígua em nomes mistos). Mesmo filtro da matriz_criativa_view.
    //    PAGINADO: o PostgREST limita SELECTs a 1000 linhas.
    interface AdRow {
      ad_id: string;
      ad_name: string | null;
      media_type: string | null;
      thumbnail_url: string | null;
      video_id: string | null;
      transcricao: string | null;
      analise_video: { transcricao_completa?: string } | null;
      campaign_id: string | null;
      effective_status: string | null;
    }
    const ads: AdRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: adsErr } = await db
        .from("meta_ads_cache")
        .select("ad_id, ad_name, media_type, thumbnail_url, video_id, transcricao, analise_video, campaign_id, effective_status")
        .ilike("campaign_name", "%laranja%moro%")
        .order("date_start", { ascending: false, nullsFirst: false })
        .range(from, from + 999);
      if (adsErr) throw new Error(adsErr.message);
      ads.push(...((page ?? []) as AdRow[]));
      if (!page || page.length < 1000) break;
    }

    const scoped = (ads ?? []).filter(
      (a) =>
        a.ad_id &&
        (!activeIds || activeIds.has(a.campaign_id)) &&
        // Status do PRÓPRIO anúncio (sync-ad-status); null → tolera como ativo.
        // Pausado não gasta IA agora; se reativar, o cron classifica depois.
        (!a.effective_status || a.effective_status === "ACTIVE"),
    );
    if (!scoped.length) return json({ pending: 0, processed: 0, ok: 0, errors: 0, skipped_cached: 0 });

    // ── 3. Diff contra o que já está classificado ──────────────────────────
    // Em blocos de 500 ids: evita URL gigante no .in() e o teto de 1000 linhas.
    const existing: Array<{ ad_id: string; provider: string | null; persona: string | null; justificativa?: string | null }> = [];
    const scopedIds = scoped.map((a) => a.ad_id);
    for (let i = 0; i < scopedIds.length; i += 500) {
      const { data: page, error: exErr } = await db
        .from("creative_classifications")
        .select("ad_id, provider, persona, justificativa")
        .in("ad_id", scopedIds.slice(i, i + 500));
      if (exErr) throw new Error(exErr.message);
      existing.push(...(page ?? []));
    }
    // provider='erro' = marcador de falha; com retryErrors conta como pendente.
    // persona='indeterminado' (sem ser erro) = a IA não conseguiu classificar;
    // com retryIndeterminados conta como pendente (com force, para passar a guarda).
    const erroSet = new Set(
      (existing ?? []).filter((r) => r.provider === "erro").map((r) => r.ad_id),
    );
    const indetSet = new Set(
      (existing ?? [])
        .filter((r) => r.provider !== "erro" && r.persona === "indeterminado")
        .map((r) => r.ad_id),
    );
    const done = new Set(
      (existing ?? [])
        .filter((r) =>
          !(retryErrors && r.provider === "erro") &&
          !(retryIndeterminados && r.provider !== "erro" && r.persona === "indeterminado"))
        .map((r) => r.ad_id),
    );
    const pendingAll = scoped.filter((a) => !done.has(a.ad_id));

    // ── Modo auditoria: só relata a cobertura do escopo ────────────────────
    if (auditOnly) {
      const existingIds = new Set(existing.map((r) => r.ad_id));
      // compareIds: o chamador manda os ad_ids que ELE vê ativos na Meta;
      // devolvemos o diagnóstico de cada um que está fora do escopo (a
      // resposta só reflete ids que o chamador já tinha — nada novo vaza).
      let fora: Array<{ ad_id: string; motivo: string }> | undefined;
      if (Array.isArray(body.compareIds) && body.compareIds.length && body.compareIds.length <= 500) {
        const scopedSet = new Set(scoped.map((a) => a.ad_id));
        const missing = (body.compareIds as string[]).filter((id) => !scopedSet.has(id));
        fora = [];
        for (let i = 0; i < missing.length; i += 200) {
          const { data: rows } = await db
            .from("meta_ads_cache")
            .select("ad_id, campaign_name, effective_status")
            .in("ad_id", missing.slice(i, i + 200));
          const byId = new Map((rows ?? []).map((r) => [r.ad_id, r]));
          for (const id of missing.slice(i, i + 200)) {
            const r = byId.get(id);
            fora.push({
              ad_id: id,
              motivo: !r
                ? "fora do cache (meta-sync nunca gravou)"
                : !/laranja.*moro/i.test(r.campaign_name ?? "")
                ? `campaign_name do cache não bate: "${r.campaign_name}"`
                : r.effective_status && r.effective_status !== "ACTIVE"
                ? `status no cache: ${r.effective_status} (desatualizado?)`
                : "campanha inativa em meta_campaigns?",
            });
          }
        }
      }
      return json({
        scoped: scoped.length,
        classificados_validos: existing.filter((r) =>
          r.provider !== "erro" && r.persona !== "indeterminado" && r.persona != null).length,
        indeterminados: indetSet.size,
        indeterminados_ids: [...indetSet],
        indeterminados_motivos: existing
          .filter((r) => indetSet.has(r.ad_id))
          .map((r) => ({ ad_id: r.ad_id, justificativa: (r.justificativa ?? "").slice(0, 300) })),
        erros: erroSet.size,
        sem_classificacao: scoped.filter((a) => !existingIds.has(a.ad_id)).length,
        ...(fora ? { fora_do_escopo: fora } : {}),
      });
    }

    const todo = pendingAll.slice(0, batchSize);
    if (!todo.length) return json({ pending: 0, processed: 0, ok: 0, errors: 0, skipped_cached: 0 });

    // ── 4. Classifica invocando classify-creative (mesma lógica de sempre) ──
    // Complemento via Meta: quando o cache não tem video_id (sync não expandiu
    // o creative) o Gemini classificava só pelo NOME do arquivo → indeterminado.
    // Buscamos creative{video_id,thumbnail_url,body} direto na Meta, persistimos
    // o que faltava no cache e enviamos a COPY do anúncio como contexto extra.
    const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
    async function fetchCreative(adId: string): Promise<{ video_id?: string; thumbnail_url?: string; body?: string } | null> {
      if (!META_TOKEN) return null;
      try {
        const q = new URLSearchParams({
          fields: "creative{video_id,thumbnail_url,body}",
          access_token: META_TOKEN,
        });
        const r = await fetch(`https://graph.facebook.com/v21.0/${adId}?${q}`);
        const d = await r.json().catch(() => ({}));
        return r.ok ? (d.creative ?? null) : null;
      } catch {
        return null;
      }
    }

    let ok = 0;
    let errors = 0;
    let skippedCached = 0;
    let idx = 0;
    let lastError = "";

    /**
     * Marca a falha como linha `indeterminado` em creative_classifications.
     * Sem isso o anúncio voltaria ao topo da fila e o cron re-tentaria o mesmo
     * erro para sempre (queimando quota). A linha registra o motivo em
     * `justificativa` e some da Matriz (a view filtra indeterminado); o
     * botão "Reclassificar" do modal continua permitindo retry manual.
     */
    async function markFailed(adId: string, motivo: string) {
      await db.from("creative_classifications").upsert(
        {
          ad_id: adId,
          persona: "indeterminado",
          etapa_funil: "indeterminado",
          angulo: "indeterminado",
          pilar_estrutura: "indeterminado",
          gancho_tipo: "indeterminado",
          confidence_score: 0,
          justificativa: `Falha na classificação automática: ${motivo.slice(0, 400)}`,
          provider: "erro",
          classificado_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ad_id" },
      );
    }

    async function worker() {
      while (idx < todo.length && Date.now() - startedAt < TIME_BUDGET_MS) {
        const ad = todo[idx++];
        try {
          // Completa vídeo/thumb/copy pela Meta (e conserta o cache) se faltar
          let videoId  = ad.video_id ?? null;
          let thumb    = ad.thumbnail_url ?? null;
          let copy     = "";
          const cr = await fetchCreative(ad.ad_id);
          if (cr) {
            copy = cr.body ?? "";
            if (!videoId && cr.video_id) videoId = cr.video_id;
            if (!thumb && cr.thumbnail_url) thumb = cr.thumbnail_url;
            if ((!ad.video_id && cr.video_id) || (!ad.thumbnail_url && cr.thumbnail_url)) {
              await db.from("meta_ads_cache").update({
                ...(!ad.video_id && cr.video_id ? { video_id: cr.video_id, media_type: "video" } : {}),
                ...(!ad.thumbnail_url && cr.thumbnail_url ? { thumbnail_url: cr.thumbnail_url } : {}),
              }).eq("ad_id", ad.ad_id);
            }
          }
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/classify-creative`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              apikey: ANON_KEY,
              Authorization: `Bearer ${ANON_KEY}`,
            },
            body: JSON.stringify({
              adId:         ad.ad_id,
              nomeCriativo: ad.ad_name ?? "",
              formato:      videoId ? "VIDEO" : ad.media_type === "image" ? "IMAGEM" : "VIDEO",
              transcricao:  ad.transcricao ?? ad.analise_video?.transcricao_completa ?? "",
              copyAnuncio:  copy,
              thumbnailUrl: thumb,
              videoId,
              // retry de falha/indeterminado: linha já existe → força passar da guarda
              force:        erroSet.has(ad.ad_id) || indetSet.has(ad.ad_id),
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (resp.ok && !data.error) {
            if (data.cached) skippedCached++;
            else ok++;
          } else {
            errors++;
            const motivo = String(data.error ?? `HTTP ${resp.status}`);
            lastError = `${ad.ad_id}: ${motivo.slice(0, 400)}`;
            console.warn("classify-batch falhou:", lastError);
            await markFailed(ad.ad_id, motivo);
          }
        } catch (err) {
          errors++;
          const motivo = String(err);
          lastError = `${ad.ad_id}: ${motivo.slice(0, 400)}`;
          console.warn("classify-batch exceção:", lastError);
          await markFailed(ad.ad_id, motivo);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker),
    );

    return json({
      pending: pendingAll.length,
      processed: ok + errors + skippedCached,
      ok,
      errors,
      skipped_cached: skippedCached,
      ...(lastError ? { last_error: lastError } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

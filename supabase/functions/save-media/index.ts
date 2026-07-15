/**
 * save-media — Edge Function (Deno)
 *
 * Copia a mídia de um anúncio (vídeo ou imagem) da Meta para o bucket
 * público "creatives" e registra em pasta_itens. Os arquivos persistem
 * mesmo depois que as URLs da Meta expiram — é o que torna o link
 * público de pastas (/p/<token>) permanente.
 *
 * Body: { ad_id: string, pasta_id: string, user_id: string }
 * Resposta: { ok, storage_path, media_type, nome }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  getVideoSource,
  extractVideoId,
  CREATIVE_MEDIA_FIELDS,
} from "../_shared/metaVideo.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  try {
    const META_TOKEN   = Deno.env.get("META_ACCESS_TOKEN")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let body: {
      ad_id?: string;
      pasta_id?: string;
      user_id?: string;
      metricas?: Record<string, number> | null;
      periodo_inicio?: string | null;
      periodo_fim?: string | null;
    } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const { ad_id, pasta_id, user_id, metricas, periodo_inicio, periodo_fim } = body;

    if (!ad_id || !pasta_id || !user_id) {
      return json({ error: "Body deve conter ad_id, pasta_id e user_id." }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── 1. Validar a pasta e o dono ──────────────────────────────────────────
    const { data: pasta } = await supabase
      .from("pastas")
      .select("id, user_id")
      .eq("id", pasta_id)
      .maybeSingle();

    if (!pasta)                    return json({ error: "Pasta não encontrada." }, 404);
    if (pasta.user_id !== user_id) return json({ error: "Pasta não pertence a este usuário." }, 403);

    // ── 2. Dados do anúncio ──────────────────────────────────────────────────
    const { data: ad } = await supabase
      .from("meta_ads_cache")
      .select("ad_id, ad_name, video_id, thumbnail_url, media_type, funil, analise_video")
      .eq("ad_id", ad_id)
      .maybeSingle();

    if (!ad) return json({ error: "Anúncio não encontrado no cache." }, 404);

    // Tags automáticas: funil do sync, ângulo da análise de vídeo (IA),
    // modelo do padrão de nome "[FUNIL] | [MODELO] | [ÂNGULO] | desc"
    const nameParts = (ad.ad_name ?? "").split("|").map((p: string) => p.trim());
    const FUNILS = ["TOFU", "MOFU", "BOFU"];
    const hasPattern = nameParts.length >= 3 && FUNILS.includes(nameParts[0]?.toUpperCase());
    const tagFunil  = ad.funil ?? (hasPattern ? nameParts[0].toUpperCase() : null);
    const tagModelo = hasPattern ? (nameParts[1] || null) : null;
    const tagAngulo = (ad.analise_video as { angulo?: string } | null)?.angulo ??
                      (hasPattern ? (nameParts[2] || null) : null);

    // ── 3. Resolver a URL da mídia na Meta ───────────────────────────────────
    // Confere o tipo direto na Meta: o cache pode ter classificado errado
    // (vídeos de post/asset_feed não expõem video_id raiz).
    const adResp = await fetch(
      `https://graph.facebook.com/v21.0/${ad_id}` +
      `?fields=creative.thumbnail_width(1080).thumbnail_height(1080){${CREATIVE_MEDIA_FIELDS}}` +
      `&access_token=${META_TOKEN}`,
    );
    const adData   = await adResp.json();
    const creative = adData?.creative ?? null;
    const videoId  = extractVideoId(creative) ?? ad.video_id ?? null;

    // Corrige o cache se a classificação mudou
    if (videoId && ad.media_type !== "video") {
      await supabase
        .from("meta_ads_cache")
        .update({ video_id: videoId, media_type: "video" })
        .eq("ad_id", ad_id);
    }

    let mediaUrl: string | null = null;
    let mediaType: "video" | "image";
    let ext: string;
    let contentType: string;

    if (videoId) {
      mediaType   = "video";
      ext         = "mp4";
      contentType = "video/mp4";
      const { source, error } = await getVideoSource(videoId, META_TOKEN);
      if (!source) return json({ error: `Vídeo indisponível: ${error}` }, 502);
      mediaUrl = source;
    } else {
      mediaType   = "image";
      ext         = "jpg";
      contentType = "image/jpeg";
      // Imagem fresca da Meta (thumbnail salvo no banco pode ter expirado)
      mediaUrl = creative?.image_url ?? creative?.thumbnail_url ??
                 ad.thumbnail_url ?? null;
      if (!mediaUrl) return json({ error: "Imagem indisponível na Meta." }, 502);
    }

    // ── 4. Baixar a mídia (timeout 100s) ─────────────────────────────────────
    const abort = new AbortController();
    const tid = setTimeout(() => abort.abort(), 100_000);
    let buffer: ArrayBuffer;
    try {
      const dl = await fetch(mediaUrl, { signal: abort.signal });
      if (!dl.ok) throw new Error(`Download falhou: HTTP ${dl.status}`);
      buffer = await dl.arrayBuffer();
    } finally {
      clearTimeout(tid);
    }

    // ── 5. Subir para o Storage (bucket público "creatives") ────────────────
    const storagePath = `${pasta_id}/${ad_id}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("creatives")
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (upErr) return json({ error: `Storage: ${upErr.message}` }, 500);

    // ── 6. Registrar o item na pasta ─────────────────────────────────────────
    const nome = ad.ad_name ?? ad_id;
    const { error: itemErr } = await supabase
      .from("pasta_itens")
      .upsert(
        {
          pasta_id, ad_id, nome,
          media_type:     mediaType,
          storage_path:   storagePath,
          funil:          tagFunil,
          angulo:         tagAngulo,
          modelo:         tagModelo,
          // Snapshot das métricas do período visível ao salvar (ROAS, CTR,
          // gasto, compras, etc.) — preserva o que o usuário via no Top Criativos.
          metricas:       metricas ?? null,
          periodo_inicio: periodo_inicio ?? null,
          periodo_fim:    periodo_fim ?? null,
        },
        { onConflict: "pasta_id,ad_id" },
      );

    if (itemErr) return json({ error: `DB: ${itemErr.message}` }, 500);

    return json({ ok: true, storage_path: storagePath, media_type: mediaType, nome });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

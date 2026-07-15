/**
 * meta-creative — Edge Function (Deno)
 *
 * Busca a mídia (thumbnail + vídeo) de um anúncio específico na Meta API
 * e atualiza os campos thumbnail_url, video_id e media_type em meta_ads_cache.
 *
 * Body: { ad_id: string }
 * Resposta: { media_type: "image"|"video"|null, url: string|null, thumbnail_url: string|null }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  getVideoSource,
  extractVideoId,
  CREATIVE_MEDIA_FIELDS,
} from "../_shared/metaVideo.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const META_TOKEN   = Deno.env.get("META_ACCESS_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!META_TOKEN) {
      return json({ error: "Secret META_ACCESS_TOKEN não configurado." }, 500);
    }

    let body: { ad_id?: string; refresh?: boolean } = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const { ad_id, refresh } = body;
    if (!ad_id) {
      return json({ error: "ad_id é obrigatório no body." }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── 1. O cache já sabe o video_id/tipo? Então NÃO re-busca o creative ────
    // (economiza chamadas e evita rate limit ao abrir vídeos repetidamente).
    const { data: cached } = await supabase
      .from("meta_ads_cache")
      .select("video_id, thumbnail_url, media_type, video_url, video_url_at")
      .eq("ad_id", ad_id)
      .maybeSingle();

    let video_id: string | null      = cached?.video_id ?? null;
    let thumbnail_url: string | null = cached?.thumbnail_url ?? null;
    let image_url: string | null     = null;
    let media_type: "video" | "image" | null = cached?.media_type ?? null;
    let video_error: string | null = null;
    let url: string | null = null;

    // URL do vídeo ainda fresca no cache (< 2h)? Devolve sem tocar na Meta.
    // refresh=true ignora o cache e força resolver tudo de novo na Meta.
    const VIDEO_TTL_MS = 2 * 60 * 60 * 1000;
    if (!refresh && cached?.video_url && cached?.video_url_at &&
        Date.now() - new Date(cached.video_url_at).getTime() < VIDEO_TTL_MS) {
      return json({
        media_type: "video", url: cached.video_url,
        thumbnail_url: cached.thumbnail_url, video_error: null,
      });
    }

    // Bate na Meta para (re)descobrir o creative quando:
    //  - refresh foi pedido (thumbnail do cache expirou/falhou no front), ou
    //  - não há video_id e não há thumbnail utilizável (inclui imagem sem thumb).
    if (refresh || (!video_id && (media_type !== "image" || !thumbnail_url))) {
      const adResp = await fetch(
        `https://graph.facebook.com/v21.0/${ad_id}` +
        `?fields=name,creative.thumbnail_width(1080).thumbnail_height(1080){id,${CREATIVE_MEDIA_FIELDS}}` +
        `&access_token=${META_TOKEN}`,
      );
      const adData = await adResp.json();
      if (!adResp.ok || adData.error) {
        return json({ error: adData.error?.message ?? `Meta API ${adResp.status}` }, 502);
      }
      const creative = adData.creative ?? {};
      video_id      = extractVideoId(creative);
      thumbnail_url = creative.thumbnail_url ?? thumbnail_url;
      image_url     = creative.image_url ?? null;
      media_type    = video_id ? "video" : (image_url || thumbnail_url ? "image" : null);

      await supabase.from("meta_ads_cache")
        .update({ thumbnail_url: thumbnail_url ?? image_url, video_id, media_type })
        .eq("ad_id", ad_id);
    }

    // ── 2. Vídeo: resolve o source (link direto) — sempre, pois a URL expira ──
    // O source só vem com o token da Página dona — getVideoSource resolve isso.
    if (video_id) {
      media_type = "video";
      const result = await getVideoSource(video_id, META_TOKEN);
      url = result.source;
      video_error = result.error;
      // Guarda a URL resolvida para as próximas aberturas (TTL 2h)
      if (url) {
        await supabase.from("meta_ads_cache")
          .update({ video_url: url, video_url_at: new Date().toISOString() })
          .eq("ad_id", ad_id);
      }
    } else if (thumbnail_url || image_url) {
      media_type = "image";
      url = image_url ?? thumbnail_url;
    }

    return json({ media_type, url, thumbnail_url: thumbnail_url ?? image_url, video_error });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

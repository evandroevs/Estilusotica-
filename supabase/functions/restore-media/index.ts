/**
 * restore-media — Edge Function (Deno)
 *
 * Restaura thumbnail/video_id/media_type dos anúncios SEM mídia no cache,
 * buscando os criativos em lotes de 50 ids por chamada (?ids=) — muito mais
 * barato em rate limit que re-sincronizar períodos inteiros.
 *
 * Body: {} (opcional: { limit: number })
 * Resposta: { pendentes, corrigidos, errors }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  extractVideoId,
  CREATIVE_MEDIA_FIELDS,
  type CreativeMediaFields,
} from "../_shared/metaVideo.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

interface AdNode {
  id: string;
  creative?: CreativeMediaFields;
  error?: { message: string };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const META_TOKEN   = Deno.env.get("META_ACCESS_TOKEN")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let body: { limit?: number } = {};
    try { body = await req.json(); } catch { /* empty */ }

    // 1. Anúncios sem mídia no cache
    const { data: ads, error: qErr } = await supabase
      .from("meta_ads_cache")
      .select("ad_id")
      .is("media_type", null)
      .limit(body.limit ?? 2000);
    if (qErr) return json({ error: qErr.message }, 500);

    const ids = (ads ?? []).map((a) => a.ad_id);
    if (!ids.length) return json({ pendentes: 0, corrigidos: 0, errors: [] });

    // 2. Busca criativos em lotes de 50 ids
    const fields = `creative.thumbnail_width(1080).thumbnail_height(1080){${CREATIVE_MEDIA_FIELDS}}`;
    const updates: Array<Record<string, unknown>> = [];
    const errors: string[] = [];

    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const url = `${GRAPH}/?ids=${batch.join(",")}&fields=${encodeURIComponent(fields)}&access_token=${META_TOKEN}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (data.error) {
        // rate limit → para e devolve o que já fez; outros erros → registra e segue
        if (/too many calls/i.test(data.error.message ?? "")) {
          errors.push(`rate-limit em lote[${i}] — parando`);
          break;
        }
        errors.push(`lote[${i}]: ${data.error.message}`);
        continue;
      }

      for (const node of Object.values(data) as AdNode[]) {
        if (!node?.id || node.error) continue;
        const c = node.creative ?? {};
        const videoId = extractVideoId(c);
        const thumb   = c.thumbnail_url ?? c.image_url ?? null;
        if (!thumb && !videoId) continue;
        updates.push({
          ad_id:         node.id,
          thumbnail_url: thumb,
          video_id:      videoId,
          media_type:    videoId ? "video" : "image",
        });
      }
    }

    // 3. Grava só as colunas de mídia (upsert parcial — linhas já existem)
    let corrigidos = 0;
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      const { error } = await supabase
        .from("meta_ads_cache")
        .upsert(chunk, { onConflict: "ad_id" });
      if (error) errors.push(`upsert[${i}]: ${error.message}`);
      else corrigidos += chunk.length;
    }

    return json({ pendentes: ids.length, corrigidos, errors });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

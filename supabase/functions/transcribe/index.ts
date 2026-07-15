/**
 * transcribe — Edge Function (Deno)
 *
 * Baixa o vídeo de um anúncio Meta, envia para a IA e salva o resultado
 * em meta_ads_cache. Roda UMA VEZ por vídeo — retorna do cache depois.
 *
 * Fluxo:
 *   1. Busca o anúncio em meta_ads_cache (checar cache)
 *   2. Se já tiver analise_video / transcricao → retorna do cache
 *   3. Resolve source URL via Meta API (video_id → source)
 *   4. Baixa o arquivo de vídeo
 *   5. modo=gemini → Gemini File API + generateContent → JSON estruturado
 *      modo=whisper → OpenAI Whisper → transcrição com timestamps
 *   6. Salva analise_video / transcricao / video_analisado_em no DB
 *   7. Retorna o objeto de análise
 *
 * Secrets necessários (nunca vão ao frontend):
 *   GEMINI_API_KEY          — para modo=gemini  (padrão)
 *   OPENAI_API_KEY          — para modo=whisper
 *   META_ACCESS_TOKEN       — para resolver o source URL do vídeo
 *   SUPABASE_URL            — injetado automaticamente
 *   SUPABASE_SERVICE_ROLE_KEY — injetado automaticamente
 *
 * Body:
 *   { ad_id: string, modo?: "gemini" | "whisper" }
 *
 * Resposta:
 *   { cached, analise_video, transcricao, video_analisado_em }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getVideoSource } from "../_shared/metaVideo.ts";

// ─── Constantes ───────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL        = "gemini-2.0-flash";
const VIDEO_INLINE_LIMIT  = 15 * 1024 * 1024;  // 15 MB → inline base64
const VIDEO_SIZE_LIMIT    = 80 * 1024 * 1024;  // 80 MB → recusa

// Prompt para análise completa do vídeo com Gemini
const GEMINI_PROMPT = `Você é um especialista em análise de criativos de performance para Meta Ads no mercado brasileiro.
Assista a este vídeo de anúncio na íntegra e responda EXCLUSIVAMENTE com JSON puro (sem \`\`\`json, sem markdown, sem texto fora do JSON).

Formato obrigatório:
{
  "hook_3s": {
    "fala": "palavras EXATAS faladas nos primeiros 3 segundos (string vazia se silencioso)",
    "visual": "descreva exatamente o que aparece visualmente nos primeiros 3 segundos"
  },
  "angulo": "ângulo de comunicação dominante: Dor | Desejo | Medo | Prova | Comparação | Contexto Social | Urgência Legítima",
  "cenas": [
    { "tempo": "MM:SS", "descricao": "o que acontece nesta cena" }
  ],
  "cta": "a frase de call-to-action falada ou exibida (string vazia se não houver)",
  "transcricao_completa": "transcrição palavra por palavra de tudo que é falado"
}`;

// ─── Handlers de cada modo ────────────────────────────────────────────────────

async function analyzeWithGemini(
  buffer: ArrayBuffer,
  mimeType: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  let fileUri: string | null = null;
  let fileName: string | null = null;

  try {
    if (buffer.byteLength > VIDEO_INLINE_LIMIT) {
      // Arquivo grande: usar File API
      const uploaded = await uploadGeminiFile(buffer, mimeType, apiKey);
      fileUri = uploaded.uri;
      fileName = uploaded.name;
    }

    const parts = fileUri
      ? [
          { fileData: { fileUri, mimeType } },
          { text: GEMINI_PROMPT },
        ]
      : [
          { inlineData: { data: toBase64(buffer), mimeType } },
          { text: GEMINI_PROMPT },
        ];

    const genResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] }),
      },
    );

    if (!genResp.ok) {
      const err = await genResp.text();
      throw new Error(`Gemini generateContent ${genResp.status}: ${err.slice(0, 300)}`);
    }

    const genData = await genResp.json();
    const rawText: string =
      genData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!rawText) throw new Error("Gemini retornou resposta vazia");

    return safeParseJSON(rawText);
  } finally {
    // Limpar arquivo do File API
    if (fileName) {
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
        { method: "DELETE" },
      ).catch(() => { /* silenciar erros de limpeza */ });
    }
  }
}

async function uploadGeminiFile(
  buffer: ArrayBuffer,
  mimeType: string,
  apiKey: string,
): Promise<{ uri: string; name: string }> {
  const boundary = "gemini_" + Date.now().toString(36);
  const encoder = new TextEncoder();
  const meta = JSON.stringify({ display_name: "ad_video.mp4" });

  const part1 = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const part2 = new Uint8Array(buffer);
  const part3 = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(part1.length + part2.length + part3.length);
  body.set(part1, 0);
  body.set(part2, part1.length);
  body.set(part3, part1.length + part2.length);

  const uploadResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );

  if (!uploadResp.ok) {
    const err = await uploadResp.text();
    throw new Error(`Gemini File API upload ${uploadResp.status}: ${err.slice(0, 300)}`);
  }

  const uploadData = await uploadResp.json();
  const file = uploadData.file ?? uploadData;
  const fileUri = file.uri as string;
  const fileName = file.name as string;

  // Aguardar estado ACTIVE (máx 60s)
  let state: string = file.state ?? "PROCESSING";
  let attempts = 0;
  while (state === "PROCESSING" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
    );
    if (poll.ok) {
      const pd = await poll.json();
      state = pd.state ?? "ACTIVE";
    }
    attempts++;
  }

  if (state !== "ACTIVE") {
    throw new Error(
      `Gemini: arquivo ficou em estado "${state}" após ${attempts * 2}s. Tente novamente.`,
    );
  }

  return { uri: fileUri, name: fileName };
}

async function transcribeWithWhisper(
  buffer: ArrayBuffer,
  apiKey: string,
): Promise<string> {
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("language", "pt");
  form.append(
    "file",
    new Blob([buffer], { type: "video/mp4" }),
    "video.mp4",
  );

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Whisper API ${resp.status}: ${err.slice(0, 300)}`);
  }

  const data = await resp.json();

  // Formatar segmentos com timestamps
  if (Array.isArray(data.segments) && data.segments.length > 0) {
    return data.segments
      .map((s: { start: number; text: string }) => {
        const m = Math.floor(s.start / 60).toString().padStart(2, "0");
        const sec = Math.floor(s.start % 60).toString().padStart(2, "0");
        return `${m}:${sec} — ${s.text.trim()}`;
      })
      .join("\n");
  }

  return (data.text as string) ?? "";
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function safeParseJSON(text: string): Record<string, unknown> {
  const stripped = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  return JSON.parse(stripped);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY");
    const OPENAI_KEY    = Deno.env.get("OPENAI_API_KEY");
    const META_TOKEN    = Deno.env.get("META_ACCESS_TOKEN");
    const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!META_TOKEN) throw new Error("META_ACCESS_TOKEN secret não configurado");

    let body: { ad_id?: string; modo?: string } = {};
    try { body = await req.json(); } catch { /* vazio */ }

    const { ad_id, modo = "gemini" } = body;
    if (!ad_id) throw new Error("ad_id é obrigatório no body");
    if (!["gemini", "whisper"].includes(modo)) {
      throw new Error(`modo inválido: "${modo}". Use: gemini | whisper`);
    }
    if (modo === "gemini"  && !GEMINI_KEY) throw new Error("GEMINI_API_KEY secret não configurado");
    if (modo === "whisper" && !OPENAI_KEY) throw new Error("OPENAI_API_KEY secret não configurado");

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── 1. Buscar ad no cache ────────────────────────────────────────────────
    const { data: ad, error: adErr } = await db
      .from("meta_ads_cache")
      .select("ad_id, ad_name, video_id, analise_video, transcricao, video_analisado_em")
      .eq("ad_id", ad_id)
      .single();

    if (adErr || !ad) {
      throw new Error(`Anúncio não encontrado: ${adErr?.message ?? "sem resultado"}`);
    }

    // ── 2. Retornar do cache se já analisado ────────────────────────────────
    if (ad.analise_video || ad.transcricao) {
      return json({
        cached:              true,
        analise_video:       ad.analise_video,
        transcricao:         ad.transcricao,
        video_analisado_em:  ad.video_analisado_em,
      });
    }

    // ── 3. Resolver source URL do vídeo via Meta API ─────────────────────────
    if (!ad.video_id) {
      throw new Error(
        "Este anúncio não possui video_id. Sincronize via meta-creative primeiro.",
      );
    }

    const { source: sourceUrl, error: srcError } = await getVideoSource(
      ad.video_id,
      META_TOKEN,
    );
    if (!sourceUrl) {
      throw new Error(`Vídeo sem source URL disponível: ${srcError ?? "motivo desconhecido"}`);
    }

    // ── 4. Baixar o vídeo (timeout 90s) ─────────────────────────────────────
    const abort = new AbortController();
    const tid = setTimeout(() => abort.abort(), 90_000);

    let videoBuffer: ArrayBuffer;
    try {
      const dlResp = await fetch(sourceUrl, { signal: abort.signal });
      if (!dlResp.ok) throw new Error(`Download do vídeo falhou: HTTP ${dlResp.status}`);
      videoBuffer = await dlResp.arrayBuffer();
    } finally {
      clearTimeout(tid);
    }

    const sizeMB = (videoBuffer.byteLength / 1024 / 1024).toFixed(1);
    if (videoBuffer.byteLength > VIDEO_SIZE_LIMIT) {
      throw new Error(`Vídeo muito grande (${sizeMB} MB). Limite: ${VIDEO_SIZE_LIMIT / 1024 / 1024} MB.`);
    }

    // ── 5. Analisar com a IA escolhida ───────────────────────────────────────
    let analise_video: Record<string, unknown>;
    let transcricao: string | null = null;

    if (modo === "gemini") {
      analise_video = await analyzeWithGemini(videoBuffer, "video/mp4", GEMINI_KEY!);
      transcricao   = (analise_video.transcricao_completa as string) || null;
    } else {
      transcricao   = await transcribeWithWhisper(videoBuffer, OPENAI_KEY!);
      analise_video = {
        hook_3s:             null,
        angulo:              null,
        cenas:               [],
        cta:                 null,
        transcricao_completa: transcricao,
      };
    }

    // ── 6. Salvar no banco ───────────────────────────────────────────────────
    const video_analisado_em = new Date().toISOString();
    const { error: saveErr } = await db
      .from("meta_ads_cache")
      .update({ analise_video, transcricao, video_analisado_em })
      .eq("ad_id", ad_id);

    if (saveErr) throw new Error(`Erro ao salvar análise: ${saveErr.message}`);

    // ── 7. Retornar ──────────────────────────────────────────────────────────
    return json({ cached: false, analise_video, transcricao, video_analisado_em });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

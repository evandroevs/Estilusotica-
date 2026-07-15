/**
 * classify-creative — Edge Function (Deno)
 *
 * Classifica UM criativo (vídeo, imagem ou carrossel) segundo o framework
 * Ecommerce Rocket / ADSUP: persona, etapa de consciência, ângulo, estrutura
 * (pilar), tipo de gancho e formato. Usa LLM com fallback Anthropic (Claude)
 * → Google (Gemini). Ver _shared/llm.ts.
 *
 * O resultado é gravado em `creative_classifications` via service_role
 * (upsert por ad_id). O frontend apenas lê essa tabela.
 *
 * Secrets (nunca vão ao frontend):
 *   ANTHROPIC_API_KEY            — chave da Anthropic (preferido)
 *   GEMINI_API_KEY               — chave do Google AI Studio (fallback gratuito)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — gravação na tabela
 *
 * Body (JSON):
 *   {
 *     adId:        string,   // ID do anúncio na Meta (aceita também creativeId)
 *     nomeCriativo?: string,
 *     transcricao?:  string, // transcrição da fala/áudio do vídeo
 *     textoTela?:    string, // texto que aparece na tela
 *     copyAnuncio?:  string, // copy do anúncio (texto do Gerenciador)
 *     thumbnailUrl?: string, // arte do criativo — enviada como IMAGEM ao modelo (visão) p/ formatos IMAGEM/CARROSSEL
 *     formato:       "VIDEO" | "IMAGEM" | "CARROSSEL" | "UGC",
 *     persist?:      boolean // default true — grava em creative_classifications
 *   }
 *
 * Resposta: o JSON da classificação + { provider, persisted }.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callLLM } from "../_shared/llm.ts";
import { getVideoSource } from "../_shared/metaVideo.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── System prompt (framework ADSUP / Ecommerce Rocket) ────────────────────────

const SYSTEM_PROMPT = `Você é um analista de criativos de performance especializado no framework Ecommerce
Rocket / ADSUP. Sua tarefa é analisar UM criativo (vídeo, imagem ou carrossel) de uma
campanha de Meta Ads do produto Laranja Moro (Denavita) e classificá-lo com precisão
segundo o framework abaixo. Não invente informação — se não conseguir identificar um
campo com confiança, retorne "indeterminado" e explique por quê no campo justificativa.

## FRAMEWORK DE REFERÊNCIA

### As 6 personas possíveis
- INS (Cliente Inseguro): busca prova, segurança e garantia. Objeção: "e se não funcionar?"
- PRAT (Comprador Prático): busca rapidez, clareza, pouca fricção. Objeção: "vai dar trabalho?"
- RES (Buscador de Resultado): busca transformação, antes/depois, evidência. Objeção: "isso funciona mesmo?"
- PRECO (Comprador de Preço): busca perceber valor, economia. Objeção: "é caro pra mim"
- PREM (Cliente Premium): busca exclusividade, autoridade, assinatura. Objeção: "tem algo superior?"
- EXP (Explorador de Novidades): busca descoberta, tendência, inovação. Objeção: "ainda é novidade?"

### As 5 etapas de consciência
- INC (Inconsciente): não sabe que tem o problema.
- PROB (Problema): reconhece o problema, não conhece a solução.
- SOL (Solução): já busca formas de resolver.
- PROD (Produto): já avalia opções e ofertas específicas.
- CONS (Mais Consciente): já compra, valida e decide.

### Os 9 ângulos
1. DOR — identificação imediata com o problema
2. BEN (Benefício) — desejo pelo resultado prometido
3. TRANS (Transformação) — antes e depois
4. PROVA — evidência social (números, depoimentos)
5. COMP (Comparação) — custo de oportunidade vs. alternativas
6. CURIO (Curiosidade) — lacuna de informação
7. AUT (Autoridade) — confiança técnica/científica
8. ROT (Rotina) — hábito real do dia a dia
9. QC (Quebra de Crença) — destrói objeção ou crença antiga

### As 3 estruturas (pilar)
- DSB: Dor → Solução → Benefício
- FF (Full Funnel): um criativo que percorre Inconsciente → Comprador
- ASK: roteiro a partir de depoimento/pesquisa real

### Os 6 tipos de gancho (0–3s)
1. Pergunta de Dor — "Você cansa de [problema]?"
2. Número + Prova — "X pessoas testaram. Veja o resultado"
3. Afirmação Contrária — "[Crença comum] ESTÁ ERRADO"
4. Segredo Revelado — "O ingrediente que a maioria [esconde/ignora]"
5. Antes/Depois Visual — imagem de transformação nos primeiros 2s
6. Identificação Direta — "Se você tem [problema], para aqui"

### Formato
VIDEO | IMAGEM | CARROSSEL | UGC

## TAREFA

Analise o criativo fornecido (transcrição do áudio/fala, texto na tela, visual, e a copy
do anúncio) e retorne APENAS o JSON abaixo, sem texto antes ou depois:

{
  "persona": "INS | PRAT | RES | PRECO | PREM | EXP | indeterminado",
  "etapa_funil": "INC | PROB | SOL | PROD | CONS | indeterminado",
  "angulo": "DOR | BEN | TRANS | PROVA | COMP | CURIO | AUT | ROT | QC | indeterminado",
  "pilar_estrutura": "DSB | FF | ASK | indeterminado",
  "gancho_tipo": "pergunta_dor | numero_prova | afirmacao_contraria | segredo_revelado | antes_depois_visual | identificacao_direta | indeterminado",
  "formato": "VIDEO | IMAGEM | CARROSSEL | UGC",
  "confidence_score": 0.0,
  "justificativa": "1-2 frases citando trecho da fala/copy que sustenta a classificação",
  "alinhamento_gancho_angulo": true,
  "observacao_alinhamento": "se o gancho não é o recomendado para o ângulo, explique; senão deixe vazio"
}

## REGRAS
1. confidence_score abaixo de 0.6 → prefira "indeterminado".
2. Compare o gancho com a recomendação: Dor→Pergunta de Dor, Prova→Número+Prova,
   Quebra de Crença→Afirmação Contrária, Curiosidade→Segredo Revelado,
   Transformação→Antes/Depois Visual, Dor/Rotina→Identificação Direta.
   Se não bater, alinhamento_gancho_angulo = false e explique.
3. Nunca inclua texto fora do JSON.
4. Se o criativo misturar elementos, escolha o predominante (o que aparece no gancho e é reforçado no CTA).`;

// ─── Schema de saída (Gemini structured output) ───────────────────────────────
// O servidor do Gemini força a decodificação neste formato: elimina prosa
// solta, JSON malformado e rascunhos de raciocínio que quebravam o parse.
const ADSUP_SCHEMA = {
  type: "OBJECT",
  properties: {
    persona:         { type: "STRING", enum: ["INS", "PRAT", "RES", "PRECO", "PREM", "EXP", "indeterminado"] },
    etapa_funil:     { type: "STRING", enum: ["INC", "PROB", "SOL", "PROD", "CONS", "indeterminado"] },
    angulo:          { type: "STRING", enum: ["DOR", "BEN", "TRANS", "PROVA", "COMP", "CURIO", "AUT", "ROT", "QC", "indeterminado"] },
    pilar_estrutura: { type: "STRING", enum: ["DSB", "FF", "ASK", "indeterminado"] },
    gancho_tipo:     { type: "STRING", enum: ["pergunta_dor", "numero_prova", "afirmacao_contraria", "segredo_revelado", "antes_depois_visual", "identificacao_direta", "indeterminado"] },
    formato:         { type: "STRING", enum: ["VIDEO", "IMAGEM", "CARROSSEL", "UGC"] },
    confidence_score:          { type: "NUMBER" },
    justificativa:             { type: "STRING" },
    alinhamento_gancho_angulo: { type: "BOOLEAN" },
    observacao_alinhamento:    { type: "STRING" },
  },
  required: [
    "persona", "etapa_funil", "angulo", "pilar_estrutura", "gancho_tipo",
    "formato", "confidence_score", "justificativa", "alinhamento_gancho_angulo",
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extrai o ÚLTIMO objeto JSON balanceado de um texto. O gemini-3.5-flash às
 * vezes emite mais de um objeto na mesma resposta (rascunho de raciocínio +
 * resposta final concatenados) — `{...}{...}` quebra o JSON.parse direto.
 * A resposta final é sempre a última. Varre de trás pra frente respeitando
 * strings/escapes.
 */
function extractLastJsonObject(text: string): string | null {
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  let depth = 0;
  let start = -1;
  // varre para trás contando chaves fora de strings
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (ch === '"') {
      // pula a string inteira (para trás), respeitando escapes
      let j = i - 1;
      while (j >= 0) {
        if (text[j] === '"') {
          // conta as barras invertidas antes da aspa
          let k = j - 1;
          let backslashes = 0;
          while (k >= 0 && text[k] === "\\") { backslashes++; k--; }
          if (backslashes % 2 === 0) break; // aspa real de abertura
        }
        j--;
      }
      i = j;
      continue;
    }
    if (ch === "}") depth++;
    if (ch === "{") {
      depth--;
      if (depth === 0) { start = i; break; }
    }
  }
  return start >= 0 ? text.slice(start, end + 1) : null;
}

function safeParseJSON(text: string): Record<string, unknown> {
  // Remove cercas ```json ... ``` caso o modelo as inclua
  const stripped = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (e1) {
    // Fallback: múltiplos objetos concatenados → fica com o ÚLTIMO (a resposta final)
    const last = extractLastJsonObject(stripped);
    if (last) {
      try {
        return JSON.parse(last);
      } catch (e2) {
        throw new Error(`parse direto: ${String(e1).slice(0, 120)} | último objeto: ${String(e2).slice(0, 120)}`);
      }
    }
    throw new Error(`sem objeto JSON balanceado | parse direto: ${String(e1).slice(0, 120)}`);
  }
}

/**
 * Junta as partes de texto de uma resposta Gemini priorizando a resposta
 * final: ignora partes de raciocínio (`thought: true`) e, se alguma parte
 * isolada já for JSON válido, prefere a última que parseia.
 */
function pickGeminiText(
  parts: Array<{ text?: string; thought?: boolean }> | undefined,
): string {
  const texts = (parts ?? [])
    .filter((p) => p?.text && p.thought !== true)
    .map((p) => p.text as string);
  if (!texts.length) return "";
  for (let i = texts.length - 1; i >= 0; i--) {
    try {
      JSON.parse(texts[i].trim());
      return texts[i];
    } catch { /* tenta a anterior */ }
  }
  return texts.join("");
}

interface ClassifyBody {
  adId?: string;
  creativeId?: string; // alias aceito
  nomeCriativo?: string;
  transcricao?: string;
  textoTela?: string;
  copyAnuncio?: string;
  thumbnailUrl?: string;
  videoId?: string;    // se presente → Gemini assiste o vídeo (multimodal)
  formato?: string;
  persist?: boolean;
  force?: boolean;     // true → reclassifica mesmo se já houver resultado salvo
}

// Formatos visuais em que a arte é o principal sinal — vale mandar a imagem.
const FORMATOS_VISUAIS = new Set(["IMAGEM", "CARROSSEL"]);

// Vídeo: só o Gemini assiste (Claude não aceita vídeo). Mesmo modelo de `transcribe`.
// gemini-3.5-flash principal; fallback gemini-2.0-flash (GA) em erro transiente.
const GEMINI_VIDEO_MODELS = ["gemini-3.5-flash", "gemini-2.0-flash"];
const VIDEO_INLINE_LIMIT = 15 * 1024 * 1024; // ≤15 MB → base64 inline
const VIDEO_SIZE_LIMIT   = 80 * 1024 * 1024; // >80 MB → recusa (cai p/ texto)

// ─── Helpers de vídeo (Gemini multimodal) ─────────────────────────────────────

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Resolve o source URL do vídeo na Meta e baixa o arquivo (timeout 90s). */
async function downloadMetaVideo(
  videoId: string,
  metaToken: string,
): Promise<{ buffer: ArrayBuffer; mime: string }> {
  const { source, error } = await getVideoSource(videoId, metaToken);
  if (!source) throw new Error(`Vídeo sem source URL: ${error ?? "motivo desconhecido"}`);

  const abort = new AbortController();
  const tid = setTimeout(() => abort.abort(), 90_000);
  try {
    const dl = await fetch(source, { signal: abort.signal });
    if (!dl.ok) throw new Error(`Download do vídeo falhou: HTTP ${dl.status}`);
    const buffer = await dl.arrayBuffer();
    const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(1);
    if (buffer.byteLength > VIDEO_SIZE_LIMIT) {
      throw new Error(`Vídeo muito grande (${sizeMB} MB, limite ${VIDEO_SIZE_LIMIT / 1024 / 1024} MB)`);
    }
    return { buffer, mime: "video/mp4" };
  } finally {
    clearTimeout(tid);
  }
}

/** Upload de vídeo grande via Gemini File API, aguardando estado ACTIVE. */
async function uploadGeminiFile(
  buffer: ArrayBuffer,
  mime: string,
  apiKey: string,
): Promise<{ uri: string; name: string }> {
  const boundary = "gemini_" + buffer.byteLength.toString(36);
  const encoder = new TextEncoder();
  const meta = JSON.stringify({ display_name: "ad_video.mp4" });

  const p1 = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const p2 = new Uint8Array(buffer);
  const p3 = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(p1.length + p2.length + p3.length);
  body.set(p1, 0);
  body.set(p2, p1.length);
  body.set(p3, p1.length + p2.length);

  const up = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
  );
  if (!up.ok) throw new Error(`Gemini File API upload ${up.status}: ${(await up.text()).slice(0, 200)}`);

  const file = (await up.json()).file ?? {};
  const fileUri: string = file.uri;
  const fileName: string = file.name;

  let state: string = file.state ?? "PROCESSING";
  let attempts = 0;
  while (state === "PROCESSING" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`);
    if (poll.ok) state = (await poll.json()).state ?? "ACTIVE";
    attempts++;
  }
  if (state !== "ACTIVE") throw new Error(`Gemini: vídeo ficou em "${state}" após ${attempts * 2}s`);

  return { uri: fileUri, name: fileName };
}

/** Classifica assistindo o vídeo no Gemini com o MESMO system prompt ADSUP. */
async function classifyVideoWithGemini(
  buffer: ArrayBuffer,
  mime: string,
  apiKey: string,
  system: string,
  user: string,
): Promise<string> {
  let fileName: string | null = null;
  try {
    let videoPart: Record<string, unknown>;
    if (buffer.byteLength > VIDEO_INLINE_LIMIT) {
      const up = await uploadGeminiFile(buffer, mime, apiKey);
      fileName = up.name;
      videoPart = { fileData: { fileUri: up.uri, mimeType: mime } };
    } else {
      videoPart = { inlineData: { data: toBase64(buffer), mimeType: mime } };
    }

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [videoPart, { text: user }] }],
      // Margem larga: no gemini-3.5-flash os tokens de raciocínio contam dentro
      // de maxOutputTokens — com 4096 o JSON saía truncado e falhava o parse.
      // responseSchema: o servidor força o JSON no formato ADSUP (structured output).
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: ADSUP_SCHEMA,
        maxOutputTokens: 16384,
      },
    });

    // gemini-3.5-flash → gemini-2.0-flash em erro transiente (429/5xx).
    let lastErr = "";
    for (const model of GEMINI_VIDEO_MODELS) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "content-type": "application/json" }, body },
      );
      if (resp.ok) {
        const data = await resp.json();
        const cand = data?.candidates?.[0];
        // Resposta cortada (MAX_TOKENS: o "pensamento" do 3.5-flash pode comer
        // o budget de saída) ou bloqueada → tenta o próximo modelo da cadeia
        // (o 2.0-flash não pensa, não trunca).
        const finish = cand?.finishReason ?? "STOP";
        if (finish !== "STOP") {
          const um = data?.usageMetadata ?? {};
          lastErr = `Gemini video ${model} finishReason=${finish} (thoughts=${um.thoughtsTokenCount ?? "?"}, out=${um.candidatesTokenCount ?? "?"})`;
          continue;
        }
        const text = pickGeminiText(cand?.content?.parts);
        if (text) return text;
        lastErr = `Gemini video ${model}: resposta vazia`;
        continue;
      }
      lastErr = `Gemini video ${model} ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
      if (resp.status === 400) throw new Error(lastErr);
    }
    throw new Error(`Gemini video — todos os modelos falharam. ${lastErr}`);
  } finally {
    if (fileName) {
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
        { method: "DELETE" },
      ).catch(() => { /* limpeza best-effort */ });
    }
  }
}

function buildUserMessage(
  b: ClassifyBody,
  nomeCriativo: string,
  hasImage: boolean,
  hasVideo: boolean,
): string {
  const anexo = hasVideo
    ? "\nO vídeo do criativo está anexado — assista-o na íntegra e classifique com base na fala, no texto na tela e no visual (o gancho dos primeiros 3s é decisivo)."
    : hasImage
    ? "\nA arte do criativo está anexada como imagem — analise o visual (gancho, texto na tela, elementos) para classificar."
    : "";

  return `CRIATIVO A CLASSIFICAR:

Nome atual do arquivo: ${nomeCriativo || "(sem nome)"}
Formato: ${b.formato}
Transcrição da fala/áudio: ${b.transcricao || "(não informada)"}
Texto na tela: ${b.textoTela || "(não informado)"}
Copy do anúncio: ${b.copyAnuncio || "(não informada)"}
${anexo}

Classifique este criativo segundo o framework do system prompt.`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const body = (await req.json()) as ClassifyBody;
    const adId = body.adId ?? body.creativeId;
    const nomeCriativo = body.nomeCriativo ?? "";

    if (!adId) {
      throw new Error("Body deve conter { adId } (ou creativeId)");
    }
    if (!body.formato) {
      throw new Error("Body deve conter { formato } (VIDEO | IMAGEM | CARROSSEL | UGC)");
    }

    // ── Guarda de idempotência (servidor): já classificado → retorna o salvo ──
    // Evita gasto duplo de IA em corridas (cron + navegador ao mesmo tempo).
    // `force: true` (botão "Reclassificar" do modal) pula a guarda.
    const SB_URL = Deno.env.get("SUPABASE_URL");
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!body.force && SB_URL && SB_KEY) {
      const guard = createClient(SB_URL, SB_KEY);
      const { data: existing } = await guard
        .from("creative_classifications")
        .select("*")
        .eq("ad_id", adId)
        .maybeSingle();
      if (existing) {
        return new Response(
          JSON.stringify({ ...existing, cached: true, persisted: true }),
          { headers: { ...CORS_HEADERS, "content-type": "application/json" } },
        );
      }
    }

    const formatoUpper = String(body.formato).toUpperCase();
    // Em formatos visuais (IMAGEM/CARROSSEL) manda a arte para o modelo enxergar.
    const imageUrl =
      FORMATOS_VISUAIS.has(formatoUpper) && body.thumbnailUrl
        ? body.thumbnailUrl
        : undefined;

    const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
    const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
    const wantsVideo = Boolean(body.videoId) && Boolean(GEMINI_KEY) && Boolean(META_TOKEN);

    let rawText: string;
    let provider: string;

    // Path de VÍDEO — só o Gemini assiste (Claude não aceita vídeo).
    // Mesmo SYSTEM_PROMPT ADSUP e mesmo JSON de saída.
    if (wantsVideo) {
      try {
        const { buffer, mime } = await downloadMetaVideo(body.videoId!, META_TOKEN!);
        rawText = await classifyVideoWithGemini(
          buffer,
          mime,
          GEMINI_KEY!,
          SYSTEM_PROMPT,
          buildUserMessage(body, nomeCriativo, false, true),
        );
        provider = "gemini";
      } catch (videoErr) {
        // Vídeo indisponível/grande/erro → cai para texto (transcrição/copy) sem quebrar.
        console.warn("classify-creative: falha no vídeo, usando texto:", String(videoErr));
        const r = await callLLM({
          system: SYSTEM_PROMPT,
          user: buildUserMessage(body, nomeCriativo, Boolean(imageUrl), false),
          maxTokens: 1000,
          imageUrl,
          responseSchema: ADSUP_SCHEMA,
        });
        rawText = r.text;
        provider = r.provider;
      }
    } else {
      // Path de TEXTO/IMAGEM — Claude → fallback Gemini (com imagem quando IMAGEM/CARROSSEL).
      const r = await callLLM({
        system: SYSTEM_PROMPT,
        user: buildUserMessage(body, nomeCriativo, Boolean(imageUrl), false),
        maxTokens: 1000,
        imageUrl,
        responseSchema: ADSUP_SCHEMA,
      });
      rawText = r.text;
      provider = r.provider;
    }

    // ── Parse seguro do JSON ──────────────────────────────────────────────
    let classificacao: Record<string, unknown>;
    try {
      classificacao = safeParseJSON(rawText);
    } catch (parseErr) {
      // Se o modelo não devolveu JSON válido, sinaliza indeterminado sem quebrar.
      // Diagnóstico completo no error: motivo do parse, tamanho, começo e FIM.
      return new Response(
        JSON.stringify({
          error:
            `Resposta da IA não pôde ser interpretada como JSON. ` +
            `Motivo: ${String(parseErr instanceof Error ? parseErr.message : parseErr).slice(0, 260)} · ` +
            `len=${rawText.length} · começo=${JSON.stringify(rawText.slice(0, 120))} · ` +
            `fim=${JSON.stringify(rawText.slice(-260))}`,
          raw: rawText.slice(0, 500),
          provider,
        }),
        { status: 502, headers: { ...CORS_HEADERS, "content-type": "application/json" } },
      );
    }

    // ── Persiste em creative_classifications (service_role) ────────────────
    let persisted = false;
    if (body.persist !== false) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (SUPABASE_URL && SERVICE_KEY) {
        const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
        const { error } = await supabase
          .from("creative_classifications")
          .upsert(
            {
              ad_id: adId,
              nome_criativo: nomeCriativo || null,
              persona: classificacao.persona ?? null,
              etapa_funil: classificacao.etapa_funil ?? null,
              angulo: classificacao.angulo ?? null,
              pilar_estrutura: classificacao.pilar_estrutura ?? null,
              gancho_tipo: classificacao.gancho_tipo ?? null,
              formato: classificacao.formato ?? body.formato,
              confidence_score: classificacao.confidence_score ?? null,
              justificativa: classificacao.justificativa ?? null,
              alinhamento_gancho_angulo:
                classificacao.alinhamento_gancho_angulo ?? null,
              observacao_alinhamento:
                classificacao.observacao_alinhamento ?? null,
              provider,
              classificado_em: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "ad_id" },
          );

        if (error) {
          console.error("Erro ao gravar classificação:", error.message);
        } else {
          persisted = true;
        }
      } else {
        console.warn(
          "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes — classificação não gravada.",
        );
      }
    }

    return new Response(
      JSON.stringify({ ...classificacao, provider, persisted }),
      { headers: { ...CORS_HEADERS, "content-type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }
});

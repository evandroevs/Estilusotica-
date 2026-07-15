/**
 * callLLM — chamada de LLM com fallback automático.
 *
 * Ordem: Anthropic (Claude) → Google (Gemini).
 * Se a Anthropic falhar (sem chave, sem créditos, erro de API), cai para o
 * Gemini 2.5 Flash (camada gratuita). Quando a conta Anthropic tiver créditos,
 * o Claude volta a ser usado automaticamente — sem alterar configuração.
 *
 * Ambos os provedores recebem o mesmo par system + user e devem devolver
 * texto (as funções chamadoras esperam JSON puro na resposta).
 */

const CLAUDE_MODEL = "claude-sonnet-4-6";
// gemini-3.5-flash é o principal; cai para gemini-2.0-flash (GA) quando o
// primeiro está sobrecarregado (429/503/5xx). gemini-2.5-flash foi aposentado.
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-2.0-flash"];

export interface LLMCall {
  system: string;
  user: string;
  maxTokens?: number;
  plainText?: boolean; // true → resposta em texto/markdown (não força JSON no Gemini)
  imageUrl?: string;   // opcional → envia a imagem para o modelo (visão) — usado em criativos IMAGEM/CARROSSEL
  // opcional → structured output no Gemini (responseSchema): o servidor força
  // JSON válido no formato dado, eliminando prosa solta/JSON malformado.
  responseSchema?: Record<string, unknown>;
}

export interface LLMResult {
  text: string;
  provider: "anthropic" | "gemini";
}

/** Baixa uma imagem e devolve { mime, base64 } para o inline_data do Gemini. Null se falhar. */
async function fetchImageInline(
  url: string,
): Promise<{ mime: string; base64: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const mime = (resp.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const bytes = new Uint8Array(await resp.arrayBuffer());
    // base64 em blocos p/ não estourar a call stack com btoa em imagens grandes
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { mime, base64: btoa(binary) };
  } catch {
    return null;
  }
}

async function callAnthropic(key: string, call: LLMCall): Promise<string> {
  // Claude aceita imagem via URL diretamente (ele mesmo busca a imagem).
  const userContent = call.imageUrl
    ? [
        { type: "image", source: { type: "url", url: call.imageUrl } },
        { type: "text", text: call.user },
      ]
    : call.user;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: call.maxTokens ?? 1200,
      system: call.system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 800)}`);
  }

  const data = await resp.json();
  const text: string = data?.content?.[0]?.text ?? "";
  if (!text) throw new Error("Resposta vazia da Anthropic API");
  return text;
}

async function callGemini(key: string, call: LLMCall): Promise<string> {
  // Gemini precisa da imagem em base64 (inline_data). Se o download falhar,
  // segue só com texto — sem quebrar a classificação.
  const parts: Array<Record<string, unknown>> = [{ text: call.user }];
  if (call.imageUrl) {
    const img = await fetchImageInline(call.imageUrl);
    if (img) {
      parts.unshift({ inline_data: { mime_type: img.mime, data: img.base64 } });
    }
  }

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: call.system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: Math.max((call.maxTokens ?? 1200) * 4, 4096),
      ...(call.plainText ? {} : { responseMimeType: "application/json" }),
      ...(!call.plainText && call.responseSchema ? { responseSchema: call.responseSchema } : {}),
    },
  });

  // Tenta gemini-3.5-flash → gemini-2.0-flash em erro transiente (429/5xx).
  const errs: string[] = [];
  for (const model of GEMINI_MODELS) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );

    if (resp.ok) {
      const data = await resp.json();
      const cand = data?.candidates?.[0];
      // Resposta truncada (o "pensamento" do 3.5-flash pode comer o budget de
      // saída) ou bloqueada → tenta o próximo modelo da cadeia.
      const finish = cand?.finishReason ?? "STOP";
      if (finish !== "STOP") {
        const um = data?.usageMetadata ?? {};
        errs.push(`Gemini ${model} finishReason=${finish} (thoughts=${um.thoughtsTokenCount ?? "?"}, out=${um.candidatesTokenCount ?? "?"})`);
        continue;
      }
      // Filtra partes de raciocínio (thought) e, em modo JSON, prefere a
      // última parte que parseia — o 3.5-flash pode emitir rascunho + final
      // concatenados, o que quebrava o JSON.parse dos chamadores.
      const rawParts =
        (cand?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
      const texts = rawParts.filter((p) => p?.text && p.thought !== true).map((p) => p.text as string);
      let text = "";
      if (texts.length) {
        if (!call.plainText) {
          for (let i = texts.length - 1; i >= 0 && !text; i--) {
            try { JSON.parse(texts[i].trim()); text = texts[i]; } catch { /* tenta anterior */ }
          }
        }
        if (!text) text = texts.join("");
      }
      if (text) return text;
      errs.push(`Gemini ${model}: resposta vazia`);
      continue; // resposta vazia → tenta o próximo modelo
    }

    const errText = await resp.text();
    errs.push(`Gemini ${model} ${resp.status}: ${errText.slice(0, 700)}`);
    // 400 = problema do request (não adianta trocar modelo). Demais (404/429/5xx) → próximo modelo.
    if (resp.status === 400) throw new Error(errs[errs.length - 1]);
  }

  throw new Error(`Gemini API — todos os modelos falharam. ${errs.join(" ||| ")}`);
}

export async function callLLM(call: LLMCall): Promise<LLMResult> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const geminiKey    = Deno.env.get("GEMINI_API_KEY");

  const errors: string[] = [];

  if (anthropicKey) {
    try {
      return { text: await callAnthropic(anthropicKey, call), provider: "anthropic" };
    } catch (err) {
      errors.push(String(err));
    }
  } else {
    errors.push("ANTHROPIC_API_KEY não configurado");
  }

  if (geminiKey) {
    try {
      return { text: await callGemini(geminiKey, call), provider: "gemini" };
    } catch (err) {
      errors.push(String(err));
    }
  } else {
    errors.push("GEMINI_API_KEY não configurado");
  }

  throw new Error(`Nenhum provedor de IA disponível. ${errors.join(" | ")}`);
}

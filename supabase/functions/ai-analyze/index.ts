/**
 * ai-analyze — Edge Function (Deno)
 *
 * Analisa criativos e campanhas usando LLM com fallback:
 * Anthropic (Claude) → Google (Gemini). Ver _shared/llm.ts.
 *
 * Secrets (nunca vão ao frontend) — pelo menos um:
 *   ANTHROPIC_API_KEY — chave da Anthropic (preferido)
 *   GEMINI_API_KEY    — chave do Google AI Studio (fallback gratuito)
 *
 * Body (JSON):
 *   {
 *     modo: "analisar_anuncio" | "ideias_hook" | "inspirar" | "resumo_campanha",
 *     dados: object  // métricas do anúncio ou da campanha
 *   }
 *
 * Resposta:
 *   { diagnostico, pontos_fortes[], pontos_fracos[], sugestoes_hook[], proxima_acao }
 */

import { callLLM } from "../_shared/llm.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── System prompts por modo ──────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<string, string> = {
  analisar_anuncio: `Você é um especialista sênior em performance de tráfego pago no Meta Ads para e-commerce brasileiro.
Analise o criativo fornecido e responda EXCLUSIVAMENTE com JSON puro (sem \`\`\`json, sem markdown, sem nenhum texto fora do JSON).

Formato obrigatório (responda APENAS este JSON, sem qualquer outro texto):
{
  "diagnostico": "análise em 2-3 frases — o que está funcionando e o que precisa de atenção",
  "pontos_fortes": ["até 3 pontos positivos baseados nas métricas"],
  "pontos_fracos": ["até 3 gargalos ou pontos de melhoria baseados nas métricas"],
  "sugestoes_hook": ["4 frases de abertura para testar no próximo criativo deste ângulo"],
  "proxima_acao": "1 ação objetiva e específica para o gestor executar agora"
}

Benchmarks da conta: ROAS excelente ≥ 5x, qualificado ≥ 3x. CTR bom ≥ 1,5%, excelente ≥ 3%. Thumbstop bom ≥ 25%, excelente ≥ 40%.`,

  ideias_hook: `Você é um copywriter especialista em hooks para vídeos de performance no Meta Ads para e-commerce brasileiro.
Analise as métricas e gere ideias de hook. Responda EXCLUSIVAMENTE com JSON puro (sem \`\`\`json, sem markdown, sem nenhum texto fora do JSON).

Formato obrigatório (responda APENAS este JSON, sem qualquer outro texto):
{
  "diagnostico": "avaliação em 2-3 frases do potencial de hook atual e oportunidade de melhoria",
  "pontos_fortes": ["até 3 aspectos positivos da abertura atual que contribuem para o Thumbstop"],
  "pontos_fracos": ["até 3 motivos que podem estar limitando o Thumbstop Rate"],
  "sugestoes_hook": ["6 frases de abertura originais — use gatilhos de curiosidade, dor, prova social, medo ou urgência. Coloque cada frase entre aspas dentro da string"],
  "proxima_acao": "qual gatilho testar primeiro e por quê"
}`,

  inspirar: `Você é um estrategista de criativos de performance no Meta Ads para e-commerce brasileiro.
Com base no anúncio vencedor fornecido, gere inspirações para novos criativos.
Responda EXCLUSIVAMENTE com JSON puro (sem \`\`\`json, sem markdown, sem nenhum texto fora do JSON).

Formato obrigatório (responda APENAS este JSON, sem qualquer outro texto):
{
  "diagnostico": "em 2-3 frases, explique POR QUE este criativo performou bem e qual é o padrão a replicar",
  "pontos_fortes": ["até 3 elementos de sucesso que devem ser mantidos nos próximos criativos"],
  "pontos_fracos": ["até 3 riscos de saturação ou limitações deste criativo"],
  "sugestoes_hook": ["4 conceitos de novos criativos — para cada um inclua: modelo de vídeo sugerido, ângulo e ideia de hook"],
  "proxima_acao": "descreva o próximo criativo a produzir: modelo, ângulo, hook e quantidade recomendada"
}`,

  resumo_campanha: `Você é um especialista em análise de campanhas de tráfego pago no Meta Ads para e-commerce brasileiro.
Analise os dados da campanha e responda EXCLUSIVAMENTE com JSON puro (sem \`\`\`json, sem markdown, sem nenhum texto fora do JSON).

Formato obrigatório (responda APENAS este JSON, sem qualquer outro texto):
{
  "diagnostico": "análise em 3-4 frases do estado geral — o que funciona, o que não funciona e o padrão dos vencedores",
  "pontos_fortes": ["até 3 padrões vencedores identificados — ângulo, modelo ou hook que funciona"],
  "pontos_fracos": ["até 3 gargalos ou padrões que devem ser pausados ou ajustados"],
  "sugestoes_hook": ["até 4 sugestões de novos criativos para esta campanha, baseadas nos padrões vencedores"],
  "proxima_acao": "1 decisão de otimização objetiva: o que pausar, o que escalar e o que testar primeiro"
}`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJSON(text: string): Record<string, unknown> {
  // Strip ```json ... ``` or ``` ... ``` code fences if the model included them
  const stripped = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  return JSON.parse(stripped);
}

function buildUserMessage(modo: string, dados: unknown): string {
  const json = JSON.stringify(dados, null, 2);
  const labels: Record<string, string> = {
    analisar_anuncio:  "Analise este anúncio",
    ideias_hook:       "Gere ideias de hook para este anúncio",
    inspirar:          "Gere inspirações baseadas neste anúncio vencedor",
    resumo_campanha:   "Gere o resumo desta campanha",
  };
  return `${labels[modo] ?? "Analise os dados"}:\n${json}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { modo, dados } = body as { modo: string; dados: unknown };

    if (!modo || !dados) {
      throw new Error("Body deve conter { modo, dados }");
    }

    const systemPrompt = SYSTEM_PROMPTS[modo];
    if (!systemPrompt) {
      throw new Error(
        `modo inválido: "${modo}". Use: analisar_anuncio | ideias_hook | inspirar | resumo_campanha`,
      );
    }

    // ── Chama o LLM (Claude → fallback Gemini) ────────────────────────────
    const { text: rawText } = await callLLM({
      system: systemPrompt,
      user: buildUserMessage(modo, dados),
      maxTokens: 1200,
    });

    // ── Parse seguro do JSON retornado ────────────────────────────────────
    let parsed: Record<string, unknown>;
    try {
      parsed = safeParseJSON(rawText);
    } catch {
      // Se o parse falhar, retorna a mensagem bruta em diagnostico para debug
      parsed = {
        diagnostico: rawText.slice(0, 400),
        pontos_fortes: [],
        pontos_fracos: [],
        sugestoes_hook: [],
        proxima_acao: "Erro ao processar resposta da IA. Tente novamente.",
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }
});

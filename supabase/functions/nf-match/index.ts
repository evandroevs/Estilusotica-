/**
 * nf-match — lê a foto da ordem de serviço com IA e cruza com os leads da loja.
 *
 * POST (com JWT do usuário + x-workspace-id):
 *   { nota_url: string }   // foto já enviada ao bucket notas-fiscais
 *
 * Resposta:
 *   {
 *     extraido:   { telefone, valor, nome, produto, data } | null,
 *     ia_ok:      boolean,
 *     candidatos: [{ id, nome, telefone, status, iniciado_em,
 *                    motivo: "telefone" | "nome",
 *                    veio_de_anuncio: boolean, ja_vendido: boolean }]
 *   }
 *
 * A function NÃO altera nada — quem dá baixa no lead é o frontend
 * (mesmo caminho RLS do fluxo manual), depois de mostrar o resultado.
 */
import { resolveTenant, CORS_HEADERS, jsonResponse } from "../_shared/tenant.ts";

/** Quanto tempo para trás procurar um lead que combine com a ordem. */
const JANELA_BUSCA_DIAS = 90;

/** Só dígitos; descarta 55 do país para comparar os finais. */
function soDigitos(t: string | null | undefined): string {
  return (t ?? "").replace(/\D/g, "").replace(/^55/, "");
}

/** Telefones equivalentes se os últimos 8 dígitos baterem (ignora DDD/9º dígito). */
function telefoneBate(a: string, b: string): boolean {
  const da = soDigitos(a), db = soDigitos(b);
  if (da.length < 8 || db.length < 8) return false;
  return da.slice(-8) === db.slice(-8);
}

/** Sem acento, minúsculo, sem pontuação — para comparar nomes escritos à mão. */
function normalizarNome(n: string | null | undefined): string[] {
  return (n ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter((p) => p.length > 2);
}

/**
 * Nomes batem se o primeiro nome e mais um pedaço coincidirem.
 * Exigir só o primeiro nome geraria falso positivo em loja (muita "Maria").
 */
function nomeBate(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = normalizarNome(a), pb = normalizarNome(b);
  if (pa.length < 2 || pb.length < 2) return false;
  if (pa[0] !== pb[0]) return false;
  return pa.slice(1).some((parte) => pb.slice(1).includes(parte));
}

interface LeadBruto {
  id: string;
  nome: string | null;
  telefone: string | null;
  status: string;
  iniciado_em: string;
  ctwa_clid: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const ctx = await resolveTenant(req);

    let body: { nota_url?: string } = {};
    try { body = await req.json(); } catch { /* segue */ }
    if (!body.nota_url) return jsonResponse({ error: "nota_url é obrigatório." }, 400);

    // ── 1. IA: extrair telefone/valor/nome/produto da foto ──
    let extraido:
      | { telefone?: string; valor?: number; nome?: string; produto?: string; data?: string }
      | null = null;
    let ia_ok = false;

    const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (API_KEY) {
      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-5",
            max_tokens: 400,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "url", url: body.nota_url } },
                {
                  type: "text",
                  text:
                    "Esta é a foto de uma ordem de serviço, nota fiscal ou comprovante de venda " +
                    "de uma ótica no Brasil. Extraia APENAS um JSON (sem markdown, sem explicação) " +
                    'no formato: {"telefone": "só dígitos ou null", "valor": numero_total_ou_null, ' +
                    '"nome": "nome do cliente ou null", "produto": "descrição curta do que foi vendido ou null", ' +
                    '"data": "YYYY-MM-DD ou null"}.\n' +
                    "Regras:\n" +
                    "- telefone = telefone do CLIENTE. Ignore o telefone da loja, que costuma aparecer " +
                    "no cabeçalho junto do CNPJ, do logotipo ou do endereço.\n" +
                    "- telefone SEMPRE com DDD. Ordem de serviço costuma trazer o número do cliente " +
                    "sem DDD porque é da mesma cidade: se o número do cliente vier com 8 ou 9 dígitos, " +
                    "complete com o DDD do telefone da LOJA (o do cabeçalho) ou do endereço dela. " +
                    "Sem DDD o número é inútil e a venda se perde.\n" +
                    "- valor = valor TOTAL da venda em reais, já com descontos. Se houver entrada e " +
                    "saldo, use o total da ordem, não a entrada.\n" +
                    "- produto = o que foi vendido em poucas palavras (ex.: 'armação + lentes multifocais', " +
                    "'óculos de sol', 'aparelho auditivo').\n" +
                    "- Use null quando não conseguir ler com confiança. Não invente.",
                },
              ],
            }],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();

          // O modelo pode devolver um bloco `thinking` antes do texto — pegar
          // content[0] às cegas quebra justamente quando ele raciocina mais.
          const blocos: Array<{ type?: string; text?: string }> = data?.content ?? [];
          const texto = blocos.find((b) => b?.type === "text")?.text ?? "";

          // Recorta o primeiro objeto JSON, caso venha cercado de explicação.
          const cru = texto.replace(/```json|```/g, "").trim();
          const json = cru.slice(cru.indexOf("{"), cru.lastIndexOf("}") + 1);
          if (!json) throw new Error(`resposta sem JSON: ${cru.slice(0, 120)}`);

          extraido = JSON.parse(json);
          ia_ok = true;
        } else {
          console.error("anthropic error", resp.status, await resp.text());
        }
      } catch (err) {
        console.error("nf-match ia falhou:", err);
      }
    }

    // ── 2. Cruzar com os leads da loja ──
    // Busca ampla de propósito: o cliente pode ter sido marcado como
    // "não comprou" e voltado dias depois — é justamente a venda que a
    // versão anterior deixava passar.
    const desde = new Date(Date.now() - JANELA_BUSCA_DIAS * 86400_000).toISOString();

    const { data: leads, error } = await ctx.admin
      .from("leads")
      .select("id, nome, telefone, status, iniciado_em, ctwa_clid")
      .eq("workspace_id", ctx.workspaceId)
      .eq("avulsa", false)
      .gte("iniciado_em", desde)
      .order("iniciado_em", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);

    const todos = (leads ?? []) as LeadBruto[];

    const enriquecer = (l: LeadBruto, motivo: "telefone" | "nome") => ({
      id: l.id,
      nome: l.nome,
      telefone: l.telefone,
      status: l.status,
      iniciado_em: l.iniciado_em,
      motivo,
      veio_de_anuncio: Boolean(l.ctwa_clid),
      ja_vendido: l.status === "vendido",
    });

    let candidatos = extraido?.telefone
      ? todos.filter((l) => telefoneBate(l.telefone ?? "", extraido!.telefone!)).map((l) => enriquecer(l, "telefone"))
      : [];

    // Telefone não bateu (ou não foi lido): tenta pelo nome do cliente.
    if (!candidatos.length && extraido?.nome) {
      candidatos = todos.filter((l) => nomeBate(l.nome, extraido!.nome)).map((l) => enriquecer(l, "nome"));
    }

    // Lead ainda aberto primeiro — é o desfecho mais provável da ordem.
    const aberto = (s: string) => (s === "em_atendimento" || s === "aguardando" ? 0 : 1);
    candidatos.sort((a, b) =>
      aberto(a.status) - aberto(b.status) ||
      new Date(b.iniciado_em).getTime() - new Date(a.iniciado_em).getTime()
    );

    return jsonResponse({ extraido, ia_ok, candidatos });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return jsonResponse({ error: (err as Error).message ?? String(err) }, status);
  }
});

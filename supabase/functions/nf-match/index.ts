/**
 * nf-match — lê a foto da nota fiscal com IA e cruza com os leads da loja.
 *
 * POST (com JWT do usuário + x-workspace-id):
 *   { nota_url: string }   // foto já enviada ao bucket notas-fiscais
 *
 * Resposta:
 *   {
 *     extraido:   { telefone, valor, nome, data } | null,  // null se IA indisponível/ilegível
 *     ia_ok:      boolean,
 *     candidatos: [{ id, nome, telefone, status, iniciado_em }]  // leads abertos com telefone equivalente
 *   }
 *
 * A function NÃO altera nada — quem dá baixa no lead é o frontend
 * (mesmo caminho RLS do fluxo manual), depois de mostrar o resultado.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTenant, CORS_HEADERS } from "../_shared/tenant.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ctx = await resolveTenant(req);

    let body: { nota_url?: string } = {};
    try { body = await req.json(); } catch { /* segue */ }
    if (!body.nota_url) return json({ error: "nota_url é obrigatório." }, 400);

    // ── 1. IA: extrair telefone/valor/nome da foto ──
    let extraido: { telefone?: string; valor?: number; nome?: string; data?: string } | null = null;
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
            max_tokens: 300,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "url", url: body.nota_url } },
                {
                  type: "text",
                  text: "Esta é a foto de uma nota fiscal ou comprovante de venda de uma ótica no Brasil. " +
                    "Extraia APENAS um JSON (sem markdown, sem explicação) no formato: " +
                    '{"telefone": "só dígitos ou null", "valor": numero_total_ou_null, ' +
                    '"nome": "nome do cliente ou null", "data": "YYYY-MM-DD ou null"}. ' +
                    "telefone = telefone do CLIENTE (não o da loja, que costuma vir no cabeçalho). " +
                    "valor = valor TOTAL da venda em reais.",
                },
              ],
            }],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const texto: string = data?.content?.[0]?.text ?? "";
          const limpo = texto.replace(/```json|```/g, "").trim();
          extraido = JSON.parse(limpo);
          ia_ok = true;
        } else {
          console.error("anthropic error", resp.status, await resp.text());
        }
      } catch (err) {
        console.error("nf-match ia falhou:", err);
      }
    }

    // ── 2. Cruzar telefone extraído com leads abertos da loja ──
    const { data: abertos, error } = await ctx.admin
      .from("leads")
      .select("id, nome, telefone, status, iniciado_em")
      .eq("workspace_id", ctx.workspaceId)
      .in("status", ["em_atendimento", "aguardando"])
      .order("iniciado_em", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const candidatos = extraido?.telefone
      ? (abertos ?? []).filter((l) => telefoneBate(l.telefone ?? "", extraido!.telefone!))
      : [];

    return json({ extraido, ia_ok, candidatos });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return json({ error: (err as Error).message ?? String(err) }, status);
  }
});

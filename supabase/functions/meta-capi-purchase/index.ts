/**
 * meta-capi-purchase — avisa a Meta que a venda aconteceu na loja física.
 *
 * POST (com JWT do usuário + x-workspace-id):
 *   { lead_id: "uuid" }     // envia uma venda
 *   { pendentes: true }     // reenvia tudo que ficou para trás na loja
 *
 * Resposta:
 *   { enviados: n, resultados: [{ lead_id, ok, atribuido_ao_anuncio, erro? }] }
 *
 * Idempotente por construção: o `event_id` é derivado do id do lead, então
 * mesmo que a função seja chamada duas vezes a Meta conta uma compra só.
 * Um lead já com meta_status='enviado' nem chega a sair daqui de novo.
 */
import { resolveTenant, CORS_HEADERS, jsonResponse } from "../_shared/tenant.ts";
import { resolveCapiConnection, enviarVendaLoja, CapiError } from "../_shared/metaCapi.ts";

interface Lead {
  id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  produto: string | null;
  status: string;
  valor_venda: number | null;
  vendido_em: string | null;
  ctwa_clid: string | null;
  avulsa: boolean;
  meta_status: string;
  meta_tentativas: number;
}

/** Motivo para não enviar, ou null se a venda pode ir. */
function bloqueio(lead: Lead): string | null {
  if (lead.status !== "vendido") return "Lead não está marcado como vendido.";
  if (!(Number(lead.valor_venda) > 0)) return "Venda sem valor — a Meta precisa do valor da compra.";
  if (lead.avulsa) return "Venda avulsa (não veio de anúncio).";
  return null;
}

/** Dias entre a venda e agora — a Meta recusa evento velho demais. */
function idadeEmDias(vendidoEm: string | null): number {
  if (!vendidoEm) return 0;
  return (Date.now() - new Date(vendidoEm).getTime()) / 86400_000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const ctx = await resolveTenant(req);

    let body: { lead_id?: string; pendentes?: boolean } = {};
    try { body = await req.json(); } catch { /* segue */ }

    if (!body.lead_id && !body.pendentes) {
      return jsonResponse({ error: "Informe lead_id ou pendentes: true." }, 400);
    }

    // ── 1. Quais vendas enviar ──
    let query = ctx.admin
      .from("leads")
      .select("id, nome, telefone, email, produto, status, valor_venda, vendido_em, ctwa_clid, avulsa, meta_status, meta_tentativas")
      .eq("workspace_id", ctx.workspaceId);

    query = body.lead_id
      ? query.eq("id", body.lead_id)
      : query.eq("status", "vendido").eq("avulsa", false)
             .in("meta_status", ["pendente", "erro"]).limit(50);

    const { data: leads, error } = await query;
    if (error) throw new CapiError(error.message, 500);
    if (!leads?.length) {
      return jsonResponse({ enviados: 0, resultados: [], mensagem: "Nada para enviar." });
    }

    // ── 2. Conexão da loja (uma vez só para o lote) ──
    const conn = await resolveCapiConnection(ctx.admin, ctx.workspaceId);

    // ── 3. Enviar ──
    const resultados: unknown[] = [];
    let enviados = 0;

    for (const lead of leads as Lead[]) {
      if (lead.meta_status === "enviado") {
        resultados.push({ lead_id: lead.id, ok: true, ja_enviado: true });
        continue;
      }

      const motivo = bloqueio(lead);
      if (motivo) {
        await ctx.admin.from("leads").update({
          meta_status: lead.avulsa ? "nao_aplicavel" : "erro",
          meta_erro: motivo,
        }).eq("id", lead.id);
        resultados.push({ lead_id: lead.id, ok: false, erro: motivo });
        continue;
      }

      const r = await enviarVendaLoja(conn, {
        eventId: `venda-${lead.id}`,
        eventTime: Math.floor(new Date(lead.vendido_em ?? Date.now()).getTime() / 1000),
        valor: Number(lead.valor_venda),
        ctwaClid: lead.ctwa_clid,
        telefone: lead.telefone,
        email: lead.email,
        nome: lead.nome,
        produto: lead.produto,
      });

      // A Meta recusa evento antigo com mensagem genérica. Se a venda já tem
      // dias, diz isso na cara — senão o erro vira um mistério.
      const dias = idadeEmDias(lead.vendido_em);
      const erro = r.ok
        ? null
        : dias > 7
          ? `${r.erro ?? "Erro desconhecido"} (a venda é de ${Math.floor(dias)} dias atrás — a Meta costuma recusar eventos com mais de 7 dias)`
          : (r.erro ?? "Erro desconhecido");

      await ctx.admin.from("leads").update({
        meta_status:     r.ok ? "enviado" : "erro",
        meta_event_id:   `venda-${lead.id}`,
        meta_enviado_em: r.ok ? new Date().toISOString() : null,
        meta_erro:       erro,
        meta_tentativas: (lead.meta_tentativas ?? 0) + 1,
      }).eq("id", lead.id);

      if (r.ok) enviados++;
      resultados.push({
        lead_id: lead.id,
        ok: r.ok,
        atribuido_ao_anuncio: r.atribuidoAoAnuncio,
        ...(erro ? { erro } : {}),
      });
    }

    // Marca a conexão como saudável (ou não) para a tela de Conexões.
    const algumOk = resultados.some((r) => (r as { ok: boolean }).ok);
    await ctx.admin.from("meta_capi_connections").update({
      status: algumOk ? "active" : "error",
      last_error: algumOk ? null : "Último envio falhou — ver detalhe no lead.",
      ...(algumOk ? { ultimo_evento_em: new Date().toISOString() } : {}),
    }).eq("id", conn.connectionId);

    return jsonResponse({ enviados, resultados });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return jsonResponse({ error: (err as Error).message ?? String(err) }, status);
  }
});

/**
 * meta-capi-config — lê e grava a configuração da Conversions API da loja.
 *
 * O token do system user precisa passar por aqui: `meta_capi_secrets` não tem
 * policy de RLS nenhuma, então só service_role escreve. O frontend manda o
 * token uma vez e nunca mais o vê.
 *
 * POST (com JWT do usuário + x-workspace-id):
 *   { action: "get" }
 *     → { config: {...}, tem_token: boolean }
 *
 *   { action: "save", dataset_id, waba_id?, wa_phone_number_id?,
 *     test_event_code?, access_token? }
 *     → { ok: true, config: {...}, tem_token: boolean }
 *
 *   { action: "test" }
 *     → dispara um evento de teste no dataset e devolve o que a Meta respondeu
 */
import { resolveTenant, CORS_HEADERS, jsonResponse } from "../_shared/tenant.ts";
import { resolveCapiConnection, enviarVendaLoja } from "../_shared/metaCapi.ts";

interface Body {
  action?: "get" | "save" | "test";
  dataset_id?: string;
  waba_id?: string;
  wa_phone_number_id?: string;
  test_event_code?: string;
  access_token?: string;
}

/** Só dígitos — é assim que a Meta identifica dataset/WABA/número. */
function soDigitos(v: string | undefined | null): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length ? d : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const ctx = await resolveTenant(req);

    let body: Body = {};
    try { body = await req.json(); } catch { /* segue */ }
    const action = body.action ?? "get";

    /** Estado atual (sem nunca devolver o token). */
    async function estado() {
      const { data: conn } = await ctx.admin
        .from("meta_capi_connections")
        .select("id, dataset_id, waba_id, wa_phone_number_id, test_event_code, status, last_error, ultimo_evento_em")
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle();

      if (!conn) return { config: null, tem_token: false };

      const { data: secret } = await ctx.admin
        .from("meta_capi_secrets")
        .select("connection_id")
        .eq("connection_id", conn.id)
        .maybeSingle();

      const { id: _id, ...publico } = conn;
      return { config: publico, tem_token: Boolean(secret) };
    }

    if (action === "get") return jsonResponse(await estado());

    if (action === "save") {
      const datasetId = soDigitos(body.dataset_id);
      if (!datasetId) {
        return jsonResponse({ error: "Informe o ID do dataset (só números, do Events Manager)." }, 400);
      }

      const { data: conn, error } = await ctx.admin
        .from("meta_capi_connections")
        .upsert({
          workspace_id:       ctx.workspaceId,
          dataset_id:         datasetId,
          waba_id:            soDigitos(body.waba_id),
          wa_phone_number_id: soDigitos(body.wa_phone_number_id),
          test_event_code:    body.test_event_code?.trim() || null,
          status:             "pending_config",
          last_error:         null,
          updated_at:         new Date().toISOString(),
        }, { onConflict: "workspace_id" })
        .select("id")
        .single();

      if (error) return jsonResponse({ error: error.message }, 500);

      if (body.access_token?.trim()) {
        const { error: secErr } = await ctx.admin
          .from("meta_capi_secrets")
          .upsert({
            connection_id: conn.id,
            access_token:  body.access_token.trim(),
            updated_at:    new Date().toISOString(),
          }, { onConflict: "connection_id" });
        if (secErr) return jsonResponse({ error: secErr.message }, 500);
      }

      return jsonResponse({ ok: true, ...(await estado()) });
    }

    if (action === "test") {
      const conn = await resolveCapiConnection(ctx.admin, ctx.workspaceId);

      // Evento de teste com telefone fictício: valida credencial e dataset sem
      // sujar os números — só aparece no Events Manager, nunca na campanha,
      // desde que o test_event_code esteja preenchido.
      const r = await enviarVendaLoja(conn, {
        eventId: `teste-${ctx.workspaceId}-${Date.now()}`,
        eventTime: Math.floor(Date.now() / 1000),
        valor: 1,
        telefone: "5541999999999",
        nome: "Teste Plataforma",
        produto: "Teste de configuração",
      });

      await ctx.admin.from("meta_capi_connections").update({
        status:     r.ok ? "active" : "error",
        last_error: r.ok ? null : (r.erro ?? "Falha no teste"),
        ...(r.ok ? { ultimo_evento_em: new Date().toISOString() } : {}),
      }).eq("id", conn.connectionId);

      return jsonResponse({
        ok: r.ok,
        erro: r.erro,
        events_received: r.eventsReceived,
        aviso: conn.testEventCode
          ? null
          : "Sem test_event_code preenchido, este evento de teste entra como dado real no dataset.",
      });
    }

    return jsonResponse({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return jsonResponse({ error: (err as Error).message ?? String(err) }, status);
  }
});

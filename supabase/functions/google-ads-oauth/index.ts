/**
 * google-ads-oauth — Edge Function (Deno)
 *
 * Fluxo de conexão da conta Google Ads do CLIENTE (multi-tenant), espelhando
 * o meta-oauth:
 *
 *   1. Frontend abre o consentimento do Google (scope adwords, access_type
 *      offline) e recebe o ?code= em /google/callback.
 *   2. Frontend chama { action: "exchange", code, redirect_uri }: trocamos o
 *      code por refresh_token, listamos as contas acessíveis e gravamos a
 *      conexão como pending_account.
 *   3. Frontend mostra as contas e chama { action: "select_account", ... }.
 *
 * Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
 *          GOOGLE_ADS_DEVELOPER_TOKEN.
 *
 * O refresh_token nunca é retornado ao frontend.
 */

import { resolveTenant, TenantError, jsonResponse, CORS_HEADERS } from "../_shared/tenant.ts";
import { exchangeCode } from "../_shared/google.ts";
import {
  listAccessibleCustomers,
  describeCustomer,
  accessTokenForConnection,
  normalizeCustomerId,
} from "../_shared/googleAds.ts";

interface ContaListada {
  customer_id: string;
  name: string;
  currency: string;
  manager: boolean;
  login_customer_id: string | null;
  erro?: string;
}

/**
 * Descreve cada conta acessível. Contas sob uma MCC só respondem com o header
 * login-customer-id apontando para a administradora — por isso, quando a
 * consulta direta falha, tentamos de novo através de cada MCC da lista.
 */
async function listarContas(accessToken: string): Promise<ContaListada[]> {
  const ids = await listAccessibleCustomers(accessToken);

  const diretas = await Promise.all(ids.map(async (id): Promise<ContaListada> => {
    try {
      const info = await describeCustomer(id, accessToken);
      return { ...info, login_customer_id: null };
    } catch (err) {
      return {
        customer_id: id, name: `Conta ${id}`, currency: "", manager: false,
        login_customer_id: null, erro: String(err),
      };
    }
  }));

  const mccs = diretas.filter((c) => c.manager && !c.erro).map((c) => c.customer_id);
  if (!mccs.length) return diretas;

  // Contas-filha das MCCs: aparecem na lista com nome resolvido via login-customer-id.
  const filhas = new Map<string, ContaListada>();
  for (const mcc of mccs) {
    for (const c of diretas) {
      if (!c.erro || filhas.has(c.customer_id)) continue;
      try {
        const info = await describeCustomer(c.customer_id, accessToken, mcc);
        filhas.set(c.customer_id, { ...info, login_customer_id: mcc });
      } catch { /* essa MCC não dá acesso a essa conta — tenta a próxima */ }
    }
  }

  return diretas.map((c) => filhas.get(c.customer_id) ?? c);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    if (!Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || !Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")) {
      return jsonResponse(
        { error: "Secrets GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET não configurados." },
        500,
      );
    }

    const ctx = await resolveTenant(req);

    let body: {
      action?: string;
      code?: string;
      redirect_uri?: string;
      customer_id?: string;
      customer_name?: string;
      login_customer_id?: string | null;
    } = {};
    try { body = await req.json(); } catch { /* body vazio */ }

    // ── exchange: code OAuth → refresh_token + lista de contas ────────────
    if (body.action === "exchange") {
      if (!body.code || !body.redirect_uri) {
        return jsonResponse({ error: "code e redirect_uri são obrigatórios." }, 400);
      }

      const tokens = await exchangeCode(body.code, body.redirect_uri);
      if (!tokens.refresh_token) {
        // Sem prompt=consent o Google reusa a autorização e omite o refresh_token.
        return jsonResponse({
          error: "O Google não devolveu refresh_token. Remova o acesso do app em " +
                 "myaccount.google.com/permissions e conecte novamente.",
        }, 409);
      }

      // Quem autorizou (só para exibir na tela de Conexões).
      let email: string | null = null;
      try {
        const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (r.ok) email = (await r.json()).email ?? null;
      } catch { /* opcional */ }

      const nowIso = new Date().toISOString();
      const { data: conn, error: connErr } = await ctx.admin
        .from("google_connections")
        .upsert({
          workspace_id: ctx.workspaceId,
          google_email: email,
          status:       "pending_account",
          last_error:   null,
          connected_by: ctx.userId,
          updated_at:   nowIso,
        }, { onConflict: "workspace_id" })
        .select("id")
        .single();
      if (connErr) throw new Error(connErr.message);

      const { error: secErr } = await ctx.admin
        .from("google_connection_secrets")
        .upsert({
          connection_id:    conn.id,
          refresh_token:    tokens.refresh_token,
          access_token:     tokens.access_token,
          token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
          updated_at:       nowIso,
        }, { onConflict: "connection_id" });
      if (secErr) throw new Error(secErr.message);

      return jsonResponse({
        google_email: email,
        accounts:     await listarContas(tokens.access_token),
      });
    }

    // ── list_accounts: re-lista com o token já salvo ──────────────────────
    if (body.action === "list_accounts") {
      const { data: conn } = await ctx.admin
        .from("google_connections")
        .select("id, google_email")
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle();
      if (!conn) return jsonResponse({ error: "Nenhuma conexão Google iniciada." }, 404);

      const accessToken = await accessTokenForConnection(ctx.admin, conn.id);
      return jsonResponse({
        google_email: conn.google_email,
        accounts:     await listarContas(accessToken),
      });
    }

    // ── select_account: define a conta Google Ads do workspace ────────────
    if (body.action === "select_account") {
      if (!body.customer_id) {
        return jsonResponse({ error: "customer_id é obrigatório." }, 400);
      }
      const customerId = normalizeCustomerId(body.customer_id);

      // Trocou de conta? Limpa as métricas da anterior — sem isso os números
      // das duas contas se somam no dashboard (mesma regra do meta-oauth).
      const { data: prev } = await ctx.admin
        .from("google_connections")
        .select("customer_id")
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle();

      if (prev?.customer_id && prev.customer_id !== customerId) {
        const { error: delErr } = await ctx.admin
          .from("google_ads_cache")
          .delete()
          .eq("workspace_id", ctx.workspaceId);
        if (delErr) throw new Error(`Falha ao limpar google_ads_cache: ${delErr.message}`);
      }

      const { error } = await ctx.admin
        .from("google_connections")
        .update({
          customer_id:       customerId,
          customer_name:     body.customer_name ?? null,
          login_customer_id: body.login_customer_id ? normalizeCustomerId(body.login_customer_id) : null,
          status:            "active",
          last_error:        null,
          updated_at:        new Date().toISOString(),
        })
        .eq("workspace_id", ctx.workspaceId);
      if (error) throw new Error(error.message);

      return jsonResponse({ ok: true });
    }

    // ── disconnect: remove conexão + tokens ───────────────────────────────
    if (body.action === "disconnect") {
      const { error } = await ctx.admin
        .from("google_connections")
        .delete()
        .eq("workspace_id", ctx.workspaceId);
      if (error) throw new Error(error.message);

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: `action desconhecida: ${body.action}` }, 400);
  } catch (err) {
    if (err instanceof TenantError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: String(err) }, 500);
  }
});

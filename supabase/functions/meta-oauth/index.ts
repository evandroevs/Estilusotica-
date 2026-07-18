/**
 * meta-oauth — Edge Function (Deno)
 *
 * Fluxo de conexão da conta Meta Ads do CLIENTE (multi-tenant):
 *
 *   1. Frontend redireciona para o dialog OAuth do Facebook
 *      (client_id público VITE_META_APP_ID, scope ads_read).
 *   2. Facebook devolve ?code= no /meta/callback do frontend.
 *   3. Frontend chama esta function com { action: "exchange", code, redirect_uri }:
 *      troca o code por token curto → token longo (~60 dias), busca as contas
 *      de anúncio do usuário e grava conexão + token (meta_connection_secrets).
 *   4. Frontend mostra as contas e chama { action: "select_account", ... }.
 *
 * Secrets necessários (Supabase → Edge Functions → Secrets):
 *   META_APP_ID      — App ID do app Meta do SaaS
 *   META_APP_SECRET  — App Secret (NUNCA no frontend)
 *
 * O token de acesso nunca é retornado ao frontend.
 */

import {
  resolveTenant,
  TenantError,
  jsonResponse,
  CORS_HEADERS,
} from "../_shared/tenant.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

interface AdAccount {
  account_id: string;
  name: string;
  account_status: number;
  currency: string;
}

async function graphGet(path: string, params: Record<string, string>) {
  const url = `${GRAPH}${path}?${new URLSearchParams(params)}`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    throw new Error(data.error?.message ?? `Meta API ${resp.status}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const APP_ID     = Deno.env.get("META_APP_ID");
    const APP_SECRET = Deno.env.get("META_APP_SECRET");
    if (!APP_ID || !APP_SECRET) {
      return jsonResponse(
        { error: "Secrets META_APP_ID e META_APP_SECRET não configurados." },
        500,
      );
    }

    const ctx = await resolveTenant(req);

    let body: {
      action?: string;
      code?: string;
      redirect_uri?: string;
      account_id?: string;
      account_name?: string;
    } = {};
    try { body = await req.json(); } catch { /* body vazio */ }

    // ── exchange: code OAuth → token longo + lista de contas ──────────────
    if (body.action === "exchange") {
      if (!body.code || !body.redirect_uri) {
        return jsonResponse({ error: "code e redirect_uri são obrigatórios." }, 400);
      }

      // 1. code → token curto (o redirect_uri precisa ser idêntico ao do dialog)
      const short = await graphGet("/oauth/access_token", {
        client_id:     APP_ID,
        client_secret: APP_SECRET,
        redirect_uri:  body.redirect_uri,
        code:          body.code,
      });

      // 2. token curto → token longo (~60 dias)
      const long = await graphGet("/oauth/access_token", {
        grant_type:        "fb_exchange_token",
        client_id:         APP_ID,
        client_secret:     APP_SECRET,
        fb_exchange_token: short.access_token,
      });

      const accessToken = long.access_token as string;
      const expiresAt = long.expires_in
        ? new Date(Date.now() + long.expires_in * 1000).toISOString()
        : null;

      // 3. Quem é o usuário Meta + quais contas de anúncio ele acessa
      const me = await graphGet("/me", {
        fields: "id,name",
        access_token: accessToken,
      });

      const accounts: AdAccount[] = [];
      let next: string | null =
        `${GRAPH}/me/adaccounts?${new URLSearchParams({
          fields: "account_id,name,account_status,currency",
          limit: "100",
          access_token: accessToken,
        })}`;
      while (next) {
        const resp = await fetch(next);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error) {
          throw new Error(data.error?.message ?? `Meta API ${resp.status}`);
        }
        accounts.push(...(data.data ?? []));
        next = data.paging?.next ?? null;
      }

      // 4. Upsert conexão do workspace + token (secrets: só service_role lê).
      // account_id anterior é PRESERVADO — select_account compara com o novo
      // para decidir se limpa os dados sincronizados da conta antiga.
      const nowIso = new Date().toISOString();
      const { data: conn, error: connErr } = await ctx.admin
        .from("meta_connections")
        .upsert({
          workspace_id: ctx.workspaceId,
          fb_user_id:   me.id,
          fb_user_name: me.name,
          status:       "pending_account",
          last_error:   null,
          connected_by: ctx.userId,
          updated_at:   nowIso,
        }, { onConflict: "workspace_id" })
        .select("id")
        .single();
      if (connErr) throw new Error(connErr.message);

      const { error: secErr } = await ctx.admin
        .from("meta_connection_secrets")
        .upsert({
          connection_id:    conn.id,
          access_token:     accessToken,
          token_expires_at: expiresAt,
          updated_at:       nowIso,
        }, { onConflict: "connection_id" });
      if (secErr) throw new Error(secErr.message);

      // account_status 1 = ACTIVE
      return jsonResponse({
        fb_user_name: me.name,
        accounts: accounts.map((a) => ({
          account_id: a.account_id,
          name:       a.name,
          active:     a.account_status === 1,
          currency:   a.currency,
        })),
      });
    }

    // ── list_accounts: re-lista as contas com o token já salvo ────────────
    // (usado quando o usuário deu refresh entre o OAuth e a escolha da conta)
    if (body.action === "list_accounts") {
      const { data: conn } = await ctx.admin
        .from("meta_connections")
        .select("id, fb_user_name")
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle();
      if (!conn) return jsonResponse({ error: "Nenhuma conexão Meta iniciada." }, 404);

      const { data: secret } = await ctx.admin
        .from("meta_connection_secrets")
        .select("access_token")
        .eq("connection_id", conn.id)
        .maybeSingle();
      if (!secret?.access_token) {
        return jsonResponse({ error: "Conexão sem token — refaça o login com o Facebook." }, 409);
      }

      const accounts: AdAccount[] = [];
      let next: string | null =
        `${GRAPH}/me/adaccounts?${new URLSearchParams({
          fields: "account_id,name,account_status,currency",
          limit: "100",
          access_token: secret.access_token,
        })}`;
      while (next) {
        const resp = await fetch(next);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error) {
          throw new Error(data.error?.message ?? `Meta API ${resp.status}`);
        }
        accounts.push(...(data.data ?? []));
        next = data.paging?.next ?? null;
      }

      return jsonResponse({
        fb_user_name: conn.fb_user_name,
        accounts: accounts.map((a) => ({
          account_id: a.account_id,
          name:       a.name,
          active:     a.account_status === 1,
          currency:   a.currency,
        })),
      });
    }

    // ── select_account: define a conta de anúncios do workspace ───────────
    if (body.action === "select_account") {
      if (!body.account_id) {
        return jsonResponse({ error: "account_id é obrigatório." }, 400);
      }

      // Trocou de conta de anúncios? Limpa as métricas da conta anterior —
      // sem isso os anúncios das duas contas se misturam no dashboard.
      const { data: prev } = await ctx.admin
        .from("meta_connections")
        .select("account_id")
        .eq("workspace_id", ctx.workspaceId)
        .maybeSingle();

      if (prev?.account_id && prev.account_id !== body.account_id) {
        for (const table of ["meta_ads_daily", "meta_ads_cache", "meta_campaigns", "meta_ads_segments"]) {
          const { error: delErr } = await ctx.admin
            .from(table)
            .delete()
            .eq("workspace_id", ctx.workspaceId);
          if (delErr) throw new Error(`Falha ao limpar ${table}: ${delErr.message}`);
        }
      }

      const { error } = await ctx.admin
        .from("meta_connections")
        .update({
          account_id:   body.account_id,
          account_name: body.account_name ?? null,
          status:       "active",
          last_error:   null,
          updated_at:   new Date().toISOString(),
        })
        .eq("workspace_id", ctx.workspaceId);
      if (error) throw new Error(error.message);

      return jsonResponse({ ok: true });
    }

    // ── disconnect: remove conexão + token ────────────────────────────────
    if (body.action === "disconnect") {
      const { error } = await ctx.admin
        .from("meta_connections")
        .delete()
        .eq("workspace_id", ctx.workspaceId);
      if (error) throw new Error(error.message);

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: `action desconhecida: ${body.action}` }, 400);
  } catch (err) {
    if (err instanceof TenantError) {
      return jsonResponse({ error: err.message }, err.status);
    }
    return jsonResponse({ error: String(err) }, 500);
  }
});

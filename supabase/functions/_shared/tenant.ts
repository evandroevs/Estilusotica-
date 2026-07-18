/**
 * tenant.ts — resolução de workspace/conexão Meta a partir do JWT do usuário.
 *
 * Toda Edge Function multi-tenant começa por aqui: valida o JWT recebido no
 * header Authorization, descobre o workspace do usuário e (quando pedido)
 * carrega a conexão Meta ativa com o token guardado em meta_connection_secrets.
 * O token NUNCA volta na resposta — só é usado dentro das functions.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface TenantContext {
  admin: SupabaseClient;         // client service_role (ignora RLS)
  userId: string;
  workspaceId: string;
}

export interface MetaConnectionContext extends TenantContext {
  connectionId: string;
  accountId: string;             // ID numérico da conta (sem "act_")
  accessToken: string;
}

export class TenantError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** Valida o JWT e resolve o workspace do usuário. */
export async function resolveTenant(req: Request): Promise<TenantContext> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new TenantError("Não autenticado.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) throw new TenantError("Sessão inválida.");

  const userId = userData.user.id;

  const { data: member, error: memberErr } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (memberErr) throw new TenantError(memberErr.message, 500);
  if (!member)   throw new TenantError("Usuário sem workspace.", 403);

  return { admin, userId, workspaceId: member.workspace_id };
}

/** resolveTenant + conexão Meta ativa do workspace (com token). */
export async function resolveMetaConnection(req: Request): Promise<MetaConnectionContext> {
  const ctx = await resolveTenant(req);

  const { data: conn, error: connErr } = await ctx.admin
    .from("meta_connections")
    .select("id, account_id, status")
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();

  if (connErr) throw new TenantError(connErr.message, 500);
  if (!conn || conn.status !== "active" || !conn.account_id) {
    throw new TenantError("Nenhuma conta Meta conectada neste workspace.", 409);
  }

  const { data: secret, error: secErr } = await ctx.admin
    .from("meta_connection_secrets")
    .select("access_token, token_expires_at")
    .eq("connection_id", conn.id)
    .maybeSingle();

  if (secErr) throw new TenantError(secErr.message, 500);
  if (!secret?.access_token) {
    throw new TenantError("Conexão Meta sem token — reconecte a conta.", 409);
  }

  if (secret.token_expires_at && new Date(secret.token_expires_at) < new Date()) {
    await ctx.admin
      .from("meta_connections")
      .update({ status: "error", last_error: "Token expirado — reconecte a conta.", updated_at: new Date().toISOString() })
      .eq("id", conn.id);
    throw new TenantError("Token da Meta expirado — reconecte a conta.", 409);
  }

  return {
    ...ctx,
    connectionId: conn.id,
    accountId: conn.account_id,
    accessToken: secret.access_token,
  };
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

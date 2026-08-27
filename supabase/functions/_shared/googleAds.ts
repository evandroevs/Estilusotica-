/**
 * googleAds.ts — cliente REST da Google Ads API + resolução da conexão do workspace.
 *
 * Complementa _shared/google.ts (que cuida do OAuth genérico do Google) com o
 * que é específico de Ads: header developer-token, login-customer-id da MCC,
 * consultas GAQL e a renovação/cache do access_token por conexão.
 *
 * Secrets necessários (Supabase → Edge Functions → Secrets):
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET — app OAuth do Google Cloud
 *   GOOGLE_ADS_DEVELOPER_TOKEN                          — API Center da conta MCC
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { refreshAccessToken } from "./google.ts";
import { resolveTenant, TenantError, type TenantContext } from "./tenant.ts";

/** Versão da Google Ads API. Bump aqui quando for migrar de versão. */
export const ADS_API_VERSION = "v25";
const ADS_BASE = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

/** Escopo OAuth do Google Ads (diferente do escopo do GA4). */
export const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

export interface GoogleAdsConnection extends TenantContext {
  connectionId: string;
  customerId: string;             // só dígitos
  loginCustomerId: string | null; // MCC pai, quando houver
  accessToken: string;
}

/** Remove hífens/espaços do customer id ("554-972-2788" → "5549722788"). */
export function normalizeCustomerId(id: string): string {
  return id.replace(/\D/g, "");
}

function developerToken(): string {
  const token = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!token) {
    throw new TenantError(
      "Secret GOOGLE_ADS_DEVELOPER_TOKEN não configurado no Supabase.",
      500,
    );
  }
  return token;
}

function adsHeaders(accessToken: string, loginCustomerId?: string | null) {
  const h: Record<string, string> = {
    "Authorization":  `Bearer ${accessToken}`,
    "developer-token": developerToken(),
    "Content-Type":   "application/json",
  };
  // Só vai quando a conta é acessada através de uma administradora (MCC).
  if (loginCustomerId) h["login-customer-id"] = normalizeCustomerId(loginCustomerId);
  return h;
}

/** Mensagem de erro legível a partir do corpo de erro da Google Ads API. */
async function adsError(resp: Response): Promise<string> {
  const raw = await resp.text();
  try {
    const j = JSON.parse(raw);
    const err = Array.isArray(j) ? j[0]?.error : j.error;
    const detail = err?.details?.[0]?.errors?.[0];
    return detail?.message ?? err?.message ?? `Google Ads API ${resp.status}: ${raw.slice(0, 300)}`;
  } catch {
    return `Google Ads API ${resp.status}: ${raw.slice(0, 300)}`;
  }
}

/** Contas Google Ads que o usuário autorizado consegue acessar. */
export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const resp = await fetch(`${ADS_BASE}/customers:listAccessibleCustomers`, {
    headers: adsHeaders(accessToken),
  });
  if (!resp.ok) throw new Error(await adsError(resp));
  const json = await resp.json();
  // ["customers/5549722788", ...] → ["5549722788", ...]
  return (json.resourceNames ?? []).map((r: string) => r.split("/")[1]);
}

/**
 * Executa uma consulta GAQL e devolve todas as linhas.
 * searchStream responde um array de chunks, cada um com `results`.
 */
export async function gaqlSearch(
  customerId: string,
  accessToken: string,
  query: string,
  loginCustomerId?: string | null,
): Promise<Record<string, any>[]> {
  const resp = await fetch(
    `${ADS_BASE}/customers/${normalizeCustomerId(customerId)}/googleAds:searchStream`,
    {
      method:  "POST",
      headers: adsHeaders(accessToken, loginCustomerId),
      body:    JSON.stringify({ query }),
    },
  );
  if (!resp.ok) throw new Error(await adsError(resp));

  const chunks = await resp.json();
  const rows: Record<string, any>[] = [];
  for (const chunk of Array.isArray(chunks) ? chunks : [chunks]) {
    if (Array.isArray(chunk?.results)) rows.push(...chunk.results);
  }
  return rows;
}

/** Nome e moeda de uma conta (usado ao listar as contas na tela de Conexões). */
export async function describeCustomer(
  customerId: string,
  accessToken: string,
  loginCustomerId?: string | null,
): Promise<{ customer_id: string; name: string; currency: string; manager: boolean }> {
  const rows = await gaqlSearch(
    customerId,
    accessToken,
    `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager
       FROM customer
      LIMIT 1`,
    loginCustomerId,
  );
  const c = rows[0]?.customer ?? {};
  return {
    customer_id: normalizeCustomerId(String(c.id ?? customerId)),
    name:        c.descriptiveName ?? `Conta ${customerId}`,
    currency:    c.currencyCode ?? "",
    manager:     Boolean(c.manager),
  };
}

/**
 * access_token válido para uma conexão, renovando pelo refresh_token quando
 * necessário. O token dura ~1h; guardamos em cache para não renovar a cada
 * chamada, com 60s de folga antes do vencimento.
 */
export async function accessTokenForConnection(
  admin: SupabaseClient,
  connectionId: string,
): Promise<string> {
  const { data: secret, error } = await admin
    .from("google_connection_secrets")
    .select("refresh_token, access_token, token_expires_at")
    .eq("connection_id", connectionId)
    .maybeSingle();

  if (error) throw new TenantError(error.message, 500);
  if (!secret?.refresh_token) {
    throw new TenantError("Conexão Google sem refresh_token — reconecte a conta.", 409);
  }

  const folga = Date.now() + 60_000;
  if (secret.access_token && secret.token_expires_at &&
      new Date(secret.token_expires_at).getTime() > folga) {
    return secret.access_token;
  }

  const fresh = await refreshAccessToken(secret.refresh_token);
  await admin
    .from("google_connection_secrets")
    .update({
      access_token:     fresh,
      token_expires_at: new Date(Date.now() + 3_500_000).toISOString(), // ~58min
      updated_at:       new Date().toISOString(),
    })
    .eq("connection_id", connectionId);

  return fresh;
}

/** resolveTenant + conexão Google Ads ativa do workspace (com access_token pronto). */
export async function resolveGoogleConnection(req: Request): Promise<GoogleAdsConnection> {
  const ctx = await resolveTenant(req);

  const { data: conn, error } = await ctx.admin
    .from("google_connections")
    .select("id, customer_id, login_customer_id, status")
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();

  if (error) throw new TenantError(error.message, 500);
  if (!conn || conn.status !== "active" || !conn.customer_id) {
    throw new TenantError("Nenhuma conta Google Ads conectada neste workspace.", 409);
  }

  return {
    ...ctx,
    connectionId:    conn.id,
    customerId:      conn.customer_id,
    loginCustomerId: conn.login_customer_id,
    accessToken:     await accessTokenForConnection(ctx.admin, conn.id),
  };
}

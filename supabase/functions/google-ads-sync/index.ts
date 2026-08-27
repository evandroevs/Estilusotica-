/**
 * google-ads-sync — Edge Function (Deno) — MULTI-TENANT
 *
 * Busca métricas diárias por campanha na Google Ads API e faz upsert em
 * google_ads_cache. Substitui o preenchimento manual via Supermetrics.
 *
 * Dois modos de operação:
 *
 *   • Sob demanda — chamada do frontend com o JWT do usuário: sincroniza
 *     apenas o workspace dele (botão "Sincronizar agora").
 *
 *   • Em lote (cron) — chamada com o header x-cron-secret igual ao secret
 *     CRON_SECRET: percorre TODAS as conexões ativas. É assim que o cron
 *     diário (migration 0009) mantém os dados em dia sozinho.
 *
 * Body (JSON, opcional):
 *   { date_start: "YYYY-MM-DD", date_stop: "YYYY-MM-DD" }
 *   Sem datas, sincroniza os últimos 30 dias — janela que também recaptura
 *   conversões atribuídas com atraso pelo Google.
 *
 * Resposta:
 *   { synced, workspaces: [{ workspace_id, customer_id, rows, error? }] }
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resolveGoogleConnection, gaqlSearch, accessTokenForConnection } from "../_shared/googleAds.ts";
import { TenantError, jsonResponse, CORS_HEADERS } from "../_shared/tenant.ts";

const JANELA_PADRAO_DIAS = 30;

interface Alvo {
  connectionId: string;
  workspaceId: string;
  customerId: string;
  loginCustomerId: string | null;
}

interface Resultado {
  workspace_id: string;
  customer_id: string;
  rows: number;
  error?: string;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Janela padrão: dos últimos JANELA_PADRAO_DIAS dias até hoje. */
function janelaPadrao(): { date_start: string; date_stop: string } {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setUTCDate(inicio.getUTCDate() - (JANELA_PADRAO_DIAS - 1));
  return { date_start: ymd(inicio), date_stop: ymd(hoje) };
}

function validarData(s: string, campo: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new TenantError(`${campo} deve estar no formato YYYY-MM-DD.`, 400);
  }
}

/**
 * Sincroniza uma conexão. Devolve quantas linhas foram gravadas.
 * Erros da API viram last_error na conexão — o dashboard mostra o motivo
 * em vez de simplesmente parar de atualizar em silêncio.
 */
async function sincronizar(
  db: SupabaseClient,
  alvo: Alvo,
  accessToken: string,
  dateStart: string,
  dateStop: string,
): Promise<number> {
  // GAQL: uma linha por campanha por dia. As datas já vêm validadas.
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${dateStart}' AND '${dateStop}'
  `;

  const rows = await gaqlSearch(alvo.customerId, accessToken, query, alvo.loginCustomerId);

  const registros = rows.map((r) => ({
    workspace_id:     alvo.workspaceId,
    date:             r.segments?.date,
    account_id:       alvo.customerId,
    campaign_id:      String(r.campaign?.id ?? ""),
    campaign_name:    r.campaign?.name ?? "(sem nome)",
    impressions:      Number(r.metrics?.impressions ?? 0),
    clicks:           Number(r.metrics?.clicks ?? 0),
    // custo vem em micros (1 real = 1.000.000 micros)
    cost:             Number(r.metrics?.costMicros ?? 0) / 1_000_000,
    conversions:      Number(r.metrics?.conversions ?? 0),
    conversion_value: Number(r.metrics?.conversionsValue ?? 0),
    synced_at:        new Date().toISOString(),
  })).filter((r) => r.date && r.campaign_id);

  if (!registros.length) return 0;

  // Upsert em blocos: contas grandes passam do limite prático de payload.
  const BLOCO = 500;
  for (let i = 0; i < registros.length; i += BLOCO) {
    const { error } = await db
      .from("google_ads_cache")
      .upsert(registros.slice(i, i + BLOCO), {
        onConflict: "workspace_id,date,account_id,campaign_id",
      });
    if (error) throw new Error(error.message);
  }

  return registros.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: { date_start?: string; date_stop?: string } = {};
    try { body = await req.json(); } catch { /* body vazio = janela padrão */ }

    const padrao = janelaPadrao();
    const dateStart = body.date_start ?? padrao.date_start;
    const dateStop  = body.date_stop  ?? padrao.date_stop;
    validarData(dateStart, "date_start");
    validarData(dateStop, "date_stop");
    if (dateStart > dateStop) {
      return jsonResponse({ error: "date_start não pode ser depois de date_stop." }, 400);
    }

    const cronSecret = Deno.env.get("CRON_SECRET");
    const ehCron = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;

    const alvos: Alvo[] = [];
    let db: SupabaseClient;

    if (ehCron) {
      // ── Modo lote: todas as conexões ativas ──
      db = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data, error } = await db
        .from("google_connections")
        .select("id, workspace_id, customer_id, login_customer_id")
        .eq("status", "active")
        .not("customer_id", "is", null);
      if (error) throw new Error(error.message);

      for (const c of data ?? []) {
        alvos.push({
          connectionId:    c.id,
          workspaceId:     c.workspace_id,
          customerId:      c.customer_id,
          loginCustomerId: c.login_customer_id,
        });
      }
    } else {
      // ── Modo sob demanda: só o workspace do usuário autenticado ──
      const ctx = await resolveGoogleConnection(req);
      db = ctx.admin;
      alvos.push({
        connectionId:    ctx.connectionId,
        workspaceId:     ctx.workspaceId,
        customerId:      ctx.customerId,
        loginCustomerId: ctx.loginCustomerId,
      });
    }

    const resultados: Resultado[] = [];
    let total = 0;

    for (const alvo of alvos) {
      const base = { workspace_id: alvo.workspaceId, customer_id: alvo.customerId };
      try {
        const accessToken = await accessTokenForConnection(db, alvo.connectionId);
        const rows = await sincronizar(db, alvo, accessToken, dateStart, dateStop);
        total += rows;
        resultados.push({ ...base, rows });

        await db
          .from("google_connections")
          .update({
            status:         "active",
            last_error:     null,
            last_synced_at: new Date().toISOString(),
            updated_at:     new Date().toISOString(),
          })
          .eq("id", alvo.connectionId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resultados.push({ ...base, rows: 0, error: msg });

        await db
          .from("google_connections")
          .update({ status: "error", last_error: msg, updated_at: new Date().toISOString() })
          .eq("id", alvo.connectionId);

        // No modo lote um cliente com token revogado não pode derrubar os demais.
        if (!ehCron) throw err;
      }
    }

    return jsonResponse({ synced: total, workspaces: resultados });
  } catch (err) {
    if (err instanceof TenantError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: String(err) }, 500);
  }
});

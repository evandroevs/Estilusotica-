/**
 * google-ads-webhook — recebe os números do Google Ads sem passar pela API.
 *
 * A integração oficial (google-ads-oauth/google-ads-sync) depende de um
 * developer token que o Google ainda não liberou. Enquanto isso, um **Google
 * Ads Script** roda dentro da própria conta, uma vez por dia, e posta os
 * dados aqui. Script não precisa de token nem de aprovação: ele já roda
 * autenticado como a conta.
 *
 *   POST /functions/v1/google-ads-webhook
 *   Header:  x-webhook-secret: <GOOGLE_ADS_WEBHOOK_SECRET>
 *   Body:    {
 *     "account_id": "5549722788",
 *     "rows": [{
 *       "date": "2026-10-26",
 *       "campaign_id": "23960641839",
 *       "campaign_name": "Estílus Ótica - Search",
 *       "impressions": 215, "clicks": 10, "cost": 25.19,
 *       "conversions": 2, "conversion_value": 2
 *     }]
 *   }
 *
 * Reenviar o mesmo dia é esperado e seguro: a chave única
 * (workspace, date, account, campaign) faz o upsert sobrescrever. Por isso o
 * script manda sempre uma janela de dias, não só ontem — conversão no Google
 * é retroativa, e o número de ontem muda depois.
 *
 * Sem JWT (quem chama é o Google): deployar com --no-verify-jwt.
 * A autenticidade vem do secret no header.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
};

interface Linha {
  date?: string;
  campaign_id?: string | number;
  campaign_name?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  conversions?: number;
  conversion_value?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SECRET = Deno.env.get("GOOGLE_ADS_WEBHOOK_SECRET");
  if (!SECRET) return json({ error: "GOOGLE_ADS_WEBHOOK_SECRET não configurado." }, 500);
  if (req.headers.get("x-webhook-secret") !== SECRET) {
    return json({ error: "Não autorizado." }, 401);
  }

  let body: { account_id?: string; rows?: Linha[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON inválido." }, 400);
  }

  // Só dígitos: o Google escreve 554-972-2788 na interface e 5549722788 na API.
  const accountId = (body.account_id ?? "").replace(/\D/g, "");
  if (!accountId) return json({ error: "account_id é obrigatório." }, 400);
  if (!Array.isArray(body.rows) || !body.rows.length) {
    return json({ error: "rows vazio — nada para gravar." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Para quais lojas essa conta escreve ──
  // A mesma conta do Google alimenta mais de um workspace (as lojas estão
  // duplicadas). O vínculo já existe nas linhas gravadas antes, então é dele
  // que saímos — mesma regra que o seed manual usava.
  const { data: existentes, error: mapaErr } = await admin
    .from("google_ads_cache")
    .select("workspace_id")
    .eq("account_id", accountId);

  if (mapaErr) return json({ error: mapaErr.message }, 500);

  const workspaces = [...new Set((existentes ?? []).map((r) => r.workspace_id))];
  if (!workspaces.length) {
    return json({
      error: `Conta ${accountId} não está vinculada a nenhuma loja. ` +
             `Grave ao menos uma linha dessa conta no google_ads_cache para criar o vínculo.`,
    }, 409);
  }

  // ── Monta as linhas (uma por loja vinculada) ──
  const registros: Record<string, unknown>[] = [];
  const ignoradas: string[] = [];

  for (const r of body.rows) {
    const date = (r.date ?? "").slice(0, 10);
    const campaignId = String(r.campaign_id ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !campaignId) {
      ignoradas.push(`linha sem date/campaign_id válidos: ${JSON.stringify(r).slice(0, 80)}`);
      continue;
    }
    for (const workspace_id of workspaces) {
      registros.push({
        workspace_id,
        date,
        account_id:       accountId,
        campaign_id:      campaignId,
        campaign_name:    r.campaign_name ?? "(sem nome)",
        impressions:      Math.round(num(r.impressions)),
        clicks:           Math.round(num(r.clicks)),
        cost:             num(r.cost),
        conversions:      num(r.conversions),
        // A conta Select não exporta valor de conversão; o seed sempre usou o
        // número de conversões no lugar, e manter isso evita um degrau no gráfico.
        conversion_value: r.conversion_value == null ? num(r.conversions) : num(r.conversion_value),
        synced_at:        new Date().toISOString(),
      });
    }
  }

  if (!registros.length) return json({ error: "Nenhuma linha válida.", ignoradas }, 400);

  const { error: upErr } = await admin
    .from("google_ads_cache")
    .upsert(registros, { onConflict: "workspace_id,date,account_id,campaign_id" });

  if (upErr) return json({ error: upErr.message }, 500);

  const datas = [...new Set(registros.map((r) => r.date as string))].sort();
  return json({
    ok: true,
    account_id: accountId,
    lojas: workspaces.length,
    linhas: registros.length,
    periodo: { de: datas[0], ate: datas[datas.length - 1] },
    ...(ignoradas.length ? { ignoradas } : {}),
  });
});

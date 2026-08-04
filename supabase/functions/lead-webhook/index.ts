/**
 * lead-webhook — entrada automática de leads do WhatsApp na aba Trackeamento.
 *
 * Chamado por automações externas (WhatsApp Business webhook, n8n, Zapier…):
 *
 *   POST /functions/v1/lead-webhook
 *   Header:  x-webhook-secret: <LEAD_WEBHOOK_SECRET>
 *   Body:    {
 *     nome?: string, telefone?: string,
 *     origem?: "meta" | "google" | "outro",
 *     campanha?: string, anuncio?: string, vendedor?: string,
 *     loja?: "otica" | "select",     // OU workspace_id direto
 *     workspace_id?: string,
 *     iniciado_em?: string           // ISO; default now()
 *   }
 *
 * Sem JWT de usuário — autentica só pelo secret e escreve via service_role.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
};

// Dono padrão das lojas em produção (evita duplicar nos workspaces de teste)
const LEAD_OWNER_EMAIL = Deno.env.get("LEAD_OWNER_EMAIL") ?? "demo@estilusotica.com.br";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SECRET = Deno.env.get("LEAD_WEBHOOK_SECRET");
  if (!SECRET || req.headers.get("x-webhook-secret") !== SECRET) {
    return json({ error: "Não autorizado." }, 401);
  }

  let body: Record<string, string | undefined>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON inválido." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Resolver o workspace de destino ──
  let workspaceId = body.workspace_id ?? null;
  if (!workspaceId) {
    const alvo = (body.loja ?? "").toLowerCase();
    if (!["otica", "select"].includes(alvo)) {
      return json({ error: "Informe workspace_id ou loja ('otica' | 'select')." }, 400);
    }
    const padrao = alvo === "select" ? "%select%" : "%otica%";
    const { data: dono } = await admin
      .from("workspaces")
      .select("id, nome, owner_id")
      .ilike("nome", padrao);
    if (!dono?.length) return json({ error: `Nenhuma loja bate com '${alvo}'.` }, 404);

    // desempate: prefere a loja do dono padrão (produção)
    let escolhido = dono[0];
    if (dono.length > 1) {
      const { data: users } = await admin.auth.admin.listUsers();
      const ownerId = users?.users?.find((u) => u.email === LEAD_OWNER_EMAIL)?.id;
      escolhido = dono.find((w) => w.owner_id === ownerId) ?? dono[0];
    }
    // "select" casa com "%otica%"? não — mas "otica" casa com "Estilus Otica" e
    // também com nada de Select ("Estilus Select" não contém 'otica'). ok.
    workspaceId = escolhido.id;
  }

  const origem = ["meta", "google", "outro"].includes(body.origem ?? "")
    ? body.origem
    : "outro";

  const { data, error } = await admin
    .from("leads")
    .insert({
      workspace_id: workspaceId,
      nome:        body.nome?.trim() || "Sem nome",
      telefone:    body.telefone ?? null,
      origem,
      campanha:    body.campanha ?? null,
      anuncio:     body.anuncio ?? null,
      vendedor:    body.vendedor ?? null,
      iniciado_em: body.iniciado_em ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, lead_id: data.id });
});

/**
 * whatsapp-webhook — porta de entrada oficial do WhatsApp Business.
 *
 * É aqui que a atribuição nasce. Quando alguém clica num anúncio
 * click-to-WhatsApp e manda a primeira mensagem, a Meta inclui um bloco
 * `referral` com o **ctwa_clid** — o ID daquele clique. Guardamos ele no lead;
 * mais tarde, quando a venda for confirmada na loja, esse mesmo ctwa_clid volta
 * para a Meta via CAPI e fecha o ciclo anúncio → conversa → venda no balcão.
 *
 * Se o ctwa_clid se perde aqui, não tem como recuperar depois.
 *
 * Configuração no painel da Meta (App → WhatsApp → Configuration):
 *   Callback URL:  https://<projeto>.supabase.co/functions/v1/whatsapp-webhook
 *   Verify token:  o valor de WHATSAPP_VERIFY_TOKEN
 *   Campo assinado: `messages`
 *
 * Secrets necessários:
 *   WHATSAPP_VERIFY_TOKEN  — string qualquer, igual à do painel
 *   WHATSAPP_APP_SECRET    — App Secret do app da Meta (valida a assinatura)
 *
 * Esta função roda SEM JWT (a Meta não manda um) — precisa ser deployada com
 * `--no-verify-jwt`. A autenticidade vem da assinatura X-Hub-Signature-256.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hub-signature-256",
};

/** Janela para considerar que a mensagem faz parte de um atendimento em curso. */
const JANELA_ATENDIMENTO_DIAS = 30;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Confere o X-Hub-Signature-256 contra o corpo cru, em tempo constante. */
async function assinaturaValida(corpoCru: string, cabecalho: string | null, segredo: string): Promise<boolean> {
  if (!cabecalho?.startsWith("sha256=")) return false;

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpoCru));
  const esperado = Array.from(new Uint8Array(assinado))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const recebido = cabecalho.slice("sha256=".length);
  if (recebido.length !== esperado.length) return false;

  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return diff === 0;
}

/** "5541999123456" → "(41) 99912-3456" para a tela do vendedor. */
function formatarTelefone(waId: string): string {
  const d = waId.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return waId;
}

interface Referral {
  ctwa_clid?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
  const APP_SECRET   = Deno.env.get("WHATSAPP_APP_SECRET");

  // ── Handshake de verificação (a Meta chama uma vez ao salvar a URL) ──
  if (req.method === "GET") {
    const url = new URL(req.url);
    const modo     = url.searchParams.get("hub.mode");
    const token    = url.searchParams.get("hub.verify_token");
    const desafio  = url.searchParams.get("hub.challenge");

    if (!VERIFY_TOKEN) return new Response("WHATSAPP_VERIFY_TOKEN não configurado", { status: 500 });
    if (modo === "subscribe" && token === VERIFY_TOKEN && desafio) {
      return new Response(desafio, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Verificação falhou", { status: 403 });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Autenticidade ──
  const corpoCru = await req.text();

  if (!APP_SECRET) return json({ error: "WHATSAPP_APP_SECRET não configurado." }, 500);
  if (!await assinaturaValida(corpoCru, req.headers.get("x-hub-signature-256"), APP_SECRET)) {
    return json({ error: "Assinatura inválida." }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(corpoCru);
  } catch {
    return json({ error: "Body JSON inválido." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let criados = 0;
  const ignorados: string[] = [];

  // deno-lint-ignore no-explicit-any
  for (const entry of ((payload as any).entry ?? []) as any[]) {
    for (const change of (entry.changes ?? [])) {
      const value = change.value ?? {};

      // Recibos de entrega/leitura não interessam — só mensagens de gente.
      const mensagens = value.messages ?? [];
      if (!mensagens.length) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) { ignorados.push("sem phone_number_id"); continue; }

      // ── Qual loja é este número? ──
      const { data: conn } = await admin
        .from("meta_capi_connections")
        .select("workspace_id")
        .eq("wa_phone_number_id", phoneNumberId)
        .maybeSingle();

      if (!conn?.workspace_id) {
        ignorados.push(`número ${phoneNumberId} não está ligado a nenhuma loja`);
        continue;
      }
      const workspaceId = conn.workspace_id;

      const contatos: Record<string, string> = {};
      for (const c of (value.contacts ?? [])) {
        if (c.wa_id) contatos[c.wa_id] = c.profile?.name ?? "";
      }

      for (const msg of mensagens) {
        const waMessageId: string | undefined = msg.id;
        const waId: string | undefined = msg.from;
        if (!waMessageId || !waId) continue;

        // Reentrega do mesmo webhook — a Meta reenvia quando não recebe 200.
        const { data: jaVisto } = await admin
          .from("leads").select("id").eq("wa_message_id", waMessageId).maybeSingle();
        if (jaVisto) { ignorados.push("mensagem repetida"); continue; }

        const referral: Referral | undefined = msg.referral;
        const ctwaClid = referral?.ctwa_clid ?? null;
        const nome = contatos[waId]?.trim() || "Sem nome";
        const iniciadoEm = msg.timestamp
          ? new Date(Number(msg.timestamp) * 1000).toISOString()
          : new Date().toISOString();

        if (ctwaClid) {
          // Veio de anúncio. Este é o lead que vale ouro.
          const { data: mesmoClique } = await admin
            .from("leads").select("id").eq("ctwa_clid", ctwaClid).maybeSingle();
          if (mesmoClique) { ignorados.push("clique já registrado"); continue; }

          const { error } = await admin.from("leads").insert({
            workspace_id: workspaceId,
            nome,
            telefone:      formatarTelefone(waId),
            origem:        "meta",
            campanha:      referral?.headline ?? null,
            anuncio:       referral?.source_id ?? null,
            ctwa_clid:     ctwaClid,
            wa_message_id: waMessageId,
            iniciado_em:   iniciadoEm,
          });
          if (error) { ignorados.push(error.message); continue; }
          criados++;
          continue;
        }

        // Sem referral: ou é a continuação de uma conversa que já virou lead,
        // ou é alguém chamando por fora do anúncio. Só abre lead novo no
        // segundo caso — senão cada mensagem do cliente viraria um card.
        const desde = new Date(Date.now() - JANELA_ATENDIMENTO_DIAS * 86400_000).toISOString();
        const { data: emCurso } = await admin
          .from("leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("telefone", formatarTelefone(waId))
          .gte("iniciado_em", desde)
          .limit(1);

        if (emCurso?.length) { ignorados.push("conversa já em atendimento"); continue; }

        const { error } = await admin.from("leads").insert({
          workspace_id: workspaceId,
          nome,
          telefone:      formatarTelefone(waId),
          origem:        "outro",
          wa_message_id: waMessageId,
          iniciado_em:   iniciadoEm,
        });
        if (error) { ignorados.push(error.message); continue; }
        criados++;
      }
    }
  }

  // Sempre 200: um erro nosso não pode fazer a Meta reenviar em loop.
  return json({ ok: true, criados, ignorados });
});

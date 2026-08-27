/**
 * metaCapi.ts — envio de vendas da loja física para a Meta (Conversions API).
 *
 * O caso de uso: o cliente clicou num anúncio click-to-WhatsApp, conversou e
 * foi comprar na loja. A Meta só descobre essa venda se a gente contar.
 *
 * O que faz a atribuição funcionar é o `ctwa_clid` — o ID daquele clique,
 * capturado pelo webhook do WhatsApp e guardado no lead. Com ele a Meta sabe
 * exatamente qual anúncio gerou a venda. Sem ele sobra o telefone hasheado,
 * que casa o cliente mas não o criativo.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const GRAPH_VERSION = "v21.0";

export interface CapiConnection {
  connectionId: string;
  datasetId: string;
  wabaId: string | null;
  testEventCode: string | null;
  accessToken: string;
}

export class CapiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ─── Normalização + hash (exigência da Meta para PII) ──────────────────── */

/** SHA-256 em hex minúsculo — formato que a Meta exige para dados pessoais. */
export async function sha256(valor: string): Promise<string> {
  const bytes = new TextEncoder().encode(valor);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Telefone no formato que a Meta espera: só dígitos, com código do país, sem "+".
 * Assume Brasil (55) quando o número vem sem código — que é o caso de tudo
 * que sai do WhatsApp das lojas.
 */
export function normalizarTelefone(bruto: string | null | undefined): string | null {
  let d = (bruto ?? "").replace(/\D/g, "");
  if (!d) return null;

  // 8 ou 9 dígitos = número solto sem DDD: não dá para inferir a região.
  if (d.length <= 9) return null;

  if (!d.startsWith("55")) d = "55" + d;

  // 55 + DDD(2) + 8 ou 9 dígitos
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

/** E-mail normalizado: minúsculo e sem espaços em volta. */
export function normalizarEmail(bruto: string | null | undefined): string | null {
  const e = (bruto ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** Primeiro/último nome separados e minúsculos, como a Meta pede. */
export function separarNome(bruto: string | null | undefined): { fn: string | null; ln: string | null } {
  const partes = (bruto ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!partes.length || partes[0] === "sem") return { fn: null, ln: null };
  return {
    fn: partes[0],
    ln: partes.length > 1 ? partes[partes.length - 1] : null,
  };
}

/* ─── Conexão da loja ───────────────────────────────────────────────────── */

/** Carrega dataset + token da CAPI configurados para a loja. */
export async function resolveCapiConnection(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<CapiConnection> {
  const { data: conn, error } = await admin
    .from("meta_capi_connections")
    .select("id, dataset_id, waba_id, test_event_code, status")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw new CapiError(error.message, 500);
  if (!conn?.dataset_id) {
    throw new CapiError(
      "Esta loja ainda não tem a Conversions API configurada (falta o dataset). Configure em Conexões.",
      409,
    );
  }

  const { data: secret, error: secErr } = await admin
    .from("meta_capi_secrets")
    .select("access_token")
    .eq("connection_id", conn.id)
    .maybeSingle();

  if (secErr) throw new CapiError(secErr.message, 500);
  if (!secret?.access_token) {
    throw new CapiError("Conexão da CAPI sem token — refaça a configuração em Conexões.", 409);
  }

  return {
    connectionId: conn.id,
    datasetId: conn.dataset_id,
    wabaId: conn.waba_id ?? null,
    testEventCode: conn.test_event_code ?? null,
    accessToken: secret.access_token,
  };
}

/* ─── Envio do evento ───────────────────────────────────────────────────── */

export interface VendaLoja {
  eventId: string;          // estável por lead → a Meta deduplica sozinha
  eventTime: number;        // unix em segundos
  valor: number;
  moeda?: string;
  ctwaClid?: string | null;
  telefone?: string | null;
  email?: string | null;
  nome?: string | null;
  produto?: string | null;
}

export interface ResultadoEnvio {
  ok: boolean;
  eventsReceived?: number;
  fbTraceId?: string;
  erro?: string;
  /** true quando o evento saiu com ctwa_clid (atribuição ao criativo). */
  atribuidoAoAnuncio: boolean;
}

/**
 * Manda um Purchase para o dataset da loja.
 *
 * Com ctwa_clid → action_source "business_messaging": a Meta liga a compra ao
 * anúncio exato. Sem ele → "physical_store", que ainda alimenta o otimizador
 * via telefone hasheado, mas não aponta o criativo.
 */
export async function enviarVendaLoja(
  conn: CapiConnection,
  venda: VendaLoja,
): Promise<ResultadoEnvio> {
  const atribuidoAoAnuncio = Boolean(venda.ctwaClid);

  const user_data: Record<string, unknown> = {};

  if (atribuidoAoAnuncio) {
    user_data.ctwa_clid = venda.ctwaClid;           // sem hash, é um click id
    if (conn.wabaId) user_data.whatsapp_business_account_id = conn.wabaId;
  }

  // PII sempre hasheada — melhora o match mesmo quando há ctwa_clid.
  const tel = normalizarTelefone(venda.telefone);
  if (tel) user_data.ph = [await sha256(tel)];

  const mail = normalizarEmail(venda.email);
  if (mail) user_data.em = [await sha256(mail)];

  const { fn, ln } = separarNome(venda.nome);
  if (fn) user_data.fn = [await sha256(fn)];
  if (ln) user_data.ln = [await sha256(ln)];

  if (!Object.keys(user_data).length) {
    return {
      ok: false,
      erro: "Venda sem nenhum dado de identificação (nem clique do anúncio, nem telefone) — a Meta não teria como casar.",
      atribuidoAoAnuncio: false,
    };
  }

  const evento: Record<string, unknown> = {
    event_name: "Purchase",
    event_time: venda.eventTime,
    event_id: venda.eventId,
    action_source: atribuidoAoAnuncio ? "business_messaging" : "physical_store",
    user_data,
    custom_data: {
      currency: venda.moeda ?? "BRL",
      value: Number(venda.valor.toFixed(2)),
      ...(venda.produto ? { content_name: venda.produto } : {}),
    },
  };

  if (atribuidoAoAnuncio) evento.messaging_channel = "whatsapp";

  const payload: Record<string, unknown> = { data: [evento] };
  if (conn.testEventCode) payload.test_event_code = conn.testEventCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${conn.datasetId}/events` +
    `?access_token=${encodeURIComponent(conn.accessToken)}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, erro: `Falha de rede ao falar com a Meta: ${(err as Error).message}`, atribuidoAoAnuncio };
  }

  const corpo = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const msg = corpo?.error?.error_user_msg ?? corpo?.error?.message ?? `HTTP ${resp.status}`;
    return { ok: false, erro: msg, fbTraceId: corpo?.error?.fbtrace_id, atribuidoAoAnuncio };
  }

  return {
    ok: true,
    eventsReceived: corpo?.events_received ?? 0,
    fbTraceId: corpo?.fbtrace_id,
    atribuidoAoAnuncio,
  };
}

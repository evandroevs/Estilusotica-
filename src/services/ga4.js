/**
 * ga4 — integração com a Google Analytics Data API (GA4) via Edge Functions.
 *
 * O fluxo OAuth roda num popup: abrimos o consentimento do Google, a página
 * /ga4/callback devolve o `code` por postMessage, e o trocamos por tokens na
 * Edge Function `ga4-oauth` (que guarda o refresh_token no Supabase).
 * Os relatórios passam pela Edge Function `ga4-data` — o client_secret e os
 * tokens nunca chegam ao frontend.
 */
import { supabase } from "../lib/supabase";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const redirectUri = () => `${window.location.origin}/ga4/callback`;

/** Invoca uma Edge Function autenticada e desembrulha erros. */
async function call(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw new Error(error.message ?? `Erro em ${fn}`);
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Abre o popup OAuth do Google e resolve com o authorization code. */
function openOAuthPopup() {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) { reject(new Error("VITE_GOOGLE_CLIENT_ID não configurado.")); return; }
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    const w = 500, h = 640;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(url, "ga4-oauth", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) { reject(new Error("Popup bloqueado — libere popups para este site.")); return; }

    function onMsg(e) {
      if (e.origin !== window.location.origin || !e.data || e.data.type !== "ga4-oauth") return;
      window.removeEventListener("message", onMsg);
      clearInterval(timer);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.code);
    }
    window.addEventListener("message", onMsg);
    const timer = setInterval(() => {
      if (popup.closed) { clearInterval(timer); window.removeEventListener("message", onMsg); reject(new Error("Janela fechada antes de concluir.")); }
    }, 500);
  });
}

/** 1) Conecta o Google Analytics: OAuth → troca o code → lista propriedades. */
export async function connectGoogleAnalytics() {
  const code = await openOAuthPopup();
  return call("ga4-oauth", { code, redirect_uri: redirectUri() }); // { properties }
}

/** Status da conexão atual ({ connected, property_id, property_name }). */
export function getGA4Status() { return call("ga4-data", { action: "status" }); }

/** 2) Propriedades GA4 disponíveis. */
export function getGA4Properties() { return call("ga4-data", { action: "properties" }); }

/** Seleciona a propriedade GA4 a usar. */
export function selectGA4Property(property_id) { return call("ga4-data", { action: "select", property_id }); }

const report = (action, params) => call("ga4-data", { action, params });

/** Métricas-resumo (totalUsers, sessions, conversions, revenue…). */
export const getOverviewMetrics = (params) => report("overview", params).then((d) => d.totals);
/** Série temporal por data. */
export const getTimeSeries = (params) => report("timeseries", params).then((d) => d.rows);
/** Origens de tráfego (source/medium). */
export const getTrafficSources = (params) => report("traffic", params).then((d) => d.rows);
/** Páginas de entrada. */
export const getLandingPages = (params) => report("landing", params).then((d) => d.rows);
/** Eventos. */
export const getEvents = (params) => report("events", params).then((d) => d.rows);
/** Dispositivos. */
export const getDevices = (params) => report("devices", params).then((d) => d.rows);
/** Países. */
export const getCountries = (params) => report("countries", params).then((d) => d.rows);
/** Vendas por estado do Brasil (region) — base do mapa coroplético. */
export const getSalesByState = (params) => report("regions", params).then((d) => d.rows);
/** Série diária por página (date × landingPage) — taxa de conversão por página. */
export const getLandingSeries = (params) => report("landingSeries", params).then((d) => d.rows);

/** Análise dos dados do GA4 com IA (Claude → Gemini). */
export function askGA4AI(prompt, contexto) {
  return call("ga4-ai", { prompt, contexto }); // { text, provider }
}

/** Gera uma apresentação (slides) dos insights do GA4. */
export function gerarApresentacao(contexto, prompt) {
  return call("ga4-slides", { contexto, prompt }); // { deck }
}

/**
 * useGoogleConnection — estado da conexão Google Ads do workspace.
 *
 * Lê google_connections (RLS: só o próprio workspace; o refresh_token fica em
 * google_connection_secrets, invisível ao frontend).
 *
 *   data === null                      → nunca conectou
 *   data.status === "pending_account"  → OAuth feito, falta escolher a conta
 *   data.status === "active"           → conectado (customer_id definido)
 *   data.status === "error"            → token revogado/erro — reconectar
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export function useGoogleConnection() {
  return useQuery({
    queryKey: ["google-connection"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("google_connections")
        .select("id, google_email, customer_id, customer_name, status, last_error, last_synced_at, updated_at")
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: 60 * 1000,
  });
}

/** Monta a URL do consentimento do Google e navega até ela. */
export function startGoogleAdsOAuth() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("VITE_GOOGLE_CLIENT_ID não configurado no .env.local");
  }

  const state = crypto.randomUUID();
  sessionStorage.setItem("google-ads-oauth-state", state);

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  `${window.location.origin}/google/callback`,
    state,
    response_type: "code",
    scope:         "https://www.googleapis.com/auth/adwords",
    // offline + consent: sem os dois o Google não devolve refresh_token
    // numa segunda autorização do mesmo usuário.
    access_type:   "offline",
    prompt:        "consent",
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

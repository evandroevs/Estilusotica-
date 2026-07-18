/**
 * useMetaConnection — estado da conexão Meta Ads do workspace.
 *
 * Lê meta_connections (RLS: só o próprio workspace; o token fica em
 * meta_connection_secrets, invisível ao frontend).
 *
 *   data === null                      → nunca conectou
 *   data.status === "pending_account"  → OAuth feito, falta escolher a conta
 *   data.status === "active"           → conectado (account_id definido)
 *   data.status === "error"            → token expirou/erro — reconectar
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export function useMetaConnection() {
  return useQuery({
    queryKey: ["meta-connection"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meta_connections")
        .select("id, fb_user_name, account_id, account_name, status, last_error, updated_at")
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: 60 * 1000,
  });
}

/** Monta a URL do dialog OAuth do Facebook e navega até ela. */
export function startMetaOAuth() {
  const appId = import.meta.env.VITE_META_APP_ID;
  if (!appId) {
    throw new Error("VITE_META_APP_ID não configurado no .env.local");
  }

  const state = crypto.randomUUID();
  sessionStorage.setItem("meta-oauth-state", state);

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  `${window.location.origin}/meta/callback`,
    state,
    response_type: "code",
    scope:         "ads_read,business_management",
  });

  window.location.href = `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

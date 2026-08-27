/**
 * Card de conexão do Google Ads — mesmo fluxo do card da Meta.
 *
 * "Conectar Google Ads" → consentimento do Google → /google/callback troca o
 * code pelo refresh_token (Edge Function google-ads-oauth) → volta para cá com
 * status pending_account → lista as contas → escolher uma ativa a conexão.
 *
 * A partir daí o cron diário (migration 0009) mantém o google_ads_cache
 * atualizado; o botão "Sincronizar agora" força uma atualização na hora.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plug, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Unplug, Megaphone,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useGoogleConnection, startGoogleAdsOAuth } from "../../hooks/useGoogleConnection";
import { useToast } from "../../context/ToastContext";

/** Formata 5549722788 → 554-972-2788 (padrão do Google Ads). */
function formatCustomerId(id) {
  if (!id || id.length !== 10) return id;
  return `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;
}

export default function GoogleAdsCard() {
  const { data: conn, isLoading } = useGoogleConnection();
  const qc = useQueryClient();
  const { addToast } = useToast();

  const [accounts, setAccounts]         = useState(null);
  const [loadingAccts, setLoadingAccts] = useState(false);
  const [selecting, setSelecting]       = useState(null);
  const [syncing, setSyncing]           = useState(false);
  const [error, setError]               = useState(null);

  // OAuth feito mas conta ainda não escolhida → busca a lista de contas
  useEffect(() => {
    if (conn?.status !== "pending_account" || accounts || loadingAccts) return;
    (async () => {
      setLoadingAccts(true);
      setError(null);
      try {
        const { data, error } = await supabase.functions.invoke("google-ads-oauth", {
          body: { action: "list_accounts" },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setAccounts(data.accounts ?? []);
      } catch (err) {
        setError(err?.message ?? String(err));
      } finally {
        setLoadingAccts(false);
      }
    })();
  }, [conn?.status, accounts, loadingAccts]);

  async function selectAccount(acct) {
    setSelecting(acct.customer_id);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("google-ads-oauth", {
        body: {
          action:            "select_account",
          customer_id:       acct.customer_id,
          customer_name:     acct.name,
          login_customer_id: acct.login_customer_id ?? null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await qc.invalidateQueries({ queryKey: ["google-connection"] });
      addToast("Conta conectada! Buscando os dados…", "success");
      await sync();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setSelecting(null);
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("google-ads-sync", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await qc.invalidateQueries({ queryKey: ["google-connection"] });
      await qc.invalidateQueries({ queryKey: ["google-ads"] });
      addToast(`${data?.synced ?? 0} registros sincronizados do Google Ads.`, "success");
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar a conta do Google Ads? Os dados já sincronizados continuam no dashboard.")) return;
    try {
      const { error } = await supabase.functions.invoke("google-ads-oauth", {
        body: { action: "disconnect" },
      });
      if (error) throw error;
      setAccounts(null);
      await qc.invalidateQueries({ queryKey: ["google-connection"] });
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }

  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-2xl flex justify-center">
        <Loader2 size={20} className="text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-2xl">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#4285F4]/15 border border-[#4285F4]/30 shrink-0">
          <Megaphone size={18} className="text-[#4285F4]" />
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-white font-semibold text-sm">Google Ads</h2>

          {/* ── Nunca conectou / erro ── */}
          {(!conn || conn.status === "error") && (
            <>
              <p className="text-xs text-gray-400 mt-1">
                {conn?.status === "error"
                  ? (conn.last_error ?? "A conexão falhou — reconecte sua conta.")
                  : "Conecte sua conta do Google Ads para o dashboard atualizar sozinho, todo dia."}
              </p>
              <button
                type="button"
                onClick={() => { try { startGoogleAdsOAuth(); } catch (err) { setError(err.message); } }}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent text-black text-xs font-bold px-4 py-2.5 hover:bg-accent-hover transition-colors"
              >
                <Plug size={14} />
                {conn?.status === "error" ? "Reconectar com o Google" : "Conectar Google Ads"}
              </button>
            </>
          )}

          {/* ── OAuth ok, falta escolher a conta ── */}
          {conn?.status === "pending_account" && (
            <>
              <p className="text-xs text-gray-400 mt-1">
                Login feito como <span className="text-white font-medium">{conn.google_email}</span>.
                Escolha a conta do Google Ads desta loja:
              </p>

              {loadingAccts && (
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-4">
                  <Loader2 size={13} className="animate-spin" /> Buscando suas contas…
                </div>
              )}

              {accounts && (
                <div className="mt-4 space-y-2">
                  {accounts.length === 0 && (
                    <p className="text-xs text-yellow-400">
                      Nenhuma conta do Google Ads encontrada neste login.
                    </p>
                  )}
                  {accounts.filter((a) => !a.manager).map((a) => (
                    <button
                      key={a.customer_id}
                      type="button"
                      disabled={selecting !== null}
                      onClick={() => selectAccount(a)}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-left hover:border-accent/50 transition-colors disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{a.name}</p>
                        <p className="text-[11px] text-gray-500">
                          {formatCustomerId(a.customer_id)}
                          {a.currency && ` · ${a.currency}`}
                          {a.login_customer_id && " · via administradora"}
                        </p>
                      </div>
                      {selecting === a.customer_id
                        ? <Loader2 size={14} className="text-accent animate-spin shrink-0" />
                        : <span className="text-[11px] text-accent font-semibold shrink-0">Usar esta conta</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Conectado ── */}
          {conn?.status === "active" && (
            <>
              <div className="flex items-center gap-1.5 mt-1">
                <CheckCircle2 size={13} className="text-accent" />
                <p className="text-xs text-gray-300">
                  Conectado a <span className="text-white font-medium">{conn.customer_name}</span>
                  <span className="text-gray-500"> ({formatCustomerId(conn.customer_id)})</span>
                </p>
              </div>
              <p className="text-[11px] text-gray-600 mt-1">
                {conn.last_synced_at
                  ? `Última sincronização: ${new Date(conn.last_synced_at).toLocaleString("pt-BR")} · atualiza sozinho todo dia às 6h20.`
                  : "Ainda não sincronizado — clique em Sincronizar agora."}
              </p>
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <button
                  type="button"
                  onClick={sync}
                  disabled={syncing}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-black text-xs font-bold px-3 py-2 hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {syncing ? "Sincronizando…" : "Sincronizar agora"}
                </button>
                <button
                  type="button"
                  onClick={() => { try { startGoogleAdsOAuth(); } catch (err) { setError(err.message); } }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 text-gray-300 text-xs font-semibold px-3 py-2 hover:text-white hover:border-gray-500 transition-colors"
                >
                  <RefreshCw size={12} /> Trocar conta
                </button>
                <button
                  type="button"
                  onClick={disconnect}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/60 text-red-400 text-xs font-semibold px-3 py-2 hover:border-red-700 transition-colors"
                >
                  <Unplug size={12} /> Desconectar
                </button>
              </div>
            </>
          )}

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400 mt-3">
              <AlertTriangle size={12} /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

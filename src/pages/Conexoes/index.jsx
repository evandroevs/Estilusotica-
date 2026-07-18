/**
 * Conexões — o cliente conecta a própria conta de Meta Ads.
 *
 * Fluxo: "Conectar Meta Ads" → dialog OAuth do Facebook → /meta/callback
 * troca o code pelo token (Edge Function meta-oauth) → volta para cá com
 * status pending_account → lista as contas de anúncio → escolher uma
 * ativa a conexão e libera o Dashboard.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plug, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Unplug, Facebook,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useMetaConnection, startMetaOAuth } from "../../hooks/useMetaConnection";
import { useToast } from "../../context/ToastContext";

function Card({ children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-2xl">
      {children}
    </div>
  );
}

export default function Conexoes() {
  const { data: conn, isLoading } = useMetaConnection();
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const toast    = useToast();

  const [accounts, setAccounts]         = useState(null);
  const [loadingAccts, setLoadingAccts] = useState(false);
  const [selecting, setSelecting]       = useState(null);
  const [error, setError]               = useState(null);

  // OAuth feito mas conta ainda não escolhida → busca a lista de contas
  useEffect(() => {
    if (conn?.status !== "pending_account" || accounts || loadingAccts) return;
    (async () => {
      setLoadingAccts(true);
      setError(null);
      try {
        const { data, error } = await supabase.functions.invoke("meta-oauth", {
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
    setSelecting(acct.account_id);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("meta-oauth", {
        body: {
          action:       "select_account",
          account_id:   acct.account_id,
          account_name: acct.name,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await qc.invalidateQueries({ queryKey: ["meta-connection"] });
      toast?.success?.("Conta conectada! Sincronizando seus dados…");
      navigate("/");
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setSelecting(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar a conta Meta? Os dados já sincronizados continuam no dashboard.")) return;
    try {
      const { error } = await supabase.functions.invoke("meta-oauth", {
        body: { action: "disconnect" },
      });
      if (error) throw error;
      setAccounts(null);
      await qc.invalidateQueries({ queryKey: ["meta-connection"] });
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={26} className="text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#1877F2]/15 border border-[#1877F2]/30 shrink-0">
            <Facebook size={18} className="text-[#1877F2]" />
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-white font-semibold text-sm">Meta Ads</h2>

            {/* ── Nunca conectou / erro ── */}
            {(!conn || conn.status === "error") && (
              <>
                <p className="text-xs text-gray-400 mt-1">
                  {conn?.status === "error"
                    ? (conn.last_error ?? "A conexão expirou — reconecte sua conta.")
                    : "Conecte sua conta de anúncios para ver as métricas dos seus criativos no dashboard."}
                </p>
                <button
                  type="button"
                  onClick={() => { try { startMetaOAuth(); } catch (err) { setError(err.message); } }}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent text-black text-xs font-bold px-4 py-2.5 hover:bg-accent-hover transition-colors"
                >
                  <Plug size={14} />
                  {conn?.status === "error" ? "Reconectar com o Facebook" : "Conectar Meta Ads"}
                </button>
              </>
            )}

            {/* ── OAuth ok, falta escolher a conta ── */}
            {conn?.status === "pending_account" && (
              <>
                <p className="text-xs text-gray-400 mt-1">
                  Login feito como <span className="text-white font-medium">{conn.fb_user_name}</span>.
                  Escolha a conta de anúncios que você quer analisar:
                </p>

                {loadingAccts && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-4">
                    <Loader2 size={13} className="animate-spin" /> Buscando suas contas de anúncio…
                  </div>
                )}

                {accounts && (
                  <div className="mt-4 space-y-2">
                    {accounts.length === 0 && (
                      <p className="text-xs text-yellow-400">
                        Nenhuma conta de anúncios encontrada neste perfil do Facebook.
                      </p>
                    )}
                    {accounts.map((a) => (
                      <button
                        key={a.account_id}
                        type="button"
                        disabled={selecting !== null}
                        onClick={() => selectAccount(a)}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-left hover:border-accent/50 transition-colors disabled:opacity-50"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{a.name}</p>
                          <p className="text-[11px] text-gray-500">
                            act_{a.account_id} · {a.currency}
                            {!a.active && " · inativa"}
                          </p>
                        </div>
                        {selecting === a.account_id
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
                    Conectado a <span className="text-white font-medium">{conn.account_name}</span>
                    <span className="text-gray-500"> (act_{conn.account_id})</span>
                    {conn.fb_user_name && <span className="text-gray-500"> · via {conn.fb_user_name}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => { try { startMetaOAuth(); } catch (err) { setError(err.message); } }}
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
      </Card>

      <Card>
        <h3 className="text-white font-semibold text-sm mb-1">Google (GA4 / Google Ads)</h3>
        <p className="text-xs text-gray-500">Em breve — a primeira versão conecta apenas Meta Ads.</p>
      </Card>
    </div>
  );
}

/**
 * /google/callback — retorno do consentimento OAuth do Google Ads.
 *
 * Valida o state anti-CSRF, troca o code pelo refresh_token (Edge Function
 * google-ads-oauth, que guarda o token no backend) e manda o usuário para
 * a página Conexões escolher a conta do Google Ads.
 *
 * Não confundir com /ga4/callback, que roda em popup e serve ao GA4.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function GoogleCallback() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const ranRef     = useRef(false);   // StrictMode monta 2× — o code só vale 1 troca
  const [error, setError] = useState(null);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      const code     = params.get("code");
      const state    = params.get("state");
      const googleErr = params.get("error_description") || params.get("error");

      if (googleErr) { setError(googleErr); return; }
      if (!code) { setError("Código OAuth ausente no retorno do Google."); return; }

      const expected = sessionStorage.getItem("google-ads-oauth-state");
      sessionStorage.removeItem("google-ads-oauth-state");
      if (expected && state !== expected) {
        setError("Validação de segurança falhou (state divergente). Tente conectar de novo.");
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("google-ads-oauth", {
          body: {
            action:       "exchange",
            code,
            redirect_uri: `${window.location.origin}/google/callback`,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        await qc.invalidateQueries({ queryKey: ["google-connection"] });
        navigate("/conexoes", { replace: true });
      } catch (err) {
        setError(err?.message ?? String(err));
      }
    })();
  }, [params, navigate, qc]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      {error ? (
        <div className="text-center max-w-md">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
          <p className="text-sm text-gray-300 mb-4">{error}</p>
          <button
            type="button"
            onClick={() => navigate("/conexoes")}
            className="rounded-lg bg-accent text-black text-xs font-bold px-4 py-2.5 hover:bg-accent-hover"
          >
            Voltar para Conexões
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <Loader2 size={18} className="text-accent animate-spin" />
          Conectando sua conta do Google Ads…
        </div>
      )}
    </div>
  );
}

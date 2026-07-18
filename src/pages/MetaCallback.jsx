/**
 * /meta/callback — retorno do dialog OAuth do Facebook.
 *
 * Valida o state anti-CSRF, troca o code pelo token (Edge Function
 * meta-oauth, que guarda o token no backend) e manda o usuário para
 * a página Conexões escolher a conta de anúncios.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function MetaCallback() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const ranRef     = useRef(false);   // StrictMode monta 2× — o code só vale 1 troca
  const [error, setError] = useState(null);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      const code  = params.get("code");
      const state = params.get("state");
      const fbErr = params.get("error_description") || params.get("error");

      if (fbErr) { setError(fbErr); return; }
      if (!code) { setError("Código OAuth ausente no retorno do Facebook."); return; }

      const expected = sessionStorage.getItem("meta-oauth-state");
      sessionStorage.removeItem("meta-oauth-state");
      if (expected && state !== expected) {
        setError("Validação de segurança falhou (state divergente). Tente conectar de novo.");
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("meta-oauth", {
          body: {
            action:       "exchange",
            code,
            redirect_uri: `${window.location.origin}/meta/callback`,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        await qc.invalidateQueries({ queryKey: ["meta-connection"] });
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
          Conectando sua conta Meta…
        </div>
      )}
    </div>
  );
}

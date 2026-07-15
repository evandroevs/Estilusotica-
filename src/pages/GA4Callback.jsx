/**
 * Página de callback do OAuth Google (popup). Lê o `code` da URL, devolve
 * para a janela que abriu via postMessage e fecha. Sem UI relevante.
 */
import { useEffect } from "react";

export default function GA4Callback() {
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const code = p.get("code");
    const error = p.get("error");
    const msg = { type: "ga4-oauth", code, error: error || (code ? null : "Sem code na resposta.") };
    try { window.opener?.postMessage(msg, window.location.origin); } catch { /* ignore */ }
    window.close();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-400 text-sm">
      Conectando ao Google Analytics… pode fechar esta janela.
    </div>
  );
}

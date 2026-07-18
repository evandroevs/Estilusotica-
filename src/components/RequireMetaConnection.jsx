/**
 * Gate das páginas de métricas: sem conexão Meta ativa, mostra o convite
 * para conectar em vez de disparar queries/sync que iriam falhar.
 */
import { Link } from "react-router-dom";
import { Loader2, Plug } from "lucide-react";
import { useMetaConnection } from "../hooks/useMetaConnection";

export default function RequireMetaConnection({ children }) {
  const { data: conn, isLoading } = useMetaConnection();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={26} className="text-accent animate-spin" />
      </div>
    );
  }

  if (conn?.status === "active") return children;

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center px-6">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 mb-5">
        <Plug size={24} className="text-accent" />
      </div>
      <h2 className="text-white font-semibold text-lg mb-2">
        Conecte sua conta Meta Ads
      </h2>
      <p className="text-sm text-gray-400 max-w-md mb-6">
        {conn?.status === "pending_account"
          ? "Falta escolher a conta de anúncios para começar a sincronizar suas métricas."
          : "Para ver o desempenho dos seus criativos, conecte a conta de anúncios da sua empresa. Leva menos de um minuto."}
      </p>
      <Link
        to="/conexoes"
        className="inline-flex items-center gap-2 rounded-lg bg-accent text-black text-sm font-bold px-5 py-3 hover:bg-accent-hover transition-colors"
      >
        <Plug size={15} />
        {conn?.status === "pending_account" ? "Escolher conta de anúncios" : "Conectar Meta Ads"}
      </Link>
    </div>
  );
}

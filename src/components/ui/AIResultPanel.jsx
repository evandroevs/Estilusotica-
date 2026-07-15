import { Loader2, AlertCircle, CheckCircle2, XCircle, Lightbulb, Zap, RotateCcw } from "lucide-react";

const MODE_LABELS = {
  analisar_anuncio: "Análise do Anúncio",
  ideias_hook:      "Novas Ideias de Hook",
  inspirar:         "Inspiração Criativa",
  resumo_campanha:  "Resumo da Campanha",
};

export function AIResultPanel({ mode, loading, result, error, onRetry }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-14 gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
            <Loader2 size={20} className="text-accent animate-spin" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-300">Analisando com IA…</p>
          <p className="text-xs text-gray-600 mt-1">{MODE_LABELS[mode] ?? mode}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <AlertCircle size={28} className="text-red-400" />
        <div>
          <p className="text-sm font-semibold text-red-400">Erro na análise</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto leading-relaxed">{error}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-xs font-medium text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors mt-1"
          >
            <RotateCcw size={11} />
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-4">

      {/* Diagnóstico */}
      <div className="rounded-xl bg-accent/5 border border-accent/15 p-4">
        <p className="text-[10px] font-bold tracking-widest text-accent/50 uppercase mb-1.5">
          ✦ {MODE_LABELS[mode] ?? "Análise"}
        </p>
        <p className="text-sm text-gray-200 leading-relaxed">{result.diagnostico}</p>
      </div>

      {/* Pontos fortes + fracos */}
      <div className="grid grid-cols-2 gap-3">

        <div className="rounded-xl bg-green-950/20 border border-green-900/30 p-3.5">
          <p className="text-[10px] font-bold text-green-500/60 uppercase tracking-wide mb-2.5">
            Pontos fortes
          </p>
          <ul className="space-y-2">
            {(result.pontos_fortes ?? []).map((p, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-300 leading-snug">
                <CheckCircle2 size={12} className="text-green-500 shrink-0 mt-0.5" />
                {p}
              </li>
            ))}
            {(!result.pontos_fortes?.length) && (
              <li className="text-xs text-gray-600 italic">—</li>
            )}
          </ul>
        </div>

        <div className="rounded-xl bg-red-950/15 border border-red-900/25 p-3.5">
          <p className="text-[10px] font-bold text-red-400/60 uppercase tracking-wide mb-2.5">
            Pontos fracos
          </p>
          <ul className="space-y-2">
            {(result.pontos_fracos ?? []).map((p, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-300 leading-snug">
                <XCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
                {p}
              </li>
            ))}
            {(!result.pontos_fracos?.length) && (
              <li className="text-xs text-gray-600 italic">—</li>
            )}
          </ul>
        </div>
      </div>

      {/* Sugestões de hook */}
      {result.sugestoes_hook?.length > 0 && (
        <div className="rounded-xl bg-gray-800/40 border border-gray-700/60 p-4">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-3">
            Sugestões de hook / próximos criativos
          </p>
          <ul className="space-y-2">
            {result.sugestoes_hook.map((h, i) => (
              <li key={i}
                className="flex gap-2 text-xs text-gray-300 bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-700 leading-snug">
                <Lightbulb size={11} className="text-accent shrink-0 mt-0.5" />
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Próxima ação */}
      {result.proxima_acao && (
        <div className="rounded-xl bg-blue-950/20 border border-blue-900/30 p-3.5 flex gap-3">
          <div className="w-7 h-7 rounded-lg bg-blue-900/40 flex items-center justify-center shrink-0">
            <Zap size={13} className="text-blue-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-blue-400/60 uppercase tracking-wide mb-1">
              Próxima ação
            </p>
            <p className="text-xs text-gray-200 leading-relaxed">{result.proxima_acao}</p>
          </div>
        </div>
      )}
    </div>
  );
}

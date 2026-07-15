/**
 * GA4IA — painel de análise dos dados do GA4 com IA (ao lado do mapa).
 * O contexto (totais, canais, páginas, estados) é montado no GA4.jsx e
 * passado por prop; o usuário pede análises/relatórios em texto livre.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Loader2, Send, FileText, TrendingUp, RotateCcw, Presentation } from "lucide-react";
import { useToast } from "../../context/ToastContext";
import { askGA4AI, gerarApresentacao } from "../../services/ga4";
import { openDeck } from "../../lib/slidesHtml";

const ATALHOS = [
  { label: "Visão geral", Icon: TrendingUp, prompt: "Faça uma análise geral do desempenho do período: o que está indo bem, o que preocupa e 3 ações prioritárias." },
  { label: "Relatório completo", Icon: FileText, prompt: "Monte um relatório executivo do período com destaques de canais de tráfego, páginas de entrada e vendas por estado, terminando com recomendações." },
  { label: "Onde escalar", Icon: Sparkles, prompt: "Com base nos canais, páginas e estados, onde devo investir mais e onde devo cortar? Justifique com os números." },
];

/* Renderizador markdown leve (títulos, bullets, negrito). */
function Markdown({ text }) {
  const lines = (text ?? "").split("\n");
  return (
    <div className="space-y-1.5 text-[13px] text-gray-300 leading-relaxed">
      {lines.map((ln, i) => {
        const l = ln.trimEnd();
        if (!l.trim()) return <div key={i} className="h-1" />;
        const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={j} className="text-white font-semibold">{p.slice(2, -2)}</strong>
            : <span key={j}>{p}</span>);
        if (/^#{1,6}\s/.test(l)) return <p key={i} className="text-sm font-bold text-white mt-2">{inline(l.replace(/^#{1,6}\s/, ""))}</p>;
        if (/^[-*]\s/.test(l)) return <p key={i} className="flex gap-1.5"><span className="text-accent">•</span><span>{inline(l.replace(/^[-*]\s/, ""))}</span></p>;
        if (/^\d+\.\s/.test(l)) return <p key={i} className="flex gap-1.5"><span className="text-accent font-semibold">{l.match(/^\d+/)[0]}.</span><span>{inline(l.replace(/^\d+\.\s/, ""))}</span></p>;
        return <p key={i}>{inline(l)}</p>;
      })}
    </div>
  );
}

export default function GA4IA({ contexto }) {
  const { addToast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [resposta, setResposta] = useState(null);

  const ask = useMutation({
    mutationFn: (p) => askGA4AI(p, contexto),
    onSuccess: (d) => setResposta(d),
    onError: (e) => setResposta({ text: `⚠ ${e.message}`, provider: null }),
  });

  const apresentar = useMutation({
    mutationFn: () => gerarApresentacao(contexto),
    onSuccess: (d) => {
      if (!d?.deck?.slides?.length) { addToast("Não consegui montar a apresentação.", "error"); return; }
      try { openDeck(d.deck); } catch (e) { addToast(e.message, "error"); }
    },
    onError: (e) => addToast(e.message, "error"),
  });

  function enviar(p) {
    const q = (p ?? prompt).trim();
    if (!q || ask.isPending) return;
    setResposta(null);
    ask.mutate(q);
  }

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 flex flex-col overflow-hidden h-full">
      <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center"><Sparkles size={12} className="text-accent" /></div>
        <h3 className="text-sm font-bold text-white">Análise com IA</h3>
        <button type="button" onClick={() => apresentar.mutate()} disabled={apresentar.isPending}
          title="Gerar apresentação (abre em nova aba, com opção de PDF)"
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-accent/40 bg-accent/10 text-[11px] font-semibold text-accent hover:bg-accent/20 transition-colors disabled:opacity-50">
          {apresentar.isPending ? <Loader2 size={11} className="animate-spin" /> : <Presentation size={11} />}
          Apresentação
        </button>
      </div>

      {/* Atalhos */}
      <div className="px-4 pt-3 flex flex-wrap gap-1.5">
        {ATALHOS.map(({ label, Icon, prompt: p }) => (
          <button key={label} type="button" onClick={() => enviar(p)} disabled={ask.isPending}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-[11px] font-semibold text-gray-300 hover:border-accent/40 hover:text-white transition-colors disabled:opacity-50">
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>

      {/* Resposta */}
      <div className="flex-1 overflow-y-auto px-5 py-3 min-h-[180px]">
        {ask.isPending ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-500">
            <Loader2 size={20} className="animate-spin text-accent" />
            <p className="text-xs">Consultando o GA4 e analisando…</p>
            <p className="text-[10px] text-gray-700">pode levar alguns segundos</p>
          </div>
        ) : resposta ? (
          <Markdown text={resposta.text} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-1 text-gray-600">
            <Sparkles size={22} className="text-gray-700" />
            <p className="text-xs">Peça análises ou relatórios — a IA consulta o GA4 ao vivo.</p>
            <p className="text-[11px] text-gray-700">Compare períodos, abra por dispositivo, cidade, dia… o que precisar.</p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-3">
        {resposta && !ask.isPending && (
          <button type="button" onClick={() => { setResposta(null); setPrompt(""); }}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 mb-2"><RotateCcw size={11} /> nova pergunta</button>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviar(); }}
            placeholder="Ex.: por que as vendas caíram no Sudeste? (Cmd+Enter envia)"
            rows={2}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder:text-gray-600"
          />
          <button type="button" onClick={() => enviar()} disabled={ask.isPending || !prompt.trim()}
            className="h-9 w-9 shrink-0 rounded-lg bg-accent text-black flex items-center justify-center hover:bg-accent-hover transition-colors disabled:opacity-40">
            {ask.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}

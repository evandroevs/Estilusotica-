/**
 * MapaVendasEstados — mapa coroplético do Brasil por estado (receita do GA4).
 *
 * Cor do mais claro (menor receita) ao accent lime (maior). Clicar num estado
 * abre o painel lateral com os números; sem seleção, mostra o total Brasil.
 * Topologia versionada localmente (src/assets/bra.topo.json) — sem CDN em runtime.
 *
 * @typedef {{ uf:string, estado:string, sessoes:number, conversoes:number, receita:number }} VendaEstado
 */
import { useMemo, useState, useRef, useEffect } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { scaleSequential } from "d3-scale";
import { feature } from "topojson-client";
import { MapPin } from "lucide-react";
import bra from "../assets/bra.topo.json";
import { normalizeEstado, UF_POR_ESTADO } from "../lib/normalizeUF";

const BRL = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);
const NUM = (v) => (v || 0).toLocaleString("pt-BR");
const PCT = (v) => (v == null || isNaN(v) ? "—" : v.toFixed(2).replace(".", ",") + "%");

// Interpolador claro → accent lime (#C8FF00)
const lerp = (t) => {
  const c0 = [52, 52, 60];      // #34343C (sem dado/quase zero)
  const c1 = [200, 255, 0];     // accent
  const ch = c0.map((a, i) => Math.round(a + (c1[i] - a) * t));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
};

const featureCollection = feature(bra, bra.objects.bra);

export default function MapaVendasEstados({ dados = [], receitaTotalConta = null, loading = false }) {
  const [selected, setSelected] = useState(null); // nome canônico do estado
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 560, h: 504 });

  // Responsivo: acompanha a largura do container, com teto p/ não ficar gigante
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.max(320, Math.min(600, e.contentRect.width));
      setSize({ w, h: Math.round(w * 0.9) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Indexa os dados por nome canônico do estado
  const porEstado = useMemo(() => {
    const m = new Map();
    for (const d of dados ?? []) {
      const nome = normalizeEstado(d.estado || d.uf);
      if (!nome) continue;
      const cur = m.get(nome) ?? { estado: nome, uf: UF_POR_ESTADO[nome], sessoes: 0, conversoes: 0, receita: 0 };
      cur.sessoes += +d.sessoes || 0;
      cur.conversoes += +d.conversoes || 0;
      cur.receita += +d.receita || 0;
      m.set(nome, cur);
    }
    return m;
  }, [dados]);

  const maxReceita = useMemo(() => Math.max(1, ...[...porEstado.values()].map((d) => d.receita)), [porEstado]);
  const colorScale = useMemo(() => scaleSequential([0, maxReceita], (t) => lerp(t)), [maxReceita]);

  // Ranking por receita
  const ranking = useMemo(
    () => [...porEstado.values()].filter((d) => d.receita > 0).sort((a, b) => b.receita - a.receita),
    [porEstado],
  );

  const totalBrasil = useMemo(() => {
    const t = [...porEstado.values()].reduce((a, d) => ({ sessoes: a.sessoes + d.sessoes, conversoes: a.conversoes + d.conversoes, receita: a.receita + d.receita }), { sessoes: 0, conversoes: 0, receita: 0 });
    return { ...t, estado: "Brasil" };
  }, [porEstado]);

  // % de receita sem região atribuída
  const semRegiao = receitaTotalConta != null && receitaTotalConta > totalBrasil.receita
    ? ((receitaTotalConta - totalBrasil.receita) / receitaTotalConta) * 100
    : null;

  // Projeção
  const { path } = useMemo(() => {
    const proj = geoMercator().fitSize([size.w, size.h], featureCollection);
    return { path: geoPath(proj) };
  }, [size]);

  const atual = selected ? (porEstado.get(selected) ?? { estado: selected, uf: UF_POR_ESTADO[selected], sessoes: 0, conversoes: 0, receita: 0 }) : totalBrasil;
  const rankPos = selected ? (ranking.findIndex((d) => d.estado === selected) + 1) : null;
  const taxa = atual.sessoes > 0 ? (atual.conversoes / atual.sessoes) * 100 : null;
  const part = totalBrasil.receita > 0 ? (atual.receita / totalBrasil.receita) * 100 : null;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
        <MapPin size={14} className="text-accent" />
        <h3 className="text-sm font-bold text-white">Vendas por estado</h3>
        <span className="text-[11px] text-gray-600 ml-auto">Clique num estado para ver os números</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
        {/* Mapa */}
        <div className="p-4">
          <div ref={wrapRef} className="w-full">
            {loading ? (
              <div className="flex items-center justify-center" style={{ height: size.h }}>
                <div className="w-6 h-6 rounded-full border-2 border-gray-700 border-t-accent animate-spin" />
              </div>
            ) : (
              <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} className="block mx-auto">
                {featureCollection.features.map((f) => {
                  const nome = f.properties.name;
                  const d = porEstado.get(nome);
                  const isSel = selected === nome;
                  const isHov = hover === nome;
                  const fill = d && d.receita > 0 ? colorScale(d.receita) : "#34343C";
                  return (
                    <path
                      key={nome}
                      d={path(f)}
                      fill={fill}
                      stroke={isSel ? "#C8FF00" : isHov ? "#9CA3AF" : "#0B0B0E"}
                      strokeWidth={isSel ? 2 : isHov ? 1.5 : 0.6}
                      style={{ cursor: "pointer", transition: "stroke 0.12s" }}
                      onMouseEnter={() => setHover(nome)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setSelected(isSel ? null : nome)}
                    >
                      <title>{nome}{d ? ` — ${BRL(d.receita)}` : " — sem dados"}</title>
                    </path>
                  );
                })}
              </svg>
            )}
          </div>

          {/* Legenda */}
          <div className="flex items-center gap-2 mt-2 px-1">
            <span className="text-[10px] text-gray-500">menos</span>
            <div className="flex-1 h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${lerp(0)}, ${lerp(0.5)}, ${lerp(1)})` }} />
            <span className="text-[10px] text-gray-500">mais receita</span>
          </div>
        </div>

        {/* Painel lateral */}
        <div className="border-t lg:border-t-0 lg:border-l border-gray-800 p-5 flex flex-col gap-4">
          <div>
            <p className="text-[11px] text-gray-500 uppercase tracking-wide">{selected ? "Estado" : "Total"}</p>
            <p className="text-lg font-bold text-white leading-tight">
              {selected ? `${atual.estado} (${atual.uf})` : "Brasil"}
            </p>
            {selected && (
              <button type="button" onClick={() => setSelected(null)} className="text-[11px] text-accent hover:underline mt-0.5">
                ← ver total Brasil
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            <Linha label="Receita" value={BRL(atual.receita)} strong />
            <Linha label="Conversões (vendas)" value={NUM(atual.conversoes)} />
            <Linha label="Sessões" value={NUM(atual.sessoes)} />
            <Linha label="Taxa de conversão" value={PCT(taxa)} />
            {selected ? (
              <>
                <Linha label="Ranking (receita)" value={rankPos > 0 ? `#${rankPos}` : "—"} />
                <Linha label="% da receita nacional" value={PCT(part)} />
              </>
            ) : (
              <Linha label="Estados com venda" value={NUM(ranking.length)} />
            )}
          </div>

          {!selected && semRegiao != null && (
            <p className="text-[11px] text-amber-400/80 leading-snug border-t border-gray-800 pt-3">
              {PCT(semRegiao)} da receita sem região atribuída (vendas server-side sem estado não aparecem no mapa).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Linha({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-bold text-accent" : "text-sm font-semibold text-gray-200"}`}>{value}</span>
    </div>
  );
}

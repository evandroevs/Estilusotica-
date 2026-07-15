/**
 * GA4 — sub-aba do Dashboard com dados reais da Google Analytics Data API.
 * Conecta via OAuth, seleciona a propriedade e mostra os relatórios.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Loader2, LogIn, Users, TrendingUp,
  MousePointerClick, DollarSign, Clock, Eye, Globe, Zap,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useToast } from "../../context/ToastContext";
import {
  connectGoogleAnalytics, getGA4Status, getGA4Properties, selectGA4Property,
  getOverviewMetrics, getTrafficSources, getLandingPages, getSalesByState, getLandingSeries,
} from "../../services/ga4";
import { aggregateChannels, GRUPO_COR } from "../../services/ga4Channels";
import MapaVendasEstados from "../../components/MapaVendasEstados";
import GA4IA from "./GA4IA";

const RANGES = [
  { v: "7daysAgo", label: "7 dias" },
  { v: "28daysAgo", label: "28 dias" },
  { v: "90daysAgo", label: "90 dias" },
];

const NUM = (v) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(v)));
const BRL = (v) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v));
const DUR = (s) => { if (!s) return "—"; const m = Math.floor(s / 60); return `${m}m ${Math.round(s % 60)}s`; };

// Páginas de entrada a acompanhar (na ordem em que aparecem na tabela).
// mode "contains" une todas as variações da URL (ex.: query strings diferentes).
const LANDING_TARGETS = [
  { id: "prod_lm", label: "/products/laranja-moro-cafe-verde-e-cromo-30-caps", short: "Laranja Moro", color: "#C8FF00", mode: "base" },
  { id: "tons",    label: "/pages/tons-clareador-de-pele", short: "Tons", color: "#A855F7", mode: "base" },
  { id: "jejoom",  label: "/pages/jejoom-denavita", short: "Jejoom", color: "#FB923C", mode: "base" },
  { id: "vinagre", label: "/pages/vinagre-maca-gomas", short: "Vinagre", color: "#4ADE80", mode: "base" },
];

/** Série diária da taxa de conversão de sessões (purchase) por página-alvo. */
function buildConvSeries(rows) {
  const byDate = new Map();
  const nativa = (rows ?? []).some((r) => "sessionConversionRate:purchase" in r);
  for (const r of rows ?? []) {
    const page = (r.landingPage || "").trim();
    const base = page.split("?")[0];
    const t = matchTarget(page, base);
    if (!t) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, {});
    const acc = byDate.get(r.date);
    const a = acc[t.id] ?? (acc[t.id] = { s: 0, cs: 0 });
    const sess = +r.sessions || 0;
    a.s += sess;
    a.cs += (nativa ? (+r["sessionConversionRate:purchase"] || 0) * sess : (+r.ecommercePurchases || 0));
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, acc]) => {
    const o = { dia: `${date.slice(6, 8)}/${date.slice(4, 6)}` };
    for (const t of LANDING_TARGETS) {
      const a = acc[t.id];
      o[t.id] = a && a.s > 0 ? +((a.cs / a.s) * 100).toFixed(2) : null;
    }
    return o;
  });
}

function matchTarget(page, base) {
  const p = page.toLowerCase();
  const b = base.toLowerCase();
  return LANDING_TARGETS.find((t) => {
    const key = t.label.toLowerCase();
    return t.mode === "contains" ? b.includes(key) || p.includes(key) : b === key || p === key;
  });
}

/** Agrega as linhas de landing pages só nas páginas-alvo (mantém a ordem da lista).
 *  Variações da mesma página (query strings) são somadas; a taxa de conversão
 *  vira a média ponderada (conversões totais ÷ sessões totais). */
function filterLandingTargets(rows) {
  const acc = new Map(LANDING_TARGETS.map((t) => [t.label, { page: t.label, sessions: 0, vendas: 0, purchaseRevenue: 0, convSessions: 0 }]));
  const nativa = (rows ?? []).some((r) => "sessionConversionRate:purchase" in r);
  for (const r of rows ?? []) {
    const page = (r.landingPage || r.landingPagePlusQueryString || "").trim();
    const base = page.split("?")[0];
    const t = matchTarget(page, base);
    if (!t) continue;
    const a = acc.get(t.label);
    const sess = +r.sessions || 0;
    a.sessions += sess;
    a.vendas += +r.ecommercePurchases || 0;
    a.purchaseRevenue += +r.purchaseRevenue || 0;
    // taxa nativa do GA4 (ratio 0-1) × sessões = sessões com compra; soma e pondera
    a.convSessions += (+r["sessionConversionRate:purchase"] || 0) * sess;
  }
  return [...acc.values()].map((a) => ({
    ...a,
    convRate: a.sessions <= 0 ? 0 : nativa ? (a.convSessions / a.sessions) * 100 : (a.vendas / a.sessions) * 100,
  }));
}

/* ─── Card de métrica ────────────────────────────────────────────────────── */

function Kpi({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + "22" }}>
          <Icon size={12} style={{ color }} />
        </div>
        <span className="text-[11px] text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-white leading-none">{value}</p>
    </div>
  );
}

/* ─── Tabela simples ─────────────────────────────────────────────────────── */

function Tabela({ title, Icon, rows, cols, loading, empty = "Sem dados no período." }) {
  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
        <Icon size={14} className="text-accent" />
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 size={18} className="animate-spin text-gray-600" /></div>
      ) : !(rows ?? []).length ? (
        <p className="p-6 text-xs text-gray-600 text-center">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr style={{ backgroundColor: "#2C2C33" }}>
                {cols.map((c) => (
                  <th key={c.key} className={`px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-gray-800 ${i % 2 ? "bg-gray-900/50" : ""}`}>
                  {cols.map((c) => (
                    <td key={c.key} className={`px-4 py-2.5 ${c.align === "right" ? "text-right tabular-nums text-gray-300" : "text-gray-200"}`}>
                      {c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Painel principal ───────────────────────────────────────────────────── */

export default function GA4() {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const [range, setRange] = useState("28daysAgo");
  const [linhaPagina, setLinhaPagina] = useState("all"); // filtro do gráfico de conversão por página
  const params = { startDate: range, endDate: "today" };

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["ga4-status"],
    queryFn: getGA4Status,
    staleTime: 1000 * 60,
  });
  const connected = status?.connected;
  const hasProperty = !!status?.property_id;

  const connect = useMutation({
    mutationFn: connectGoogleAnalytics,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ga4-status"] }); qc.invalidateQueries({ queryKey: ["ga4-props"] }); addToast("Google conectado!", "success"); },
    onError: (e) => addToast(e.message, "error"),
  });

  const { data: propsData } = useQuery({
    queryKey: ["ga4-props"],
    queryFn: getGA4Properties,
    enabled: !!connected,
    staleTime: 1000 * 60 * 10,
  });

  const selectProp = useMutation({
    mutationFn: selectGA4Property,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ga4-status"] }); qc.invalidateQueries({ queryKey: ["ga4"] }); },
    onError: (e) => addToast(e.message, "error"),
  });

  // Relatórios (só quando há propriedade)
  const rep = (key, fn, p = params) => useQuery({ queryKey: ["ga4", key, status?.property_id, range], queryFn: () => fn(p), enabled: hasProperty, staleTime: 1000 * 60 * 5 });
  const overview = rep("overview", getOverviewMetrics);
  const traffic = rep("traffic", getTrafficSources, { ...params, limit: 200 }); // mais linhas p/ agrupar bem
  const landing = rep("landing", getLandingPages, { ...params, limit: 200 });   // filtra nas páginas-alvo
  const landingSeries = rep("landingSeries", getLandingSeries, { ...params, pages: LANDING_TARGETS.map((t) => t.label) });
  const regions = rep("regions", getSalesByState);                              // mapa por estado

  const t = overview.data ?? {};
  const convSeries = buildConvSeries(landingSeries.data);
  const canais = aggregateChannels(traffic.data);
  const landingRows = filterLandingTargets(landing.data);
  const vendasEstados = (regions.data ?? []).map((r) => ({
    estado: r.region, sessoes: +r.sessions || 0, conversoes: +r.ecommercePurchases || 0, receita: +r.purchaseRevenue || 0,
  }));

  // Contexto enviado à IA (dados reais já agregados)
  const periodoLabel = RANGES.find((r) => r.v === range)?.label ?? range;
  const contextoIA = {
    periodo: periodoLabel,
    totais: {
      usuarios: t.totalUsers, novos_usuarios: t.newUsers, sessoes: t.sessions,
      sessoes_engajadas: t.engagedSessions, conversoes: t.conversions,
      receita: t.purchaseRevenue, visualizacoes: t.screenPageViews,
    },
    canais: canais.map((c) => ({ canal: c.canal, grupo: c.grupo, sessoes: c.sessions, vendas: c.conversions, receita: c.purchaseRevenue })),
    paginas_de_venda: landingRows.map((p) => ({ pagina: p.page, sessoes: p.sessions, vendas: p.vendas, receita: p.purchaseRevenue, taxa_conversao: +p.convRate.toFixed(2) })),
    vendas_por_estado: vendasEstados.filter((e) => e.receita > 0).map((e) => ({ estado: e.estado, sessoes: e.sessoes, vendas: e.conversoes, receita: e.receita })),
  };

  /* ── Estados sem conexão ── */
  if (statusLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" size={26} /></div>;
  }

  if (!connected) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-4">
          <BarChart3 className="text-accent" size={28} />
        </div>
        <h3 className="text-white font-bold text-lg mb-1">Conectar Google Analytics 4</h3>
        <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
          Faça login com o Google para trazer os dados reais do GA4 (tráfego, conversões, páginas de entrada, eventos e mais).
        </p>
        <button type="button" onClick={() => connect.mutate()} disabled={connect.isPending}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-black font-bold hover:bg-accent-hover transition-colors disabled:opacity-50">
          {connect.isPending ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} Login com Google
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Barra: propriedade + período */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-3.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500">Propriedade GA4</span>
        <select
          value={status?.property_id ?? ""}
          onChange={(e) => selectProp.mutate(e.target.value)}
          className="h-9 rounded-lg border border-gray-700 bg-gray-800 px-3 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer min-w-[220px]"
        >
          <option value="">Selecione uma propriedade…</option>
          {(propsData?.properties ?? []).map((p) => (
            <option key={p.property_id} value={p.property_id}>{p.property_name} ({p.property_id})</option>
          ))}
        </select>
        {selectProp.isPending && <Loader2 size={14} className="animate-spin text-gray-500" />}

        <div className="ml-auto flex items-center gap-1">
          {RANGES.map((r) => (
            <button key={r.v} type="button" onClick={() => setRange(r.v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${range === r.v ? "bg-accent text-black" : "bg-gray-800 text-gray-400 hover:text-gray-200"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!hasProperty ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-12 text-center">
          <BarChart3 size={28} className="mx-auto text-gray-700 mb-3" />
          <p className="text-sm text-gray-400 font-medium">Selecione uma propriedade GA4 acima para ver os dados.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          {overview.isLoading ? (
            <div className="grid grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />)}</div>
          ) : overview.error ? (
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4 text-xs text-red-300">Erro ao buscar métricas: {overview.error.message}</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Kpi icon={Users} label="Usuários" value={NUM(t.totalUsers)} color="#60A5FA" />
              <Kpi icon={TrendingUp} label="Novos usuários" value={NUM(t.newUsers)} color="#4ADE80" />
              <Kpi icon={MousePointerClick} label="Sessões" value={NUM(t.sessions)} color="#C8FF00" />
              <Kpi icon={Zap} label="Sessões engajadas" value={NUM(t.engagedSessions)} color="#A78BFA" />
              <Kpi icon={DollarSign} label="Conversões" value={NUM(t.conversions)} color="#FBBF24" />
              <Kpi icon={DollarSign} label="Receita (compras)" value={BRL(t.purchaseRevenue)} color="#34D399" />
              <Kpi icon={Clock} label="Duração méd. sessão" value={DUR(t.averageSessionDuration)} color="#38BDF8" />
              <Kpi icon={Eye} label="Visualizações" value={NUM(t.screenPageViews)} color="#FB923C" />
            </div>
          )}

          {/* Taxa de conversão por página (dia) */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h3 className="text-sm font-bold text-white">Taxa de conversão por página de venda (dia)</h3>
              <div className="flex items-center gap-1 flex-wrap">
                <button type="button" onClick={() => setLinhaPagina("all")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${linhaPagina === "all" ? "bg-accent text-black" : "bg-gray-800 text-gray-400 hover:text-gray-200"}`}>
                  Todos
                </button>
                {LANDING_TARGETS.map((tg) => (
                  <button key={tg.id} type="button" onClick={() => setLinhaPagina(tg.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${linhaPagina === tg.id ? "bg-gray-700 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"}`}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tg.color }} />{tg.short}
                  </button>
                ))}
              </div>
            </div>
            {landingSeries.isLoading ? (
              <div className="h-52 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-gray-600" /></div>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={convSeries} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke="#34343C" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={{ stroke: "#34343C" }} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={{ background: "#26262D", border: "1px solid #34343C", borderRadius: 12, fontSize: 11 }} labelStyle={{ color: "#A3A3AE" }} formatter={(v) => (v == null ? "—" : `${(+v).toFixed(2).replace(".", ",")}%`)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => <span style={{ color: "#A3A3AE" }}>{value}</span>} />
                  {LANDING_TARGETS.filter((tg) => linhaPagina === "all" || tg.id === linhaPagina).map((tg) => (
                    <Line key={tg.id} type="monotone" dataKey={tg.id} name={tg.short} stroke={tg.color} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabelas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Tabela title="Canais de tráfego" Icon={Globe} loading={traffic.isLoading} rows={canais}
              empty="Sem tráfego no período." cols={[
                { key: "canal", label: "Canal", fmt: (v, r) => (
                  <span className="flex items-center gap-1.5">
                    {v}
                    {r.revisar && <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/30">revisar</span>}
                  </span>
                ) },
                { key: "grupo", label: "Grupo", fmt: (v) => {
                  const c = GRUPO_COR[v] ?? GRUPO_COR["Outros"];
                  return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: c.bg, color: c.text }}>{v}</span>;
                } },
                { key: "sessions", label: "Sessões", align: "right", fmt: NUM },
                { key: "conversions", label: "Conv.", align: "right", fmt: NUM },
                { key: "purchaseRevenue", label: "Receita", align: "right", fmt: BRL },
              ]} />
            <Tabela title="Páginas de entrada" Icon={Eye} loading={landing.isLoading} rows={landingRows}
              empty="Sem sessões nas páginas monitoradas." cols={[
                { key: "page", label: "Página", fmt: (v) => <span className="truncate inline-block max-w-[240px]" title={v}>{v}</span> },
                { key: "sessions", label: "Sessões", align: "right", fmt: NUM },
                { key: "vendas", label: "Vendas", align: "right", fmt: NUM },
                { key: "purchaseRevenue", label: "Receita", align: "right", fmt: BRL },
                { key: "convRate", label: "Taxa Conv.", align: "right", fmt: (v) => (v > 0 ? v.toFixed(2) + "%" : "—") },
              ]} />
          </div>

          {/* Mapa de vendas por estado + Análise com IA (lado a lado) */}
          <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_1fr] gap-5 items-stretch">
            <MapaVendasEstados
              dados={vendasEstados}
              receitaTotalConta={+t.purchaseRevenue || null}
              loading={regions.isLoading}
            />
            <GA4IA contexto={contextoIA} />
          </div>
        </>
      )}
    </div>
  );
}

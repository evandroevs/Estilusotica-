/**
 * Relatório Mensal — visão simples do mês com as principais métricas
 * de Meta Ads (meta_ads_daily) e Google Ads (google_ads_cache) da loja
 * ativa, lado a lado, com gráficos diários de investimento e resultados.
 * Compara sempre com o mês anterior.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, MessageCircle, MousePointerClick, Eye, Target, Coins } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { supabase } from "../../lib/supabase";

const NUM = (v) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(v)));
const BRL = (v, d = 2) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: d }).format(v));

const META_COR = "#60A5FA";   // azul — Meta
const GOOGLE_COR = "#C8FF00"; // accent — Google

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** Últimos 6 meses como opções { v: "2026-08", label: "Agosto 2026" }. */
function buildMonths() {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const y = d.getFullYear(), m = d.getMonth();
    out.push({ v: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MESES[m]} ${y}` });
    d.setMonth(m - 1);
  }
  return out;
}

/** [primeiro dia, último dia] de "YYYY-MM". */
function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}
function prevMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function aggMeta(rows) {
  if (!rows?.length) return null;
  const sum = (k) => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  const spend = sum("spend"), messages = sum("messages"), revenue = sum("revenue"),
        purchases = sum("purchases"), clicks = sum("link_clicks"), impressions = sum("impressions");
  return {
    spend, messages, revenue, purchases, clicks, impressions,
    custoPorMensagem: messages > 0 ? spend / messages : null,
    roas: spend > 0 && revenue > 0 ? revenue / spend : null,
  };
}
function aggGoogle(rows) {
  if (!rows?.length) return null;
  const sum = (k) => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  const cost = sum("cost"), conversions = sum("conversions"),
        clicks = sum("clicks"), impressions = sum("impressions");
  return { cost, conversions, clicks, impressions, cpa: conversions > 0 ? cost / conversions : null };
}

function delta(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function Kpi({ icon: Icon, label, value, deltaValue, invertColor = false, color }) {
  const d = deltaValue;
  const isGood = d != null && (invertColor ? d < 0 : d > 0);
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + "22" }}>
          <Icon size={12} style={{ color }} />
        </div>
        <span className="text-[11px] text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-white leading-none">{value}</p>
      {d == null ? (
        <span className="text-xs text-gray-600">vs mês anterior</span>
      ) : (
        <span className="text-xs">
          <span className={`font-medium ${isGood ? "text-green-400" : "text-red-400"}`}>
            {d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}%
          </span>{" "}
          <span className="text-gray-600">vs mês anterior</span>
        </span>
      )}
    </div>
  );
}

function SectionTitle({ color, children }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      <h3 className="text-sm font-bold text-white">{children}</h3>
    </div>
  );
}

export default function RelatorioMensal() {
  const months = useMemo(buildMonths, []);
  const [mes, setMes] = useState(months[0].v);

  const anterior = prevMonth(mes);
  const [fetchStart] = monthRange(anterior);
  const [curStart, curEnd] = monthRange(mes);

  // Meta e Google do mês atual + anterior (uma query por fonte; RLS filtra a loja)
  const meta = useQuery({
    queryKey: ["rel-mensal-meta", mes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meta_ads_daily")
        .select("date,spend,revenue,purchases,impressions,link_clicks,messages")
        .gte("date", fetchStart).lte("date", curEnd)
        .order("date");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });
  const google = useQuery({
    queryKey: ["rel-mensal-google", mes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("google_ads_cache")
        .select("date,cost,conversions,clicks,impressions")
        .gte("date", fetchStart).lte("date", curEnd)
        .order("date");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });

  const loading = meta.isLoading || google.isLoading;

  const { m, mPrev, g, gPrev, series, temEcommerce } = useMemo(() => {
    const metaCur  = (meta.data ?? []).filter((r) => r.date >= curStart);
    const metaAnt  = (meta.data ?? []).filter((r) => r.date < curStart);
    const gCur     = (google.data ?? []).filter((r) => r.date >= curStart);
    const gAnt     = (google.data ?? []).filter((r) => r.date < curStart);

    // Série diária do mês: investimento e resultados das duas fontes
    const byDate = new Map();
    const ensure = (d) => {
      if (!byDate.has(d)) byDate.set(d, { meta: 0, google: 0, mensagens: 0, compras: 0, conversoes: 0 });
      return byDate.get(d);
    };
    for (const r of metaCur) {
      const a = ensure(r.date);
      a.meta += +r.spend || 0;
      a.mensagens += +r.messages || 0;
      a.compras += +r.purchases || 0;
    }
    for (const r of gCur) {
      const a = ensure(r.date);
      a.google += +r.cost || 0;
      a.conversoes += +r.conversions || 0;
    }
    const series = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, a]) => ({
        dia: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
        meta: +a.meta.toFixed(2),
        google: +a.google.toFixed(2),
        mensagens: Math.round(a.mensagens),
        compras: Math.round(a.compras),
        conversoes: +a.conversoes.toFixed(1),
      }));

    const m = aggMeta(metaCur);
    return {
      m, mPrev: aggMeta(metaAnt), g: aggGoogle(gCur), gPrev: aggGoogle(gAnt), series,
      temEcommerce: (m?.revenue ?? 0) > 0,
    };
  }, [meta.data, google.data, curStart]);

  const totalInvestido = (m?.spend ?? 0) + (g?.cost ?? 0);
  const totalAnterior = (mPrev?.spend ?? 0) + (gPrev?.cost ?? 0);

  return (
    <div className="space-y-5">
      {/* Mês + total investido */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-3.5 flex items-center gap-4 flex-wrap">
        <select value={mes} onChange={(e) => setMes(e.target.value)}
          className="h-9 rounded-lg border border-gray-700 bg-gray-800 px-3 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer">
          {months.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <div className="ml-auto text-right">
          <p className="text-[11px] text-gray-500">Investimento total (Meta + Google)</p>
          <p className="text-lg font-bold text-white leading-tight">
            {BRL(totalInvestido)}
            {totalAnterior > 0 && (
              <span className={`ml-2 text-xs font-medium ${totalInvestido <= totalAnterior ? "text-green-400" : "text-red-400"}`}>
                {totalInvestido > totalAnterior ? "▲" : "▼"} {Math.abs(delta(totalInvestido, totalAnterior) ?? 0).toFixed(1)}%
              </span>
            )}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Meta Ads */}
          <div className="space-y-3">
            <SectionTitle color={META_COR}>Meta Ads</SectionTitle>
            {!m ? (
              <p className="text-xs text-gray-600 bg-gray-900 border border-gray-800 rounded-xl p-4">Sem dados de Meta Ads neste mês.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Kpi icon={DollarSign} label="Investimento" value={BRL(m.spend)} deltaValue={delta(m.spend, mPrev?.spend)} invertColor color={META_COR} />
                {temEcommerce ? (
                  <>
                    <Kpi icon={Target} label="Receita" value={BRL(m.revenue)} deltaValue={delta(m.revenue, mPrev?.revenue)} color="#34D399" />
                    <Kpi icon={Coins} label="ROAS" value={m.roas ? m.roas.toFixed(2).replace(".", ",") + "x" : "—"} deltaValue={delta(m.roas, mPrev?.roas)} color="#FBBF24" />
                  </>
                ) : (
                  <>
                    <Kpi icon={MessageCircle} label="Mensagens" value={NUM(m.messages)} deltaValue={delta(m.messages, mPrev?.messages)} color="#34D399" />
                    <Kpi icon={Coins} label="Custo por mensagem" value={BRL(m.custoPorMensagem)} deltaValue={delta(m.custoPorMensagem, mPrev?.custoPorMensagem)} invertColor color="#FBBF24" />
                  </>
                )}
                <Kpi icon={MousePointerClick} label="Cliques no link" value={NUM(m.clicks)} deltaValue={delta(m.clicks, mPrev?.clicks)} color="#8B5CF6" />
              </div>
            )}
          </div>

          {/* Google Ads */}
          <div className="space-y-3">
            <SectionTitle color={GOOGLE_COR}>Google Ads</SectionTitle>
            {!g ? (
              <p className="text-xs text-gray-600 bg-gray-900 border border-gray-800 rounded-xl p-4">Sem dados de Google Ads neste mês.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Kpi icon={DollarSign} label="Investimento" value={BRL(g.cost)} deltaValue={delta(g.cost, gPrev?.cost)} invertColor color={GOOGLE_COR} />
                <Kpi icon={Target} label="Conversões" value={NUM(g.conversions)} deltaValue={delta(g.conversions, gPrev?.conversions)} color="#34D399" />
                <Kpi icon={Coins} label="Custo por conversão" value={BRL(g.cpa)} deltaValue={delta(g.cpa, gPrev?.cpa)} invertColor color="#FBBF24" />
                <Kpi icon={Eye} label="Impressões" value={NUM(g.impressions)} deltaValue={delta(g.impressions, gPrev?.impressions)} color="#8B5CF6" />
              </div>
            )}
          </div>

          {/* Gráfico: investimento por dia */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <h3 className="text-sm font-bold text-white mb-3">Investimento por dia</h3>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={series} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#34343C" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="dia" tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={{ stroke: "#34343C" }} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `R$${v}`} />
                <Tooltip contentStyle={{ background: "#26262D", border: "1px solid #34343C", borderRadius: 12, fontSize: 11 }} labelStyle={{ color: "#A3A3AE" }} formatter={(v) => BRL(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => <span style={{ color: "#A3A3AE" }}>{value}</span>} />
                <Line type="monotone" dataKey="meta" name="Meta Ads" stroke={META_COR} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="google" name="Google Ads" stroke={GOOGLE_COR} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Gráfico: resultados por dia */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <h3 className="text-sm font-bold text-white mb-3">
              Resultados por dia — {temEcommerce ? "compras" : "mensagens"} (Meta) e conversões (Google)
            </h3>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={series} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#34343C" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="dia" tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={{ stroke: "#34343C" }} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#26262D", border: "1px solid #34343C", borderRadius: 12, fontSize: 11 }} labelStyle={{ color: "#A3A3AE" }} formatter={(v) => NUM(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => <span style={{ color: "#A3A3AE" }}>{value}</span>} />
                <Line type="monotone" dataKey={temEcommerce ? "compras" : "mensagens"} name={temEcommerce ? "Compras (Meta)" : "Mensagens (Meta)"} stroke={META_COR} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="conversoes" name="Conversões (Google)" stroke={GOOGLE_COR} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Google — sub-aba do Dashboard com métricas do Google Ads da loja ativa.
 * Lê do cache `google_ads_cache` (RLS filtra pelo workspace do header
 * x-workspace-id — trocar de loja na sidebar troca a conta do Google).
 * Alimentado por export do Google Ads (sync manual, service_role) — a
 * Edge Function google-ads-sync automatiza isso quando for ligada.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, Eye, MousePointerClick, Percent,
  Target, TrendingUp, Megaphone, Coins,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { supabase } from "../../lib/supabase";
import { PeriodFilter } from "../../components/ui/PeriodFilter";
import { getPeriodDates, getPrevDates, defaultCustom } from "../../lib/periods";

const NUM = (v) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(v)));
const BRL = (v) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(v));
const PCT = (v) => (v == null || isNaN(v) ? "—" : v.toFixed(2).replace(".", ",") + "%");

/** Agrega linhas diárias em totais + métricas derivadas. */
function agg(rows) {
  if (!rows?.length) return null;
  const impressions = rows.reduce((s, r) => s + (+r.impressions || 0), 0);
  const clicks      = rows.reduce((s, r) => s + (+r.clicks || 0), 0);
  const cost        = rows.reduce((s, r) => s + (+r.cost || 0), 0);
  const conversions = rows.reduce((s, r) => s + (+r.conversions || 0), 0);
  const convValue   = rows.reduce((s, r) => s + (+r.conversion_value || 0), 0);
  return {
    impressions, clicks, cost, conversions, convValue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpc: clicks > 0 ? cost / clicks : null,
    cpa: conversions > 0 ? cost / conversions : null,
  };
}

function delta(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function DeltaBadge({ value, invertColor = false }) {
  if (value == null) return <span className="text-xs text-gray-600">vs período anterior</span>;
  const isUp = value > 0;
  const isGood = invertColor ? !isUp : isUp;
  return (
    <span className="text-xs">
      <span className={`font-medium ${isGood ? "text-green-400" : "text-red-400"}`}>
        {isUp ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
      </span>{" "}
      <span className="text-gray-600">vs período anterior</span>
    </span>
  );
}

function Kpi({ icon: Icon, label, value, deltaValue, invertColor = false, color }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 md:p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-1.5">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + "22" }}>
          <Icon size={12} style={{ color }} />
        </div>
        <span className="text-[11px] text-gray-500">{label}</span>
      </div>
      <p className="text-lg md:text-xl font-bold text-white leading-none tabular-nums truncate">{value}</p>
      <DeltaBadge value={deltaValue} invertColor={invertColor} />
    </div>
  );
}

export default function GoogleAds() {
  const [period, setPeriod] = useState("30d");
  const [custom, setCustom] = useState(defaultCustom);
  const [linhas, setLinhas] = useState({ custo: true, conversoes: true });

  // Janela atual + anterior de uma vez (para os deltas); RLS filtra a loja.
  const { s: curStart, e: curEnd } = getPeriodDates(period, custom);
  const { s: prevStart } = getPrevDates(period, custom);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["google-ads", curStart, curEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("google_ads_cache")
        .select("*")
        .gte("date", prevStart)
        .lte("date", curEnd)
        .order("date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });

  const { cur, prev, series, campaigns, syncedAt } = useMemo(() => {
    const all = rows ?? [];
    const curRows = all.filter((r) => r.date >= curStart && r.date <= curEnd);
    const prevRows = all.filter((r) => r.date < curStart);

    const byDate = new Map();
    for (const r of curRows) {
      const a = byDate.get(r.date) ?? { cost: 0, conversions: 0, clicks: 0 };
      a.cost += +r.cost || 0;
      a.conversions += +r.conversions || 0;
      a.clicks += +r.clicks || 0;
      byDate.set(r.date, a);
    }
    const series = [...byDate.entries()].map(([date, a]) => ({
      dia: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
      custo: +a.cost.toFixed(2),
      conversoes: +a.conversions.toFixed(1),
      cliques: a.clicks,
    }));

    const byCampaign = new Map();
    for (const r of curRows) {
      const a = byCampaign.get(r.campaign_id) ?? { campaign_name: r.campaign_name, rows: [] };
      a.campaign_name = r.campaign_name;
      a.rows.push(r);
      byCampaign.set(r.campaign_id, a);
    }
    const campaigns = [...byCampaign.values()]
      .map((c) => ({ name: c.campaign_name, ...agg(c.rows) }))
      .sort((a, b) => b.cost - a.cost);

    const syncedAt = all.length
      ? all.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), all[0].synced_at)
      : null;

    return { cur: agg(curRows), prev: agg(prevRows), series, campaigns, syncedAt };
  }, [rows, curStart, curEnd]);

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Período */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 md:px-5 py-3.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500 whitespace-nowrap">Google Ads da loja ativa</span>
        <div className="md:ml-auto">
          <PeriodFilter period={period} custom={custom} onPeriodChange={setPeriod} onCustomChange={setCustom} />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4 text-xs text-red-300">Erro ao buscar dados: {error.message}</div>
      ) : !cur ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-12 text-center">
          <Megaphone size={28} className="mx-auto text-gray-700 mb-3" />
          <p className="text-sm text-gray-400 font-medium">Sem dados do Google Ads no período para esta loja.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <Kpi icon={DollarSign} label="Custo" value={BRL(cur.cost)} deltaValue={delta(cur.cost, prev?.cost)} invertColor color="#F87171" />
            <Kpi icon={Eye} label="Impressões" value={NUM(cur.impressions)} deltaValue={delta(cur.impressions, prev?.impressions)} color="#60A5FA" />
            <Kpi icon={MousePointerClick} label="Cliques" value={NUM(cur.clicks)} deltaValue={delta(cur.clicks, prev?.clicks)} color="#8B5CF6" />
            <Kpi icon={Percent} label="CTR" value={PCT(cur.ctr)} deltaValue={delta(cur.ctr, prev?.ctr)} color="#A78BFA" />
            <Kpi icon={Coins} label="CPC" value={BRL(cur.cpc)} deltaValue={delta(cur.cpc, prev?.cpc)} invertColor color="#FB923C" />
            <Kpi icon={Target} label="Conversões" value={NUM(cur.conversions)} deltaValue={delta(cur.conversions, prev?.conversions)} color="#4ADE80" />
            <Kpi icon={TrendingUp} label="Custo / conversão" value={BRL(cur.cpa)} deltaValue={delta(cur.cpa, prev?.cpa)} invertColor color="#FBBF24" />
            <Kpi icon={DollarSign} label="Valor de conversão" value={NUM(cur.convValue)} deltaValue={delta(cur.convValue, prev?.convValue)} color="#34D399" />
          </div>

          {/* Série diária */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h3 className="text-sm font-bold text-white">Custo e conversões por dia</h3>
              <div className="flex items-center gap-1">
                {[
                  { key: "custo",      label: "Custo",      cor: "#C8FF00" },
                  { key: "conversoes", label: "Conversões", cor: "#4ADE80" },
                ].map(({ key, label, cor }) => (
                  <button key={key} type="button"
                    onClick={() => setLinhas((l) => ({ ...l, [key]: !l[key] }))}
                    title={linhas[key] ? `Ocultar ${label}` : `Mostrar ${label}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                      linhas[key] ? "bg-gray-700 text-white" : "bg-gray-800 text-gray-500 line-through"
                    }`}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: linhas[key] ? cor : "#55555E" }} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={series} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#34343C" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="dia" tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={{ stroke: "#34343C" }} tickLine={false} minTickGap={24} />
                <YAxis yAxisId="custo" tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `R$${v}`} />
                <YAxis yAxisId="conv" orientation="right" tick={{ fill: "#7E7E8A", fontSize: 10 }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#26262D", border: "1px solid #34343C", borderRadius: 12, fontSize: 11 }}
                  labelStyle={{ color: "#A3A3AE" }}
                  formatter={(v, name) => (name === "Custo" ? BRL(v) : NUM(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => <span style={{ color: "#A3A3AE" }}>{value}</span>} />
                {linhas.custo && <Line yAxisId="custo" type="monotone" dataKey="custo" name="Custo" stroke="#C8FF00" strokeWidth={2} dot={false} />}
                {linhas.conversoes && <Line yAxisId="conv" type="monotone" dataKey="conversoes" name="Conversões" stroke="#4ADE80" strokeWidth={2} dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Campanhas */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="px-4 md:px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
              <Megaphone size={14} className="text-accent" />
              <h3 className="text-sm font-bold text-white">Campanhas</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr style={{ backgroundColor: "#2C2C33" }}>
                    {["Campanha", "Impressões", "Cliques", "CTR", "CPC", "Custo", "Conv.", "Custo/Conv."].map((h, i) => (
                      <th key={h} className={`px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr key={c.name} className={`border-t border-gray-800 ${i % 2 ? "bg-gray-900/50" : ""}`}>
                      <td className="px-4 py-2.5 text-gray-200">{c.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{NUM(c.impressions)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{NUM(c.clicks)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{PCT(c.ctr)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{BRL(c.cpc)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{BRL(c.cost)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{NUM(c.conversions)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{BRL(c.cpa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {syncedAt && (
            <p className="text-[11px] text-gray-600">
              Última sincronização: {new Date(syncedAt).toLocaleString("pt-BR")} — dados do Google Ads.
            </p>
          )}
        </>
      )}
    </div>
  );
}

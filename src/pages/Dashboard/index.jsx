import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, ShoppingCart, BarChart2, BarChart3,
  MousePointer, ArrowRight, Users, Play, RefreshCw, Eye, FileText,
  MessageCircle,
} from "lucide-react";
import GA4 from "./GA4";
import Relatorio from "./Relatorio";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { supabase } from "../../lib/supabase";
import { usePeriodAds } from "../../hooks/usePeriodAds";
import { PeriodFilter } from "../../components/ui/PeriodFilter";
import { getPrevDates, defaultCustom, getPeriodDates } from "../../lib/periods";
import CreativeModal from "../../components/CreativeModal";

/* ─── Formatters ─────────────────────────────────────────────────────────── */

const BRL = (v) =>
  v == null || isNaN(v)
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency", currency: "BRL",
        minimumFractionDigits: 0, maximumFractionDigits: 0,
      }).format(v);

const NUM  = (v) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(v)));
const PCT  = (v, d = 1) => (v == null || isNaN(v) ? "—" : v.toFixed(d) + "%");
const ROAS = (v) => (v == null || isNaN(v) ? "—" : v.toFixed(2) + "x");

/* ─── Date helpers (janela dos gráficos) ─────────────────────────────────── */
function addDaysStr(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
const minDateStr = (a, b) => (a <= b ? a : b);
// Gráficos de tendência mostram sempre pelo menos esta janela de histórico.
const CHART_MIN_DAYS = 30;

/* ─── Aggregation ────────────────────────────────────────────────────────── */

function agg(rows) {
  if (!rows?.length) return null;
  const spend         = rows.reduce((s, r) => s + +r.spend             || 0, 0);
  const revenue       = rows.reduce((s, r) => s + +r.revenue           || 0, 0);
  const purchases     = rows.reduce((s, r) => s + +r.purchases         || 0, 0);
  const impr          = rows.reduce((s, r) => s + +r.impressions       || 0, 0);
  const clicks        = rows.reduce((s, r) => s + +r.link_clicks       || 0, 0);
  const lpv           = rows.reduce((s, r) => s + +r.landing_page_views|| 0, 0);
  const initCheckout  = rows.reduce((s, r) => s + (+r.initiate_checkout || 0), 0);
  const addPayment    = rows.reduce((s, r) => s + (+r.add_payment_info  || 0), 0);
  const messages      = rows.reduce((s, r) => s + (+r.messages          || 0), 0);
  // Soma de alcances diários — aproximação (superestima o alcance único)
  const reach         = rows.reduce((s, r) => s + (+r.reach             || 0), 0);

  return {
    spend, revenue, purchases, impr, clicks, lpv, initCheckout, addPayment,
    messages, reach,
    custoPorMensagem: messages > 0 ? spend / messages : 0,
    frequencia:       reach    > 0 ? impr  / reach    : 0,
    roas:           spend     > 0 ? revenue   / spend    : 0,
    cpa:            purchases > 0 ? spend     / purchases: 0,
    cpm:            impr      > 0 ? (spend / impr) * 1000 : 0,
    cpc:            clicks    > 0 ? spend     / clicks   : 0,
    ctr:            impr      > 0 ? (clicks / impr) * 100 : 0,
    conversionRate: clicks    > 0 ? (purchases / clicks) * 100 : 0,
    connectRate:    clicks    > 0 ? (lpv / clicks) * 100 : 0,
    ticketMedio:    purchases > 0 ? revenue   / purchases: 0,
    cplpv:          lpv       > 0 ? spend     / lpv      : 0,
    adCount: rows.length,
  };
}

function delta(cur, prev) {
  if (!prev || prev === 0 || cur == null) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const FUNIL_SEG = {
  TOFU: { label: "Prospecting",  color: "#4ADE80", bar: "#052E16" },
  MOFU: { label: "Engajamento",  color: "#FCD34D", bar: "#2B1500" },
  BOFU: { label: "Retargeting",  color: "#C084FC", bar: "#1A0B2E" },
};

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function DeltaBadge({ value, invertColor = false }) {
  if (value == null) return null;
  const isUp   = value > 0;
  const isGood = invertColor ? !isUp : isUp;
  return (
    <span className={`text-xs font-medium ${isGood ? "text-green-400" : "text-red-400"}`}>
      {isUp ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function KpiCard({ title, value, prevValue, fmt, icon: Icon, color, invertColor = false }) {
  const d = delta(value, prevValue);
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 leading-tight">{title}</span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: color + "22" }}>
          <Icon size={13} style={{ color }} />
        </div>
      </div>
      <p className="text-xl font-bold text-white leading-none">{fmt(value)}</p>
      <div className="flex items-center gap-1.5">
        <DeltaBadge value={d} invertColor={invertColor} />
        {d == null && <span className="text-xs text-gray-600">vs período anterior</span>}
        {d != null && <span className="text-xs text-gray-600">vs período anterior</span>}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-2.5 animate-pulse">
      <div className="h-3 w-24 rounded bg-gray-700" />
      <div className="h-6 w-32 rounded bg-gray-700" />
      <div className="h-3 w-16 rounded bg-gray-700" />
    </div>
  );
}

function SkeletonBlock({ h = "h-40" }) {
  return <div className={`${h} bg-gray-900 rounded-2xl border border-gray-800 animate-pulse`} />;
}

/* ─── Gráficos de tendência (ROAS×CPA e ROAS×Conv. LP) ───────────────────── */

const CHART_FMT = {
  roas:   (v) => (v == null ? "—" : v.toFixed(2) + "x"),
  brl:    (v) => (v == null ? "—" : BRL(v)),
  pct:    (v) => (v == null ? "—" : v.toFixed(1) + "%"),
};

function ChartTooltip({ active, payload, label, left, right }) {
  if (!active || !payload?.length) return null;
  const fmt = { [left.key]: CHART_FMT[left.fmt] };
  if (right) fmt[right.key] = CHART_FMT[right.fmt];
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 shadow-2xl">
      <p className="text-[11px] font-semibold text-gray-300 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-[11px] tabular-nums" style={{ color: p.stroke }}>
          {p.name}: <span className="font-bold">{fmt[p.dataKey]?.(p.value) ?? p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Gráfico de 2 linhas com eixos independentes (esq./dir.) sobre a série diária. */
function TrendChart({ title, subtitle, data, left, right = null }) {
  const hasData = (data ?? []).filter((d) => d[left.key] != null || (right && d[right.key] != null)).length > 0;
  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <h3 className="font-bold text-white text-sm">{title}</h3>
      <p className="text-[11px] text-gray-600 mt-0.5 mb-3">{subtitle}</p>
      {!hasData ? (
        <div className="h-52 flex items-center justify-center text-xs text-gray-600">
          Sem dados no período.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#34343C" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="dia"
              tick={{ fill: "#7E7E8A", fontSize: 10 }}
              axisLine={{ stroke: "#34343C" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: left.color, fontSize: 10 }}
              tickFormatter={(v) => CHART_FMT[left.fmt](v)}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            {right && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: right.color, fontSize: 10 }}
                tickFormatter={(v) => CHART_FMT[right.fmt](v)}
                axisLine={false}
                tickLine={false}
                width={52}
              />
            )}
            <Tooltip content={<ChartTooltip left={left} right={right} />} />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value) => <span style={{ color: "#A3A3AE" }}>{value}</span>}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey={left.key}
              name={left.label}
              stroke={left.color}
              strokeWidth={2}
              dot={(data?.length ?? 0) <= 2}
              connectNulls
            />
            {right && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey={right.key}
                name={right.label}
                stroke={right.color}
                strokeWidth={2}
                dot={(data?.length ?? 0) <= 2}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* ─── Funil de Aquisição ─────────────────────────────────────────────────── */

function FunnelAquisicao({ m }) {
  if (!m) return <SkeletonBlock h="h-40" />;

  const costPer = (spend, n) => (n > 0 ? spend / n : null);

  const steps = [
    { label: "Cliques de Saída",    value: m.clicks,       cost: costPer(m.spend, m.clicks) },
    { label: "Visualiz. de Página", value: m.lpv,          cost: costPer(m.spend, m.lpv) },
    { label: "Início de Checkout",  value: m.initCheckout, cost: costPer(m.spend, m.initCheckout) },
    { label: "Info de Pagamento",   value: m.addPayment,   cost: costPer(m.spend, m.addPayment) },
    { label: "Compras",             value: m.purchases,    cost: m.cpa > 0 ? m.cpa : null },
  ];

  // Largura afunilando por etapa (forma de funil, não proporcional ao valor —
  // compras seriam finas demais para ler)
  const widths = ["100%", "85%", "70%", "55%", "40%"];
  const top = steps[0].value || 1;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <h3 className="font-bold text-white text-sm mb-4">Funil de Aquisição</h3>
      <div className="flex flex-col items-center max-w-2xl mx-auto">
        {steps.map((step, i) => {
          const next  = steps[i + 1];
          const dropP = next && step.value > 0
            ? ((step.value - next.value) / step.value) * 100
            : null;
          const pctTop  = top > 0 ? Math.round((step.value / top) * 100) : 0;
          const opacity = 0.05 + (i / (steps.length - 1)) * 0.16;
          const hasData = step.value > 0;

          return (
            <div key={step.label} className="w-full flex flex-col items-center">
              <div
                className="rounded-xl border border-gray-700 px-4 py-2 flex items-center justify-between gap-3"
                style={{ width: widths[i], backgroundColor: `rgba(200,255,0,${opacity})` }}
              >
                <span className="text-xs text-gray-400 leading-tight truncate">{step.label}</span>
                <span className="text-right shrink-0">
                  <span className={`text-sm font-bold leading-none ${hasData ? "text-white" : "text-gray-600"}`}>
                    {hasData ? NUM(step.value) : "N/D"}
                  </span>
                  <span className="block text-[10px] text-gray-500 leading-tight">
                    {step.cost != null && hasData ? BRL(step.cost) + "/un." : "—"}{i > 0 && hasData ? ` · ${pctTop}%` : ""}
                  </span>
                </span>
              </div>

              {next && (
                <div className="h-5 flex items-center">
                  {dropP != null && dropP > 0 ? (
                    <span className="text-[10px] text-red-500 font-semibold leading-none">
                      ▼ -{Math.round(dropP)}%
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-700 leading-none">▼</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Performance por Produto ────────────────────────────────────────────── */

function ProductTable({ rows, products, groupBy = "product" }) {
  const isCampaign = groupBy === "campaign";

  const grouped = useMemo(() => {
    const map = {};
    for (const r of (rows ?? [])) {
      const key = isCampaign
        ? (r.campaign_id || r.campaign_name || "unknown")
        : (r.product_id || "unknown");
      (map[key] ??= []).push(r);
    }
    return Object.entries(map)
      .map(([key, ads]) => {
        const m = agg(ads);
        const nome = isCampaign
          ? (ads[0]?.campaign_name || "Sem campanha")
          : (products?.find((x) => x.id === key)?.nome ?? "Sem produto");
        return { key, nome, adCount: ads.length, ...m };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [rows, products, isCampaign]);

  const maxRoas = Math.max(...grouped.map((r) => r.roas ?? 0), 0.1);

  if (!grouped.length) return null;

  const firstCol = isCampaign ? "Campanha" : "Produto";
  const title    = isCampaign ? "Performance por Campanha" : "Performance por Produto";

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3">
        <h3 className="font-bold text-white text-sm">{title}</h3>
        {isCampaign && (
          <span className="text-[11px] text-gray-500">
            {grouped.length} campanha{grouped.length !== 1 ? "s" : ""} · inclui inativas
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: "#2C2C33" }}>
              {[firstCol,"Anúncios","Invest.","CPLPV","CPM","CPA","Compras","ROAS","Taxa Conv.","Ticket Médio","Receita"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map((r, i) => (
              <tr key={r.key} className={`border-t border-gray-800 ${i % 2 === 0 ? "bg-gray-900" : "bg-gray-900/60"}`}>
                <td className="px-4 py-2.5 font-medium text-gray-200 whitespace-nowrap max-w-[260px] truncate" title={r.nome}>{r.nome}</td>
                <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{NUM(r.adCount)}</td>
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{BRL(r.spend)}</td>
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{BRL(r.cplpv)}</td>
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{BRL(r.cpm)}</td>
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{BRL(r.cpa)}</td>
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{NUM(r.purchases)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold whitespace-nowrap ${r.roas >= 5 ? "text-green-400" : r.roas >= 3 ? "text-yellow-400" : "text-red-400"}`}>
                      {ROAS(r.roas)}
                    </span>
                    <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${(r.roas / maxRoas) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{PCT(r.conversionRate)}</td>
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{BRL(r.ticketMedio)}</td>
                <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{BRL(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Distribuição por Segmento ──────────────────────────────────────────── */

function SegmentBlock({ rows }) {
  const segs = useMemo(() => {
    const totals = { TOFU: 0, MOFU: 0, BOFU: 0 };
    for (const r of (rows ?? [])) {
      if (r.funil in totals) totals[r.funil] += +r.spend || 0;
    }
    const total = Object.values(totals).reduce((s, v) => s + v, 0);
    return Object.entries(totals).map(([funil, spend]) => ({
      funil,
      ...FUNIL_SEG[funil],
      spend,
      pct: total > 0 ? (spend / total) * 100 : 0,
    }));
  }, [rows]);

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <h3 className="font-bold text-white text-sm mb-4">Distribuição por Segmento de Público</h3>
      <div className="space-y-3">
        {segs.map((s) => (
          <div key={s.funil}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{BRL(s.spend)}</span>
                <span className="text-xs font-bold text-gray-300 w-10 text-right">{PCT(s.pct, 0)}</span>
              </div>
            </div>
            <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${s.pct}%`, backgroundColor: s.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Top Criativos ──────────────────────────────────────────────────────── */

const FUNIL_GRAD = {
  TOFU: "linear-gradient(135deg, #052E16, #0D4015)",
  MOFU: "linear-gradient(135deg, #2B1500, #3D2000)",
  BOFU: "linear-gradient(135deg, #1A0B2E, #2A1050)",
};

function TopCreativosBlock({ rows, onSelect }) {
  const top = useMemo(
    () => [...(rows ?? [])].sort((a, b) => b.purchases - a.purchases).slice(0, 6),
    [rows],
  );

  if (!top.length) return null;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-white text-sm">Top Criativos</h3>
        <Link
          to="/top-criativos"
          className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover transition-colors"
        >
          Ver todos <ArrowRight size={12} />
        </Link>
      </div>
      <div className="grid grid-cols-6 gap-3">
        {top.map((ad, i) => (
          <button
            key={ad.ad_id}
            type="button"
            onClick={() => onSelect?.(ad)}
            title="Ver detalhes, vídeo e ações"
            className="group block text-left"
          >
            <div
              className="aspect-[9/16] rounded-xl overflow-hidden relative border border-gray-800 group-hover:border-accent/30 transition-colors"
              style={{
                background: ad.thumbnail_url
                  ? `url(${ad.thumbnail_url}) center/cover`
                  : FUNIL_GRAD[ad.funil] ?? FUNIL_GRAD.TOFU,
              }}
            >
              <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                <span className="text-xs font-bold text-accent leading-none">#{i + 1}</span>
              </div>
              {!ad.thumbnail_url && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Play size={18} className="text-white/30" />
                </div>
              )}
            </div>
            <div className="mt-1.5 px-0.5">
              <p className="text-xs text-gray-400 truncate leading-tight"
                title={ad.ad_name}>
                {ad.ad_name?.split("|").pop()?.trim() ?? ad.ad_name}
              </p>
              <p className={`text-xs font-bold mt-0.5 ${+ad.roas >= 5 ? "text-green-400" : +ad.roas >= 3 ? "text-yellow-400" : "text-red-400"}`}>
                {ROAS(ad.roas)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Filtros por nomenclatura (nome do anúncio) ─────────────────────────── */
// Opções "virtuais" do seletor: em vez de filtrar por product_id, filtram pelos
// anúncios cujo ad_name contém o termo. value usa prefixo "nome:" p/ não colidir
// com os UUIDs de produtos reais. Passe [label, term] p/ sobrescrever o termo
// buscado; por padrão term = label em minúsculas.
const mk = (label, term) => ({
  value: `nome:${(term ?? label).toLowerCase()}`,
  label,
  term: (term ?? label).toLowerCase(),
});

// Grupos de influenciadores (menu dependente da categoria).
const INFLU_GROUPS = {
  macro: [
    mk("Dani"), mk("Dani Bm"), mk("Ana Elisa"), mk("Jade"),
    mk("Luciana"), mk("Evelyn"), mk("Dr Ursinho", "ursinho"),
  ],
  micro: [
    mk("Amanda"), mk("Patricia"), mk("Andressa"), mk("Gabi"),
    mk("Aline"), mk("Jamile"), mk("Brenda"),
  ],
  ugc: [
    mk("Ste"), mk("Saly"),
  ],
};

// Rótulos das categorias do primeiro menu.
const CATEGORIAS = [
  { key: "produto", label: "Produto" },
  { key: "macro",   label: "Macro"   },
  { key: "micro",   label: "Micro"   },
  { key: "ugc",     label: "UGC"     },
];

// Lista achatada usada p/ o lookup do filtro por nome (independe da categoria).
const NAME_FILTERS = [...INFLU_GROUPS.macro, ...INFLU_GROUPS.micro, ...INFLU_GROUPS.ugc];

// Casa o termo como PALAVRA INTEIRA no ad_name (delimitada por início/fim ou por
// qualquer caractere não-alfanumérico: espaço, "|", "-", "_", etc.). Evita que
// termos curtos batam como substring — ex.: "ste" (UGC Ste) casaria com "teste".
function makeNameRegex(term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i");
}

/* ─── Main ───────────────────────────────────────────────────────────────── */

export default function Dashboard() {
  const [view,       setView]       = useState("geral"); // geral | ga4
  // Formato dos KPIs: "ecommerce" (loja online) | "local" (negócio local/WhatsApp)
  const [dashFormat, setDashFormat] = useState(() => localStorage.getItem("dash-format") || "ecommerce");
  const [period,     setPeriod]     = useState("7d");
  const [custom,     setCustom]     = useState(defaultCustom());
  const [category,   setCategory]   = useState("");      // "" | produto | macro | micro | ugc
  const [productId,  setProductId]  = useState("");      // valor do 2º menu (UUID de produto ou "nome:...")
  const [selectedAd, setSelectedAd] = useState(null);

  // Debounce: delay the queryKey by 300ms to avoid flicker on rapid switches
  const [dPeriod,    setDPeriod]    = useState(period);
  const [dCustom,    setDCustom]    = useState(custom);
  const [dProductId, setDProductId] = useState(productId);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDPeriod(period);
      setDCustom(custom);
      setDProductId(productId);
    }, 300);
    return () => clearTimeout(timer.current);
  }, [period, custom, productId]);

  // Products
  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id,nome,slug").eq("ativo", true);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 10,
  });

  // Filtro por nomenclatura selecionado? (ex.: "Perfil Nutri")
  const nameFilter = NAME_FILTERS.find((f) => f.value === dProductId) ?? null;
  const nameTerm   = nameFilter?.term ?? null;
  // Quando o filtro é por nome, os RPCs buscam TODOS os produtos e a filtragem
  // por ad_name é feita no client (o RPC só sabe filtrar por product_id).
  const rpcProductId = nameTerm ? "" : dProductId;

  // Current period ads (com auto-pull)
  const {
    rows: curRows, loading: curLoading, syncing, range,
  } = usePeriodAds({ period: dPeriod, custom: dCustom, productId: rpcProductId });

  // Aplica o filtro por nomenclatura (no-op quando não há termo).
  const matchesName = useMemo(() => {
    if (!nameTerm) return () => true;
    const re = makeNameRegex(nameTerm);
    return (r) => re.test(r.ad_name ?? "");
  }, [nameTerm]);
  const curFiltered = useMemo(() => (curRows ?? []).filter(matchesName), [curRows, matchesName]);

  // Previous period ads (for delta)
  const prevDates = getPrevDates(dPeriod, dCustom);
  const { data: prevRows } = useQuery({
    queryKey: ["period-ads", prevDates.s, prevDates.e, rpcProductId || null, null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ads_metrics", {
        p_start:    prevDates.s,
        p_end:      prevDates.e,
        p_product:  rpcProductId || null,
        p_campaign: null,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });
  const prevFiltered = useMemo(() => (prevRows ?? []).filter(matchesName), [prevRows, matchesName]);

  const loading = curLoading || period !== dPeriod || productId !== dProductId || custom !== dCustom;
  const m     = useMemo(() => agg(curFiltered),  [curFiltered]);
  const mPrev = useMemo(() => agg(prevFiltered), [prevFiltered]);

  // Série diária p/ gráficos de tendência (ROAS×CPA e ROAS×Conv. LP).
  // A janela do gráfico é independente do período de KPIs: usa o intervalo
  // selecionado, mas com um mínimo de CHART_MIN_DAYS dias — assim o histórico
  // aparece mesmo quando o KPI é "Hoje"/"Ontem" (que dariam só 1 ponto).
  const { s: periodS, e: periodE } = getPeriodDates(dPeriod, dCustom);
  const chartE = periodE;
  const chartS = minDateStr(periodS, addDaysStr(periodE, -(CHART_MIN_DAYS - 1)));
  const { data: dailyRows } = useQuery({
    queryKey: ["daily-totals", chartS, chartE, rpcProductId || null],
    enabled: !nameTerm, // no filtro por nome usamos a série por ad_id (abaixo)
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_daily_totals", {
        p_start:   chartS,
        p_end:     chartE,
        p_product: rpcProductId || null,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });

  // Filtro por nome: get_daily_totals só filtra por produto. Buscamos os ad_id
  // cujo nome casa (independente do período de KPIs) e agregamos meta_ads_daily
  // por dia na janela do gráfico — assim o histórico aparece mesmo com "Hoje".
  const { data: dailyByName } = useQuery({
    queryKey: ["daily-by-name", chartS, chartE, nameTerm],
    enabled: !!nameTerm,
    queryFn: async () => {
      const { data: nameAds, error: e1 } = await supabase
        .from("meta_ads_cache")
        .select("ad_id, ad_name")
        .ilike("ad_name", `%${nameTerm}%`);
      if (e1) throw e1;
      // ilike pré-filtra no banco; aqui exigimos o termo como palavra inteira
      // (mesma regra do matchesName) p/ não incluir "teste" quando termo é "ste".
      const re = makeNameRegex(nameTerm);
      const ids = (nameAds ?? []).filter((a) => re.test(a.ad_name ?? "")).map((a) => a.ad_id);
      if (!ids.length) return [];

      const { data, error } = await supabase
        .from("meta_ads_daily")
        .select("date, spend, revenue, purchases, landing_page_views")
        .in("ad_id", ids)
        .gte("date", chartS)
        .lte("date", chartE);
      if (error) throw error;
      const byDate = {};
      for (const r of data ?? []) {
        const k = r.date;
        (byDate[k] ??= { date: k, spend: 0, revenue: 0, purchases: 0, lpv: 0 });
        byDate[k].spend     += +r.spend || 0;
        byDate[k].revenue   += +r.revenue || 0;
        byDate[k].purchases += +r.purchases || 0;
        byDate[k].lpv       += +r.landing_page_views || 0;
      }
      return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 1000 * 60 * 5,
  });

  const chartData = useMemo(
    () => ((nameTerm ? dailyByName : dailyRows) ?? []).map((d) => {
      const spend = +d.spend || 0, revenue = +d.revenue || 0,
            purchases = +d.purchases || 0, lpv = +d.lpv || 0;
      const [, mm, dd] = d.date.split("-");
      return {
        dia:    `${dd}/${mm}`,
        roas:   spend > 0 ? revenue / spend : null,
        cpa:    purchases > 0 ? spend / purchases : null,
        convLp: lpv > 0 ? (purchases / lpv) * 100 : null,
      };
    }),
    [dailyRows, dailyByName, nameTerm],
  );

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">

      {/* ── Sub-abas: Visão Geral | Relatório + seletor de formato ───────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-gray-900 rounded-xl border border-gray-800 p-1.5 w-fit">
          {[
            { key: "geral",     label: "Visão Geral", Icon: BarChart2 },
            // GA4 fica oculto no SaaS v1 (só Meta Ads) — volta quando o OAuth
            // Google por workspace for portado: { key: "ga4", label: "GA4", Icon: BarChart3 },
            { key: "relatorio", label: "Relatório",   Icon: FileText  },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                view === key ? "bg-accent text-black shadow-sm" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Formato dos KPIs: e-commerce (loja online) × negócio local (mensagens) */}
        {view === "geral" && (
          <div className="flex items-center gap-1 bg-gray-900 rounded-xl border border-gray-800 p-1.5 w-fit">
            {[
              { key: "ecommerce", label: "E-commerce",    Icon: ShoppingCart  },
              { key: "local",     label: "Tráfego Local", Icon: MessageCircle },
            ].map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                title={key === "local"
                  ? "KPIs para negócio local: mensagens, custo por mensagem, alcance e frequência"
                  : "KPIs para loja online: receita, ROAS, CPA e taxa de conversão"}
                onClick={() => { setDashFormat(key); localStorage.setItem("dash-format", key); }}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  dashFormat === key ? "bg-accent text-black shadow-sm" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "ga4" && <GA4 />}
      {view === "relatorio" && <Relatorio />}

      {view === "geral" && (
      <>
      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4 flex flex-wrap items-center gap-4">
        {/* Period filter (Hoje/Ontem/7d/30d/Personalizado + auto-pull) */}
        <PeriodFilter
          period={period}
          custom={custom}
          onPeriodChange={setPeriod}
          onCustomChange={setCustom}
          syncing={syncing}
        />

        <div className="w-px self-stretch bg-gray-800" />

        {/* Menu 1 — Categoria: Produto | Macro | Micro | UGC */}
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setProductId(""); }}
          className="h-8 rounded-lg border border-gray-700 bg-gray-800 px-3 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
        >
          <option value="">Todas as Categorias</option>
          {CATEGORIAS.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>

        {/* Menu 2 — depende da categoria: produtos ou nomes das influs */}
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          disabled={!category}
          className="h-8 rounded-lg border border-gray-700 bg-gray-800 px-3 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {!category && <option value="">Selecione a categoria</option>}
          {category === "produto" && (
            <>
              <option value="">Todos os Produtos</option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </>
          )}
          {category && category !== "produto" && (
            <>
              <option value="">Todos ({CATEGORIAS.find((c) => c.key === category)?.label})</option>
              {(INFLU_GROUPS[category] ?? []).map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </>
          )}
        </select>

        {/* Contador de anúncios com a nomenclatura selecionada */}
        {nameFilter && !loading && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-accent whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            {m?.adCount ?? 0} anúncio{(m?.adCount ?? 0) !== 1 ? "s" : ""} ativo{(m?.adCount ?? 0) !== 1 ? "s" : ""} com "{nameFilter.label}" no período
          </span>
        )}

        {loading && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
            <RefreshCw size={12} className="animate-spin" />
            Atualizando…
          </div>
        )}
      </div>

      {/* ── KPI Linha 1 ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : dashFormat === "local" ? (
        <div className="grid grid-cols-6 gap-4">
          <KpiCard title="Investimento"       value={m?.spend}            prevValue={mPrev?.spend}            fmt={BRL} icon={DollarSign}    color="#60A5FA" />
          <KpiCard title="Mensagens"          value={m?.messages}         prevValue={mPrev?.messages}         fmt={NUM} icon={MessageCircle} color="#C8FF00" />
          <KpiCard title="Custo por Mensagem" value={m?.custoPorMensagem} prevValue={mPrev?.custoPorMensagem} fmt={BRL} icon={MessageCircle} color="#F87171" invertColor />
          <KpiCard title="Alcance"            value={m?.reach}            prevValue={mPrev?.reach}            fmt={NUM} icon={Users}         color="#38BDF8" />
          <KpiCard title="Compras"            value={m?.purchases}        prevValue={mPrev?.purchases}        fmt={NUM} icon={ShoppingCart}  color="#A78BFA" />
          <KpiCard title="Total de Vendas"    value={m?.revenue}          prevValue={mPrev?.revenue}          fmt={BRL} icon={TrendingUp}    color="#4ADE80" />
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-4">
          <KpiCard title="Investimento"   value={m?.spend}     prevValue={mPrev?.spend}     fmt={BRL}  icon={DollarSign}   color="#60A5FA" />
          <KpiCard title="Receita"        value={m?.revenue}   prevValue={mPrev?.revenue}   fmt={BRL}  icon={TrendingUp}   color="#4ADE80" />
          <KpiCard title="ROAS"           value={m?.roas}      prevValue={mPrev?.roas}      fmt={ROAS} icon={BarChart2}    color="#C8FF00" />
          <KpiCard title="CPA"            value={m?.cpa}       prevValue={mPrev?.cpa}       fmt={BRL}  icon={MousePointer} color="#F87171" invertColor />
          <KpiCard title="Compras"        value={m?.purchases} prevValue={mPrev?.purchases} fmt={NUM}  icon={ShoppingCart} color="#A78BFA" />
          <KpiCard title="CPM"            value={m?.cpm}       prevValue={mPrev?.cpm}       fmt={BRL}  icon={Users}        color="#FB923C" invertColor />
        </div>
      )}

      {/* ── KPI Linha 2 ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : dashFormat === "local" ? (
        <div className="grid grid-cols-5 gap-4">
          <KpiCard title="ROAS"       value={m?.roas}       prevValue={mPrev?.roas}       fmt={ROAS}          icon={BarChart2}    color="#C8FF00" />
          <KpiCard title="CPA"        value={m?.cpa}        prevValue={mPrev?.cpa}        fmt={BRL}           icon={MousePointer} color="#F87171" invertColor />
          <KpiCard title="CPM"        value={m?.cpm}        prevValue={mPrev?.cpm}        fmt={BRL}           icon={Users}        color="#FB923C" invertColor />
          <KpiCard title="CTR"        value={m?.ctr}        prevValue={mPrev?.ctr}        fmt={(v) => PCT(v)} icon={TrendingUp}   color="#4ADE80" />
          <KpiCard title="Frequência" value={m?.frequencia} prevValue={mPrev?.frequencia} fmt={ROAS}          icon={Eye}          color="#C084FC" invertColor />
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-4">
          <KpiCard title="Taxa de Conversão" value={m?.conversionRate} prevValue={mPrev?.conversionRate} fmt={(v) => PCT(v)} icon={TrendingUp}   color="#4ADE80" />
          <KpiCard title="Ticket Médio"      value={m?.ticketMedio}    prevValue={mPrev?.ticketMedio}    fmt={BRL}           icon={DollarSign}   color="#60A5FA" />
          <KpiCard title="Connect Rate"      value={m?.connectRate}    prevValue={mPrev?.connectRate}    fmt={(v) => PCT(v)} icon={MousePointer} color="#C084FC" />
          <KpiCard title="CPC"               value={m?.cpc}            prevValue={mPrev?.cpc}            fmt={BRL}           icon={BarChart2}    color="#FB923C" invertColor />
          <KpiCard title="Custo por Vis. de Página" value={m?.cplpv}  prevValue={mPrev?.cplpv}          fmt={BRL}           icon={Eye}          color="#38BDF8" invertColor />
        </div>
      )}

      {/* ── Gráficos: fadiga criativa + conversão da LP ────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 gap-5">
          <SkeletonBlock h="h-64" /><SkeletonBlock h="h-64" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          <TrendChart
            title="Fadiga Criativa — ROAS × CPA"
            subtitle="ROAS caindo com CPA subindo = criativos cansando; hora de renovar"
            data={chartData}
            left={{  key: "roas", label: "ROAS", color: "#C8FF00", fmt: "roas" }}
            right={{ key: "cpa",  label: "CPA",  color: "#F87171", fmt: "brl"  }}
          />
          <TrendChart
            title="Conversão da LP"
            subtitle="Compras ÷ visualizações da página — mede a página, não o anúncio"
            data={chartData}
            left={{ key: "convLp", label: "Conv. LP", color: "#38BDF8", fmt: "pct" }}
          />
        </div>
      )}

      {/* ── Funil de Aquisição ─────────────────────────────────────────── */}
      {loading ? <SkeletonBlock h="h-36" /> : <FunnelAquisicao m={m} />}

      {/* ── Performance por Produto + Segmento ────────────────────────── */}
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2">
          {loading
            ? <SkeletonBlock h="h-48" />
            : <ProductTable rows={curFiltered} products={products} groupBy={dProductId ? "campaign" : "product"} />
          }
        </div>
        <div>
          {loading
            ? <SkeletonBlock h="h-48" />
            : <SegmentBlock rows={curFiltered} />
          }
        </div>
      </div>

      {/* ── Top Criativos ─────────────────────────────────────────────── */}
      {loading
        ? <SkeletonBlock h="h-52" />
        : <TopCreativosBlock rows={curFiltered} onSelect={setSelectedAd} />
      }

      {/* ── Modal completo do criativo ────────────────────────────────── */}
      {selectedAd && (
        <CreativeModal
          ad={selectedAd}
          products={products}
          periodo={{ inicio: range.s, fim: range.e }}
          onClose={() => setSelectedAd(null)}
        />
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {!loading && !curFiltered.length && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
          <p className="text-gray-400 text-sm mb-1">
            {nameFilter
              ? `Nenhum anúncio com "${nameFilter.label}" neste período.`
              : "Nenhum dado para este período."}
          </p>
          <p className="text-gray-600 text-xs">
            Sincronize os dados do Meta para este intervalo de datas.
          </p>
        </div>
      )}
      </>
      )}
    </div>
  );
}

/**
 * Relatório Executivo — sub-aba Dashboard → Relatório
 *
 * Relatório de Meta Ads no padrão do analista:
 *   1. ROAS da plataforma vs. referência (número que decide a saúde da conta)
 *   2. Público: Cold (prospecting) · Remarketing (engaged) · Clientes (existing)
 *      — breakdown oficial user_segment_key da Meta, nunca só o blended
 *   3. Funil impressões → cliques → LPV → checkout → compras
 *   4. Diagnósticos automáticos com gatilho NUMÉRICO (não opinião):
 *      fadiga, queda de CTR, aumento de CPA, zumbi, pronto p/ escalar,
 *      aprendizado limitado, versão melhor pausada ("caso JADE TOFU")
 *   5. Vencedores / perdedores por linha de produto com régua de
 *      significância: ≥100 cliques OU ≥20 compras, e ≥7 dias ativos
 *   6. Resumo executivo gerado dos dados: problemas → hipóteses → ações
 *
 * Fonte: RPCs da migration 0027 (get_report_segments,
 * get_report_campaigns_daily, get_report_ads) sobre meta_ads_daily,
 * meta_ads_segments e meta_ads_cache.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, TrendingDown, ShoppingCart, Target, Flame,
  Snowflake, RefreshCw, Users, AlertTriangle, CheckCircle2, PauseCircle,
  Trophy, ThumbsDown, Zap, Ghost, GraduationCap, ArrowDownRight,
  ArrowUpRight, Minus, FileText,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { PeriodFilter } from "../../components/ui/PeriodFilter";
import { getPeriodDates, getPrevDates, defaultCustom } from "../../lib/periods";

/* ─── Metas e referências (definidas pelo gestor) ────────────────────────── */
const CPA_META_MAX = 66;   // teto da meta de CPA (R$ 60–66)
const CPA_ALERTA   = 85;   // acima disso = vermelho
const ROAS_REF     = 3.13; // referência blended saudável (3,13–3,33)
const ROAS_COLD    = 1.91; // benchmark cold da operação
const SIG_CLIQUES  = 100;  // régua de significância
const SIG_COMPRAS  = 20;
const SIG_DIAS     = 7;

/* ─── Formatters ─────────────────────────────────────────────────────────── */
const BRL = (v, d = 0) =>
  v == null || isNaN(v) ? "—"
  : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL",
      minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const NUM  = (v) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(v)));
const PCT  = (v, d = 1) => (v == null || isNaN(v) ? "—" : v.toFixed(d).replace(".", ",") + "%");
const X2   = (v) => (v == null || isNaN(v) ? "—" : v.toFixed(2).replace(".", ",") + "x");

/* Semáforo de CPA e ROAS */
const cpaColor  = (v) => (v == null ? "text-gray-500" : v <= CPA_META_MAX ? "text-emerald-400" : v <= CPA_ALERTA ? "text-yellow-400" : "text-red-400");
const roasColor = (v, ref = ROAS_REF) => (v == null ? "text-gray-500" : v >= ref ? "text-emerald-400" : v >= ref * 0.8 ? "text-yellow-400" : "text-red-400");

/* ─── Agregação ──────────────────────────────────────────────────────────── */
const sum = (rows, k) => rows.reduce((s, r) => s + (+r[k] || 0), 0);
function kpisOf(rows) {
  const spend = sum(rows, "spend"), revenue = sum(rows, "revenue"),
    purchases = sum(rows, "purchases"), imp = sum(rows, "impressions"),
    clicks = sum(rows, "link_clicks"), lpv = sum(rows, "landing_page_views"),
    v3 = sum(rows, "video_views_3s");
  return {
    spend, revenue, purchases, imp, clicks, lpv,
    roas: spend > 0 ? revenue / spend : null,
    cpa:  purchases > 0 ? spend / purchases : null,
    ctr:  imp > 0 ? (clicks / imp) * 100 : null,
    cpc:  clicks > 0 ? spend / clicks : null,
    cpm:  imp > 0 ? (spend / imp) * 1000 : null,
    cvr:  clicks > 0 ? (purchases / clicks) * 100 : null,
    thumbstop: imp > 0 ? (v3 / imp) * 100 : null,
    aov: purchases > 0 ? revenue / purchases : null,
  };
}
const pctDelta = (cur, prev) => (cur == null || !prev ? null : ((cur - prev) / prev) * 100);

/* ─── Sub-componentes visuais ────────────────────────────────────────────── */
function Delta({ value, invert = false, suffix = "%" }) {
  if (value == null || isNaN(value)) return <span className="text-gray-600 text-[11px]">—</span>;
  const good = invert ? value < 0 : value > 0;
  const Icon = Math.abs(value) < 0.5 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${
      Math.abs(value) < 0.5 ? "text-gray-500" : good ? "text-emerald-400" : "text-red-400"}`}>
      <Icon size={11} />{Math.abs(value).toFixed(1).replace(".", ",")}{suffix}
    </span>
  );
}

function BigKpi({ title, value, colorClass = "text-white", delta, invert, icon: Icon, iconColor = "#C8FF00", caption }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-400 truncate">{title}</p>
        {Icon && (
          <div className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ backgroundColor: `${iconColor}1A` }}>
            <Icon size={14} style={{ color: iconColor }} />
          </div>
        )}
      </div>
      <p className={`text-xl lg:text-2xl font-bold leading-none tabular-nums ${colorClass}`}>{value}</p>
      <div className="flex items-center justify-between gap-2 min-h-[14px]">
        {caption ? <p className="text-[11px] text-gray-500 truncate">{caption}</p> : <span />}
        {delta !== undefined && <Delta value={delta} invert={invert} />}
      </div>
    </div>
  );
}

/* Card de segmento de público (Cold / Remarketing / Clientes) */
function SegmentCard({ title, icon: Icon, color, k, prev, sharePct, refRoas }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ backgroundColor: `${color}1A` }}>
          <Icon size={15} style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-[11px] text-gray-500">{sharePct != null ? `${sharePct.toFixed(0)}% do investimento` : "—"}</p>
        </div>
      </div>

      {/* Barra de share do spend */}
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(sharePct ?? 0, 100)}%`, backgroundColor: color }} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">ROAS</p>
          <p className={`text-lg font-bold tabular-nums ${roasColor(k?.roas, refRoas)}`}>{X2(k?.roas)}</p>
          <Delta value={pctDelta(k?.roas, prev?.roas)} />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">CPA</p>
          <p className={`text-lg font-bold tabular-nums ${cpaColor(k?.cpa)}`}>{BRL(k?.cpa, 0)}</p>
          <Delta value={pctDelta(k?.cpa, prev?.cpa)} invert />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Investido</p>
          <p className="text-sm font-semibold text-gray-200 tabular-nums">{BRL(k?.spend)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Compras</p>
          <p className="text-sm font-semibold text-gray-200 tabular-nums">{NUM(k?.purchases)}</p>
        </div>
      </div>
    </div>
  );
}

/* Funil com barras proporcionais e taxa de passagem entre etapas */
function Funnel({ k }) {
  const steps = [
    { label: "Impressões",      value: k?.imp,       fmt: NUM },
    { label: "Cliques no link", value: k?.clicks,    fmt: NUM },
    { label: "Página de venda", value: k?.lpv,       fmt: NUM },
    { label: "Compras",         value: k?.purchases, fmt: NUM },
  ].filter((s) => s.value != null);
  const max = steps[0]?.value || 1;
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const rate = prev ? (s.value / prev) * 100 : null;
        const w = Math.max((s.value / max) * 100, 1.5);
        return (
          <div key={s.label} className="flex items-center gap-3">
            <p className="w-28 shrink-0 text-[11px] text-gray-400 text-right">{s.label}</p>
            <div className="flex-1 h-7 bg-gray-800/60 rounded-lg overflow-hidden relative">
              <div className="h-full rounded-lg bg-accent/80" style={{ width: `${w}%`, minWidth: 8 }} />
              <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold text-black mix-blend-normal"
                style={{ color: w > 25 ? "#000" : "#F0F0F4", left: w > 25 ? 8 : `calc(${w}% + 8px)` }}>
                {s.fmt(s.value)}
              </span>
            </div>
            <p className="w-14 shrink-0 text-[11px] tabular-nums text-gray-500">{rate != null ? PCT(rate, rate < 10 ? 1 : 0) : ""}</p>
          </div>
        );
      })}
    </div>
  );
}

/* Card de diagnóstico com contagem, cor de severidade e lista expansível */
function DiagCard({ icon: Icon, title, rule, items, tone, renderItem }) {
  const [open, setOpen] = useState(false);
  const n = items.length;
  const toneMap = {
    red:    { ring: "border-red-500/40",    chip: "bg-red-500/15 text-red-400",       icon: "#f87171" },
    yellow: { ring: "border-yellow-500/40", chip: "bg-yellow-500/15 text-yellow-400", icon: "#facc15" },
    green:  { ring: "border-emerald-500/40",chip: "bg-emerald-500/15 text-emerald-400", icon: "#34d399" },
    gray:   { ring: "border-gray-800",      chip: "bg-gray-800 text-gray-400",        icon: "#7E7E8A" },
  };
  const t = toneMap[n === 0 ? "gray" : tone];
  return (
    <div className={`bg-gray-900 rounded-xl border ${t.ring} p-4 flex flex-col gap-2`}>
      <button type="button" onClick={() => n > 0 && setOpen((v) => !v)}
        className={`flex items-center gap-2.5 text-left ${n > 0 ? "cursor-pointer" : "cursor-default"}`}>
        <Icon size={16} style={{ color: t.icon }} className="shrink-0" />
        <span className="text-sm font-semibold text-white flex-1">{title}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${t.chip}`}>{n}</span>
      </button>
      <p className="text-[11px] text-gray-500 leading-snug">{rule}</p>
      {open && n > 0 && (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-gray-800 pt-2">
          {items.slice(0, 8).map(renderItem)}
          {n > 8 && <p className="text-[11px] text-gray-500">+ {n - 8} outros…</p>}
        </div>
      )}
    </div>
  );
}

/* Linha de anúncio (vencedor/perdedor) */
function AdRow({ ad, tone }) {
  return (
    <div className="flex items-center gap-3 bg-gray-800/40 rounded-lg px-3 py-2">
      {ad.thumbnail_url
        ? <img src={ad.thumbnail_url} alt="" className="w-9 h-9 rounded-md object-cover shrink-0 border border-gray-700" />
        : <div className="w-9 h-9 rounded-md bg-gray-800 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-100 truncate" title={ad.ad_name}>{ad.ad_name}</p>
        <p className="text-[10px] text-gray-500 truncate">{ad.produto} · {NUM(ad.purchases)} compras · {BRL(ad.spend)} investidos</p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-sm font-bold tabular-nums ${tone === "win" ? "text-emerald-400" : "text-red-400"}`}>{X2(ad.k.roas)}</p>
        <p className={`text-[10px] tabular-nums ${cpaColor(ad.k.cpa)}`}>CPA {BRL(ad.k.cpa)}</p>
      </div>
    </div>
  );
}

/* ─── Componente principal ───────────────────────────────────────────────── */
export default function Relatorio() {
  const [period, setPeriod]   = useState("30d");
  const [custom, setCustom]   = useState(defaultCustom());
  const [produto, setProduto] = useState("todos");

  const { s, e }   = getPeriodDates(period, custom);
  const prev       = getPrevDates(period, custom);
  const last7      = useMemo(() => {
    const end = new Date(e + "T00:00:00");
    const st  = new Date(end); st.setDate(st.getDate() - 6);
    const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { s: f(st), e };
  }, [e]);

  /* ── Dados ── */
  const rpc = async (name, args) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return data ?? [];
  };
  const STALE = 5 * 60 * 1000;

  const segsQ  = useQuery({ queryKey: ["rel-segs", s, e], staleTime: STALE,
    queryFn: () => rpc("get_report_segments", { p_start: s, p_end: e }) });
  const segsPQ = useQuery({ queryKey: ["rel-segs-prev", prev.s, prev.e], staleTime: STALE,
    queryFn: () => rpc("get_report_segments", { p_start: prev.s, p_end: prev.e }) });
  // série diária cobrindo período anterior + atual (WoW, streaks, fadiga)
  const campQ  = useQuery({ queryKey: ["rel-camps", prev.s, e], staleTime: STALE,
    queryFn: () => rpc("get_report_campaigns_daily", { p_start: prev.s, p_end: e }) });
  const adsQ   = useQuery({ queryKey: ["rel-ads", s, e], staleTime: STALE,
    queryFn: () => rpc("get_report_ads", { p_start: s, p_end: e }) });
  const ads7Q  = useQuery({ queryKey: ["rel-ads7", last7.s, last7.e], staleTime: STALE,
    queryFn: () => rpc("get_report_ads", { p_start: last7.s, p_end: last7.e }) });

  const loading  = segsQ.isLoading || campQ.isLoading || adsQ.isLoading;
  const rpcError = [segsQ, segsPQ, campQ, adsQ, ads7Q].find((x) => x.error)?.error;

  /* ── Filtro por produto ── */
  const inScope = (row) => produto === "todos" || row.produto === produto;

  /* ── Derivações ── */
  const R = useMemo(() => {
    const camps  = (campQ.data ?? []).filter(inScope);
    const ads    = (adsQ.data ?? []).filter(inScope);
    const ads7   = (ads7Q.data ?? []).filter(inScope);
    const segs   = (segsQ.data ?? []).filter(inScope);
    const segsP  = (segsPQ.data ?? []).filter(inScope);

    const cur  = camps.filter((r) => r.date >= s);
    const pre  = camps.filter((r) => r.date < s);
    const tot  = kpisOf(cur), totPrev = kpisOf(pre);

    /* segmentos: prospecting=cold, engaged=remarketing, existing=clientes */
    const seg = (rows, key) => kpisOf(rows.filter((r) => r.segment === key));
    const S  = { cold: seg(segs, "prospecting"), rmkt: seg(segs, "engaged"), cli: seg(segs, "existing") };
    const SP = { cold: seg(segsP, "prospecting"), rmkt: seg(segsP, "engaged"), cli: seg(segsP, "existing") };
    const segSpend = S.cold.spend + S.rmkt.spend + S.cli.spend;

    /* por campanha */
    const byCamp = new Map();
    for (const r of camps) {
      if (!byCamp.has(r.campaign_id)) byCamp.set(r.campaign_id, { name: r.campaign_name, status: r.campaign_status, produto: r.produto, days: [] });
      byCamp.get(r.campaign_id).days.push(r);
    }
    const campRows = [];
    for (const [id, c] of byCamp) {
      const curD = c.days.filter((r) => r.date >= s);
      if (!curD.length || sum(curD, "spend") < 1) continue;
      const sorted = [...curD].sort((a, b) => (a.date < b.date ? 1 : -1)); // desc
      const w1 = kpisOf(sorted.slice(0, 7));                    // últimos 7d
      const w0 = kpisOf(sorted.slice(7, 14));                   // 7d anteriores
      const k  = kpisOf(curD);
      // streak: dias CONSECUTIVOS de calendário (a partir do dia mais recente
      // com entrega) com CPA ≤ meta e ≥1 compra — dia faltante quebra a série
      let streak = 0;
      let expected = sorted[0]?.date;
      for (const d of sorted) {
        if (d.date !== expected) break;
        if (!(+d.purchases > 0 && +d.spend / +d.purchases <= CPA_META_MAX)) break;
        streak++;
        const dt = new Date(d.date + "T00:00:00");
        dt.setDate(dt.getDate() - 1);
        expected = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      }
      // zumbi de campanha: gastou nos últimos 7 dias e 0 compras
      const zombie = c.status === "ACTIVE" && w1.spend > 50 && w1.purchases === 0 && sorted.length >= 7;
      const ctrWoW = pctDelta(w1.ctr, w0.ctr);
      const cpaWoW = pctDelta(w1.cpa, w0.cpa);
      const thumbWoW = pctDelta(w1.thumbstop, w0.thumbstop);
      const fatigueTriggers = [
        ctrWoW != null && ctrWoW <= -20 && "CTR −20%+ WoW",
        cpaWoW != null && cpaWoW >= 30 && "CPA +30%+ WoW",
        thumbWoW != null && thumbWoW <= -20 && "Thumbstop −20%+ WoW",
      ].filter(Boolean);
      campRows.push({ id, ...c, k, w1, w0, streak, zombie, ctrWoW, cpaWoW, fatigueTriggers });
    }
    campRows.sort((a, b) => b.k.spend - a.k.spend);

    /* por anúncio */
    const adRows = ads.map((a) => ({ ...a, k: kpisOf([a]),
      sig: (+a.link_clicks >= SIG_CLIQUES || +a.purchases >= SIG_COMPRAS) && +a.days_active >= SIG_DIAS }));
    const sig = adRows.filter((a) => a.sig && a.k.roas != null);
    const winners = [...sig].filter((a) => (a.k.roas ?? 0) >= 3 && a.effective_status === "ACTIVE").sort((a, b) => b.k.roas - a.k.roas);
    const losers  = [...sig].filter((a) => a.effective_status === "ACTIVE" && ((a.k.roas ?? 0) < 1.2 || (a.k.cpa ?? 0) > CPA_ALERTA)).sort((a, b) => b.k.spend - a.k.spend);

    const ads7Map = new Map(ads7.map((a) => [a.ad_id, a]));
    const zombies = adRows
      .filter((a) => a.effective_status === "ACTIVE")
      .map((a) => ({ ...a, a7: ads7Map.get(a.ad_id) }))
      .filter((a) => a.a7 && +a.a7.spend > 50 && +a.a7.purchases === 0)
      .sort((a, b) => +b.a7.spend - +a.a7.spend);

    /* versão melhor pausada na MESMA campanha (aproximação do caso JADE TOFU) */
    const pausedBetter = [];
    for (const [cid] of byCamp) {
      const inCamp  = adRows.filter((a) => a.campaign_id === cid);
      const actives = inCamp.filter((a) => a.effective_status === "ACTIVE" && a.k.spend > 100 && a.sig);
      const paused  = inCamp.filter((a) => (a.effective_status ?? "").includes("PAUSED") && +a.purchases >= SIG_COMPRAS && (a.k.roas ?? 0) >= 2);
      if (!actives.length || !paused.length) continue;
      const bestPaused = paused.reduce((m, a) => (a.k.roas > m.k.roas ? a : m));
      const worstActive = actives.reduce((m, a) => ((a.k.roas ?? 0) < (m.k.roas ?? 0) ? a : m));
      if ((worstActive.k.roas ?? 0) < 0.7 * bestPaused.k.roas)
        pausedBetter.push({ campaign: bestPaused.campaign_name, active: worstActive, paused: bestPaused });
    }

    const diagnostics = {
      fadiga:    campRows.filter((c) => c.fatigueTriggers.length >= 2),
      quedaCtr:  campRows.filter((c) => c.ctrWoW != null && c.ctrWoW <= -20),
      altaCpa:   campRows.filter((c) => c.cpaWoW != null && c.cpaWoW >= 30),
      escalar:   campRows.filter((c) => c.streak >= 5),
      aprendiz:  campRows.filter((c) => c.status === "ACTIVE" && c.w1.purchases < 50 && c.w1.spend > 500),
      zumbis:    zombies,
      pausedBetter,
    };

    /* por produto (hierarquia de KPIs) */
    const prods = [...new Set(camps.map((r) => r.produto))].filter((p) => p !== "Outros");
    const byProd = prods.map((p) => ({ produto: p, k: kpisOf(cur.filter((r) => r.produto === p)) }))
      .filter((r) => r.k.spend > 0).sort((a, b) => b.k.spend - a.k.spend);

    return { tot, totPrev, S, SP, segSpend, campRows, winners, losers, diagnostics, byProd };
  }, [campQ.data, adsQ.data, ads7Q.data, segsQ.data, segsPQ.data, s, produto]);

  /* ── Resumo executivo gerado dos dados ── */
  const resumo = useMemo(() => {
    if (!R?.tot?.spend) return [];
    const out = [];
    const d = R.diagnostics;
    if (R.tot.roas != null)
      out.push({ pri: R.tot.roas >= ROAS_REF ? "ok" : "média",
        texto: `ROAS blended ${X2(R.tot.roas)} (referência ${X2(ROAS_REF)}) · cold ${X2(R.S.cold.roas)} vs benchmark ${X2(ROAS_COLD)} · CPA geral ${BRL(R.tot.cpa)} (meta ≤ ${BRL(CPA_META_MAX)}).` });
    d.pausedBetter.forEach((p) => out.push({ pri: "alta",
      texto: `"${p.active.ad_name}" segue ATIVO com ROAS ${X2(p.active.k.roas)} enquanto "${p.paused.ad_name}" (ROAS ${X2(p.paused.k.roas)}) está pausado na mesma campanha — revisar qual versão deveria rodar.` }));
    d.zumbis.slice(0, 3).forEach((z) => out.push({ pri: "alta",
      texto: `Zumbi: "${z.ad_name}" gastou ${BRL(+z.a7.spend)} nos últimos 7 dias sem nenhuma compra — pausar ou trocar criativo.` }));
    d.fadiga.forEach((c) => out.push({ pri: "média",
      texto: `Fadiga em "${c.name}": ${c.fatigueTriggers.join(" + ")} — preparar criativo substituto antes que o CPA suba.` }));
    d.altaCpa.filter((c) => !d.fadiga.includes(c)).forEach((c) => out.push({ pri: "média",
      texto: `CPA de "${c.name}" subiu ${c.cpaWoW.toFixed(0)}% WoW (${BRL(c.w0.cpa)} → ${BRL(c.w1.cpa)}) — investigar leilão/criativo.` }));
    d.escalar.forEach((c) => out.push({ pri: "alta",
      texto: `"${c.name}" está há ${c.streak} dias consecutivos com CPA ≤ ${BRL(CPA_META_MAX)} — candidata a aumento de orçamento (+20%).` }));
    d.aprendiz.forEach((c) => out.push({ pri: "baixa",
      texto: `"${c.name}" com ${NUM(c.w1.purchases)} conversões em 7 dias (<50) — aprendizado limitado; consolidar conjuntos ou ampliar público.` }));
    if (!out.length) out.push({ pri: "ok", texto: "Nenhum problema detectado pelos gatilhos automáticos no período." });
    return out;
  }, [R]);

  /* ── Estados de carregamento/erro ── */
  if (rpcError) {
    const missing = /get_report|schema cache|function/i.test(rpcError.message ?? "");
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center space-y-2">
        <AlertTriangle className="mx-auto text-yellow-400" size={22} />
        <p className="text-sm text-gray-200 font-semibold">
          {missing ? "Migration 0027 ainda não aplicada no Supabase" : "Erro ao carregar o relatório"}
        </p>
        <p className="text-xs text-gray-500">{rpcError.message}</p>
      </div>
    );
  }

  const PRODS = ["todos", ...new Set((campQ.data ?? []).map((r) => r.produto))].filter((p) => p !== "Outros");

  return (
    <div className="space-y-5">
      {/* ── Filtros ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4 flex flex-wrap items-center gap-4">
        <PeriodFilter period={period} custom={custom} onPeriodChange={setPeriod} onCustomChange={setCustom} />
        <div className="flex items-center gap-1 flex-wrap ml-auto">
          {PRODS.map((p) => (
            <button key={p} type="button" onClick={() => setProduto(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                produto === p ? "bg-accent text-black shadow-sm" : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"}`}>
              {p === "todos" ? "Todos" : p === "LM" ? "Laranja Moro" : p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 h-28 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* ── 1. Saúde da conta ── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <BigKpi title="ROAS (plataforma)" value={X2(R.tot.roas)} colorClass={roasColor(R.tot.roas)}
              delta={pctDelta(R.tot.roas, R.totPrev.roas)} icon={TrendingUp}
              caption={`referência ${X2(ROAS_REF)}`} />
            <BigKpi title="CPA" value={BRL(R.tot.cpa)} colorClass={cpaColor(R.tot.cpa)}
              delta={pctDelta(R.tot.cpa, R.totPrev.cpa)} invert icon={Target} iconColor="#f97316"
              caption={`meta R$ 60–${CPA_META_MAX}`} />
            <BigKpi title="Investido" value={BRL(R.tot.spend)}
              delta={pctDelta(R.tot.spend, R.totPrev.spend)} icon={DollarSign}
              caption="vs período anterior" />
            <BigKpi title="Compras" value={NUM(R.tot.purchases)}
              delta={pctDelta(R.tot.purchases, R.totPrev.purchases)} icon={ShoppingCart} iconColor="#38bdf8"
              caption={`ticket médio ${BRL(R.tot.aov)}`} />
            <BigKpi title="Receita" value={BRL(R.tot.revenue)}
              delta={pctDelta(R.tot.revenue, R.totPrev.revenue)} icon={TrendingUp} iconColor="#34d399"
              caption="valor de compras" />
          </div>

          {/* ── 2. Público: cold / remarketing / clientes ── */}
          <div>
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Users size={14} className="text-accent" /> Público — nunca olhe só o blended
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SegmentCard title="Cold (prospecting)" icon={Snowflake} color="#38bdf8"
                k={R.S.cold} prev={R.SP.cold} refRoas={ROAS_COLD}
                sharePct={R.segSpend ? (R.S.cold.spend / R.segSpend) * 100 : null} />
              <SegmentCard title="Remarketing (engajados)" icon={RefreshCw} color="#C8FF00"
                k={R.S.rmkt} prev={R.SP.rmkt} refRoas={ROAS_REF}
                sharePct={R.segSpend ? (R.S.rmkt.spend / R.segSpend) * 100 : null} />
              <SegmentCard title="Clientes (recompra)" icon={Users} color="#a78bfa"
                k={R.S.cli} prev={R.SP.cli} refRoas={ROAS_REF}
                sharePct={R.segSpend ? (R.S.cli.spend / R.segSpend) * 100 : null} />
            </div>
          </div>

          {/* ── 3. Funil + hierarquia por produto ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-bold text-white mb-3">Funil do período</h3>
              <Funnel k={R.tot} />
              <p className="mt-3 text-[11px] text-gray-500">
                CTR {PCT(R.tot.ctr, 2)} · CPC {BRL(R.tot.cpc, 2)} · CPM {BRL(R.tot.cpm, 2)} · Thumbstop {PCT(R.tot.thumbstop)} · Conv. por clique {PCT(R.tot.cvr, 2)}
              </p>
            </div>

            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 overflow-x-auto">
              <h3 className="text-sm font-bold text-white mb-3">Linhas de produto</h3>
              <table className="w-full text-xs min-w-[420px]">
                <thead>
                  <tr className="text-gray-500 text-[10px] uppercase tracking-wide">
                    <th className="text-left pb-2 font-medium">Produto</th>
                    <th className="text-right pb-2 font-medium">Investido</th>
                    <th className="text-right pb-2 font-medium">ROAS</th>
                    <th className="text-right pb-2 font-medium">CPA</th>
                    <th className="text-right pb-2 font-medium">CTR</th>
                    <th className="text-right pb-2 font-medium">Thumbstop</th>
                    <th className="text-right pb-2 font-medium">Compras</th>
                  </tr>
                </thead>
                <tbody>
                  {R.byProd.map((r) => (
                    <tr key={r.produto} className="border-t border-gray-800">
                      <td className="py-2 font-semibold text-gray-100">{r.produto === "LM" ? "Laranja Moro" : r.produto}</td>
                      <td className="py-2 text-right tabular-nums text-gray-300">{BRL(r.k.spend)}</td>
                      <td className={`py-2 text-right tabular-nums font-bold ${roasColor(r.k.roas)}`}>{X2(r.k.roas)}</td>
                      <td className={`py-2 text-right tabular-nums font-bold ${cpaColor(r.k.cpa)}`}>{BRL(r.k.cpa)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-300">{PCT(r.k.ctr, 2)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-300">{PCT(r.k.thumbstop)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-300">{NUM(r.k.purchases)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── 4. Diagnósticos automáticos ── */}
          <div>
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Zap size={14} className="text-accent" /> Diagnósticos automáticos
              <span className="text-[11px] font-normal text-gray-500">gatilhos numéricos · sem opinião</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <DiagCard icon={PauseCircle} title="Versão melhor pausada" tone="red"
                rule={`Anúncio pausado com ROAS ≥ 2x e ≥ ${SIG_COMPRAS} compras supera em 30%+ um ativo da mesma campanha (caso "JADE TOFU").`}
                items={R.diagnostics.pausedBetter}
                renderItem={(p, i) => (
                  <div key={i} className="text-[11px] leading-snug">
                    <p className="text-red-400 font-semibold truncate">▶ {p.active.ad_name} <span className="text-gray-500">({X2(p.active.k.roas)})</span></p>
                    <p className="text-emerald-400 truncate">⏸ {p.paused.ad_name} <span className="text-gray-500">({X2(p.paused.k.roas)})</span></p>
                  </div>
                )} />
              <DiagCard icon={Ghost} title="Zumbis" tone="red"
                rule="Anúncio ativo com gasto > R$ 50 nos últimos 7 dias e nenhuma compra."
                items={R.diagnostics.zumbis}
                renderItem={(z) => (
                  <p key={z.ad_id} className="text-[11px] text-gray-300 truncate">
                    {z.ad_name} <span className="text-red-400 font-semibold">{BRL(+z.a7.spend)} / 0 compras</span>
                  </p>
                )} />
              <DiagCard icon={Flame} title="Fadiga de criativo" tone="yellow"
                rule="2+ gatilhos: CTR −20% WoW · CPA +30% WoW · Thumbstop −20% WoW."
                items={R.diagnostics.fadiga}
                renderItem={(c) => (
                  <p key={c.id} className="text-[11px] text-gray-300 truncate">{c.name} <span className="text-yellow-400">({c.fatigueTriggers.join(" · ")})</span></p>
                )} />
              <DiagCard icon={TrendingUp} title="Pronto para escalar" tone="green"
                rule={`CPA ≤ ${BRL(CPA_META_MAX)} por 5+ dias consecutivos (com compra todo dia).`}
                items={R.diagnostics.escalar}
                renderItem={(c) => (
                  <p key={c.id} className="text-[11px] text-gray-300 truncate">{c.name} <span className="text-emerald-400 font-semibold">{c.streak} dias na meta</span></p>
                )} />
              <DiagCard icon={ArrowDownRight} title="Queda de CTR" tone="yellow"
                rule="CTR caiu mais de 20% vs semana anterior (abaixo disso é ruído)."
                items={R.diagnostics.quedaCtr}
                renderItem={(c) => (
                  <p key={c.id} className="text-[11px] text-gray-300 truncate">{c.name} <span className="text-yellow-400">{c.ctrWoW.toFixed(0)}%</span></p>
                )} />
              <DiagCard icon={ArrowUpRight} title="Aumento de CPA" tone="yellow"
                rule="CPA subiu mais de 30% vs semana anterior."
                items={R.diagnostics.altaCpa}
                renderItem={(c) => (
                  <p key={c.id} className="text-[11px] text-gray-300 truncate">{c.name} <span className="text-yellow-400">+{c.cpaWoW.toFixed(0)}% ({BRL(c.w0.cpa)} → {BRL(c.w1.cpa)})</span></p>
                )} />
              <DiagCard icon={GraduationCap} title="Aprendizado limitado" tone="yellow"
                rule="Campanha ativa com menos de 50 conversões nos últimos 7 dias."
                items={R.diagnostics.aprendiz}
                renderItem={(c) => (
                  <p key={c.id} className="text-[11px] text-gray-300 truncate">{c.name} <span className="text-yellow-400">{NUM(c.w1.purchases)} conv/7d</span></p>
                )} />
              <DiagCard icon={CheckCircle2} title="Campanhas saudáveis" tone="green"
                rule="Sem nenhum gatilho de problema no período."
                items={R.campRows.filter((c) =>
                  !c.zombie && c.fatigueTriggers.length < 2 &&
                  !(c.ctrWoW != null && c.ctrWoW <= -20) && !(c.cpaWoW != null && c.cpaWoW >= 30))}
                renderItem={(c) => (
                  <p key={c.id} className="text-[11px] text-gray-300 truncate">{c.name} <span className="text-gray-500">{X2(c.k.roas)} · CPA {BRL(c.k.cpa)}</span></p>
                )} />
            </div>
          </div>

          {/* ── 5. Vencedores × Perdedores ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <Trophy size={14} className="text-emerald-400" /> Vencedores
              </h3>
              <p className="text-[11px] text-gray-500 mb-3">ROAS ≥ 3x · ativos · amostra significante (≥{SIG_CLIQUES} cliques ou ≥{SIG_COMPRAS} compras, ≥{SIG_DIAS} dias)</p>
              <div className="flex flex-col gap-1.5">
                {R.winners.slice(0, 8).map((a) => <AdRow key={a.ad_id} ad={a} tone="win" />)}
                {!R.winners.length && <p className="text-xs text-gray-500">Nenhum vencedor com amostra significante no período.</p>}
              </div>
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <ThumbsDown size={14} className="text-red-400" /> Perdedores (ainda ativos)
              </h3>
              <p className="text-[11px] text-gray-500 mb-3">ROAS &lt; 1,2x ou CPA &gt; {BRL(CPA_ALERTA)} · amostra significante · ordenado por gasto</p>
              <div className="flex flex-col gap-1.5">
                {R.losers.slice(0, 8).map((a) => <AdRow key={a.ad_id} ad={a} tone="lose" />)}
                {!R.losers.length && <p className="text-xs text-gray-500">Nenhum perdedor significante ativo. 👌</p>}
              </div>
            </div>
          </div>

          {/* ── 6. Resumo executivo ── */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <FileText size={14} className="text-accent" /> Resumo executivo — ações recomendadas
            </h3>
            <div className="flex flex-col gap-2">
              {resumo.map((r, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                    r.pri === "alta" ? "bg-red-500/15 text-red-400"
                    : r.pri === "média" ? "bg-yellow-500/15 text-yellow-400"
                    : r.pri === "baixa" ? "bg-sky-500/15 text-sky-400"
                    : "bg-emerald-500/15 text-emerald-400"}`}>
                    {r.pri === "ok" ? "info" : r.pri}
                  </span>
                  <p className="text-xs text-gray-300 leading-relaxed">{r.texto}</p>
                </div>
              ))}
              <p className="text-[10px] text-gray-600 mt-1">
                Nenhuma alteração é executada automaticamente — este bloco apenas recomenda. Frequência por conjunto e limite de orçamento exigem dados que ainda não são sincronizados (ver Configurações → Sync).
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, RefreshCw, Loader2, Tags } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { useAutoClassify } from "../../hooks/useAutoClassify";
import { usePeriodAds } from "../../hooks/usePeriodAds";
import { useConfigBenchmarks } from "../../hooks/useConfig";
import { useFunilReal } from "../../hooks/useFunilReal";
import { PeriodFilter } from "../../components/ui/PeriodFilter";
import { CreativeThumb } from "../../components/ui/CreativeThumb";
import { EntregaBadge } from "../../components/ui/EntregaBadge";
import { defaultCustom } from "../../lib/periods";
import { buildBenchMap, metricLevel, LEVEL_PILL } from "../../lib/metricScale";
import CreativeModal from "../../components/CreativeModal";

/* ─── Constants ──────────────────────────────────────────────────────────── */

const SORT_OPTIONS = [
  { value: "hook_score",      label: "Melhor Hook (vendas + thumbstop)", asc: false },
  { value: "thumbstop_rate",  label: "Thumbstop Rate",  asc: false },
  { value: "ctr",             label: "CTR",              asc: false },
  { value: "conversion_rate", label: "Taxa de Conv.",    asc: false },
  { value: "purchases",       label: "Compras",          asc: false },
  { value: "cpa",             label: "Custo por compra", asc: true  },
  { value: "roas",            label: "ROAS",             asc: false },
];

const TAB_DEFAULT_SORT = { vendas: "purchases", hooks: "hook_score" };

const TAB_METRICS = {
  vendas: [
    { key: "thumbstop_rate",  label: "Thumbstop", fmt: "pct"      },
    { key: "ctr",             label: "CTR",        fmt: "pct"      },
    { key: "conversion_rate", label: "Conv.",      fmt: "pct"      },
    { key: "purchases",       label: "Compras",    fmt: "int"      },
    { key: "cpa",             label: "CPA",        fmt: "currency" },
    { key: "roas",            label: "ROAS",       fmt: "roas"     },
  ],
  hooks: [
    { key: "hook_score",     label: "Hook Score", fmt: "score"    },
    { key: "purchases",      label: "Compras",    fmt: "int"      },
    { key: "thumbstop_rate", label: "Thumbstop",  fmt: "pct"      },
    { key: "ctr",            label: "CTR",        fmt: "pct"      },
    { key: "connect_rate",   label: "Connect",    fmt: "pct"      },
    { key: "spend",          label: "Investido",  fmt: "currency" },
  ],
};

const PRODUTO_PALETTE = [
  { bg: "rgba(251,146,60,0.18)",  text: "#FB923C", dot: "#F97316" },
  { bg: "rgba(250,204,21,0.18)",  text: "#FCD34D", dot: "#EAB308" },
  { bg: "rgba(167,139,250,0.18)", text: "#C084FC", dot: "#A855F7" },
  { bg: "rgba(74,222,128,0.18)",  text: "#4ADE80", dot: "#22C55E" },
  { bg: "rgba(56,189,248,0.18)",  text: "#7DD3FC", dot: "#0EA5E9" },
];

/* ─── Value formatters ───────────────────────────────────────────────────── */

function fmtVal(v, fmt) {
  if (v == null || (typeof v === "number" && isNaN(v))) return "—";
  switch (fmt) {
    case "pct":      return v.toFixed(1) + "%";
    case "currency": return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
    case "roas":     return v.toFixed(2) + "x";
    case "int":      return new Intl.NumberFormat("pt-BR").format(Math.round(v));
    case "score":    return v.toFixed(1);
    default:         return String(v);
  }
}

/**
 * Hook Score — equilibra retenção e vendas: thumbstop × log10(1 + compras).
 * Sem venda → score 0; o log evita que 1–3 vendas com thumbstop altíssimo
 * passem na frente de criativos que realmente vendem.
 */
function hookScore(r) {
  return (+r.thumbstop_rate || 0) * Math.log10(1 + (+r.purchases || 0));
}

function sortAds(ads, sortKey) {
  const opt = SORT_OPTIONS.find((o) => o.value === sortKey);
  const asc = opt?.asc ?? false;
  return [...ads].sort((a, b) => {
    const va = a[sortKey] ?? (asc ? Infinity : -Infinity);
    const vb = b[sortKey] ?? (asc ? Infinity : -Infinity);
    return asc ? va - vb : vb - va;
  });
}

/* ─── Shared atoms ───────────────────────────────────────────────────────── */

function FunilBadge({ funil }) {
  const cls = {
    TOFU: "bg-green-900/40 text-green-400",
    MOFU: "bg-amber-900/40 text-amber-400",
    BOFU: "bg-purple-900/40 text-purple-400",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${cls[funil] ?? "bg-gray-800 text-gray-400"}`}>
      {funil}
    </span>
  );
}

function ProductBadge({ productId, products }) {
  if (!products?.length) return null;
  const p = products.find((x) => x.id === productId);
  if (!p) return null;
  const idx = products.indexOf(p) % PRODUTO_PALETTE.length;
  const c = PRODUTO_PALETTE[idx];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
      {p.nome}
    </span>
  );
}

/* ─── Skeleton ───────────────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden animate-pulse">
      <div className="h-32 bg-gray-800" />
      <div className="p-3 space-y-2">
        <div className="flex gap-1">
          <div className="h-4 w-10 rounded bg-gray-800" />
          <div className="h-4 w-20 rounded bg-gray-800" />
        </div>
        <div className="h-3 w-full rounded bg-gray-800" />
        <div className="h-3 w-4/5 rounded bg-gray-800" />
        <div className="pt-1 space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between">
              <div className="h-2.5 w-14 rounded bg-gray-800" />
              <div className="h-2.5 w-10 rounded bg-gray-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Creative Card ──────────────────────────────────────────────────────── */

function CreativeCard({ ad, rank, tab, products, benchMap, real, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-gray-900 rounded-xl border border-gray-800 overflow-hidden
                 hover:border-accent/30 hover:-translate-y-0.5 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-accent/30"
    >
      <div className="relative">
        <CreativeThumb ad={ad} />
        <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/65 flex items-center justify-center">
          <span className="text-[10px] font-bold leading-none text-accent">#{rank}</span>
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex flex-wrap gap-1">
          {real?.funil_real
            ? <EntregaBadge info={real} />
            : <FunilBadge funil={ad.funil} />}
          <ProductBadge productId={ad.product_id} products={products} />
        </div>

        <p className="text-xs font-semibold text-gray-200 leading-snug line-clamp-2 min-h-[2.5rem]">
          {ad.ad_name}
        </p>

        <div className="border-t border-gray-800 pt-2 space-y-1">
          {TAB_METRICS[tab].map(({ key, label, fmt }) => {
            const level = metricLevel(ad[key], benchMap[key]);
            return (
              <div key={key} className="flex items-center justify-between gap-1">
                <span className="text-[11px] text-gray-500">{label}</span>
                {level ? (
                  <span className={`text-[11px] tabular-nums px-1.5 py-px rounded-md ${LEVEL_PILL[level]}`}>
                    {fmtVal(ad[key], fmt)}
                  </span>
                ) : (
                  <span className="text-[11px] tabular-nums text-gray-300">
                    {fmtVal(ad[key], fmt)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </button>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function TopCreativos() {
  const [period,     setPeriod]     = useState("30d");
  const [custom,     setCustom]     = useState(defaultCustom());
  const [sortBy,     setSortBy]     = useState("purchases");
  const [activeTab,  setActiveTab]  = useState("vendas");
  const [selectedAd, setSelectedAd] = useState(null);

  const { addToast } = useToast();

  // 300ms debounce on period change to avoid flash
  const [dPeriod, setDPeriod] = useState(period);
  const [dCustom, setDCustom] = useState(custom);
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setDPeriod(period); setDCustom(custom); }, 300);
    return () => clearTimeout(timer.current);
  }, [period, custom]);

  function handleTabChange(tab) {
    setActiveTab(tab);
    setSortBy(TAB_DEFAULT_SORT[tab]);
  }

  // Products (for badges)
  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id,nome,slug").eq("ativo", true);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 10,
  });

  // Ads for selected period (com auto-pull)
  const { rows: rawAds, loading: isLoading, syncing, syncProgress, range } = usePeriodAds({
    period: dPeriod,
    custom: dCustom,
  });

  // Régua de cores das métricas (benchmarks de Configurações)
  const benchmarks = useConfigBenchmarks();
  const benchMap = useMemo(() => buildBenchMap(benchmarks), [benchmarks]);

  // Funil real pela entrega da Meta (segmento com mais compras)
  const funilReal = useFunilReal({ s: range.s, e: range.e });

  const loading = isLoading || period !== dPeriod || custom !== dCustom;

  const ads = useMemo(() => {
    let rows = rawAds ?? [];
    // Melhores Hooks: hook é coisa de vídeo — artes (imagens) ficam de fora
    if (activeTab === "hooks") rows = rows.filter((r) => r.media_type === "video");
    rows = rows.map((r) => ({ ...r, hook_score: hookScore(r) }));
    return sortAds(rows, sortBy);
  }, [rawAds, sortBy, activeTab]);

  // Classificação ADSUP automática: assim que o período carrega, classifica
  // sozinho o que ainda falta em creative_classifications (pula o resto) e
  // já popula a Matriz Criativa. `rawAds` (não `ads`) — cobre todo o período,
  // independente da aba/ordenação ativa.
  const { running: batchRunning, done: batchDone, total: batchTotal, runNow: runBatch } =
    useAutoClassify(rawAds, { enabled: !loading });

  async function handleBatchClick() {
    const { total, done, errors } = await runBatch();
    if (total === 0) {
      addToast("Todos os criativos visíveis já estão classificados.", "success");
      return;
    }
    const ok = done - errors;
    addToast(
      `Classificação concluída: ${ok}/${total}${errors ? ` · ${errors} com erro` : ""}.`,
      errors ? "error" : "success",
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">

          {/* Period filter (Hoje/Ontem/7d/30d/Personalizado + auto-pull) */}
          <PeriodFilter
            period={period}
            custom={custom}
            onPeriodChange={setPeriod}
            onCustomChange={setCustom}
            syncing={syncing}
            syncProgress={syncProgress}
          />

          {/* Sort dropdown + classificar em lote + spinner */}
          <div className="flex items-center gap-2.5 shrink-0">
            {loading && <RefreshCw size={12} className="text-gray-600 animate-spin" />}

            <button
              type="button"
              onClick={handleBatchClick}
              disabled={batchRunning || loading || ads.length === 0}
              title="Classifica automaticamente pelo framework ADSUP o que ainda falta neste período (roda sozinho ao abrir a página; use aqui para forçar agora)"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-700 bg-gray-800 text-xs font-medium text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors disabled:opacity-50"
            >
              {batchRunning
                ? <Loader2 size={12} className="animate-spin text-accent" />
                : <Tags size={12} />}
              {batchRunning ? `Classificando ${batchDone}/${batchTotal}` : "Classificar em lote"}
            </button>

            <div className="w-px h-4 bg-gray-700" />

            <span className="text-xs text-gray-500 whitespace-nowrap">Ordenar por</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-8 rounded-lg border border-gray-700 bg-gray-800 px-2.5 text-xs text-gray-200
                         focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Tabs + Grid ───────────────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">

        {/* Tab bar */}
        <div className="flex items-end border-b border-gray-800 px-2">
          {[
            { key: "vendas", label: "Melhores Vendas",  sub: "Criativos com mais compras no período"  },
            { key: "hooks",  label: "Melhores Hooks",   sub: "Vídeos que vendem com a melhor retenção inicial" },
          ].map(({ key, label, sub }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleTabChange(key)}
              className={`flex flex-col px-5 py-3.5 text-left border-b-2 transition-colors ${
                activeTab === key
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              <span className="text-sm font-semibold">{label}</span>
              <span className="text-[11px] text-gray-600 mt-0.5">{sub}</span>
            </button>
          ))}

          <span className="ml-auto pr-5 text-xs text-gray-600 self-center">
            {loading ? "…" : `${ads.length} criativo${ads.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Content */}
        <div className="p-5">
          {loading ? (
            <div className="grid grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : ads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Trophy size={32} className="text-gray-700" />
              <p className="text-sm font-medium text-gray-500">Nenhum criativo no período</p>
              <p className="text-xs text-gray-600">Selecione um período mais amplo ou sincronize os dados em Configurações.</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {ads.map((ad, idx) => (
                <CreativeCard
                  key={ad.ad_id ?? ad.id}
                  ad={ad}
                  rank={idx + 1}
                  tab={activeTab}
                  products={products}
                  benchMap={benchMap}
                  real={funilReal?.get(ad.ad_id)}
                  onClick={() => setSelectedAd(ad)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal ─────────────────────────────────────────────────────── */}
      {selectedAd && (
        <CreativeModal
          ad={selectedAd}
          products={products}
          periodo={{ inicio: range.s, fim: range.e }}
          onClose={() => setSelectedAd(null)}
        />
      )}
    </div>
  );
}

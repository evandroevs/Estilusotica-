/**
 * CreativeModal — modal de insights do criativo, compartilhado por todas
 * as abas (Top Criativos, Análise, Dashboard, Biblioteca).
 *
 * Inclui: player de vídeo/imagem, tabs Overview/Performance/Vídeo/IA,
 * e ações: Adicionar à Biblioteca (form real), Baixar, Salvar na pasta,
 * botões de IA e leitura de vídeo (Gemini).
 *
 * Uso: <CreativeModal ad={adDoCache} products={products} onClose={...} />
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Play, X, BookmarkPlus, Sparkles, Lightbulb, Copy,
  Loader2, Film, AlertCircle, CheckCircle2, ChevronDown, RotateCcw,
  Download, FolderOpen, FolderPlus, Image as ImageIcon,
  ChevronRight, Home, Check, Tags, AlertTriangle,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  classifyAd, labelFor, extractFunctionErrorMessage,
  PERSONA_LABELS, ETAPA_LABELS, ANGULO_LABELS, PILAR_LABELS, GANCHO_LABELS,
} from "../../lib/classify";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useCreativeMedia } from "../../hooks/useCreativeMedia";
import { usePastas, useCreatePasta, useSaveToPasta } from "../../hooks/usePastas";
import { useConfigModelosNomes, useConfigAngulosNomes } from "../../hooks/useConfig";
import { downloadExternalUrl } from "../../lib/mediaUrl";
import { pickMetricas } from "../../lib/metricas";
import { AIResultPanel } from "../ui/AIResultPanel";

/* ─── Constants ──────────────────────────────────────────────────────────── */

const BENCHMARKS = {
  thumbstop_rate:  { bom: 25,  excelente: 40  },
  ctr:             { bom: 1.5, excelente: 3   },
  roas:            { bom: 3,   excelente: 5   },
  conversion_rate: { bom: 3.5, excelente: 7   },  // compras ÷ cliques no link
  connect_rate:    { bom: 60,  excelente: 80  },
};

const PERF_METRICS = [
  { key: "purchases",          label: "Compras",                fmt: "int"      },
  { key: "spend",              label: "Valor usado",             fmt: "currency" },
  { key: "roas",               label: "ROAS",                    fmt: "roas"     },
  { key: "revenue",            label: "Valor das Compras",       fmt: "currency" },
  { key: "impressions",        label: "Impressões",              fmt: "int"      },
  { key: "link_clicks",        label: "Cliques no Link",         fmt: "int"      },
  { key: "ctr",                label: "CTR",                     fmt: "pct"      },
  { key: "cpm",                label: "CPM",                     fmt: "currency" },
  { key: "cpc",                label: "CPC",                     fmt: "currency" },
  { key: "connect_rate",       label: "Connect Rate",            fmt: "pct"      },
  { key: "thumbstop_rate",     label: "Thumbstop Rate",          fmt: "pct"      },
  { key: "conversion_rate",    label: "Taxa de Conversão",       fmt: "pct"      },
  { key: "cpa",                label: "Custo por compra",        fmt: "currency" },
  { key: "landing_page_views", label: "Vis. Página de Destino",  fmt: "int"      },
];

export const FUNIL_GRADIENT = {
  TOFU: "linear-gradient(135deg, #052E16, #0D4015)",
  MOFU: "linear-gradient(135deg, #2B1500, #3D2000)",
  BOFU: "linear-gradient(135deg, #1A0B2E, #2A1050)",
};

const FUNILS = ["TOFU", "MOFU", "BOFU"];
const STATUS = ["Validado", "Em Teste", "Reprovado"];
const TIPOS  = ["Vídeo", "Arte"];

const PRODUTO_PALETTE = [
  { bg: "rgba(251,146,60,0.18)",  text: "#FB923C", dot: "#F97316" },
  { bg: "rgba(250,204,21,0.18)",  text: "#FCD34D", dot: "#EAB308" },
  { bg: "rgba(167,139,250,0.18)", text: "#C084FC", dot: "#A855F7" },
  { bg: "rgba(74,222,128,0.18)",  text: "#4ADE80", dot: "#22C55E" },
  { bg: "rgba(56,189,248,0.18)",  text: "#7DD3FC", dot: "#0EA5E9" },
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */

export function fmtVal(v, fmt) {
  if (v == null || (typeof v === "number" && isNaN(v))) return "—";
  switch (fmt) {
    case "pct":      return v.toFixed(1) + "%";
    case "currency": return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
    case "roas":     return v.toFixed(2) + "x";
    case "int":      return new Intl.NumberFormat("pt-BR").format(Math.round(v));
    default:         return String(v);
  }
}

function metricColor(key, value) {
  const b = BENCHMARKS[key];
  if (!b || value == null) return "text-gray-400";
  if (value >= b.excelente) return "text-green-400 font-bold";
  if (value >= b.bom)       return "text-yellow-400";
  return "text-gray-500";
}

function parseAdName(name, fallbackFunil) {
  const parts = (name ?? "").split("|").map((p) => p.trim());
  const funil = FUNILS.includes(parts[0]?.toUpperCase())
    ? parts[0].toUpperCase()
    : (fallbackFunil ?? "");
  return {
    funil,
    modelo:    parts[1] ?? "",
    angulo:    parts[2] ?? "",
    descricao: parts[3] ?? parts[parts.length - 1] ?? "",
  };
}

/* ─── Badges (exportados para reuso nas páginas) ─────────────────────────── */

export function FunilBadge({ funil }) {
  const cls = {
    TOFU: "bg-green-900/40 text-green-400",
    MOFU: "bg-amber-900/40 text-amber-400",
    BOFU: "bg-purple-900/40 text-purple-400",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${cls[funil] ?? "bg-gray-800 text-gray-400"}`}>
      {funil ?? "—"}
    </span>
  );
}

export function ProductBadge({ productId, products }) {
  const p = products?.find((x) => x.id === productId);
  if (!p) return null;
  const idx = (products?.indexOf(p) ?? 0) % PRODUTO_PALETTE.length;
  const c = PRODUTO_PALETTE[idx];
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
      {p.nome}
    </span>
  );
}

/** Formata o período do snapshot ("01/01/2025 → 31/12/2025"). */
function fmtPeriodo({ inicio, fim } = {}) {
  const br = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const a = br(inicio);
  const b = br(fim);
  if (a && b && a !== b) return `${a} → ${b}`;
  return a || b;
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-800 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-medium text-gray-300 text-right break-all ml-2">{value}</span>
    </div>
  );
}

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-gray-400 mb-1">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

/* ─── Media player ───────────────────────────────────────────────────────── */

/** Traduz o erro real de vídeo da Meta numa mensagem útil. */
function videoErrorMsg(err) {
  if (!err) return "Vídeo indisponível no momento — tente novamente em instantes.";
  if (/too many calls/i.test(err))
    return "A Meta limitou temporariamente as chamadas da conta (rate limit). O vídeo volta a carregar sozinho em até 1 hora.";
  if (/access|permission|token|page/i.test(err))
    return "O token Meta não tem acesso à Página dona deste vídeo (adicione a Página ao usuário do sistema no Gerenciador de Negócios).";
  return `Vídeo indisponível: ${err}`;
}

function ModalMedia({ ad }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  // Imagens com thumbnail no banco renderizam direto (sem roundtrip). Mas buscamos
  // fresco quando: é vídeo (URL expira), não há thumb no cache, ou a thumb falhou
  // ao carregar (expirada na Meta) — aí com refresh para furar o atalho de cache.
  const needsVideo = ad.media_type !== "image";
  const wantFetch = needsVideo || !ad.thumbnail_url || thumbFailed;
  const { data: media, isLoading, isError } = useCreativeMedia(
    wantFetch ? ad.ad_id : null,
    { refresh: thumbFailed },
  );

  const mtype = media?.media_type ?? ad.media_type;
  const url   = media?.url ?? null;
  const thumb = media?.thumbnail_url ?? (thumbFailed ? null : ad.thumbnail_url) ?? null;

  if (mtype === "video" && url) {
    return (
      <video
        src={url}
        controls
        autoPlay
        poster={thumb ?? undefined}
        className="w-full h-44 bg-black object-contain shrink-0"
      />
    );
  }

  if (thumb || url) {
    return (
      <div className="relative h-44 shrink-0 bg-black">
        <img
          src={url ?? thumb}
          alt={ad.ad_name}
          className="w-full h-full object-contain"
          onError={() => setThumbFailed(true)}
        />
        {needsVideo && isLoading && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/70 rounded-full px-2.5 py-1">
            <Loader2 size={11} className="text-accent animate-spin" />
            <span className="text-[10px] text-gray-300">Carregando vídeo…</span>
          </div>
        )}
        {mtype === "video" && !isLoading && !url && (
          <div className="absolute inset-x-0 bottom-0 bg-black/80 px-3 py-2">
            <p className="text-[11px] text-amber-400 leading-snug">
              ⚠ {videoErrorMsg(media?.video_error)}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-44 bg-gray-800 flex items-center justify-center shrink-0">
        <Loader2 size={20} className="text-gray-600 animate-spin" />
      </div>
    );
  }

  // Sem mídia: anúncio antigo/excluído na Meta — as métricas persistem, mas a
  // arte/vídeo não é mais retornada pela Graph API. Deixa isso explícito.
  return (
    <div
      className="h-44 flex flex-col items-center justify-center gap-2 px-6 text-center shrink-0"
      style={{ background: FUNIL_GRADIENT[ad.funil] ?? FUNIL_GRADIENT.TOFU }}
    >
      <div className="w-11 h-11 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
        <AlertCircle size={20} className="text-white/70" />
      </div>
      <p className="text-[11px] text-white/80 leading-snug max-w-[260px]">
        {isError
          ? "Mídia indisponível na Meta — o anúncio provavelmente foi excluído. As métricas históricas continuam disponíveis abaixo."
          : "Sem arte para exibir — o anúncio pode ter sido excluído na Meta. As métricas históricas continuam abaixo."}
      </p>
    </div>
  );
}

/* ─── Download + Salvar na pasta ─────────────────────────────────────────── */

function SaveToPastaButton({ ad, label = "Salvar na pasta", align = "left", periodo = null }) {
  const { addToast } = useToast();

  const { data: pastas } = usePastas();
  const createPasta      = useCreatePasta();
  const saveToPasta      = useSaveToPasta();

  const [open, setOpen]         = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [navPath, setNavPath]   = useState([]); // [{id, nome}] — navegação na árvore
  const rootRef = useRef(null);

  const currentFolder = navPath[navPath.length - 1] ?? null;

  /* Filhos de cada pasta (mapa parent_id → pastas), ordenados por nome. */
  const childrenOf = useMemo(() => {
    const m = new Map();
    for (const p of pastas ?? []) {
      const k = p.parent_id ?? "root";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.nome.localeCompare(b.nome));
    return m;
  }, [pastas]);

  const foldersAtLevel = childrenOf.get(currentFolder?.id ?? "root") ?? [];
  const hasChildren = (p) => (childrenOf.get(p.id)?.length ?? 0) > 0;

  /* Abre resetando a navegação; fecha ao clicar fora. */
  function toggleOpen() {
    if (open) { setOpen(false); return; }
    setNavPath([]); setNovoNome(""); setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function close(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function handleSave(pastaId, pastaNome) {
    setOpen(false);
    addToast(`Salvando em "${pastaNome}"… (vídeos podem levar ~30s)`, "success");
    try {
      await saveToPasta.mutateAsync({
        adId: ad.ad_id,
        pastaId,
        metricas: pickMetricas(ad),
        periodo,
      });
      addToast(`Salvo em "${pastaNome}"! Veja na Biblioteca — compartilhe a pasta pelo menu ⋮.`, "success");
    } catch (err) {
      addToast(`Erro ao salvar na pasta: ${err.message ?? err}`, "error");
    }
  }

  async function handleCreateAndSave(e) {
    e.preventDefault();
    e.stopPropagation();
    const nome = novoNome.trim();
    if (!nome) return;
    try {
      const p = await createPasta.mutateAsync({ nome, parentId: currentFolder?.id ?? null });
      setNovoNome("");
      await handleSave(p.id, p.nome);
    } catch (err) {
      addToast(`Erro ao criar pasta: ${err.message ?? err}`, "error");
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={saveToPasta.isPending}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 text-xs font-medium text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors disabled:opacity-50"
      >
        {saveToPasta.isPending ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
        {label}
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={`absolute bottom-full mb-2 ${align === "right" ? "right-0" : "left-0"} w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-20`}>
          {/* Breadcrumb de navegação */}
          <div className="flex items-center gap-0.5 px-3 py-2 border-b border-gray-800 text-[11px] overflow-x-auto">
            <button
              type="button"
              onClick={() => setNavPath([])}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded shrink-0 ${
                !currentFolder ? "text-accent font-bold" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <Home size={11} /> Início
            </button>
            {navPath.map((seg, i) => (
              <span key={seg.id} className="flex items-center gap-0.5 shrink-0">
                <ChevronRight size={10} className="text-gray-700" />
                <button
                  type="button"
                  onClick={() => setNavPath((prev) => prev.slice(0, i + 1))}
                  className={`px-1.5 py-0.5 rounded max-w-[110px] truncate ${
                    i === navPath.length - 1 ? "text-accent font-bold" : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {seg.nome}
                </button>
              </span>
            ))}
          </div>

          {/* Salvar diretamente na pasta atual (quando dentro de uma) */}
          {currentFolder && (
            <button
              type="button"
              onClick={() => handleSave(currentFolder.id, currentFolder.nome)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-accent hover:bg-accent/10 border-b border-gray-800"
            >
              <Check size={13} className="shrink-0" />
              Salvar nesta pasta
            </button>
          )}

          {/* Pastas do nível atual */}
          <div className="max-h-44 overflow-y-auto">
            {!foldersAtLevel.length && (
              <p className="px-4 py-3 text-[11px] text-gray-600">
                {currentFolder ? "Sem subpastas — crie abaixo." : "Nenhuma pasta — crie abaixo."}
              </p>
            )}
            {foldersAtLevel.map((p) => {
              const drillable = hasChildren(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => drillable
                    ? setNavPath((prev) => [...prev, { id: p.id, nome: p.nome }])
                    : handleSave(p.id, p.display ?? p.nome)}
                  title={drillable ? `Abrir "${p.nome}" para ver as subpastas` : `Salvar em "${p.display ?? p.nome}"`}
                  className="w-full text-left px-4 py-2.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                >
                  <FolderOpen size={12} className="text-gray-500 shrink-0" />
                  <span className="truncate flex-1">{p.nome}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">{p.item_count}</span>
                  {drillable
                    ? <ChevronRight size={13} className="text-gray-600 shrink-0" />
                    : <Check size={12} className="text-gray-700 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Criar subpasta no nível atual */}
          <form onSubmit={handleCreateAndSave} className="border-t border-gray-800 p-2 flex gap-1.5">
            <input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder={currentFolder ? `Nova subpasta em ${currentFolder.nome}…` : "Nova pasta…"}
              className="flex-1 min-w-0 h-8 rounded-lg border border-gray-700 bg-gray-800 px-2.5 text-[11px] text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <button
              type="submit"
              disabled={!novoNome.trim() || createPasta.isPending}
              className="h-8 px-2.5 rounded-lg bg-accent text-black text-[11px] font-bold disabled:opacity-40 shrink-0"
            >
              {createPasta.isPending ? <Loader2 size={11} className="animate-spin" /> : <FolderPlus size={11} />}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MediaActions({ ad, periodo = null }) {
  const { addToast } = useToast();
  const needsVideo = ad.media_type !== "image";
  const { data: media } = useCreativeMedia(needsVideo ? ad.ad_id : null);

  const [downloading, setDownloading] = useState(false);

  const isVideo  = (media?.media_type ?? ad.media_type) === "video";
  const mediaUrl = isVideo ? media?.url : (ad.thumbnail_url ?? media?.thumbnail_url);

  async function handleDownload() {
    if (!mediaUrl) {
      addToast(isVideo ? "Vídeo ainda carregando — tente em instantes." : "Mídia indisponível.", "error");
      return;
    }
    setDownloading(true);
    try {
      await downloadExternalUrl(mediaUrl, ad.ad_name, isVideo ? "mp4" : "jpg");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading || (isVideo && !media?.url)}
        title={isVideo && !media?.url ? "Aguardando link do vídeo…" : "Baixar arquivo"}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 text-xs font-medium text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors disabled:opacity-50"
      >
        {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        Baixar
      </button>

      <SaveToPastaButton ad={ad} periodo={periodo} />
    </>
  );
}

/* ─── Add to Library Modal (form real) ───────────────────────────────────── */

export function AddToLibraryModal({ ad, products, onClose, periodo = null }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const MODELOS = useConfigModelosNomes();
  const ANGULOS = useConfigAngulosNomes();
  const parsed = parseAdName(ad.ad_name, ad.funil);
  const ticketMedio = ad.purchases > 0 ? ad.revenue / ad.purchases : null;

  const [form, setForm] = useState({
    nome:        ad.ad_name ?? "",
    funil:       parsed.funil || ad.funil || "TOFU",
    tipo:        ad.media_type === "image" ? "Arte" : "Vídeo",
    modelo:      parsed.modelo,
    angulo:      parsed.angulo,
    hook:        parsed.descricao,
    status:      "Validado",
    observacoes: "",
  });

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("biblioteca").insert({
        nome:            form.nome,
        ad_id:           ad.ad_id,
        product_id:      ad.product_id ?? null,
        funil:           form.funil,
        tipo:            form.tipo,
        modelo_video:    form.modelo || null,
        angulo:          form.angulo || null,
        hook_texto:      form.hook   || null,
        status:          form.status,
        roas:            ad.roas ?? null,
        ctr:             ad.ctr  ?? null,
        thumbstop_rate:  ad.thumbstop_rate ?? null,
        compras:         ad.purchases ?? null,
        cpa:             ad.cpa ?? null,
        thumbnail_url:   ad.thumbnail_url ?? null,
        observacoes:     form.observacoes || null,
        user_id:         user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      addToast("Criativo validado! A IA do Planejamento vai usá-lo como referência.", "success");
      onClose();
    },
    onError: (err) => {
      addToast(err.message ?? "Erro ao validar criativo", "error");
    },
  });

  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  const isValid = form.nome.trim().length > 0 && form.funil;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-800 shrink-0">
          <BookmarkPlus size={18} className="text-accent shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">Validar criativo para a IA</p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              Alimenta o Planejamento Mensal · {ad.ad_name}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left: thumbnail + metrics */}
          <div className="w-48 shrink-0 border-r border-gray-800 flex flex-col">
            <div
              className="h-36 shrink-0"
              style={{
                background: ad.thumbnail_url
                  ? `url(${ad.thumbnail_url}) center/cover`
                  : FUNIL_GRADIENT[ad.funil] ?? FUNIL_GRADIENT.TOFU,
              }}
            />
            <div className="p-3 flex-1 overflow-y-auto space-y-0">
              {ad._periodo?.inicio && (
                <p className="text-[10px] text-gray-500 mb-1.5 leading-tight">
                  Métricas salvas do período {fmtPeriodo(ad._periodo)}
                </p>
              )}
              {[
                { label: "ROAS",       value: fmtVal(ad.roas, "roas") },
                { label: "Compras",    value: fmtVal(ad.purchases, "int") },
                { label: "CPA",        value: fmtVal(ad.cpa, "currency") },
                { label: "Ticket",     value: fmtVal(ticketMedio, "currency") },
                { label: "CTR",        value: fmtVal(ad.ctr, "pct") },
                { label: "Thumbstop",  value: fmtVal(ad.thumbstop_rate, "pct") },
                { label: "Invest.",    value: fmtVal(ad.spend, "currency") },
                { label: "Receita",    value: fmtVal(ad.revenue, "currency") },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 border-b border-gray-800 last:border-0">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className="text-xs font-medium text-gray-300">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: form */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <FieldLabel required>Nome do criativo</FieldLabel>
              <input
                type="text"
                value={form.nome}
                onChange={(e) => set("nome", e.target.value)}
                className="w-full h-9 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Produto</FieldLabel>
                <div className="h-9 rounded-lg border border-gray-700 bg-gray-800/50 px-3 flex items-center">
                  {ad.product_id && products ? (
                    <ProductBadge productId={ad.product_id} products={products} />
                  ) : (
                    <span className="text-xs text-gray-600">Não mapeado</span>
                  )}
                </div>
              </div>
              <div>
                <FieldLabel required>Funil</FieldLabel>
                <select
                  value={form.funil}
                  onChange={(e) => set("funil", e.target.value)}
                  className="w-full h-9 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
                >
                  {FUNILS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>

            <div>
              <FieldLabel>Tipo</FieldLabel>
              <div className="flex gap-2">
                {TIPOS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set("tipo", t)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      form.tipo === t
                        ? "bg-accent-dim border-accent/40 text-accent"
                        : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {t === "Vídeo" ? <Film size={12} /> : <ImageIcon size={12} />}
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Modelo de vídeo</FieldLabel>
                <select
                  value={form.modelo}
                  onChange={(e) => set("modelo", e.target.value)}
                  className="w-full h-9 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
                >
                  <option value="">Selecionar…</option>
                  {MODELOS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Ângulo</FieldLabel>
                <select
                  value={form.angulo}
                  onChange={(e) => set("angulo", e.target.value)}
                  className="w-full h-9 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
                >
                  <option value="">Selecionar…</option>
                  {ANGULOS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>

            <div>
              <FieldLabel>Hook / texto de abertura</FieldLabel>
              <textarea
                rows={2}
                value={form.hook}
                onChange={(e) => set("hook", e.target.value)}
                placeholder="A frase de abertura do vídeo…"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder:text-gray-600"
              />
            </div>

            <div>
              <FieldLabel>Status</FieldLabel>
              <div className="flex gap-2">
                {STATUS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set("status", s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      form.status === s
                        ? s === "Validado"   ? "bg-green-900/40 border-green-700 text-green-400"
                        : s === "Em Teste"   ? "bg-yellow-900/40 border-yellow-700 text-yellow-400"
                                             : "bg-red-900/40 border-red-800 text-red-400"
                        : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>Observações</FieldLabel>
              <textarea
                rows={2}
                value={form.observacoes}
                onChange={(e) => set("observacoes", e.target.value)}
                placeholder="Notas sobre o criativo, contexto, próximos passos…"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder:text-gray-600"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800 bg-gray-900/60 shrink-0 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-700 text-xs font-semibold text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
          >
            Cancelar
          </button>
          <SaveToPastaButton ad={ad} label="Adicionar à Biblioteca" align="right" periodo={periodo} />
          <button
            type="button"
            onClick={() => save()}
            disabled={!isValid || isPending}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-accent text-black text-xs font-bold hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BookmarkPlus size={13} />
            {isPending ? "Salvando…" : "Validar criativo"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Video Analysis Panel ───────────────────────────────────────────────── */

function VideoAnalysisPanel({ ad, analysis, onAnalyze }) {
  const [showTranscricao, setShowTranscricao] = useState(false);

  if (!ad.video_id) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
        <Film size={24} className="text-gray-700" />
        <p className="text-sm text-gray-500">Sem video_id associado</p>
        <p className="text-xs text-gray-600">Sincronize via meta-creative para obter o video_id.</p>
      </div>
    );
  }

  if (analysis.loading) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-4">
        <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
          <Loader2 size={20} className="text-accent animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-300">Baixando e analisando vídeo…</p>
          <p className="text-xs text-gray-600 mt-1.5 max-w-xs leading-relaxed">
            O Gemini "assiste" o vídeo completo e retorna hook, ângulo, cenas e CTA.
            Pode levar 1–2 min para vídeos mais longos.
          </p>
        </div>
      </div>
    );
  }

  if (analysis.error) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
        <AlertCircle size={24} className="text-red-400" />
        <div>
          <p className="text-sm font-semibold text-red-400">Erro na análise</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto leading-relaxed">{analysis.error}</p>
        </div>
        <button type="button" onClick={onAnalyze}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-xs font-medium text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors">
          <RotateCcw size={11} />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!analysis.result) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
          <Film size={20} className="text-gray-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-400">Análise de vídeo com Gemini</p>
          <p className="text-xs text-gray-600 mt-1.5 max-w-xs leading-relaxed">
            O Gemini "assiste" o vídeo inteiro, identifica hook, ângulo, cenas e CTA.
            Roda uma única vez e fica salvo permanentemente.
          </p>
        </div>
        <button type="button" onClick={onAnalyze}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-xs font-semibold text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors">
          <Film size={13} />
          Ler vídeo com Gemini
        </button>
      </div>
    );
  }

  const r = analysis.result;
  const analyzedAt = r.video_analisado_em
    ? new Date(r.video_analisado_em).toLocaleDateString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "2-digit",
      })
    : null;

  return (
    <div className="space-y-4">
      {analyzedAt && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <CheckCircle2 size={11} className="text-green-500 shrink-0" />
          Analisado em {analyzedAt} via Gemini{r.cached ? " · do cache" : ""}
        </div>
      )}

      {r.hook_3s && (r.hook_3s.fala || r.hook_3s.visual) && (
        <div className="rounded-xl bg-accent/5 border border-accent/15 p-4">
          <p className="text-[10px] font-bold text-accent/50 uppercase tracking-wide mb-2.5">
            Hook — primeiros 3 segundos
          </p>
          {r.hook_3s.fala && (
            <div className="mb-2.5">
              <p className="text-[10px] text-gray-600 font-medium uppercase tracking-wide mb-0.5">Fala</p>
              <p className="text-xs text-gray-200 italic leading-relaxed">"{r.hook_3s.fala}"</p>
            </div>
          )}
          {r.hook_3s.visual && (
            <div>
              <p className="text-[10px] text-gray-600 font-medium uppercase tracking-wide mb-0.5">Visual</p>
              <p className="text-xs text-gray-300 leading-relaxed">{r.hook_3s.visual}</p>
            </div>
          )}
        </div>
      )}

      {r.angulo && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">Ângulo identificado:</span>
          <span className="px-2.5 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold">
            {r.angulo}
          </span>
        </div>
      )}

      {Array.isArray(r.cenas) && r.cenas.length > 0 && (
        <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/50">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-3">Cenas</p>
          <ul className="space-y-2">
            {r.cenas.map((c, i) => (
              <li key={i} className="flex gap-2.5 text-xs">
                <span className="font-mono text-gray-600 shrink-0 w-10">{c.tempo}</span>
                <span className="text-gray-300 leading-snug">{c.descricao}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.cta && (
        <div className="flex gap-2.5 items-start bg-blue-950/20 border border-blue-900/30 rounded-xl p-3.5">
          <span className="text-[10px] font-bold text-blue-400/60 uppercase tracking-wide shrink-0 mt-0.5">CTA</span>
          <p className="text-xs font-medium text-gray-200">"{r.cta}"</p>
        </div>
      )}

      {(r.transcricao_completa || r.transcricao) && (
        <div className="bg-gray-800/30 rounded-xl border border-gray-700/50 overflow-hidden">
          <button type="button" onClick={() => setShowTranscricao((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-400 hover:text-gray-200 transition-colors">
            Transcrição completa
            <ChevronDown size={12} className={`transition-transform duration-200 ${showTranscricao ? "rotate-180" : ""}`} />
          </button>
          {showTranscricao && (
            <div className="px-4 pb-4 border-t border-gray-700/50 pt-3">
              <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">
                {r.transcricao_completa ?? r.transcricao}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Classification Panel (ADSUP) ───────────────────────────────────────── */

function ClsChip({ label, code, map }) {
  const isInd = !code || code === "indeterminado";
  return (
    <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/60">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
          isInd ? "bg-gray-800 text-gray-500" : "bg-accent/10 text-accent"
        }`}>
          {isInd ? "?" : code}
        </span>
        <span className="text-xs text-gray-300 leading-tight">{labelFor(map, code)}</span>
      </div>
    </div>
  );
}

function ClassificationPanel({ loading, result, error, onRun }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
          <Loader2 size={20} className="text-accent animate-spin" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-300">Classificando com IA…</p>
          <p className="text-xs text-gray-600 mt-1.5 max-w-xs leading-relaxed">
            Persona, etapa de consciência, ângulo, estrutura e tipo de gancho (framework ADSUP).
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
        <AlertCircle size={24} className="text-red-400" />
        <div>
          <p className="text-sm font-semibold text-red-400">Erro na classificação</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto leading-relaxed">{error}</p>
        </div>
        <button type="button" onClick={onRun}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-xs font-medium text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors">
          <RotateCcw size={11} /> Tentar novamente
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
          <Tags size={20} className="text-gray-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-400">Classificação ADSUP</p>
          <p className="text-xs text-gray-600 mt-1.5 max-w-xs leading-relaxed">
            Classifica o criativo por persona, etapa, ângulo, estrutura e gancho. Roda uma vez e fica salvo.
          </p>
        </div>
        <button type="button" onClick={onRun}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-xs font-semibold text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors">
          <Tags size={13} /> Classificar criativo
        </button>
      </div>
    );
  }

  const r = result;
  const conf = typeof r.confidence_score === "number" ? Math.round(r.confidence_score * 100) : null;
  const confColor = conf == null ? "text-gray-500" : conf >= 80 ? "text-green-400" : conf >= 60 ? "text-yellow-400" : "text-red-400";
  const alinhado = r.alinhamento_gancho_angulo;

  return (
    <div className="space-y-4">
      {/* Cabeçalho: confiança + provider */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Confiança</span>
          <span className={`text-sm font-bold ${confColor}`}>{conf == null ? "—" : `${conf}%`}</span>
        </div>
        {r.provider && (
          <span className="text-[10px] text-gray-600 uppercase tracking-wide">via {r.provider}</span>
        )}
      </div>

      {/* Grid de classificação */}
      <div className="grid grid-cols-2 gap-2.5">
        <ClsChip label="Persona"   code={r.persona}         map={PERSONA_LABELS} />
        <ClsChip label="Etapa"     code={r.etapa_funil}     map={ETAPA_LABELS}   />
        <ClsChip label="Ângulo"    code={r.angulo}          map={ANGULO_LABELS}  />
        <ClsChip label="Estrutura" code={r.pilar_estrutura} map={PILAR_LABELS}   />
        <ClsChip label="Gancho"    code={r.gancho_tipo}     map={GANCHO_LABELS}  />
        <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/60">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Formato</p>
          <span className="text-xs font-semibold text-gray-300">{r.formato ?? "—"}</span>
        </div>
      </div>

      {/* Alinhamento gancho × ângulo */}
      {alinhado != null && (
        <div className={`flex gap-2.5 items-start rounded-xl p-3.5 border ${
          alinhado ? "bg-green-950/20 border-green-900/30" : "bg-amber-950/20 border-amber-900/30"
        }`}>
          {alinhado
            ? <CheckCircle2 size={15} className="text-green-400 shrink-0 mt-0.5" />
            : <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />}
          <div>
            <p className={`text-xs font-semibold ${alinhado ? "text-green-400" : "text-amber-400"}`}>
              {alinhado ? "Gancho alinhado ao ângulo" : "Gancho fora do recomendado para o ângulo"}
            </p>
            {r.observacao_alinhamento && (
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{r.observacao_alinhamento}</p>
            )}
          </div>
        </div>
      )}

      {/* Justificativa */}
      {r.justificativa && (
        <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/50">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Justificativa</p>
          <p className="text-xs text-gray-300 leading-relaxed">{r.justificativa}</p>
        </div>
      )}

      <button type="button" onClick={onRun}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-xs font-medium text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors">
        <RotateCcw size={11} /> Reclassificar
      </button>
    </div>
  );
}

/* ─── Creative Modal (principal) ─────────────────────────────────────────── */

export default function CreativeModal({ ad, products, onClose, periodo = null }) {
  const [tab, setTab] = useState("overview");
  const [showLibrary, setShowLibrary] = useState(false);

  const [aiMode,    setAiMode]    = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult,  setAiResult]  = useState(null);
  const [aiError,   setAiError]   = useState(null);

  // Classificação ADSUP — a aba fica sempre visível (vídeo ou arte estática);
  // o painel mostra o CTA "Classificar" quando ainda não há resultado.
  const [clsLoading, setClsLoading] = useState(false);
  const [clsResult,  setClsResult]  = useState(null);
  const [clsError,   setClsError]   = useState(null);

  // Pré-carrega classificação existente (evita re-gastar tokens ao reabrir)
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("creative_classifications")
        .select("*")
        .eq("ad_id", ad.ad_id)
        .maybeSingle();
      if (alive && data) setClsResult(data);
    })();
    return () => { alive = false; };
  }, [ad.ad_id]);

  async function invokeClassify() {
    setClsLoading(true);
    setClsError(null);
    setTab("adsup");
    try {
      // Se já há resultado, o clique veio do "Reclassificar" → force pula a
      // guarda de idempotência do servidor e roda a IA de novo de propósito.
      const data = await classifyAd(ad, { force: !!clsResult });
      setClsResult(data);
    } catch (err) {
      setClsError(err.message ?? "Erro ao classificar criativo");
    } finally {
      setClsLoading(false);
    }
  }

  const [videoAnalysis, setVideoAnalysis] = useState(() => {
    if (ad.analise_video || ad.transcricao) {
      return {
        loading: false,
        result: {
          ...(ad.analise_video ?? {}),
          transcricao:        ad.transcricao,
          video_analisado_em: ad.video_analisado_em,
          cached:             true,
        },
        error: null,
      };
    }
    return { loading: false, result: null, error: null };
  });

  async function invokeTranscribe() {
    setVideoAnalysis({ loading: true, result: null, error: null });
    setTab("video");
    try {
      const { data, error } = await supabase.functions.invoke("transcribe", {
        body: { ad_id: ad.ad_id, modo: "gemini" },
      });
      if (error) throw new Error(await extractFunctionErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      setVideoAnalysis({
        loading: false,
        result: {
          ...(data.analise_video ?? {}),
          transcricao:        data.transcricao,
          video_analisado_em: data.video_analisado_em,
          cached:             data.cached ?? false,
        },
        error: null,
      });
    } catch (err) {
      setVideoAnalysis({ loading: false, result: null, error: err.message ?? "Erro" });
    }
  }

  async function invokeAI(modo) {
    setAiMode(modo);
    setAiLoading(true);
    setAiResult(null);
    setAiError(null);
    setTab("ia");
    try {
      const dados = {
        ad_name:            ad.ad_name,
        funil:              ad.funil,
        roas:               ad.roas,
        purchases:          ad.purchases,
        cpa:                ad.cpa,
        ctr:                ad.ctr,
        thumbstop_rate:     ad.thumbstop_rate,
        conversion_rate:    ad.conversion_rate,
        connect_rate:       ad.connect_rate,
        spend:              ad.spend,
        revenue:            ad.revenue,
        cpm:                ad.cpm,
        cpc:                ad.cpc,
        landing_page_views: ad.landing_page_views,
      };
      const { data, error } = await supabase.functions.invoke("ai-analyze", {
        body: { modo, dados },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setAiResult(data);
    } catch (err) {
      setAiError(err.message ?? "Erro na análise com IA");
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  const cplpv       = ad.landing_page_views > 0 ? ad.spend / ad.landing_page_views : null;
  const ticketMedio = ad.purchases > 0 ? ad.revenue / ad.purchases : null;

  const TABS = [
    { key: "overview",    label: "Overview"    },
    { key: "performance", label: "Performance" },
    ...(ad.video_id ? [{ key: "video", label: "Vídeo" }] : []),
    ...(aiMode      ? [{ key: "ia",    label: "✦ IA"  }] : []),
    { key: "adsup", label: "✦ ADSUP" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white leading-snug line-clamp-2">{ad.ad_name}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <FunilBadge funil={ad.funil} />
              <ProductBadge productId={ad.product_id} products={products} />
              <span className="text-[11px] text-gray-600">{ad.date_start} → {ad.date_stop}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body (2 col) ── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left: media + meta */}
          <div className="w-52 shrink-0 border-r border-gray-800 flex flex-col overflow-y-auto">
            <ModalMedia ad={ad} />
            <div className="p-4 flex-1">
              <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-2">Campanha</p>
              <p className="text-xs font-medium text-gray-300 leading-snug mb-3 break-words">{ad.campaign_name}</p>
              <InfoRow label="Período" value={`${ad.date_start} → ${ad.date_stop}`} />
              <InfoRow label="Funil"   value={ad.funil} />
              <InfoRow label="Ad ID"   value={ad.ad_id} />
            </div>
          </div>

          {/* Right: tabs */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

            <div className="flex border-b border-gray-800 px-4 shrink-0">
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                    tab === key
                      ? "border-accent text-accent"
                      : "border-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">

              {tab === "overview" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "ROAS",      key: "roas",           fmt: "roas" },
                      { label: "Compras",   key: "purchases",      fmt: "int"  },
                      { label: "Thumbstop", key: "thumbstop_rate", fmt: "pct"  },
                    ].map(({ label, key, fmt }) => (
                      <div key={key} className="bg-gray-800 rounded-xl p-3 text-center border border-gray-700">
                        <p className="text-[11px] text-gray-500 mb-1">{label}</p>
                        <p className={`text-2xl font-bold leading-none ${metricColor(key, ad[key])}`}>
                          {fmtVal(ad[key], fmt)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="bg-gray-800/40 rounded-xl p-4">
                    <InfoRow label="Investimento"   value={fmtVal(ad.spend, "currency")}       />
                    <InfoRow label="Receita"         value={fmtVal(ad.revenue, "currency")}     />
                    <InfoRow label="CPA"             value={fmtVal(ad.cpa, "currency")}         />
                    <InfoRow label="Ticket Médio"    value={fmtVal(ticketMedio, "currency")}    />
                    <InfoRow label="CTR"             value={fmtVal(ad.ctr, "pct")}              />
                    <InfoRow label="Connect Rate"    value={fmtVal(ad.connect_rate, "pct")}     />
                    <InfoRow label="CPM"             value={fmtVal(ad.cpm, "currency")}         />
                    <InfoRow label="CPC"             value={fmtVal(ad.cpc, "currency")}         />
                    <InfoRow label="Impressões"      value={fmtVal(ad.impressions, "int")}      />
                    <InfoRow label="Cliques no Link" value={fmtVal(ad.link_clicks, "int")}      />
                  </div>
                </div>
              )}

              {tab === "performance" && (
                <div className="grid grid-cols-2 gap-2">
                  {PERF_METRICS.map(({ key, label, fmt }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between px-3 py-2.5 bg-gray-800 rounded-lg border border-gray-700"
                    >
                      <span className="text-xs text-gray-400">{label}</span>
                      <span className={`text-xs font-semibold tabular-nums ml-2 ${metricColor(key, ad[key])}`}>
                        {fmtVal(ad[key], fmt)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2.5 bg-gray-800 rounded-lg border border-gray-700">
                    <span className="text-xs text-gray-400">Custo por Vis. Pág.</span>
                    <span className="text-xs font-semibold tabular-nums ml-2 text-gray-300">
                      {fmtVal(cplpv, "currency")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5 bg-gray-800 rounded-lg border border-gray-700">
                    <span className="text-xs text-gray-400">Ticket Médio</span>
                    <span className="text-xs font-semibold tabular-nums ml-2 text-gray-300">
                      {fmtVal(ticketMedio, "currency")}
                    </span>
                  </div>
                </div>
              )}

              {tab === "video" && (
                <VideoAnalysisPanel
                  ad={ad}
                  analysis={videoAnalysis}
                  onAnalyze={invokeTranscribe}
                />
              )}

              {tab === "ia" && (
                <AIResultPanel
                  mode={aiMode}
                  loading={aiLoading}
                  result={aiResult}
                  error={aiError}
                  onRetry={() => invokeAI(aiMode)}
                />
              )}

              {tab === "adsup" && (
                <ClassificationPanel
                  loading={clsLoading}
                  result={clsResult}
                  error={clsError}
                  onRun={invokeClassify}
                />
              )}
            </div>

            {/* ── Footer: actions ── */}
            <div className="px-5 py-4 border-t border-gray-800 bg-gray-900/60 shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowLibrary(true)}
                  title="Marca o criativo como validado — alimenta a IA do Planejamento Mensal"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-xs font-bold hover:bg-accent-hover transition-colors"
                >
                  <BookmarkPlus size={13} />
                  Validar p/ IA
                </button>

                <MediaActions ad={ad} periodo={periodo} />

                <div className="w-px h-4 bg-gray-700 mx-0.5" />

                {[
                  { label: "Analisar",  modo: "analisar_anuncio", Icon: Sparkles  },
                  { label: "Hook",      modo: "ideias_hook",      Icon: Lightbulb },
                  { label: "Inspirar",  modo: "inspirar",         Icon: Copy      },
                ].map(({ label, modo, Icon }) => (
                  <button
                    key={modo}
                    type="button"
                    onClick={() => invokeAI(modo)}
                    disabled={aiLoading}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                      aiMode === modo && (aiLoading || aiResult)
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                    }`}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    setTab("adsup");
                    if (!clsResult && !clsLoading) invokeClassify();
                  }}
                  disabled={clsLoading}
                  title="Classifica o criativo pelo framework ADSUP (persona, etapa, ângulo, estrutura, gancho)"
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                    clsResult
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                  }`}
                >
                  {clsLoading ? <Loader2 size={12} className="animate-spin" /> : <Tags size={12} />}
                  {clsResult ? "Classificação" : "Classificar"}
                </button>

                {ad.video_id && (
                  <>
                    <div className="w-px h-4 bg-gray-700 mx-0.5" />
                    <button
                      type="button"
                      disabled={videoAnalysis.loading}
                      onClick={() => {
                        setTab("video");
                        if (!videoAnalysis.result && !videoAnalysis.loading) invokeTranscribe();
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                        videoAnalysis.result
                          ? "border-green-700/50 bg-green-950/20 text-green-400"
                          : "border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                      }`}
                    >
                      <Film size={12} />
                      {videoAnalysis.result ? "Análise de vídeo" : "Ler vídeo (IA)"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Add to Library (sobreposto) ── */}
      {showLibrary && (
        <AddToLibraryModal
          ad={ad}
          products={products}
          periodo={periodo}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
}

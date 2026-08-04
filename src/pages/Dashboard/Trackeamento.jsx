/**
 * Trackeamento — leads do WhatsApp → venda na loja física.
 *
 * Feita para o VENDEDOR: zero digitação além do valor da venda.
 * Leads entram sozinhos (Edge Function lead-webhook + realtime);
 * aqui só se confirma a venda (valor + foto da NF) ou marca "não comprou".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, ShoppingBag, Percent, DollarSign, Camera, CheckCircle2,
  XCircle, X, Loader2, MessageCircle, Phone, ChevronLeft,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";

/* ─── Status ─────────────────────────────────────────────────────────────── */

const STATUS = {
  em_atendimento: { label: "Em atendimento",  cor: "#60A5FA" },
  aguardando:     { label: "Aguardando",       cor: "#FBBF24" },
  vendido:        { label: "Venda Confirmada", cor: "#4ADE80" },
  nao_comprou:    { label: "Não Comprou",      cor: "#F87171" },
};

const MOTIVOS = [
  { v: "nao_retornou",        label: "Não retornou" },
  { v: "preco",               label: "Preço" },
  { v: "comprou_outro_lugar", label: "Comprou em outro lugar" },
  { v: "sem_estoque",         label: "Sem estoque" },
  { v: "desistiu",            label: "Desistiu" },
  { v: "outro",               label: "Outro" },
];

const FILTROS = [
  { v: "todos", label: "Todos" },
  { v: "em_atendimento", label: "Em atendimento" },
  { v: "aguardando", label: "Aguardando" },
  { v: "vendido", label: "Vendidos" },
  { v: "nao_comprou", label: "Não comprou" },
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const BRL = (v) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(v));

function ehHoje(iso) {
  return new Date(iso).toDateString() === new Date().toDateString();
}

/** "às 10:35" (hoje) · "ontem às 11:12" · "28/07 às 09:40" */
function quando(iso) {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (ehHoje(iso)) return `às ${hora}`;
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return `ontem às ${hora}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hora}`;
}

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.em_atendimento;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: s.cor + "1c", color: s.cor }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.cor }} />
      {s.label}
    </span>
  );
}

function KpiHoje({ icon: Icon, label, value, color }) {
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

/* ─── Drawer do lead ─────────────────────────────────────────────────────── */

function LeadDrawer({ lead, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef(null);

  const [valor, setValor] = useState("");
  const [foto, setFoto] = useState(null);        // File
  const [modoMotivo, setModoMotivo] = useState(false);

  useEffect(() => { setValor(""); setFoto(null); setModoMotivo(false); }, [lead?.id]);

  const salvar = useMutation({
    mutationFn: async (patch) => {
      let nota_fiscal_url = null;
      if (patch.status === "vendido" && foto) {
        const ext = (foto.name?.split(".").pop() || "jpg").toLowerCase();
        const path = `${lead.workspace_id}/${lead.id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("notas-fiscais").upload(path, foto, { upsert: true });
        if (upErr) throw upErr;
        nota_fiscal_url = supabase.storage.from("notas-fiscais").getPublicUrl(path).data.publicUrl;
      }
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("leads")
        .update({
          ...patch,
          ...(patch.status === "vendido" && {
            vendido_em: new Date().toISOString(),
            confirmado_por: userData?.user?.id ?? null,
            ...(nota_fiscal_url && { nota_fiscal_url }),
          }),
        })
        .eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: (_d, patch) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast?.success?.(patch.status === "vendido" ? "Venda confirmada! 🎉" : "Registrado.");
      onClose();
    },
    onError: (e) => toast?.error?.(e.message ?? String(e)),
  });

  if (!lead) return null;
  const aberto = lead.status === "em_atendimento" || lead.status === "aguardando";
  const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
  const valorOk = valorNum > 0;

  const Info = ({ label, children }) => (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-600 mb-0.5">{label}</p>
      <p className="text-xs text-gray-200">{children ?? "—"}</p>
    </div>
  );

  return (
    <>
      {/* overlay */}
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      {/* drawer: lateral no desktop, tela cheia no celular */}
      <div className="fixed z-50 inset-y-0 right-0 w-full sm:w-[420px] bg-gray-950 sm:border-l border-gray-800 flex flex-col">
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800">
          <button type="button" onClick={onClose} className="sm:hidden text-gray-400 hover:text-white">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-white font-bold text-base truncate">{lead.nome}</h3>
            <p className="text-xs text-gray-500 flex items-center gap-1"><Phone size={11} /> {lead.telefone ?? "—"}</p>
          </div>
          <StatusBadge status={lead.status} />
          <button type="button" onClick={onClose} className="hidden sm:block text-gray-500 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* dados do lead (ninguém digita nada aqui) */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <Info label="Origem">
              {lead.origem === "meta" ? "Meta Ads" : lead.origem === "google" ? "Google Ads" : "Outro"}
            </Info>
            <Info label="Atendimento">{quando(lead.iniciado_em)}</Info>
            <Info label="Campanha">{lead.campanha}</Info>
            <Info label="Anúncio">{lead.anuncio === "exemplo" ? "—" : lead.anuncio}</Info>
            {lead.vendedor && <Info label="Vendedor">{lead.vendedor}</Info>}
            {lead.status === "vendido" && <Info label="Valor da venda">{BRL(+lead.valor_venda)}</Info>}
            {lead.status === "nao_comprou" && (
              <Info label="Motivo">{MOTIVOS.find((m) => m.v === lead.motivo_nao_compra)?.label ?? "—"}</Info>
            )}
          </div>

          {lead.status === "vendido" && lead.nota_fiscal_url && (
            <a href={lead.nota_fiscal_url} target="_blank" rel="noreferrer"
              className="block text-xs text-accent underline">Ver foto da nota fiscal</a>
          )}

          {/* fluxo do vendedor */}
          {aberto && !modoMotivo && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Valor da venda</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">R$</span>
                  <input
                    type="text" inputMode="decimal" placeholder="0,00" value={valor}
                    onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))}
                    className="w-full h-12 rounded-xl border border-gray-700 bg-gray-900 pl-10 pr-3 text-lg font-bold text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                  Foto da nota fiscal <span className="text-gray-600 font-normal">(opcional)</span>
                </label>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full h-11 rounded-xl border border-dashed border-gray-700 text-gray-300 text-xs font-semibold inline-flex items-center justify-center gap-2 hover:border-gray-500 transition-colors">
                  <Camera size={14} />
                  {foto ? foto.name : "Tirar foto ou selecionar imagem"}
                </button>
              </div>

              <button type="button" disabled={!valorOk || salvar.isPending}
                onClick={() => salvar.mutate({ status: "vendido", valor_venda: valorNum })}
                className="w-full h-13 py-3.5 rounded-xl bg-accent text-black text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors disabled:opacity-40">
                {salvar.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Confirmar Venda
              </button>

              <button type="button" disabled={salvar.isPending}
                onClick={() => setModoMotivo(true)}
                className="w-full py-3 rounded-xl border border-red-900/60 text-red-400 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:border-red-700 transition-colors">
                <XCircle size={15} /> Não Comprou
              </button>
            </>
          )}

          {aberto && modoMotivo && (
            <div>
              <p className="text-xs font-semibold text-gray-400 mb-2">Por que não comprou?</p>
              <div className="space-y-1.5">
                {MOTIVOS.map((m) => (
                  <button key={m.v} type="button" disabled={salvar.isPending}
                    onClick={() => salvar.mutate({ status: "nao_comprou", motivo_nao_compra: m.v })}
                    className="w-full py-3 px-4 rounded-xl border border-gray-800 bg-gray-900 text-left text-sm text-gray-200 hover:border-red-800/70 transition-colors disabled:opacity-50">
                    {m.label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setModoMotivo(false)}
                className="mt-3 text-xs text-gray-500 hover:text-gray-300">← Voltar</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Tela principal ─────────────────────────────────────────────────────── */

export default function Trackeamento() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState("todos");
  const [leadAberto, setLeadAberto] = useState(null);

  const { data: leads, isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("iniciado_em", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60, // fallback do realtime
  });

  // Realtime: lead novo do WhatsApp aparece sem recarregar
  useEffect(() => {
    const canal = supabase
      .channel("leads-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        qc.invalidateQueries({ queryKey: ["leads"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [qc]);

  const { kpis, visiveis } = useMemo(() => {
    const all = leads ?? [];
    const hoje = all.filter((l) => ehHoje(l.iniciado_em));
    const vendasHoje = all.filter((l) => l.status === "vendido" && l.vendido_em && ehHoje(l.vendido_em));
    const valorHoje = vendasHoje.reduce((s, l) => s + (+l.valor_venda || 0), 0);
    return {
      kpis: {
        leadsHoje: hoje.length,
        vendasHoje: vendasHoje.length,
        taxa: hoje.length > 0 ? (hoje.filter((l) => l.status === "vendido").length / hoje.length) * 100 : null,
        valorHoje,
      },
      visiveis: filtro === "todos" ? all : all.filter((l) => l.status === filtro),
    };
  }, [leads, filtro]);

  return (
    <div className="space-y-5">
      {/* KPIs de hoje */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiHoje icon={Users}       label="Leads Hoje"        value={kpis.leadsHoje} color="#60A5FA" />
        <KpiHoje icon={ShoppingBag} label="Vendas Hoje"       value={kpis.vendasHoje} color="#4ADE80" />
        <KpiHoje icon={Percent}     label="Taxa de Conversão" value={kpis.taxa == null ? "—" : kpis.taxa.toFixed(0) + "%"} color="#A78BFA" />
        <KpiHoje icon={DollarSign}  label="Valor Vendido Hoje" value={BRL(kpis.valorHoje)} color="#C8FF00" />
      </div>

      {/* Filtro por status */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTROS.map((f) => (
          <button key={f.v} type="button" onClick={() => setFiltro(f.v)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filtro === f.v ? "bg-accent text-black" : "bg-gray-800 text-gray-400 hover:text-gray-200"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista de leads */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />)}
        </div>
      ) : !visiveis.length ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-12 text-center">
          <MessageCircle size={28} className="mx-auto text-gray-700 mb-3" />
          <p className="text-sm text-gray-400 font-medium">Nenhum lead por aqui ainda.</p>
          <p className="text-xs text-gray-600 mt-1">Quando um cliente chamar no WhatsApp, ele aparece sozinho nesta lista.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visiveis.map((l) => {
            const s = STATUS[l.status] ?? STATUS.em_atendimento;
            return (
              <button key={l.id} type="button" onClick={() => setLeadAberto(l)}
                className="w-full flex items-center gap-3.5 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3.5 text-left hover:border-gray-600 transition-colors">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.cor }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{l.nome}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {l.telefone ? `${l.telefone} · ` : ""}WhatsApp iniciado {quando(l.iniciado_em)}
                  </p>
                </div>
                {l.status === "vendido" && +l.valor_venda > 0 && (
                  <span className="text-xs font-bold text-green-400 tabular-nums shrink-0">{BRL(+l.valor_venda)}</span>
                )}
                <StatusBadge status={l.status} />
              </button>
            );
          })}
        </div>
      )}

      {leadAberto && (
        <LeadDrawer
          lead={(leads ?? []).find((l) => l.id === leadAberto.id) ?? leadAberto}
          onClose={() => setLeadAberto(null)}
        />
      )}
    </div>
  );
}

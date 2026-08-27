/**
 * Trackeamento — página própria (sidebar): leads do WhatsApp → venda na loja.
 *
 * Feita para o VENDEDOR: zero digitação além do valor da venda.
 * Leads entram sozinhos (lead-webhook + realtime). Duas formas de dar baixa:
 *   1. Foto da nota fiscal → IA (nf-match) lê telefone/valor → cruza com os
 *      leads e registra a venda sozinha quando o telefone bate.
 *   2. Manual: clica no lead → valor → Confirmar Venda.
 *
 * Confirmada a venda, a plataforma avisa a Meta (Conversions API) que aquele
 * clique no anúncio virou compra no balcão — é o que fecha o ciclo
 * anúncio → WhatsApp → loja física e alimenta o otimizador de campanha.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, ShoppingBag, Percent, DollarSign, Camera, CheckCircle2,
  XCircle, X, Loader2, MessageCircle, Phone, ChevronLeft,
  Send, AlertTriangle, Store, Megaphone,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { Sparkles, Upload } from "lucide-react";

/* ─── Status ─────────────────────────────────────────────────────────────── */

const STATUS = {
  em_atendimento: { label: "Em atendimento",  cor: "#60A5FA" },
  aguardando:     { label: "Aguardando",       cor: "#FBBF24" },
  vendido:        { label: "Venda Confirmada", cor: "#4ADE80" },
  nao_comprou:    { label: "Não Comprou",      cor: "#F87171" },
};

/** Situação do aviso enviado para a Meta (coluna meta_status). */
const META = {
  enviado:       { label: "Meta avisada",      cor: "#4ADE80", icon: CheckCircle2 },
  pendente:      { label: "Não sinalizada",    cor: "#FBBF24", icon: Send },
  erro:          { label: "Falha ao sinalizar", cor: "#F87171", icon: AlertTriangle },
  nao_aplicavel: { label: "Venda avulsa",      cor: "#9CA3AF", icon: Store },
};

/**
 * Avisa a Meta que a venda saiu. Nunca derruba o fluxo do vendedor: se falhar,
 * a venda continua registrada e o lead fica com meta_status='erro' para
 * reenvio depois (botão "Reenviar" ou o lote de pendentes).
 */
async function sinalizarMeta(leadId) {
  try {
    const { data, error } = await supabase.functions.invoke("meta-capi-purchase", {
      body: { lead_id: leadId },
    });
    if (error) return { ok: false, erro: error.message };
    if (data?.error) return { ok: false, erro: data.error };
    const r = data?.resultados?.[0];
    return { ok: Boolean(r?.ok), erro: r?.erro, atribuido: Boolean(r?.atribuido_ao_anuncio) };
  } catch (err) {
    return { ok: false, erro: err.message ?? String(err) };
  }
}

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

/** Par rótulo/valor do cartão de dados do lead. */
function Info({ label, children }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-600 mb-0.5">{label}</p>
      <p className="text-xs text-gray-200">{children ?? "—"}</p>
    </div>
  );
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
  const { addToast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef(null);

  const [valor, setValor] = useState("");
  const [foto, setFoto] = useState(null);        // File
  const [modoMotivo, setModoMotivo] = useState(false);

  useEffect(() => { setValor(""); setFoto(null); setModoMotivo(false); }, [lead?.id]);

  const salvar = useMutation({
    mutationFn: async (patch) => {
      let documento_url = null;
      if (patch.status === "vendido" && foto) {
        const ext = (foto.name?.split(".").pop() || "jpg").toLowerCase();
        const path = `${lead.workspace_id}/${lead.id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("notas-fiscais").upload(path, foto, { upsert: true });
        if (upErr) throw upErr;
        documento_url = supabase.storage.from("notas-fiscais").getPublicUrl(path).data.publicUrl;
      }
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("leads")
        .update({
          ...patch,
          ...(patch.status === "vendido" && {
            vendido_em: new Date().toISOString(),
            confirmado_por: userData?.user?.id ?? null,
            ...(documento_url && { documento_url }),
          }),
        })
        .eq("id", lead.id);
      if (error) throw error;

      // Venda registrada: avisa a Meta antes de fechar o drawer.
      if (patch.status === "vendido") return await sinalizarMeta(lead.id);
      return null;
    },
    onSuccess: (meta, patch) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      if (patch.status !== "vendido") {
        addToast("Registrado.");
      } else if (meta?.ok) {
        addToast(meta.atribuido
          ? "Venda confirmada e atribuída ao anúncio na Meta! 🎉"
          : "Venda confirmada e enviada à Meta! 🎉");
      } else {
        addToast("Venda confirmada! 🎉");
        addToast(`A Meta não recebeu o aviso: ${meta?.erro ?? "erro desconhecido"}. Dá para reenviar no lead.`, "error");
      }
      onClose();
    },
    onError: (e) => addToast(e.message ?? String(e), "error"),
  });

  const reenviar = useMutation({
    mutationFn: () => sinalizarMeta(lead.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      if (r?.ok) addToast("Meta avisada da venda. ✅");
      else addToast(r?.erro ?? "A Meta recusou o evento.", "error");
    },
  });

  if (!lead) return null;
  const aberto = lead.status === "em_atendimento" || lead.status === "aguardando";
  const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
  const valorOk = valorNum > 0;

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
            {lead.produto && <Info label="Produto">{lead.produto}</Info>}
            {lead.status === "vendido" && <Info label="Valor da venda">{BRL(+lead.valor_venda)}</Info>}
            <Info label="Atribuição">
              {lead.ctwa_clid ? (
                <span className="inline-flex items-center gap-1 text-green-400">
                  <Megaphone size={11} /> Clique do anúncio identificado
                </span>
              ) : lead.avulsa ? (
                "Venda avulsa (sem anúncio)"
              ) : (
                <span className="text-gray-500">Sem clique — só telefone</span>
              )}
            </Info>
            {lead.status === "nao_comprou" && (
              <Info label="Motivo">{MOTIVOS.find((m) => m.v === lead.motivo_nao_compra)?.label ?? "—"}</Info>
            )}
          </div>

          {lead.status === "vendido" && lead.documento_url && (
            <a href={lead.documento_url} target="_blank" rel="noreferrer"
              className="block text-xs text-accent underline">Ver foto da ordem de serviço</a>
          )}

          {/* O que a Meta sabe sobre esta venda */}
          {lead.status === "vendido" && (() => {
            const m = META[lead.meta_status] ?? META.pendente;
            const precisaEnviar = lead.meta_status === "pendente" || lead.meta_status === "erro";
            return (
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-center gap-2">
                  <m.icon size={14} style={{ color: m.cor }} />
                  <span className="text-xs font-semibold" style={{ color: m.cor }}>{m.label}</span>
                </div>
                {lead.meta_erro && (
                  <p className="mt-2 text-[11px] text-red-400 leading-relaxed">{lead.meta_erro}</p>
                )}
                {lead.meta_status === "enviado" && (
                  <p className="mt-1.5 text-[11px] text-gray-500">
                    A Meta contabilizou esta compra{lead.ctwa_clid ? " no anúncio que gerou a conversa." : " pelos dados do cliente."}
                  </p>
                )}
                {precisaEnviar && !lead.avulsa && (
                  <button type="button" disabled={reenviar.isPending}
                    onClick={() => reenviar.mutate()}
                    className="mt-3 w-full py-2.5 rounded-lg border border-gray-700 text-gray-200 text-xs font-semibold inline-flex items-center justify-center gap-2 hover:border-gray-500 transition-colors disabled:opacity-40">
                    {reenviar.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Enviar para a Meta agora
                  </button>
                )}
              </div>
            );
          })()}

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
                  Foto da ordem de serviço <span className="text-gray-600 font-normal">(opcional)</span>
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


/* ─── Registrar venda pela nota fiscal (IA cruza o telefone) ─────────────── */

function CardNotaFiscal({ leadsAbertos }) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef(null);

  // fase: idle | lendo | escolher | ok
  const [nf, setNf] = useState({ fase: "idle" });
  const [leadEscolhido, setLeadEscolhido] = useState("");
  const [valorManual, setValorManual] = useState("");
  const [produtoManual, setProdutoManual] = useState("");
  const [salvando, setSalvando] = useState(false);

  const reset = () => {
    setNf({ fase: "idle" });
    setLeadEscolhido(""); setValorManual(""); setProdutoManual(""); setSalvando(false);
  };

  async function darBaixa(leadId, valor, documentoUrl, produto) {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("leads")
      .update({
        status: "vendido",
        valor_venda: valor,
        vendido_em: new Date().toISOString(),
        confirmado_por: userData?.user?.id ?? null,
        documento_url: documentoUrl,
        ...(produto ? { produto } : {}),
      })
      .eq("id", leadId);
    if (error) throw error;

    const meta = await sinalizarMeta(leadId);
    qc.invalidateQueries({ queryKey: ["leads"] });
    if (!meta.ok) {
      addToast(`Venda registrada, mas a Meta não recebeu o aviso: ${meta.erro ?? "erro desconhecido"}.`, "error");
    }
    return meta;
  }

  /**
   * Venda que não veio de anúncio nenhum: entra no faturamento da loja e
   * fica marcada como avulsa para nunca ser enviada à Meta (sinalizar uma
   * compra que a campanha não gerou envenena o otimizador).
   */
  async function registrarSemLead(valor, documentoUrl, extraido, { avisarMeta }) {
    const { data: userData } = await supabase.auth.getUser();
    const { data: novo, error } = await supabase.from("leads").insert({
      nome: extraido?.nome?.trim() || "Cliente da loja",
      telefone: extraido?.telefone ?? null,
      origem: "outro",
      status: "vendido",
      avulsa: !avisarMeta,
      meta_status: avisarMeta ? "pendente" : "nao_aplicavel",
      valor_venda: valor,
      produto: extraido?.produto ?? null,
      vendido_em: new Date().toISOString(),
      confirmado_por: userData?.user?.id ?? null,
      documento_url: documentoUrl,
    }).select("id").single();
    if (error) throw error;

    // Sem ctwa_clid a Meta casa pelo telefone hasheado — atribuição mais fraca
    // que o clique, mas é o possível enquanto o WhatsApp não está ligado.
    if (avisarMeta) {
      if (!extraido?.telefone) {
        addToast("Venda registrada, mas sem telefone na ordem a Meta não tem como casar o cliente.", "error");
      } else {
        const meta = await sinalizarMeta(novo.id);
        if (!meta.ok) {
          addToast(`Venda registrada, mas a Meta não recebeu: ${meta.erro ?? "erro desconhecido"}.`, "error");
        }
      }
    }
    qc.invalidateQueries({ queryKey: ["leads"] });
  }

  async function onFoto(file) {
    if (!file) return;
    setNf({ fase: "lendo" });
    try {
      // 1. sobe a foto
      const ext = (file.name?.split(".").pop() || "jpg").toLowerCase();
      const path = `nf/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("notas-fiscais").upload(path, file);
      if (upErr) throw upErr;
      const notaUrl = supabase.storage.from("notas-fiscais").getPublicUrl(path).data.publicUrl;

      // 2. IA lê e cruza com os leads
      const { data, error } = await supabase.functions.invoke("nf-match", { body: { nota_url: notaUrl } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { extraido, ia_ok, candidatos } = data;

      // 3. telefone bateu com exatamente 1 lead e a IA leu o valor → baixa automática
      // Só automatiza quando o telefone bateu com UM lead ainda aberto — se
      // casou pelo nome, ou o lead já estava fechado, o vendedor confirma.
      const auto = candidatos?.length === 1 &&
        candidatos[0].motivo === "telefone" &&
        !candidatos[0].ja_vendido &&
        extraido?.valor > 0;

      if (auto) {
        const meta = await darBaixa(candidatos[0].id, extraido.valor, notaUrl, extraido.produto);
        setNf({ fase: "ok", lead: candidatos[0], valor: extraido.valor, meta });
        addToast(`Venda cruzada com ${candidatos[0].nome}! 🎉`);
        setTimeout(reset, 6000);
        return;
      }

      // 4. senão, vendedor escolhe o lead (candidatos primeiro; senão todos os abertos)
      setNf({ fase: "escolher", notaUrl, extraido, ia_ok, candidatos: candidatos ?? [] });
      if (candidatos?.length) setLeadEscolhido(candidatos[0].id);
      if (extraido?.valor > 0) setValorManual(String(extraido.valor).replace(".", ","));
      if (extraido?.produto) setProdutoManual(extraido.produto);
    } catch (err) {
      addToast(err.message ?? String(err), "error");
      reset();
    }
  }

  const opcoes = nf.fase === "escolher" && nf.candidatos.length
    ? nf.candidatos
    : leadsAbertos.map((l) => ({
        ...l,
        veio_de_anuncio: Boolean(l.ctwa_clid),
        ja_vendido: l.status === "vendido",
      }));
  const valorNum = Number(valorManual.replace(/\./g, "").replace(",", "."));

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={14} className="text-accent" />
        <h3 className="text-sm font-bold text-white">Registrar venda pela ordem de serviço</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Tire a foto da ordem: a IA lê o cliente, o produto e o valor, acha o lead que
        veio do anúncio e avisa a Meta que a compra aconteceu na loja.
      </p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { onFoto(e.target.files?.[0]); e.target.value = ""; }} />

      {nf.fase === "idle" && (
        <button type="button" onClick={() => fileRef.current?.click()}
          className="w-full py-4 rounded-xl bg-accent text-black text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors">
          <Camera size={16} /> Tirar foto da ordem de serviço
        </button>
      )}

      {nf.fase === "lendo" && (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin text-accent" /> Lendo a ordem e cruzando com os leads…
        </div>
      )}

      {nf.fase === "ok" && (
        <div className="rounded-xl border border-green-900/60 bg-green-950/30 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="text-green-400 shrink-0" />
            <p className="text-sm text-green-300">
              Venda de <span className="font-bold">{BRL(nf.valor)}</span> registrada para{" "}
              <span className="font-bold">{nf.lead.nome}</span> — telefone conferido pela ordem.
            </p>
          </div>
          <p className="mt-2 pl-7 text-[11px] leading-relaxed">
            {nf.meta?.ok ? (
              <span className="text-green-400/90">
                {nf.meta.atribuido
                  ? "Meta avisada e a compra foi creditada ao anúncio que gerou a conversa."
                  : "Meta avisada da compra (casada pelos dados do cliente, sem clique de anúncio)."}
              </span>
            ) : (
              <span className="text-amber-400/90">
                A Meta ainda não recebeu o aviso — abra o lead e use “Enviar para a Meta agora”.
              </span>
            )}
          </p>
        </div>
      )}

      {nf.fase === "escolher" && (
        <div className="space-y-3">
          <p className="text-xs rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5 text-gray-400">
            {!nf.ia_ok
              ? "A leitura por IA não está configurada — escolha o cliente e informe o valor:"
              : nf.candidatos.length > 1
                ? "Mais de um lead combina — confirme qual é:"
                : nf.candidatos.length === 1 && nf.candidatos[0].motivo === "nome"
                  ? "Achei pelo NOME, não pelo telefone — confira antes de confirmar:"
                  : nf.candidatos.length === 1 && nf.candidatos[0].ja_vendido
                    ? "Esse lead já está marcado como vendido — confirme se não é uma segunda compra:"
                    : nf.extraido?.telefone
                      ? "Nenhum lead bate com essa ordem — escolha o cliente ou registre como venda avulsa:"
                      : "Não consegui ler o telefone na ordem — escolha o cliente:"}
            {nf.ia_ok && (nf.extraido?.telefone || nf.extraido?.nome || nf.extraido?.produto) && (
              <span className="block text-gray-600 mt-1">
                Lido: {[
                  nf.extraido?.telefone && `tel ${nf.extraido.telefone}`,
                  nf.extraido?.nome && nf.extraido.nome,
                  nf.extraido?.produto,
                ].filter(Boolean).join(" · ")}
              </span>
            )}
          </p>

          <select value={leadEscolhido} onChange={(e) => setLeadEscolhido(e.target.value)}
            className="w-full h-11 rounded-xl border border-gray-700 bg-gray-950 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40">
            <option value="">Escolha o cliente…</option>
            {opcoes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}{l.telefone ? ` — ${l.telefone}` : ""}
                {l.veio_de_anuncio ? " · veio de anúncio" : ""}
                {l.ja_vendido ? " · já vendido" : ""}
              </option>
            ))}
          </select>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">R$</span>
            <input type="text" inputMode="decimal" placeholder="Valor da venda" value={valorManual}
              onChange={(e) => setValorManual(e.target.value.replace(/[^\d.,]/g, ""))}
              className="w-full h-11 rounded-xl border border-gray-700 bg-gray-950 pl-10 pr-3 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>

          <input type="text" placeholder="Produto (opcional)" value={produtoManual}
            onChange={(e) => setProdutoManual(e.target.value)}
            className="w-full h-11 rounded-xl border border-gray-700 bg-gray-950 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40" />

          <div className="flex gap-2">
            <button type="button" disabled={!leadEscolhido || !(valorNum > 0) || salvando}
              onClick={async () => {
                setSalvando(true);
                try {
                  await darBaixa(leadEscolhido, valorNum, nf.notaUrl, produtoManual.trim() || null);
                  const lead = opcoes.find((l) => l.id === leadEscolhido);
                  addToast(`Venda registrada para ${lead?.nome ?? "o cliente"}! 🎉`);
                  reset();
                } catch (err) { addToast(err.message ?? String(err), "error"); setSalvando(false); }
              }}
              className="flex-1 py-3 rounded-xl bg-accent text-black text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors disabled:opacity-40">
              {salvando ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Confirmar venda
            </button>
            <button type="button" onClick={reset} disabled={salvando}
              className="px-4 py-3 rounded-xl border border-gray-700 text-gray-400 text-sm font-semibold hover:text-white transition-colors disabled:opacity-40">
              Cancelar
            </button>
          </div>

          {/* Cliente não está entre os leads: registrar mesmo assim */}
          <div className="pt-3 space-y-1.5 border-t border-gray-800">
            <button type="button" disabled={!(valorNum > 0) || salvando}
              onClick={async () => {
                setSalvando(true);
                try {
                  await registrarSemLead(valorNum, nf.notaUrl, {
                    ...nf.extraido,
                    produto: produtoManual.trim() || nf.extraido?.produto || null,
                  }, { avisarMeta: true });
                  addToast("Venda registrada e enviada à Meta pelo telefone do cliente.");
                  reset();
                } catch (err) { addToast(err.message ?? String(err), "error"); setSalvando(false); }
              }}
              className="w-full py-2.5 rounded-xl border border-gray-700 text-gray-300 text-xs font-semibold inline-flex items-center justify-center gap-2 hover:border-gray-500 transition-colors disabled:opacity-40">
              <Megaphone size={13} /> Cliente não está na lista — registrar e avisar a Meta
            </button>

            <button type="button" disabled={!(valorNum > 0) || salvando}
              onClick={async () => {
                setSalvando(true);
                try {
                  await registrarSemLead(valorNum, nf.notaUrl, {
                    ...nf.extraido,
                    produto: produtoManual.trim() || nf.extraido?.produto || null,
                  }, { avisarMeta: false });
                  addToast("Venda avulsa registrada (não foi enviada à Meta).");
                  reset();
                } catch (err) { addToast(err.message ?? String(err), "error"); setSalvando(false); }
              }}
              className="w-full py-2.5 rounded-xl border border-gray-800 text-gray-500 text-xs font-semibold inline-flex items-center justify-center gap-2 hover:text-gray-300 hover:border-gray-600 transition-colors disabled:opacity-40">
              <Store size={13} /> Não veio de anúncio — venda avulsa
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Vendas que a Meta ainda não recebeu ────────────────────────────────── */

/**
 * Rede de segurança: se o navegador fechou no meio, a internet caiu ou o token
 * expirou, a venda fica registrada mas não sinalizada. Aqui o vendedor reenvia
 * o lote inteiro num clique — sem risco de contar duas vezes, porque o
 * event_id é derivado do lead.
 */
function AvisoPendentes({ pendentes }) {
  const { addToast } = useToast();
  const qc = useQueryClient();

  const enviar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-capi-purchase", {
        body: { pendentes: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      addToast(`${d.enviados} venda(s) sinalizada(s) para a Meta.`);
    },
    onError: (e) => addToast(e.message ?? String(e), "error"),
  });

  if (!pendentes.length) return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-amber-900/60 bg-amber-950/20 px-4 py-3.5">
      <AlertTriangle size={17} className="text-amber-400 shrink-0" />
      <p className="text-xs text-amber-200 flex-1">
        <span className="font-bold">{pendentes.length} venda(s)</span> ainda não chegaram à Meta.
        Enquanto isso, a campanha não sabe que elas aconteceram.
      </p>
      <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate()}
        className="shrink-0 px-4 py-2 rounded-lg bg-amber-500/90 text-black text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-amber-400 transition-colors disabled:opacity-40">
        {enviar.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        Enviar agora
      </button>
    </div>
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

  const { kpis, visiveis, pendentes } = useMemo(() => {
    const all = leads ?? [];
    const hoje = all.filter((l) => ehHoje(l.iniciado_em));
    const vendasHoje = all.filter((l) => l.status === "vendido" && l.vendido_em && ehHoje(l.vendido_em));
    const valorHoje = vendasHoje.reduce((s, l) => s + (+l.valor_venda || 0), 0);
    const pendentes = all.filter(
      (l) => l.status === "vendido" && !l.avulsa &&
        (l.meta_status === "pendente" || l.meta_status === "erro")
    );
    return {
      pendentes,
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

      <AvisoPendentes pendentes={pendentes} />

      {/* Registrar venda pela ordem de serviço */}
      <CardNotaFiscal leadsAbertos={(leads ?? []).filter((l) => l.status === "em_atendimento" || l.status === "aguardando")} />

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
                  <p className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                    {l.nome}
                    {l.ctwa_clid && <Megaphone size={11} className="text-accent shrink-0" title="Veio de um anúncio" />}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {l.telefone ? `${l.telefone} · ` : ""}
                    {l.avulsa ? `venda na loja ${quando(l.iniciado_em)}` : `WhatsApp iniciado ${quando(l.iniciado_em)}`}
                  </p>
                </div>
                {l.status === "vendido" && +l.valor_venda > 0 && (
                  <span className="text-xs font-bold text-green-400 tabular-nums shrink-0">{BRL(+l.valor_venda)}</span>
                )}
                {l.status === "vendido" && (() => {
                  const m = META[l.meta_status] ?? META.pendente;
                  return <m.icon size={13} style={{ color: m.cor }} className="shrink-0" title={m.label} />;
                })()}
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

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
  Users, ShoppingBag, Percent, Camera, CheckCircle2,
  XCircle, X, Loader2, MessageCircle, Phone, ChevronLeft,
  Send, AlertTriangle, Store, Megaphone, FileText,
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
  // Estado herdado: vendas registradas antes de toda venda passar a ir ao pixel.
  nao_aplicavel: { label: "Não enviada",       cor: "#9CA3AF", icon: Store },
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

// "Vendidos" saiu daqui de propósito: nome e valor de cliente não ficam
// expostos na tela do balcão. Quem precisa vê pelo botão Relatório de vendas.
const FILTROS = [
  { v: "todos", label: "Em aberto" },
  { v: "em_atendimento", label: "Em atendimento" },
  { v: "aguardando", label: "Aguardando" },
  { v: "nao_comprou", label: "Não comprou" },
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */

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
            {lead.status === "vendido" && <Info label="Venda">registrada</Info>}
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
  /**
   * Toda venda vai para a Meta. A diferença é o NOME do evento: a que veio de
   * anúncio sai como Purchase e conta na campanha; a que não veio sai como
   * evento customizado, alimentando o pixel sem creditar a campanha.
   */
  async function registrarSemLead(valor, documentoUrl, extraido, { veioDeAnuncio }) {
    const { data: userData } = await supabase.auth.getUser();
    const { data: novo, error } = await supabase.from("leads").insert({
      nome: extraido?.nome?.trim() || "Cliente da loja",
      telefone: extraido?.telefone ?? null,
      origem: "outro",
      status: "vendido",
      avulsa: !veioDeAnuncio,
      meta_status: "pendente",
      valor_venda: valor,
      produto: extraido?.produto ?? null,
      vendido_em: new Date().toISOString(),
      confirmado_por: userData?.user?.id ?? null,
      documento_url: documentoUrl,
    }).select("id").single();
    if (error) throw error;

    if (!extraido?.telefone) {
      addToast("Venda registrada, mas sem telefone na ordem a Meta não tem como casar o cliente.", "error");
    } else {
      const meta = await sinalizarMeta(novo.id);
      if (!meta.ok) {
        addToast(`Venda registrada, mas a Meta não recebeu: ${meta.erro ?? "erro desconhecido"}.`, "error");
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
              Venda registrada para <span className="font-bold">{nf.lead.nome}</span> —
              telefone conferido pela ordem.
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

      {nf.fase === "escolher" && (() => {
        // Sem lead para casar, o seletor e o "Confirmar venda" só atrapalham
        // quem está atendendo: sobra a pergunta que importa, veio de anúncio ou não.
        const temLista = opcoes.length > 0;

        const registrar = (veioDeAnuncio) => async () => {
          setSalvando(true);
          try {
            await registrarSemLead(valorNum, nf.notaUrl, {
              ...nf.extraido,
              produto: produtoManual.trim() || nf.extraido?.produto || null,
            }, { veioDeAnuncio });
            addToast(veioDeAnuncio
              ? "Venda registrada e creditada ao anúncio na Meta. 🎉"
              : "Venda registrada. Foi para o pixel, sem contar na campanha.");
            reset();
          } catch (err) { addToast(err.message ?? String(err), "error"); setSalvando(false); }
        };

        return (
        <div className="space-y-3">
          <p className="text-xs rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5 text-gray-400">
            {!nf.ia_ok
              ? "A leitura por IA não está configurada — informe o valor:"
              : !temLista
                ? "Confira o valor e diga se esse cliente veio de um anúncio:"
                : nf.candidatos.length > 1
                  ? "Mais de um lead combina — confirme qual é:"
                  : nf.candidatos[0]?.motivo === "nome"
                    ? "Achei pelo NOME, não pelo telefone — confira antes de confirmar:"
                    : nf.candidatos[0]?.ja_vendido
                      ? "Esse lead já está marcado como vendido — confirme se não é uma segunda compra:"
                      : "Nenhum lead bate com essa ordem — escolha o cliente ou siga sem ele:"}
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

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">R$</span>
            <input type="text" inputMode="decimal" placeholder="Valor da venda" value={valorManual}
              onChange={(e) => setValorManual(e.target.value.replace(/[^\d.,]/g, ""))}
              className="w-full h-12 rounded-xl border border-gray-700 bg-gray-950 pl-10 pr-3 text-lg font-bold text-white focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>

          <input type="text" placeholder="Produto (opcional)" value={produtoManual}
            onChange={(e) => setProdutoManual(e.target.value)}
            className="w-full h-11 rounded-xl border border-gray-700 bg-gray-950 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40" />

          {/* A pergunta que o vendedor precisa responder */}
          <button type="button" disabled={!(valorNum > 0) || salvando}
            onClick={registrar(true)}
            className="w-full py-4 rounded-xl bg-accent text-black text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors disabled:opacity-40">
            {salvando ? <Loader2 size={16} className="animate-spin" /> : <Megaphone size={16} />}
            Cliente veio de anúncio
          </button>

          <button type="button" disabled={!(valorNum > 0) || salvando}
            onClick={registrar(false)}
            className="w-full py-3.5 rounded-xl border border-gray-700 text-gray-300 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:border-gray-500 transition-colors disabled:opacity-40">
            <Store size={15} /> Não veio de anúncio
          </button>

          <p className="text-[10px] text-gray-600 text-center leading-relaxed px-2">
            As duas opções mandam a venda para o pixel. Só a de cima conta como
            resultado da campanha.
          </p>

          {/* Escolher um lead da lista continua possível, mas fora do caminho principal */}
          {temLista && (
            <details className="pt-1 border-t border-gray-800">
              <summary className="pt-3 text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                Vincular a um cliente da lista
              </summary>
              <div className="mt-3 space-y-2">
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
                  className="w-full py-3 rounded-xl bg-accent text-black text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors disabled:opacity-40">
                  <CheckCircle2 size={15} /> Confirmar venda deste cliente
                </button>
              </div>
            </details>
          )}

          <button type="button" onClick={reset} disabled={salvando}
            className="w-full py-2 text-xs text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-40">
            Cancelar
          </button>
        </div>
        );
      })()}
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

/* ─── Relatório de vendas (fora da tela do balcão) ───────────────────────── */

/**
 * As vendas não aparecem na lista principal: a tela fica aberta no caixa e
 * mostraria nome, telefone e valor de cada cliente para quem passasse ali.
 * Aqui é acesso deliberado — quem quer o número, abre.
 */
function RelatorioVendas({ vendas, onClose }) {
  const doMes = vendas.filter((l) => {
    if (!l.vendido_em) return false;
    const d = new Date(l.vendido_em), h = new Date();
    return d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear();
  });
  const enviadas = vendas.filter((l) => l.meta_status === "enviado").length;

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-40" onClick={onClose} />
      <div className="fixed z-50 inset-0 sm:inset-8 lg:inset-x-32 lg:inset-y-16 bg-gray-950 sm:rounded-2xl sm:border border-gray-800 flex flex-col overflow-hidden">

        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800 shrink-0">
          <FileText size={18} className="text-accent" />
          <div className="min-w-0 flex-1">
            <h3 className="text-white font-bold text-base">Relatório de vendas</h3>
            <p className="text-[11px] text-gray-500">
              {vendas.length} venda{vendas.length !== 1 ? "s" : ""} registrada{vendas.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Sem valores: o relatório serve para conferir se a venda foi
            sinalizada, não para expor faturamento numa tela da loja. */}
        <div className="grid grid-cols-2 gap-3 px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-600">Este mês</p>
            <p className="text-xl font-bold text-white">
              {doMes.length} venda{doMes.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-600">Sinalizadas à Meta</p>
            <p className="text-xl font-bold text-accent">{enviadas} de {vendas.length}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!vendas.length ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <ShoppingBag size={28} className="text-gray-700" />
              <p className="text-sm text-gray-500">Nenhuma venda registrada ainda.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-950">
                <tr className="text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                  <th className="text-left font-semibold px-5 py-2.5">Cliente</th>
                  <th className="text-left font-semibold px-3 py-2.5 hidden md:table-cell">Produto</th>
                  <th className="text-left font-semibold px-3 py-2.5">Quando</th>
                  <th className="text-center font-semibold px-5 py-2.5">Meta</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((l) => {
                  const m = META[l.meta_status] ?? META.pendente;
                  return (
                    <tr key={l.id} className="border-b border-gray-900 hover:bg-gray-900/50">
                      <td className="px-5 py-3">
                        <p className="text-gray-100 font-medium truncate flex items-center gap-1.5">
                          {l.nome}
                          {l.ctwa_clid && <Megaphone size={11} className="text-accent shrink-0" title="Veio de anúncio" />}
                        </p>
                        {l.telefone && <p className="text-[11px] text-gray-600">{l.telefone}</p>}
                      </td>
                      <td className="px-3 py-3 text-gray-400 text-xs hidden md:table-cell">{l.produto ?? "—"}</td>
                      <td className="px-3 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {l.vendido_em ? quando(l.vendido_em) : "—"}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <m.icon size={14} style={{ color: m.cor }} className="inline" title={m.label} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
  const [verRelatorio, setVerRelatorio] = useState(false);

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

  const { kpis, visiveis, pendentes, vendas } = useMemo(() => {
    const all = leads ?? [];
    const hoje = all.filter((l) => ehHoje(l.iniciado_em));
    const vendasHoje = all.filter((l) => l.status === "vendido" && l.vendido_em && ehHoje(l.vendido_em));
    const pendentes = all.filter(
      (l) => l.status === "vendido" && !l.avulsa &&
        (l.meta_status === "pendente" || l.meta_status === "erro")
    );
    // Venda confirmada sai da lista: a tela fica aberta no balcão o dia todo
    // e não deve mostrar quem comprou o quê para quem passa na frente dela.
    const emAberto = all.filter((l) => l.status !== "vendido");

    return {
      pendentes,
      vendas: all
        .filter((l) => l.status === "vendido")
        .sort((a, b) => new Date(b.vendido_em ?? 0) - new Date(a.vendido_em ?? 0)),
      kpis: {
        leadsHoje: hoje.length,
        vendasHoje: vendasHoje.length,
        taxa: hoje.length > 0 ? (hoje.filter((l) => l.status === "vendido").length / hoje.length) * 100 : null,
      },
      visiveis: filtro === "todos" ? emAberto : emAberto.filter((l) => l.status === filtro),
    };
  }, [leads, filtro]);

  return (
    <div className="space-y-5">
      {/* KPIs de hoje */}
      {/* Sem valor de venda aqui: a tela fica aberta no balcão o dia todo.
          O faturamento está no Relatório de vendas, atrás de um clique. */}
      <div className="grid grid-cols-3 gap-4">
        <KpiHoje icon={Users}       label="Leads Hoje"        value={kpis.leadsHoje} color="#60A5FA" />
        <KpiHoje icon={ShoppingBag} label="Vendas Hoje"       value={kpis.vendasHoje} color="#4ADE80" />
        <KpiHoje icon={Percent}     label="Taxa de Conversão" value={kpis.taxa == null ? "—" : kpis.taxa.toFixed(0) + "%"} color="#A78BFA" />
      </div>

      <AvisoPendentes pendentes={pendentes} />

      {/* Registrar venda pela ordem de serviço */}
      <CardNotaFiscal leadsAbertos={(leads ?? []).filter((l) => l.status === "em_atendimento" || l.status === "aguardando")} />

      {/* Filtro por status + acesso ao relatório */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTROS.map((f) => (
          <button key={f.v} type="button" onClick={() => setFiltro(f.v)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filtro === f.v ? "bg-accent text-black" : "bg-gray-800 text-gray-400 hover:text-gray-200"
            }`}>
            {f.label}
          </button>
        ))}

        <button type="button" onClick={() => setVerRelatorio(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-700 text-xs font-semibold text-gray-300 hover:border-gray-500 hover:text-white transition-colors">
          <FileText size={13} />
          Relatório de vendas
          {vendas.length > 0 && (
            <span className="ml-0.5 px-1.5 rounded-full bg-gray-800 text-[10px] text-gray-400">{vendas.length}</span>
          )}
        </button>
      </div>

      {/* Lista de leads */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />)}
        </div>
      ) : !visiveis.length ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-12 text-center">
          <MessageCircle size={28} className="mx-auto text-gray-700 mb-3" />
          <p className="text-sm text-gray-400 font-medium">Nenhum atendimento em aberto.</p>
          <p className="text-xs text-gray-600 mt-1">
            Quando um cliente chamar no WhatsApp, ele aparece sozinho aqui.
            {vendas.length > 0 && " Vendas confirmadas ficam no relatório."}
          </p>
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
                <StatusBadge status={l.status} />
              </button>
            );
          })}
        </div>
      )}

      {verRelatorio && (
        <RelatorioVendas vendas={vendas} onClose={() => setVerRelatorio(false)} />
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

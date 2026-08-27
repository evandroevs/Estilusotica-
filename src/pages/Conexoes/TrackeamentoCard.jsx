/**
 * Card de configuração do Trackeamento — o elo que fecha o ciclo
 * anúncio → WhatsApp → venda na loja física.
 *
 * Duas pontas para ligar:
 *   1. WhatsApp: qual número manda os leads (com o ctwa_clid) para esta loja.
 *   2. Meta CAPI: para qual dataset avisar quando a venda sair no balcão.
 *
 * O token do system user é gravado pela Edge Function `meta-capi-config`
 * numa tabela sem RLS — depois de salvo, o frontend nunca mais o recebe.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Radio, Loader2, CheckCircle2, AlertTriangle, Save, Send, ExternalLink,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { useCapiConnection, CAPI_QUERY_KEY } from "../../hooks/useCapiConnection";

const CAMPOS = ["dataset_id", "waba_id", "wa_phone_number_id", "test_event_code", "access_token"];

function Campo({ label, dica, ...props }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-400 mb-1.5">{label}</label>
      <input
        className="w-full h-11 rounded-xl border border-gray-700 bg-gray-950 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40"
        {...props}
      />
      {dica && <p className="mt-1 text-[11px] text-gray-600 leading-relaxed">{dica}</p>}
    </div>
  );
}

export default function TrackeamentoCard() {
  const { addToast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error: erroCarga } = useCapiConnection();
  const config   = data?.config ?? null;
  const temToken = Boolean(data?.temToken);

  // `edicoes` guarda só o que o usuário mexeu; o resto vem do servidor. Assim
  // não é preciso espelhar a config no estado, e depois de salvar o formulário
  // volta a refletir o que foi gravado sozinho.
  const [edicoes, setEdicoes]   = useState({});
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  const valor = (campo) =>
    edicoes[campo] !== undefined ? edicoes[campo] : (campo === "access_token" ? "" : config?.[campo] ?? "");
  const editar = (campo) => (e) => setEdicoes((f) => ({ ...f, [campo]: e.target.value }));
  const form = Object.fromEntries(CAMPOS.map((c) => [c, valor(c)]));

  async function salvar() {
    setSalvando(true);
    try {
      const { data: r, error } = await supabase.functions.invoke("meta-capi-config", {
        body: { action: "save", ...form },
      });
      if (error) throw error;
      if (r?.error) throw new Error(r.error);
      setEdicoes({});
      await qc.invalidateQueries({ queryKey: CAPI_QUERY_KEY });
      addToast("Configuração salva.");
    } catch (err) {
      addToast(err.message ?? String(err), "error");
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    try {
      const { data: r, error } = await supabase.functions.invoke("meta-capi-config", {
        body: { action: "test" },
      });
      if (error) throw error;
      if (r?.error) throw new Error(r.error);
      if (r.ok) {
        addToast(`Meta recebeu o evento de teste. ${r.aviso ?? ""}`.trim());
      } else {
        addToast(r.erro ?? "A Meta recusou o evento de teste.", "error");
      }
      await qc.invalidateQueries({ queryKey: CAPI_QUERY_KEY });
    } catch (err) {
      addToast(err.message ?? String(err), "error");
    } finally {
      setTestando(false);
    }
  }

  const pronto = Boolean(config?.dataset_id) && temToken;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-2xl">
      <div className="flex items-start gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
          <Radio size={17} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-white font-bold">Trackeamento da loja física</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Avisa a Meta quando um cliente que veio do anúncio compra no balcão.
          </p>
        </div>
        {!isLoading && (
          pronto ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-400 shrink-0">
              <CheckCircle2 size={14} /> Ativo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 shrink-0">
              <AlertTriangle size={14} /> Falta configurar
            </span>
          )
        )}
      </div>

      {erroCarga && (
        <p className="mt-3 text-[11px] text-amber-400 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 leading-relaxed">
          Não consegui ler a configuração desta loja. Se a Edge Function
          <span className="font-mono"> meta-capi-config </span> ainda não foi deployada,
          é isso — o formulário abaixo só vai salvar depois do deploy.
        </p>
      )}

      {config?.last_error && (
        <p className="mt-3 text-[11px] text-red-400 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2">
          {config.last_error}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
          <Loader2 size={15} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <Campo
            label="ID do dataset (pixel)"
            placeholder="504762905373298"
            inputMode="numeric"
            value={valor("dataset_id")}
            onChange={editar("dataset_id")}
            dica="Events Manager → o dataset da loja → Configurações. Só números."
          />

          <Campo
            label="WhatsApp Business Account ID (WABA)"
            placeholder="Opcional, melhora a atribuição"
            inputMode="numeric"
            value={valor("waba_id")}
            onChange={editar("waba_id")}
            dica="Painel do app → WhatsApp → Configuração da API."
          />

          <Campo
            label="ID do número de telefone do WhatsApp"
            placeholder="Roteia os leads deste número para esta loja"
            inputMode="numeric"
            value={valor("wa_phone_number_id")}
            onChange={editar("wa_phone_number_id")}
            dica="É o phone_number_id, não o número em si. Cada loja precisa do seu — é assim que o webhook sabe de quem é o lead."
          />

          <Campo
            label={`Token do system user ${temToken ? "(já salvo)" : ""}`}
            type="password"
            autoComplete="off"
            placeholder={temToken ? "••••••••  deixe vazio para manter" : "Cole o token aqui"}
            value={valor("access_token")}
            onChange={editar("access_token")}
            dica="Business Settings → Usuários do sistema → Gerar token, com a permissão do dataset. Fica guardado no servidor e não volta para a tela."
          />

          <Campo
            label="Código de teste (test_event_code)"
            placeholder="TEST12345 — só enquanto valida"
            value={valor("test_event_code")}
            onChange={editar("test_event_code")}
            dica="Com ele preenchido os eventos aparecem só na aba Eventos de Teste e NÃO contam na campanha. Apague quando for para valer."
          />

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={salvar} disabled={salvando || !form.dataset_id.trim()}
              className="flex-1 min-w-[140px] py-3 rounded-xl bg-accent text-black text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors disabled:opacity-40">
              {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Salvar
            </button>
            <button type="button" onClick={testar} disabled={testando || !pronto}
              className="flex-1 min-w-[140px] py-3 rounded-xl border border-gray-700 text-gray-200 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:border-gray-500 transition-colors disabled:opacity-40">
              {testando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Enviar evento de teste
            </button>
          </div>

          {config?.ultimo_evento_em && (
            <p className="text-[11px] text-gray-600">
              Último evento aceito pela Meta em{" "}
              {new Date(config.ultimo_evento_em).toLocaleString("pt-BR")}.
            </p>
          )}

          <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Falta ainda apontar o webhook do WhatsApp para a plataforma — é ele que
              captura o clique do anúncio. A URL e o passo a passo estão em{" "}
              <span className="text-gray-400 font-mono">docs/TRACKEAMENTO.md</span>.
            </p>
            <a
              href="https://business.facebook.com/events_manager2"
              target="_blank" rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-accent hover:underline"
            >
              Abrir o Events Manager <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

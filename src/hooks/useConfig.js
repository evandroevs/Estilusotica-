/**
 * useConfig — Hooks para ler/salvar configurações da tabela config do Supabase.
 *
 * Prioridade: linha user-específica (user_id = auth.uid()) > linha global (user_id = NULL).
 * Usuários só podem escrever nas próprias linhas — globais são read-only (RLS).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

// ─── Fallbacks (usados quando config ainda não foi carregada) ──────────────────

const MODELOS_DEFAULT = [
  { id: "m1", nome: "React",          descricao: "Apresentador reage a conteúdo de referência em tempo real",                  is_default: true },
  { id: "m2", nome: "Narrado",         descricao: "Voice-over descrevendo o produto enquanto o visual reforça a mensagem",      is_default: true },
  { id: "m3", nome: "Low Fi",          descricao: "Estética casual e autêntica filmada com celular",                            is_default: true },
  { id: "m4", nome: "Corte Stories",   descricao: "Vertical, dinâmico, com textos e transições rápidas",                       is_default: true },
  { id: "m5", nome: "Podcast",         descricao: "Conversa longa e aprofundada entre dois apresentadores",                     is_default: true },
  { id: "m6", nome: "Especialista",    descricao: "Autoridade falando diretamente para a câmera com credibilidade",             is_default: true },
  { id: "m7", nome: "Tela Dividida",   descricao: "Split screen para comparação antes/depois ou versus concorrente",            is_default: true },
  { id: "m8", nome: "Chroma Key",      descricao: "Fundo removido com cenário artificial ou produto em destaque",               is_default: true },
];

const ANGULOS_DEFAULT = [
  { id: "a1", nome: "Dor",               psicologia: "Foco no problema e no desconforto atual do público",                             nivel: "Consciente do Problema",                is_default: true },
  { id: "a2", nome: "Desejo",            psicologia: "Foco na transformação aspiracional e no estado ideal conquistado",                nivel: "Consciente da Solução",                 is_default: true },
  { id: "a3", nome: "Medo",              psicologia: "Agita as consequências negativas de não agir agora",                             nivel: "Inconsciente / Consciente do Problema", is_default: true },
  { id: "a4", nome: "Prova",             psicologia: "Dados, autoridade e resultados comprovados por terceiros",                       nivel: "Consciente do Produto",                 is_default: true },
  { id: "a5", nome: "Comparação",        psicologia: "Produto superior às alternativas existentes no mercado",                         nivel: "Consciente da Solução / Produto",       is_default: true },
  { id: "a6", nome: "Contexto Social",   psicologia: "Pertencimento, validação social e comportamento de grupo",                       nivel: "Consciente da Solução",                 is_default: true },
  { id: "a7", nome: "Urgência Legítima", psicologia: "Motivo real e verificável para ação imediata (não manipulação)",                 nivel: "Consciente da Oferta",                  is_default: true },
  { id: "a8", nome: "Promoção",          psicologia: "Oferta concreta — desconto, bônus ou condição especial com vantagem clara",      nivel: "Consciente da Oferta",                  is_default: true },
];

export const INFLU_CATEGORIAS = ["UGC", "Influ Micro", "Influ Macro"];

const INFLUS_DEFAULT = [
  { id: "i1", nome: "Ana Elisa", categoria: "Influ Macro", keywords: ["ana elisa"] },
  { id: "i2", nome: "Evelyn",    categoria: "Influ Macro", keywords: ["evelyn"] },
  { id: "i3", nome: "Jade",      categoria: "Influ Macro", keywords: ["jade"] },
  { id: "i4", nome: "Saly",      categoria: "UGC",         keywords: ["saly"] },
  { id: "i5", nome: "Taina",     categoria: "UGC",         keywords: ["taina"] },
  { id: "i6", nome: "Brenda",    categoria: "Influ Micro", keywords: ["brenda"] },
  { id: "i7", nome: "Dani",      categoria: "Influ Macro", keywords: ["dani"] },
];

const BENCHMARKS_DEFAULT = {
  roas_qualificado:    3.0,
  roas_excelente:      5.0,
  ctr_bom:             1.5,
  ctr_excelente:       3.0,
  thumbstop_bom:       25,
  thumbstop_excelente: 40,
  body_rate_bom:       15,
  body_rate_excelente: 30,
  frequencia_tofu_max: 1.15,
  frequencia_mofu_max: 2.0,
};

export const CONFIG_FALLBACKS = {
  modelos_video: MODELOS_DEFAULT,
  angulos:       ANGULOS_DEFAULT,
  benchmarks:    BENCHMARKS_DEFAULT,
  influs:        INFLUS_DEFAULT,
};

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchConfig(chave, userId) {
  const { data } = await supabase
    .from("config")
    .select("valor, user_id")
    .eq("chave", chave);

  if (!data?.length) return CONFIG_FALLBACKS[chave] ?? null;

  const userRow   = data.find((r) => r.user_id === userId);
  const globalRow = data.find((r) => r.user_id === null);
  return (userRow ?? globalRow)?.valor ?? CONFIG_FALLBACKS[chave] ?? null;
}

// ─── Save helper (upsert user-specific row) ───────────────────────────────────

async function saveConfig(chave, valor, userId) {
  const { data: existing } = await supabase
    .from("config")
    .select("id")
    .eq("chave", chave)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("config")
      .update({ valor })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("config")
      .insert({ chave, valor, user_id: userId });
    if (error) throw error;
  }
}

// ─── Hooks públicos ───────────────────────────────────────────────────────────

/** Retorna o valor completo de uma chave de config (objetos, benchmarks, etc.) */
export function useConfigQuery(chave) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["config", chave],
    queryFn: () => fetchConfig(chave, user?.id),
    staleTime: 5 * 60 * 1000,
  });
}

/** Retorna uma mutation para salvar config com user_id do usuário autenticado */
export function useConfigSave(chave) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (valor) => {
      if (!user?.id) throw new Error("Não autenticado");
      return saveConfig(chave, valor, user.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config", chave] }),
  });
}

/** Retorna apenas a lista de nomes dos modelos de vídeo — para usar em selects */
export function useConfigModelosNomes() {
  const { data } = useConfigQuery("modelos_video");
  const list = Array.isArray(data) ? data.map((m) => m.nome).filter(Boolean) : [];
  return list.length ? list : MODELOS_DEFAULT.map((m) => m.nome);
}

/** Retorna apenas a lista de nomes dos ângulos — para usar em selects */
export function useConfigAngulosNomes() {
  const { data } = useConfigQuery("angulos");
  const list = Array.isArray(data) ? data.map((a) => a.nome).filter(Boolean) : [];
  return list.length ? list : ANGULOS_DEFAULT.map((a) => a.nome);
}

/** Lista de influenciadores/UGC — aba Influs da Análise */
export function useConfigInflus() {
  const { data } = useConfigQuery("influs");
  return Array.isArray(data) && data.length ? data : INFLUS_DEFAULT;
}

/** Retorna os benchmarks como objeto — para uso em KPIs e colorização */
export function useConfigBenchmarks() {
  const { data } = useConfigQuery("benchmarks");
  return (data && typeof data === "object" && !Array.isArray(data))
    ? data
    : BENCHMARKS_DEFAULT;
}

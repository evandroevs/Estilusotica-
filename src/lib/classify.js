/**
 * classify.js — cliente da Edge Function `classify-creative` (framework ADSUP)
 * e rótulos legíveis dos códigos de classificação.
 *
 * Reusado pelo CreativeModal (botão "Classificar") e pela classificação em
 * lote do Top Criativos.
 */
import { supabase } from "./supabase";

/* ─── Rótulos legíveis dos códigos ADSUP ─────────────────────────────────── */

export const PERSONA_LABELS = {
  INS:   "Cliente Inseguro",
  PRAT:  "Comprador Prático",
  RES:   "Buscador de Resultado",
  PRECO: "Comprador de Preço",
  PREM:  "Cliente Premium",
  EXP:   "Explorador de Novidades",
};

export const ETAPA_LABELS = {
  INC:  "Inconsciente",
  PROB: "Problema",
  SOL:  "Solução",
  PROD: "Produto",
  CONS: "Mais Consciente",
};

export const ANGULO_LABELS = {
  DOR:   "Dor",
  BEN:   "Benefício",
  TRANS: "Transformação",
  PROVA: "Prova social",
  COMP:  "Comparação",
  CURIO: "Curiosidade",
  AUT:   "Autoridade",
  ROT:   "Rotina",
  QC:    "Quebra de Crença",
};

export const PILAR_LABELS = {
  DSB: "Dor → Solução → Benefício",
  FF:  "Full Funnel",
  ASK: "Depoimento / Pesquisa (ASK)",
};

export const GANCHO_LABELS = {
  pergunta_dor:         "Pergunta de Dor",
  numero_prova:         "Número + Prova",
  afirmacao_contraria:  "Afirmação Contrária",
  segredo_revelado:     "Segredo Revelado",
  antes_depois_visual:  "Antes/Depois Visual",
  identificacao_direta: "Identificação Direta",
};

export function labelFor(map, code) {
  if (!code || code === "indeterminado") return "Indeterminado";
  return map[code] ?? code;
}

/* ─── Metadados da Matriz Criativa (Persona × Etapa de consciência) ──────── */

// Ordem canônica (linhas = personas, colunas = etapas da escada de consciência)
export const PERSONA_ORDER = ["INS", "PRAT", "RES", "PRECO", "PREM", "EXP"];
export const ETAPA_ORDER   = ["INC", "PROB", "SOL", "PROD", "CONS"];

// Detalhes do slide 9 da Brand Legacy Scale ("Conheça a mente. Conecte a
// mensagem."): motivação, objeção e mensagem que funciona de cada persona —
// exibidos no hover card da Matriz Criativa.
export const PERSONA_META = {
  INS:   { nome: "Cliente Inseguro",        busca: "prova, segurança e garantia",
           motivacao: "Evitar arrependimento.",  objecao: "E se não funcionar?",
           mensagem: "Prova social, garantia, depoimentos, selos e segurança." },
  PRAT:  { nome: "Comprador Prático",       busca: "rapidez, clareza e pouca fricção",
           motivacao: "Resolver rápido.",        objecao: "Vai dar trabalho?",
           mensagem: "Comunicação direta, benefícios claros, facilidade e agilidade." },
  RES:   { nome: "Buscador de Resultado",   busca: "transformação, antes/depois e evidência",
           motivacao: "Ter resultado real.",     objecao: "Isso realmente funciona?",
           mensagem: "Antes e depois, métricas, estudos e resultados reais." },
  PRECO: { nome: "Comprador de Preço",      busca: "perceber valor, economia e vantagem",
           motivacao: "Pagar o justo.",          objecao: "É caro para mim.",
           mensagem: "Comparativos, descontos, benefícios econômicos e ROI." },
  PREM:  { nome: "Cliente Premium",         busca: "exclusividade, autoridade e assinatura",
           motivacao: "Status e exclusividade.", objecao: "Tem algo superior?",
           mensagem: "Exclusividade, autoridade, diferenciais e experiência premium." },
  EXP:   { nome: "Explorador de Novidades", busca: "descoberta, tendência e inovação",
           motivacao: "Descobrir o novo.",       objecao: "Ainda é novidade?",
           mensagem: "Novidade, tendência, inovação e curiosidade." },
};

// Slide 11 da Brand Legacy Scale ("Nem todo criativo tem a mesma função"):
// para cada persona, o PILAR QUE ABRE (atrai atenção e inicia a conversa),
// o PILAR QUE FECHA (conduz à ação e fecha a venda) e a MENSAGEM PRINCIPAL.
// Usado no mini card da etiqueta do quadrante da Matriz: etapas iniciais
// (Inconsciente/Problema/Solução) recomendam o pilar que abre; etapas finais
// (Produto/Totalmente Consciente) recomendam o pilar que fecha.
export const PERSONA_PILARES = {
  INS:   { abre:  { titulo: "UGC / Prova Social",      desc: "Gera confiança e reduz a resistência inicial." },
           fecha: { titulo: "Oferta + Garantia",       desc: "Reforça segurança e elimina o medo de comprar." },
           mensagem: "É seguro, comprovado e sem risco para mim." },
  PRAT:  { abre:  { titulo: "DSB Direto",              desc: "Comunica rápido a solução para o problema." },
           fecha: { titulo: "CTA + Prazo",             desc: "Gera urgência e facilita a decisão imediata." },
           mensagem: "É rápido, fácil e posso resolver agora." },
  RES:   { abre:  { titulo: "Transformação",           desc: "Mostra o caminho, o antes e o depois." },
           fecha: { titulo: "UGC Visual",              desc: "Mostra resultados reais de pessoas como ele." },
           mensagem: "Funciona de verdade e transforma como promete." },
  PRECO: { abre:  { titulo: "Comparativo / DSB",       desc: "Destaca diferença, ganho e economia." },
           fecha: { titulo: "Oferta + Valor",          desc: "Mostra o benefício financeiro e a vantagem da oferta." },
           mensagem: "Vale mais a pena e cabe no meu bolso." },
  PREM:  { abre:  { titulo: "Conceito",                desc: "Cria desejo através de posicionamento e narrativa." },
           fecha: { titulo: "Autoridade + Experiência", desc: "Reforça exclusividade e valor da experiência." },
           mensagem: "É exclusivo, superior e feito para poucos." },
  EXP:   { abre:  { titulo: "Ângulo / Novidade",       desc: "Desperta curiosidade e abre a mente para o novo." },
           fecha: { titulo: "Creator + Escassez",      desc: "Gera desejo com autenticidade e senso de oportunidade." },
           mensagem: "É novo, diferente e vale experimentar agora." },
};

// Etapas em que o criativo tem papel de ABRIR a conversa (público frio/morno);
// nas demais (PROD, CONS) o papel é FECHAR a venda.
export const ETAPAS_QUE_ABREM = new Set(["INC", "PROB", "SOL"]);

// Slide 13 (Pilar 1 — Ângulos): a frase-exemplo de cada ângulo de comunicação.
export const ANGULO_EXEMPLOS = {
  DOR:   "Você ainda sofre com isso?",
  BEN:   "Mais praticidade, menos esforço.",
  TRANS: "Do jeito que você está para o que você quer ser.",
  PROVA: "4.872 clientes testaram.",
  COMP:  "Por que pagar mais caro se existe isso?",
  CURIO: "Você não vai acreditar no que isso faz.",
  AUT:   "Especialistas recomendam. Líderes confiam.",
  ROT:   "Encaixa na sua rotina. Funciona todo dia.",
  QC:    "Você não precisa fazer do jeito antigo.",
};

// Ângulos que funcionam melhor em cada ETAPA de consciência (foco de
// comunicação da tabela de referência: identificação/curiosidade no topo,
// prova/confiança perto do produto, fechamento na base).
export const ETAPA_ANGULOS = {
  INC:  ["CURIO", "DOR", "QC"],
  PROB: ["DOR", "TRANS", "CURIO"],
  SOL:  ["BEN", "TRANS", "COMP"],
  PROD: ["PROVA", "AUT", "COMP"],
  CONS: ["ROT", "PROVA", "AUT"],
};

// Ângulos que conectam com cada PERSONA (derivado da motivação/objeção do
// slide 9: inseguro precisa de prova; prático, de benefício rápido; etc.).
export const PERSONA_ANGULOS = {
  INS:   ["PROVA", "AUT", "QC"],
  PRAT:  ["BEN", "ROT", "COMP"],
  RES:   ["TRANS", "PROVA", "DOR"],
  PRECO: ["COMP", "BEN", "PROVA"],
  PREM:  ["AUT", "COMP", "CURIO"],
  EXP:   ["CURIO", "QC", "TRANS"],
};

// Escada de consciência (Eugene Schwartz) — nomes completos e foco de
// comunicação por nível, conforme a tabela de referência do usuário.
export const ETAPA_META = {
  INC:  { nome: "Inconsciente do Problema", desc: "Não percebe que tem um problema ou necessidade · foco: identificação, curiosidade e conscientização" },
  PROB: { nome: "Consciente do Problema",   desc: "Sabe que tem um problema, mas não conhece a solução · foco: educação, empatia e aprofundamento da dor" },
  SOL:  { nome: "Consciente da Solução",    desc: "Sabe que existem soluções, mas não decidiu pela sua · foco: apresentar a solução e seus diferenciais" },
  PROD: { nome: "Consciente do Produto",    desc: "Já conhece o produto e compara opções antes de decidir · foco: confiança, prova social e redução de objeções" },
  CONS: { nome: "Totalmente Consciente",    desc: "Já conhece o produto e está pronta para comprar · foco: oferta, urgência, benefícios finais e CTA" },
};

/* ─── Chamada da Edge Function ───────────────────────────────────────────── */

/** Deriva o formato ADSUP a partir do media_type do cache Meta. */
export function deriveFormato(ad) {
  return ad?.media_type === "image" ? "IMAGEM" : "VIDEO";
}

/** Monta o body de classificação a partir de uma linha de meta_ads_cache. */
export function buildClassifyBody(ad) {
  return {
    adId:         ad.ad_id,
    nomeCriativo: ad.ad_name ?? "",
    formato:      deriveFormato(ad),
    // Transcrição vinda da Edge Function `transcribe` (quando já rodada)
    transcricao:  ad.transcricao ?? ad.analise_video?.transcricao_completa ?? "",
    copyAnuncio:  "",                 // meta_ads_cache não guarda a copy do anúncio
    thumbnailUrl: ad.thumbnail_url ?? null,
    // Se houver video_id, a função assiste o vídeo (Gemini multimodal)
    videoId:      ad.video_id ?? null,
  };
}

/** Classifica um criativo via Edge Function. Lança em caso de erro.
 *  `force: true` reclassifica mesmo que já exista resultado salvo (a função
 *  tem guarda de idempotência no servidor e devolve o cache sem gastar IA). */
export async function classifyAd(ad, { force = false } = {}) {
  const { data, error } = await supabase.functions.invoke("classify-creative", {
    body: { ...buildClassifyBody(ad), force },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * O supabase-js só expõe `error.message` como o texto genérico "Edge Function
 * returned a non-2xx status code" para FunctionsHttpError — o motivo real vem
 * no corpo da resposta, acessível via `error.context` (um objeto Response).
 * Exportado para reuso em qualquer chamada a `supabase.functions.invoke(...)`.
 */
export async function extractFunctionErrorMessage(error) {
  try {
    if (error?.context && typeof error.context.json === "function") {
      const body = await error.context.clone().json();
      if (body?.error) return body.error;
    }
  } catch {
    // corpo não era JSON — mantém a mensagem padrão abaixo
  }
  return error?.message ?? "Erro desconhecido ao classificar o criativo";
}

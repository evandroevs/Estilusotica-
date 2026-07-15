/**
 * matrizRef.js — a matriz de REFERÊNCIA (Brand Legacy Scale, slide 10:
 * "Cada persona entra na jornada por uma porta diferente") e a lógica de
 * metas por quadrante.
 *
 * Conceito (alinhado ao MATRIZ_CRIATIVA.md): a referência define ONDE cada
 * persona entra no funil e onde ela responde bem — isso dita quantos
 * criativos ativos faz sentido manter em cada quadrante. A matriz do app
 * compara o volume REAL classificado contra essa meta:
 *   etiqueta do quadrante = categoria-alvo da referência (fixa)
 *   cor da célula         = % da meta atingida (muda conforme você produz)
 *
 * Distribuição da meta global (ex.: 150 criativos ativos) pelos pesos:
 *   Entrada Principal (amarelo na ref.)  peso 3  — porta de entrada da persona
 *   Alta Atividade    (verde escuro ref.) peso 2 — responde muito bem
 *   Atividade         (verde claro ref.)  peso 1 — pode responder bem
 *   Baixa Prioridade  (cinza ref.)        peso ¼ — menor atenção (quase nada)
 *
 * Com meta 150: célula de Entrada ≈ 10 criativos, Alta ≈ 6, Atividade ≈ 3,
 * Baixa ≈ 1 — a escala segue proporcional para 200, 250, etc.
 * (Eco do MATRIZ_CRIATIVA.md: diversidade de ângulos/etapas rotacionando e
 * baterias por região do funil, não volume uniforme em todo lugar.)
 */

/* ─── Categorias-alvo (cores da matriz de referência/imagem) ─────────────── */

// `tag` = texto curto da etiqueta no canto do quadrante · `tagFg` = cor do
// texto sobre a cor da categoria (contraste: escuro sobre claro e vice-versa)
export const REF_CATEGORIAS = {
  entrada: { label: "Entrada Principal", tag: "Entrada", tagFg: "#1A1A1A", neon: true, desc: "Ponto de entrada mais comum dessa persona no funil", cor: "#FFE55C", peso: 3 },
  alta:    { label: "Alta Atividade",    tag: "Alta",    tagFg: "#052E16", desc: "Responde muito bem nessa etapa",                      cor: "#86EFAC", peso: 2 },
  ativ:    { label: "Atividade",         tag: "Ativ.",   tagFg: "#DCFCE7", desc: "Pode responder bem nessa etapa",                      cor: "#14532D", peso: 1 },
  baixa:   { label: "Baixa Prioridade",  tag: "Baixa",   tagFg: "#C8C8D0", desc: "Menor atenção ou relevância nessa etapa",             cor: "#3F3F46", peso: 0.25 },
};

/* ─── A matriz de referência transcrita da imagem (persona × etapa) ──────── */

export const REF_MATRIX = {
  INS:   { INC: "baixa", PROB: "ativ",  SOL: "ativ",  PROD: "entrada", CONS: "alta"  },
  PRAT:  { INC: "baixa", PROB: "ativ",  SOL: "entrada", PROD: "alta",  CONS: "ativ"  },
  RES:   { INC: "ativ",  PROB: "alta",  SOL: "entrada", PROD: "alta",  CONS: "ativ"  },
  PRECO: { INC: "baixa", PROB: "ativ",  SOL: "ativ",  PROD: "entrada", CONS: "alta"  },
  PREM:  { INC: "baixa", PROB: "ativ",  SOL: "entrada", PROD: "alta",  CONS: "alta"  },
  EXP:   { INC: "entrada", PROB: "alta", SOL: "alta",  PROD: "ativ",   CONS: "baixa" },
};

/** Soma dos pesos de todas as 30 células (p/ ratear a meta global). */
export function somaPesos() {
  let w = 0;
  for (const linha of Object.values(REF_MATRIX)) {
    for (const cat of Object.values(linha)) w += REF_CATEGORIAS[cat].peso;
  }
  return w;
}

/**
 * Meta de criativos de UM quadrante dada a meta global.
 * Ex.: meta 150 → Entrada ≈ 10 · Alta ≈ 6 · Atividade ≈ 3 · Baixa ≈ 1.
 */
export function metaDoQuadrante(persona, etapa, metaGlobal) {
  const cat = REF_MATRIX[persona]?.[etapa] ?? "baixa";
  const alvo = (metaGlobal * REF_CATEGORIAS[cat].peso) / somaPesos();
  return Math.max(1, Math.round(alvo));
}

/* ─── Nível de atingimento (cor da célula) ───────────────────────────────── */
// Semáforo com GRADIENTE: cinza (0) → vermelho (longe) → amarelo
// (aproximando) → verde (meta atingida). Dentro de cada faixa a cor fica
// mais forte conforme a quantidade sobe — dá leitura fina de progresso.

export const NIVEIS = {
  zero:     { label: "Sem criativos", desc: "Nenhum classificado aqui", swatch: "#34343C" },
  vermelho: { label: "Longe da meta", desc: "Abaixo de 40% da meta",    swatch: "rgba(239,68,68,0.75)" },
  amarelo:  { label: "Aproximando",   desc: "40–99% da meta",           swatch: "rgba(234,179,8,0.80)" },
  verde:    { label: "Meta atingida", desc: "100% ou mais",             swatch: "rgba(34,197,94,0.90)" },
};
export const NIVEL_ORDER = ["zero", "vermelho", "amarelo", "verde"];

export function nivelDoQuadrante(qtd, meta) {
  if (!qtd || qtd <= 0) return "zero";
  const r = qtd / Math.max(meta, 1);
  if (r >= 1)   return "verde";
  if (r >= 0.4) return "amarelo";
  return "vermelho";
}

/**
 * Cor da célula com gradiente de intensidade dentro da faixa:
 *   vermelho: 0→40%  da meta (mais forte quanto mais perto de 40%)
 *   amarelo: 40→99%  da meta (mais forte quanto mais perto de 100%)
 *   verde:   ≥100%   (mais forte quanto mais acima da meta, satura em 150%)
 */
export function corDoQuadrante(qtd, meta) {
  if (!qtd || qtd <= 0) return { nivel: "zero", bg: "#2C2C34", fg: "#5A5A62" };
  const r = qtd / Math.max(meta, 1);

  if (r < 0.4) {
    const t = r / 0.4;                       // 0 → 1 dentro da faixa
    const alpha = 0.30 + 0.55 * t;
    return { nivel: "vermelho", bg: `rgba(239,68,68,${alpha.toFixed(2)})`, fg: "#FFE4E6" };
  }
  if (r < 1) {
    const t = (r - 0.4) / 0.6;
    const alpha = 0.35 + 0.55 * t;
    return {
      nivel: "amarelo",
      bg: `rgba(234,179,8,${alpha.toFixed(2)})`,
      fg: alpha > 0.6 ? "#1A1A1A" : "#FDE68A",
    };
  }
  const t = Math.min((r - 1) / 0.5, 1);      // satura em 150% da meta
  const alpha = 0.55 + 0.45 * t;
  return {
    nivel: "verde",
    bg: `rgba(34,197,94,${alpha.toFixed(2)})`,
    fg: alpha > 0.8 ? "#052E16" : "#DCFCE7",
  };
}

/**
 * Excesso em região de baixa prioridade: pela referência não faz sentido
 * acumular criativos ali — sinaliza pra realocar produção.
 */
export function excessoBaixaPrioridade(persona, etapa, qtd, metaGlobal) {
  const cat = REF_MATRIX[persona]?.[etapa];
  if (cat !== "baixa") return false;
  return qtd > 2 * metaDoQuadrante(persona, etapa, metaGlobal);
}

/* ─── Metas globais disponíveis no seletor ───────────────────────────────── */
export const METAS_GLOBAIS = [100, 150, 200, 250, 300, 400, 500];
export const META_DEFAULT = 150;

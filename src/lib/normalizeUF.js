/**
 * De-para de nomes de estados do Brasil.
 *
 * A dimensão `region` do GA4 às vezes vem em grafia diferente da topologia
 * (ex.: "State of São Paulo", "Federal District", sem acento). Aqui
 * garantimos o match dos 27 (26 estados + DF) com `properties.name` do
 * bra.topo.json (nomes completos em pt-BR).
 */

/** Nome canônico (igual ao topojson) por UF. */
export const ESTADO_POR_UF = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

/** UF por nome canônico (inverso). */
export const UF_POR_ESTADO = Object.fromEntries(
  Object.entries(ESTADO_POR_UF).map(([uf, nome]) => [nome, uf]),
);

const strip = (s) =>
  (s ?? "").toString().trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")     // sem acento
    .replace(/^(estado d[eo] |state of |the )/i, "")       // tira prefixos
    .replace(/\bfederal district\b/i, "distrito federal")
    .replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();

/** Índice nome-normalizado → nome canônico (topojson). */
const INDEX = {};
for (const nome of Object.values(ESTADO_POR_UF)) INDEX[strip(nome)] = nome;
// aliases comuns do GA4
INDEX[strip("Federal District")] = "Distrito Federal";
INDEX[strip("State of Sao Paulo")] = "São Paulo";

/** Normaliza um nome/UF do GA4 para o nome canônico do mapa (ou null). */
export function normalizeEstado(raw) {
  if (!raw) return null;
  const s = raw.toString().trim();
  if (ESTADO_POR_UF[s.toUpperCase()]) return ESTADO_POR_UF[s.toUpperCase()]; // veio como UF
  return INDEX[strip(s)] ?? null;
}

/** UF a partir de um nome/UF do GA4. */
export function toUF(raw) {
  const nome = normalizeEstado(raw);
  return nome ? UF_POR_ESTADO[nome] : null;
}

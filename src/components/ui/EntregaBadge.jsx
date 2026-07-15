/**
 * EntregaBadge — tag do funil REAL do anúncio pela entrega da Meta
 * (segmento de público com mais compras no período). Contorno vazado
 * para diferenciar do FunilBadge (funil planejado, preenchido).
 */
const CLS = {
  TOFU: "border-green-700/70 text-green-400",
  MOFU: "border-amber-700/70 text-amber-400",
  BOFU: "border-purple-700/70 text-purple-400",
};

const SEG_LABEL = {
  TOFU: "público novo",
  MOFU: "engajados",
  BOFU: "clientes",
};

export function EntregaBadge({ info }) {
  const funil = info?.funil_real;
  if (!funil) return null;

  const title =
    `Funil real pela entrega da Meta — vendeu mais para ${SEG_LABEL[funil]}.\n` +
    `Compras por segmento: novo ${Math.round(+info.compras_prospecting || 0)} · ` +
    `engajados ${Math.round(+info.compras_engaged || 0)} · ` +
    `clientes ${Math.round(+info.compras_existing || 0)}`;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide border bg-transparent ${CLS[funil]}`}
    >
      ◎ {funil} real
    </span>
  );
}

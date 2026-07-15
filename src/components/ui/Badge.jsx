const funiStyles = {
  TOFU: { color: "#4ADE80", background: "#052E16" },
  MOFU: { color: "#FCD34D", background: "#2B1500" },
  BOFU: { color: "#C084FC", background: "#1A0B2E" },
};

const statusStyles = {
  ativo:      { color: "#4ADE80", background: "#052E16" },
  pausado:    { color: "#FCD34D", background: "#2B1500" },
  reprovado:  { color: "#F87171", background: "#2B0A0A" },
  Validado:   { color: "#4ADE80", background: "#052E16" },
  "Em Teste": { color: "#FCD34D", background: "#2B1500" },
  Reprovado:  { color: "#F87171", background: "#2B0A0A" },
};

const defaultStyle = { color: "#94A3B8", background: "#1E293B" };

function resolveStyle(label, type) {
  if (type === "funil")  return funiStyles[label]  ?? defaultStyle;
  if (type === "status") return statusStyles[label] ?? defaultStyle;
  return defaultStyle;
}

export default function Badge({ label, type = "default" }) {
  const { color, background } = resolveStyle(label, type);

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide"
      style={{ color, background }}
    >
      {label}
    </span>
  );
}

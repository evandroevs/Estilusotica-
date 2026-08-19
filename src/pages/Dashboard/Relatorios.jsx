/**
 * Relatórios — sub-aba do Dashboard com duas visões:
 *   Mensal    → RelatorioMensal (Meta + Google, simples, com gráficos)
 *   Detalhado → Relatorio (relatório executivo de Meta Ads do analista)
 */
import { useState } from "react";
import { CalendarDays, FileText } from "lucide-react";
import RelatorioMensal from "./RelatorioMensal";
import Relatorio from "./Relatorio";

export default function Relatorios() {
  const [modo, setModo] = useState("mensal");
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 bg-gray-900 rounded-xl border border-gray-800 p-1.5 w-fit max-w-full overflow-x-auto">
        {[
          { key: "mensal",    label: "Mensal (Meta + Google)", Icon: CalendarDays },
          { key: "detalhado", label: "Detalhado (Meta)",       Icon: FileText },
        ].map(({ key, label, Icon }) => (
          <button key={key} type="button" onClick={() => setModo(key)}
            className={`inline-flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              modo === key ? "bg-accent text-black shadow-sm" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}>
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
      {modo === "mensal" ? <RelatorioMensal /> : <Relatorio />}
    </div>
  );
}

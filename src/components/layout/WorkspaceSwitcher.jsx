/**
 * Seletor de loja — fica no topo da sidebar, colado no logo.
 *
 * Clicar em outra loja recarrega o painel já apontando para ela: os dados
 * da loja anterior não são reaproveitados, e se a nova loja não tiver
 * conexão Meta o próprio RequireMetaConnection oferece conectar.
 */
import { useEffect, useRef, useState } from "react";
import { Store, Check, ChevronDown } from "lucide-react";
import { useWorkspaces } from "../../hooks/useWorkspaces";
import { switchWorkspace } from "../../lib/workspace";

export default function WorkspaceSwitcher({ collapsed }) {
  const { lojas, ativa, isLoading } = useWorkspaces();
  const [aberto, setAberto] = useState(false);
  const boxRef = useRef(null);

  // Fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!aberto) return;

    function onClickFora(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setAberto(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setAberto(false);
    }

    document.addEventListener("mousedown", onClickFora);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickFora);
      document.removeEventListener("keydown", onEsc);
    };
  }, [aberto]);

  if (isLoading || lojas.length === 0) return null;

  const rotulo = ativa?.nome ?? "Loja";

  return (
    <div
      ref={boxRef}
      style={{ borderBottom: "1px solid var(--chrome-border)" }}
      className="relative px-2 py-2 shrink-0"
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title={collapsed ? rotulo : "Trocar de loja"}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        style={{ color: "var(--nav-inactive)" }}
        className={`hover-chrome w-full flex items-center rounded-lg py-2 transition-all duration-150
          ${collapsed ? "justify-center px-0" : "gap-2 px-2.5"}`}
      >
        <Store size={15} className="shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left text-xs font-semibold text-white truncate">
              {rotulo}
            </span>
            <ChevronDown
              size={14}
              className={`shrink-0 transition-transform duration-150 ${aberto ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      {aberto && (
        <ul
          role="listbox"
          style={{ backgroundColor: "var(--chrome-bg)", border: "1px solid var(--chrome-border)" }}
          className={`absolute z-40 mt-1 rounded-lg py-1 shadow-xl shadow-black/40
            ${collapsed ? "left-full ml-2 top-2 w-48" : "left-2 right-2"}`}
        >
          {lojas.map((loja) => {
            const atual = loja.id === ativa?.id;
            return (
              <li key={loja.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={atual}
                  onClick={() => {
                    setAberto(false);
                    switchWorkspace(loja.id);
                  }}
                  style={{ color: atual ? "#ffffff" : "var(--nav-inactive)" }}
                  className="hover-chrome w-full flex items-center gap-2 px-2.5 py-2 text-left
                             text-xs font-semibold rounded-md"
                >
                  <span className="flex-1 truncate">{loja.nome}</span>
                  {atual && <Check size={13} className="text-accent shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

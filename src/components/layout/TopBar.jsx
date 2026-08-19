import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { Sun, Moon, LogOut, Menu } from "lucide-react";

export default function TopBar({ title, sidebarWidth = 240, isMobile = false, onMenuClick }) {
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const isLight = theme === "light";

  return (
    <header
      style={{
        height: 64,
        backgroundColor: "var(--chrome-bg)",
        borderBottom: "1px solid var(--chrome-border)",
        left: sidebarWidth,
        transition: "left 0.2s",
      }}
      className="fixed top-0 right-0 flex items-center justify-between gap-2 px-4 md:px-6 z-30"
    >
      <div className="flex items-center gap-2 min-w-0">
        {isMobile && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Abrir menu"
            className="hover-chrome flex items-center justify-center w-9 h-9 -ml-1 rounded-lg text-gray-400 shrink-0"
          >
            <Menu size={19} />
          </button>
        )}
        <h1 className="text-white font-semibold text-sm md:text-base leading-none tracking-tight truncate">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <span className="hidden sm:inline-flex items-center rounded-full bg-accent/10 border border-accent/20 px-3 py-1 text-xs font-semibold text-accent">
          v2.0 beta
        </span>

        <button
          type="button"
          onClick={toggleTheme}
          title={isLight ? "Mudar para tema escuro" : "Mudar para tema claro"}
          aria-label="Alternar tema"
          className="hover-chrome flex items-center justify-center w-9 h-9 md:w-8 md:h-8 rounded-lg text-gray-500 hover:text-white transition-colors"
        >
          {isLight ? <Moon size={15} /> : <Sun size={15} />}
        </button>

        {user?.email && (
          <span className="text-[11px] text-gray-500 hidden md:inline max-w-[180px] truncate">
            {user.email}
          </span>
        )}

        {/* Sem sessão (plataforma aberta) não há o que deslogar */}
        {user && (
          <button
            type="button"
            onClick={signOut}
            title="Sair"
            aria-label="Sair da conta"
            className="hover-chrome flex items-center justify-center w-9 h-9 md:w-8 md:h-8 rounded-lg text-gray-500 hover:text-white transition-colors"
          >
            <LogOut size={15} />
          </button>
        )}
      </div>
    </header>
  );
}

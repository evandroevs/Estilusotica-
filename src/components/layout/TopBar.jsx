import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { LogOut, Sun, Moon } from "lucide-react";

export default function TopBar({ title, sidebarWidth = 240 }) {
  const { signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
      className="fixed top-0 right-0 flex items-center justify-between px-6 z-20"
    >
      <h1 className="text-white font-semibold text-base leading-none tracking-tight">
        {title}
      </h1>

      <div className="flex items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-accent/10 border border-accent/20 px-3 py-1 text-xs font-semibold text-accent">
          v2.0 beta
        </span>

        <button
          type="button"
          onClick={toggleTheme}
          title={isLight ? "Mudar para tema escuro" : "Mudar para tema claro"}
          aria-label="Alternar tema"
          className="hover-chrome flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-white transition-colors"
        >
          {isLight ? <Moon size={15} /> : <Sun size={15} />}
        </button>

        <button
          type="button"
          onClick={signOut}
          title="Sair"
          className="hover-chrome flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-white transition-colors"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}

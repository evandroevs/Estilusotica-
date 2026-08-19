import { NavLink } from "react-router-dom";
import {
  Target, LayoutDashboard, ChevronsLeft, ChevronsRight, Trophy, Plug,
  MessageCircle, X,
} from "lucide-react";
import { BRAND_NAME } from "../../lib/brand";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

const NAV_ITEMS = [
  { to: "/",               Icon: LayoutDashboard, label: "Dashboard"      },
  { to: "/top-criativos",  Icon: Trophy,          label: "Top Criativos"  },
  { to: "/conexoes",       Icon: Plug,            label: "Conexões"       },
  { to: "/trackeamento",   Icon: MessageCircle,   label: "Trackeamento"   },
];

export default function Sidebar({ collapsed, onToggle, isMobile = false, open = false, onClose }) {
  return (
    <>
      {/* Overlay do drawer (só mobile) */}
      {isMobile && open && (
        <div
          onClick={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] md:hidden"
        />
      )}

    <aside
      style={{
        width: isMobile ? 260 : collapsed ? 64 : 240,
        backgroundColor: "var(--chrome-bg)",
        transform: isMobile && !open ? "translateX(-100%)" : "translateX(0)",
      }}
      className="fixed left-0 top-0 h-screen flex flex-col z-50 shrink-0
                 transition-[width,transform] duration-200 overflow-hidden"
    >
      {/* Logo */}
      <div
        style={{ borderBottom: "1px solid var(--chrome-border)" }}
        className="flex items-center gap-3 px-3.5 py-5 shrink-0 min-h-[72px]"
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent shrink-0 shadow-lg shadow-accent/30">
          <Target size={16} className="text-black" />
        </div>
        {!collapsed && (
          <span className="text-white font-bold text-sm tracking-tight whitespace-nowrap overflow-hidden">
            {BRAND_NAME}
          </span>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar menu"
            style={{ color: "var(--nav-inactive)" }}
            className="hover-chrome ml-auto flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
          >
            <X size={17} />
          </button>
        )}
      </div>

      {/* Seletor de loja — colado no logo */}
      <WorkspaceSwitcher collapsed={collapsed} />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ to, Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onClose}
            title={collapsed ? label : undefined}
            style={({ isActive }) =>
              isActive
                ? { backgroundColor: "rgb(var(--c-accent))", color: "#000000" }
                : { color: "var(--nav-inactive)" }
            }
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg text-xs font-semibold
               transition-all duration-150 whitespace-nowrap
               ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-3 md:py-2.5"}
               ${isActive ? "shadow-sm" : "hover-chrome"}`
            }
          >
            <Icon size={17} className="shrink-0" />
            {!collapsed && label}
          </NavLink>
        ))}
      </nav>

      {/* Footer — collapse toggle (no mobile o drawer não recolhe) */}
      <div
        style={{ borderTop: "1px solid var(--chrome-border)" }}
        className="px-2 py-4 shrink-0"
      >
        {!collapsed && (
          <p className="text-[10px] text-gray-500 px-3 mb-2 whitespace-nowrap overflow-hidden">
            © 2026 {BRAND_NAME}
          </p>
        )}
        {!isMobile && (
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          style={{ color: "var(--nav-inactive)" }}
          className={`hover-chrome w-full flex items-center rounded-lg py-2
            transition-all duration-150
            ${collapsed ? "justify-center px-0" : "gap-2 px-3"}`}
        >
          {collapsed ? (
            <ChevronsRight size={15} />
          ) : (
            <>
              <ChevronsLeft size={15} />
              <span className="text-xs font-medium whitespace-nowrap">Recolher</span>
            </>
          )}
        </button>
        )}
      </div>
    </aside>
    </>
  );
}

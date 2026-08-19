import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { queryClient }     from "./lib/queryClient";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Sidebar            from "./components/layout/Sidebar";
import TopBar             from "./components/layout/TopBar";
import { ToastProvider }  from "./context/ToastContext";
import { ThemeProvider }  from "./context/ThemeContext";
import { useIsMobile }    from "./hooks/useIsMobile";
import { BRAND_NAME } from "./lib/brand";

// Code splitting por rota: cada página vira um chunk próprio — o primeiro
// carregamento baixa só o necessário (React Flow e Recharts só nas páginas que usam).
const Dashboard     = lazy(() => import("./pages/Dashboard"));
const TopCreativos  = lazy(() => import("./pages/TopCreativos"));
const Conexoes      = lazy(() => import("./pages/Conexoes"));
const Trackeamento  = lazy(() => import("./pages/Trackeamento"));
const MetaCallback  = lazy(() => import("./pages/MetaCallback"));
const Login         = lazy(() => import("./pages/Login"));
const GA4Callback   = lazy(() => import("./pages/GA4Callback"));
const NotFound      = lazy(() => import("./pages/NotFound"));

const RequireMetaConnection = lazy(() => import("./components/RequireMetaConnection"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={26} className="text-accent animate-spin" />
    </div>
  );
}

const PAGE_TITLES = {
  "/":               "Dashboard",
  "/top-criativos":  "Top Criativos",
  "/conexoes":       "Conexões",
  "/trackeamento":   "Trackeamento",
  "/meta/callback":  "Conectando…",
};

// ─── AppLayout (só renderizado quando autenticado) ─────────────

function AppLayout() {
  const { pathname } = useLocation();
  const title = PAGE_TITLES[pathname] ?? BRAND_NAME;

  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem("sidebar-collapsed") === "true",
  const isMobile = useIsMobile();

  );

  const sidebarWidth = isMobile ? 0 : collapsed ? 64 : 240;
  // No mobile a sidebar vira drawer: sempre expandida por dentro, escondida
  // fora da tela até o usuário abrir pelo botão da TopBar.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Com o drawer aberto, trava o scroll do body para não rolar por baixo.
  useEffect(() => {
    if (!isMobile || !drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isMobile, drawerOpen]);

  function handleToggle() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar
        collapsed={isMobile ? false : collapsed}
        onToggle={handleToggle}
        isMobile={isMobile}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <div
        className="flex flex-col flex-1 min-w-0 transition-[margin] duration-200"
        style={{ marginLeft: sidebarWidth }}
      >
        <TopBar
          title={title}
          sidebarWidth={sidebarWidth}
          isMobile={isMobile}
          onMenuClick={() => setDrawerOpen(true)}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-6" style={{ marginTop: 64 }}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/"               element={<Dashboard />}    />
              <Route path="/top-criativos"  element={<RequireMetaConnection><TopCreativos /></RequireMetaConnection>} />
              <Route path="/conexoes"       element={<Conexoes />}     />
              <Route path="/trackeamento"   element={<Trackeamento />} />
              <Route path="/meta/callback"  element={<MetaCallback />} />
              <Route path="*"              element={<NotFound />}     />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

// ─── SessionGate — plataforma aberta por padrão ─────────────────
// Hoje o painel abre sem login. Com sessão, as queries rodam sob RLS do
// workspace do usuário; sem sessão, elas voltam o que o RLS liberar para
// o anon.
//
// Para reativar o login obrigatório (SaaS multi-tenant), basta definir
// VITE_REQUIRE_AUTH=1 no .env.local e nas envs da Vercel.
const REQUIRE_AUTH = import.meta.env.VITE_REQUIRE_AUTH === "1";

function SessionGate() {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={32} className="text-accent animate-spin" />
      </div>
    );
  }

  if (!session && REQUIRE_AUTH) return <Login />;

  return <AppLayout />;
}

// ─── Root ───────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Suspense fallback={
              <div className="min-h-screen bg-gray-950 flex items-center justify-center">
                <Loader2 size={32} className="text-accent animate-spin" />
              </div>
            }>
              <Routes>
                {/* Callback OAuth do Google (popup) */}
                <Route path="/ga4/callback" element={<GA4Callback />} />
                <Route path="/*" element={<SessionGate />} />
              </Routes>
            </Suspense>
          </ToastProvider>
        </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

import { useState, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { queryClient }     from "./lib/queryClient";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Sidebar            from "./components/layout/Sidebar";
import TopBar             from "./components/layout/TopBar";
import { ToastProvider }  from "./context/ToastContext";
import { ThemeProvider }  from "./context/ThemeContext";
import { BRAND_NAME } from "./lib/brand";

// Code splitting por rota: cada página vira um chunk próprio — o primeiro
// carregamento baixa só o necessário (React Flow e Recharts só nas páginas que usam).
const Dashboard     = lazy(() => import("./pages/Dashboard"));
const TopCreativos  = lazy(() => import("./pages/TopCreativos"));
const GA4Callback   = lazy(() => import("./pages/GA4Callback"));
const NotFound      = lazy(() => import("./pages/NotFound"));

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
};

// ─── AppLayout (só renderizado quando autenticado) ─────────────

function AppLayout() {
  const { pathname } = useLocation();
  const title = PAGE_TITLES[pathname] ?? BRAND_NAME;

  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem("sidebar-collapsed") === "true",
  );

  const sidebarWidth = collapsed ? 64 : 240;

  function handleToggle() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />

      <div
        className="flex flex-col flex-1 transition-[margin] duration-200"
        style={{ marginLeft: sidebarWidth }}
      >
        <TopBar title={title} sidebarWidth={sidebarWidth} />

        <main className="flex-1 overflow-y-auto p-6" style={{ marginTop: 64 }}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/"               element={<Dashboard />}   />
              <Route path="/top-criativos"  element={<TopCreativos />} />
              <Route path="*"              element={<NotFound />}     />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

// ─── SessionGate — segura o render até a sessão anônima existir ─
// Sem isso as primeiras queries disparam sem JWT e o RLS devolve vazio.

function SessionGate() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={32} className="text-accent animate-spin" />
      </div>
    );
  }

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

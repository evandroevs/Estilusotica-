/**
 * Login/Cadastro — porta de entrada do SaaS.
 *
 * Cadastro cria o usuário no Supabase Auth; o trigger handle_new_user
 * cria o workspace automaticamente. Se o projeto estiver com confirmação
 * de e-mail ativada, mostra o aviso de "verifique seu e-mail".
 */
import { useState } from "react";
import { Target, Loader2, Mail, Lock, Building2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { BRAND_NAME } from "../../lib/brand";

export default function Login() {
  const { signIn, signUp } = useAuth();

  const [mode, setMode]         = useState("login"); // login | signup
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [empresa, setEmpresa]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [notice, setNotice]     = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "login") {
        const { error } = await signIn(email.trim(), password);
        if (error) throw error;
        // onAuthStateChange troca a tela sozinho
      } else {
        const { data, error } = await signUp(email.trim(), password, empresa.trim());
        if (error) throw error;
        if (!data?.session) {
          setNotice("Conta criada! Verifique seu e-mail para confirmar o cadastro e depois faça login.");
          setMode("login");
        }
      }
    } catch (err) {
      const msg = err?.message ?? String(err);
      setError(
        /invalid login credentials/i.test(msg) ? "E-mail ou senha incorretos." :
        /already registered/i.test(msg)        ? "Este e-mail já tem cadastro — faça login." :
        /at least 6 characters/i.test(msg)     ? "A senha precisa ter pelo menos 6 caracteres." :
        msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent shadow-lg shadow-accent/30">
            <Target size={20} className="text-black" />
          </div>
          <span className="text-white font-bold text-xl tracking-tight">{BRAND_NAME}</span>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          {/* Alternância login/cadastro */}
          <div className="grid grid-cols-2 gap-1 bg-gray-950 rounded-lg p-1 mb-6">
            {[["login", "Entrar"], ["signup", "Criar conta"]].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setMode(key); setError(null); setNotice(null); }}
                className={`py-2 rounded-md text-xs font-semibold transition-colors ${
                  mode === key
                    ? "bg-accent text-black"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Nome da empresa
                </label>
                <div className="relative">
                  <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={empresa}
                    onChange={(e) => setEmpresa(e.target.value)}
                    placeholder="Minha Marca"
                    className="w-full h-10 rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">E-mail</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com"
                  className="w-full h-10 rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Senha</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            </div>

            {error  && <p className="text-xs text-red-400">{error}</p>}
            {notice && <p className="text-xs text-accent">{notice}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-10 rounded-lg bg-accent text-black text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {mode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-gray-600 mt-6">
          © 2026 {BRAND_NAME} — análise de criativos Meta Ads
        </p>
      </div>
    </div>
  );
}

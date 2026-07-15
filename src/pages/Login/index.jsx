import { useState } from "react";
import { Target, Loader2, Eye, EyeOff } from "lucide-react";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("E-mail ou senha incorretos. Verifique seus dados e tente novamente.");
      setLoading(false);
    }
    // Se sucesso: AuthContext detecta a nova sessão e App re-renderiza para o painel
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-accent shadow-lg shadow-accent/20">
            <Target size={22} className="text-black" />
          </div>
          <span className="text-white font-bold text-xl tracking-tight">Estilusótica</span>
        </div>

        {/* Card */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl">
          <h1 className="text-xl font-bold text-white mb-1">Bem-vindo de volta</h1>
          <p className="text-sm text-gray-500 mb-7">Acesse o painel da Estilusótica</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* E-mail */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                E-mail
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full h-11 rounded-xl bg-gray-800 border border-gray-700 px-4 text-sm text-white
                           placeholder:text-gray-600
                           focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40
                           transition-colors"
              />
            </div>

            {/* Senha */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                Senha
              </label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 rounded-xl bg-gray-800 border border-gray-700 px-4 pr-10 text-sm text-white
                             placeholder:text-gray-600
                             focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40
                             transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm text-red-400 bg-red-950 border border-red-900/60 rounded-xl px-4 py-3 leading-snug">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-accent text-black font-bold text-sm
                         hover:bg-accent-hover active:scale-[0.98]
                         transition-all shadow-lg shadow-accent/20
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2 mt-2"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Entrando...</>
                : "Entrar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-700 mt-6">
          Estilusótica · Dashboard
        </p>
      </div>
    </div>
  );
}

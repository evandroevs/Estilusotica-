import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { queryClient } from "../lib/queryClient";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// Plataforma aberta: com estas envs definidas o app entra sozinho numa conta
// fixa, sem mostrar tela de login. É o que dá workspace (e portanto dados) a
// quem abre o link. Sem elas, o painel abre sem sessão e o RLS não devolve
// nada. ⚠️ Quem tiver o link tem os dados dessa conta.
const AUTO_EMAIL = import.meta.env.VITE_AUTO_LOGIN_EMAIL;
const AUTO_SENHA = import.meta.env.VITE_AUTO_LOGIN_PASSWORD;

export function AuthProvider({ children }) {
  // undefined = loading | null = signed out | object = signed in
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session && AUTO_EMAIL && AUTO_SENHA) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email:    AUTO_EMAIL,
          password: AUTO_SENHA,
        });
        if (error) console.error("Auto-login falhou:", error.message);
        setSession(data?.session ?? null);
        return;
      }
      setSession(session ?? null);
    });

    // Quando o token muda (login automático, renovação de token expirado,
    // logout), tudo que já foi buscado com o token anterior está furado —
    // inclusive respostas vazias que o RLS devolveu por falta de sessão
    // válida. Sem este refetch, a lista de lojas fica presa em vazia e o
    // seletor não aparece.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session ?? null);
      if (["SIGNED_IN", "TOKEN_REFRESHED", "SIGNED_OUT"].includes(event)) {
        queryClient.invalidateQueries();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  // workspace_name vai no user_metadata — o trigger handle_new_user usa
  // para nomear o workspace criado automaticamente no signup.
  function signUp(email, password, workspaceName) {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { workspace_name: workspaceName || "" } },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{
        user:    session?.user ?? null,
        session: session ?? null,
        loading: session === undefined,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

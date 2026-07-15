import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function AuthProvider({ children }) {
  // undefined = loading | null = signed out | object = signed in
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    // Sem tela de login: se não há sessão salva, cria uma sessão anônima
    // (anonymous sign-in habilitado no projeto). A sessão fica no localStorage.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) console.error("Falha no login anônimo:", error.message);
        setSession(data?.session ?? null);
        return;
      }
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{
        user:    session?.user ?? null,
        session: session ?? null,
        loading: session === undefined,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

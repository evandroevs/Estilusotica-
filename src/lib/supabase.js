import { createClient } from "@supabase/supabase-js";
import { getActiveWorkspaceId } from "./workspace";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local");
}

// A loja ativa é fixada na criação do client — vale para PostgREST e para as
// Edge Functions. Trocar de loja recarrega a página (ver lib/workspace.js),
// então o client sempre nasce apontando para a loja certa.
const lojaAtiva = getActiveWorkspaceId();

export const supabase = createClient(url ?? "", key ?? "", {
  global: {
    headers: lojaAtiva ? { "x-workspace-id": lojaAtiva } : {},
  },
});

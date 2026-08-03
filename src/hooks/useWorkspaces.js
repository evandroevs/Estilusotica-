/**
 * useWorkspaces — lojas em que o usuário é membro, na ordem de criação.
 *
 * Alimenta o seletor de loja do topo da sidebar. Sem nada salvo em
 * localStorage, a loja ativa é a primeira da lista — mesmo critério do
 * fallback de current_workspace_id() no banco.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { getActiveWorkspaceId } from "../lib/workspace";

export function useWorkspaces() {
  const query = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, nome")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const lojas    = query.data ?? [];
  const salva    = getActiveWorkspaceId();
  const ativa    = lojas.find((l) => l.id === salva) ?? lojas[0] ?? null;

  return { ...query, lojas, ativa };
}

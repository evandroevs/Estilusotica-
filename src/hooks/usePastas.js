/**
 * Hooks de pastas de criativos (salvar + compartilhar).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

/** Lista as pastas do usuário (com contagem de itens e caminho completo). */
export function usePastas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pastas", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pastas")
        .select("id, nome, parent_id, share_token, created_at, pasta_itens(count)")
        .eq("user_id", user.id)
        .order("nome");
      if (error) throw error;
      const rows = (data ?? []).map((p) => ({
        ...p,
        item_count: p.pasta_itens?.[0]?.count ?? 0,
      }));
      // display = caminho completo ("Maio 2026 / Laranja Moro")
      const byId = new Map(rows.map((p) => [p.id, p]));
      for (const p of rows) {
        const chain = [p.nome];
        let cur = byId.get(p.parent_id);
        while (cur) { chain.unshift(cur.nome); cur = byId.get(cur.parent_id); }
        p.display = chain.join(" / ");
      }
      rows.sort((a, b) => a.display.localeCompare(b.display));
      return rows;
    },
    enabled: !!user,
    staleTime: 1000 * 60,
  });
}

/** Cria uma pasta (opcionalmente dentro de outra) e retorna a linha criada. */
export function useCreatePasta() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arg) => {
      // Aceita string (raiz) ou { nome, parentId }.
      const nome = typeof arg === "string" ? arg : arg.nome;
      const parentId = typeof arg === "string" ? null : (arg.parentId ?? null);
      const { data, error } = await supabase
        .from("pastas")
        .insert({ nome, user_id: user.id, parent_id: parentId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pastas"] }),
  });
}

/** Salva a mídia de um anúncio numa pasta (copia da Meta → Storage). */
export function useSaveToPasta() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ adId, pastaId, metricas, periodo }) => {
      const { data, error } = await supabase.functions.invoke("save-media", {
        body: {
          ad_id:          adId,
          pasta_id:       pastaId,
          user_id:        user.id,
          metricas:       metricas ?? null,
          periodo_inicio: periodo?.inicio ?? null,
          periodo_fim:    periodo?.fim ?? null,
        },
      });
      if (error) {
        // FunctionsHttpError esconde a mensagem real em error.context (Response).
        // Lê o corpo para mostrar o motivo verdadeiro (ex.: "Imagem indisponível na Meta").
        let detail = error.message ?? "Erro ao salvar mídia";
        try {
          const body = await error.context?.json?.();
          if (body?.error) detail = body.error;
        } catch { /* corpo não é JSON — mantém a mensagem padrão */ }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pastas"] });
      qc.invalidateQueries({ queryKey: ["pasta-itens"] });
    },
  });
}

/** Itens de uma pasta. */
export function usePastaItens(pastaId) {
  return useQuery({
    queryKey: ["pasta-itens", pastaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pasta_itens")
        .select("*")
        .eq("pasta_id", pastaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!pastaId,
  });
}

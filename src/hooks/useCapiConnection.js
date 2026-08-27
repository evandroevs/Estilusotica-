/**
 * useCapiConnection — configuração da Conversions API da loja ativa.
 *
 * Vai pela Edge Function `meta-capi-config` em vez de ler a tabela direto,
 * porque o token mora em `meta_capi_secrets`, que não tem policy de RLS —
 * só service_role enxerga. A function devolve `tem_token` no lugar do valor.
 *
 *   data.config === null  → loja nunca configurada
 *   data.tem_token        → já existe token guardado no servidor
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export const CAPI_QUERY_KEY = ["capi-connection"];

export function useCapiConnection() {
  return useQuery({
    queryKey: CAPI_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-capi-config", {
        body: { action: "get" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { config: data.config ?? null, temToken: Boolean(data.tem_token) };
    },
    staleTime: 60 * 1000,
    // Sem retry: enquanto a function não estiver deployada isso só atrasa a
    // tela em vários segundos para chegar no mesmo erro.
    retry: false,
  });
}

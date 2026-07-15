/**
 * useFunilReal — funil real de cada anúncio no período, pela entrega da Meta.
 *
 * Lê a RPC get_funil_real (agrega meta_ads_segments): o segmento de público
 * com mais compras define a tag — prospecting→TOFU, engaged→MOFU,
 * existing→BOFU. Retorna um Map ad_id → { funil_real, compras_* } (ou null
 * enquanto carrega).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export function useFunilReal({ s, e, enabled = true } = {}) {
  const { data } = useQuery({
    queryKey: ["funil-real", s, e],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_funil_real", {
        p_start: s,
        p_end:   e,
      });
      if (error) throw error;
      const map = new Map();
      for (const r of data ?? []) map.set(r.ad_id, r);
      return map;
    },
    enabled: enabled && !!s && !!e,
    staleTime: 1000 * 60 * 5,
  });
  return data ?? null;
}

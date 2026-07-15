import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

/**
 * Busca a mídia (thumbnail + URL do vídeo) de um anúncio sob demanda.
 * Chama a Edge Function meta-creative que atualiza meta_ads_cache e retorna:
 *   { media_type: "image"|"video"|null, url: string|null, thumbnail_url: string|null }
 *
 * Uso: const { data, isLoading } = useCreativeMedia(ad.ad_id)
 * Passar null/undefined para adId desabilita a query (lazy).
 */
export function useCreativeMedia(adId, { refresh = false } = {}) {
  return useQuery({
    queryKey: ["creative-media", adId, refresh],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-creative", {
        body: { ad_id: adId, refresh },
      });
      if (error) throw new Error(error.message ?? "meta-creative error");
      return data;
    },
    enabled: !!adId,
    staleTime: 1000 * 60 * 30, // 30 min — URLs de vídeo Meta expiram; revalida quando stale
    gcTime:    1000 * 60 * 60, // 1 hora no cache em memória
    retry: 1,
  });
}

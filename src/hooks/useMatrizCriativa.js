/**
 * useMatrizCriativa — dados da aba Matriz Criativa.
 *
 * Escopo determinístico da Matriz: anúncios ATIVOS de campanhas ATIVAS cujo
 * NOME contém "laranja moro" (regra do usuário — dispensa a inferência de
 * produto por palavra-chave, que era ambígua em nomes mistos). Vale para a
 * agregação (matriz_criativa_view, filtrada no banco), para o drill-in de um
 * quadrante (filtrado aqui) e para a fila do classify-batch — os três
 * precisam concordar, senão a contagem da célula não bate com a lista.
 *
 * - useMatrizCriativa(): lê a view agregada matriz_criativa_view
 *   (qtd de criativos por Persona × Etapa de consciência).
 * - useCriativosPorQuadrante(persona, etapa): criativos de um quadrante,
 *   juntando creative_classifications (classificação ADSUP) com
 *   meta_ads_cache (métricas + thumbnail) por ad_id — join no cliente,
 *   pois não há FK entre as tabelas.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

// Mesmo padrão da view (ilike '%laranja%moro%') e do classify-batch.
export const MATRIZ_CAMPANHA_REGEX = /laranja.*moro/i;

/** Campanhas ativas na Meta (null = meta_campaigns ainda sem sync → tolera). */
export async function fetchCampanhasAtivas() {
  const { data: activeCampaigns } = await supabase
    .from("meta_campaigns")
    .select("campaign_id")
    .eq("effective_status", "ACTIVE");
  return activeCampaigns?.length
    ? new Set(activeCampaigns.map((c) => c.campaign_id))
    : null;
}

export function useMatrizCriativa() {
  return useQuery({
    queryKey: ["matriz-criativa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matriz_criativa_view")
        .select("persona, etapa_funil, qtd");
      if (error) throw error;
      return data ?? [];
    },
    // O cron classify-batch preenche a tabela em segundo plano no servidor;
    // o refetch periódico faz a matriz se atualizar sozinha na tela.
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60,
  });
}

export function useCriativosPorQuadrante(persona, etapaFunil) {
  return useQuery({
    queryKey: ["criativos-quadrante", persona, etapaFunil],
    enabled: !!persona && !!etapaFunil,
    queryFn: async () => {
      // 1. Classificações do quadrante
      const { data: cls, error } = await supabase
        .from("creative_classifications")
        .select("*")
        .eq("persona", persona)
        .eq("etapa_funil", etapaFunil)
        .order("confidence_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      if (!cls?.length) return [];

      // 2. Escopo: campanha com "laranja moro" no NOME + campanha ativa +
      //    anúncio ativo (mesmo filtro da matriz_criativa_view)
      const activeCampaignIds = await fetchCampanhasAtivas();

      const adIds = cls.map((c) => c.ad_id).filter(Boolean);
      const { data: ads, error: adsErr } = await supabase
        .from("meta_ads_cache")
        .select("*")
        .in("ad_id", adIds)
        .ilike("campaign_name", "%laranja%moro%");
      if (adsErr) throw adsErr;

      const filteredAds = (ads ?? []).filter(
        (a) =>
          (!activeCampaignIds || activeCampaignIds.has(a.campaign_id)) &&
          // Status do PRÓPRIO anúncio (sync-ad-status); null = ainda não sincronizado → tolera
          (!a.effective_status || a.effective_status === "ACTIVE"),
      );
      const adMap = new Map(filteredAds.map((a) => [a.ad_id, a]));

      // 3. Merge: linha do anúncio (p/ o CreativeModal) + classificação em _cls
      //    Classificações de anúncios fora do escopo (outro produto, pausados,
      //    ou já removidos do cache) são descartadas — mesma regra da view.
      return cls
        .filter((c) => adMap.has(c.ad_id))
        .map((c) => ({ ...adMap.get(c.ad_id), _cls: c }));
    },
  });
}

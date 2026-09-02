/**
 * useAdStatus — quem está ligado agora na Meta.
 *
 * As métricas vêm do histórico (get_ads_metrics), que não sabe se o anúncio
 * ainda está no ar. O status real mora em duas tabelas alimentadas pela Meta:
 *   • meta_ads_cache.effective_status   — por anúncio (Edge Function sync-ad-status)
 *   • meta_campaigns.effective_status   — por campanha (meta-sync)
 *
 * Ao montar, dispara `sync-ad-status` sem esperar: se o gerente pausou um
 * anúncio ontem, a tela reflete isso ao abrir, não no próximo cron.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export const AD_STATUS_KEY = ["ad-status"];

/** Sem status sincronizado ainda (null) tratamos como ativo — não some tudo da tela. */
export function estaAtivo(status) {
  return !status || status === "ACTIVE";
}

export function useAdStatus({ enabled = true } = {}) {
  const qc = useQueryClient();

  // Fire-and-forget: atualiza o status na Meta e recarrega quando terminar.
  // Falha aqui não quebra a tela — só significa status um pouco velho.
  useEffect(() => {
    if (!enabled) return;
    let cancelado = false;
    supabase.functions
      .invoke("sync-ad-status", { body: {} })
      .then(({ error }) => {
        if (cancelado || error) return;
        qc.invalidateQueries({ queryKey: AD_STATUS_KEY });
      })
      .catch(() => { /* silencioso de propósito */ });
    return () => { cancelado = true; };
  }, [enabled, qc]);

  return useQuery({
    queryKey: AD_STATUS_KEY,
    enabled,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const [ads, campanhas] = await Promise.all([
        supabase.from("meta_ads_cache").select("ad_id, effective_status").limit(5000),
        supabase.from("meta_campaigns").select("campaign_id, campaign_name, effective_status").limit(1000),
      ]);
      if (ads.error) throw ads.error;
      if (campanhas.error) throw campanhas.error;

      return {
        porAd: new Map((ads.data ?? []).map((a) => [a.ad_id, a.effective_status])),
        porCampanha: new Map((campanhas.data ?? []).map((c) => [c.campaign_id, c])),
      };
    },
  });
}

/**
 * usePeriodAds — busca métricas por anúncio agregadas em um período,
 * com AUTO-PULL: se o intervalo pedido não estiver coberto pelos dados já
 * sincronizados, dispara a Edge Function meta-sync para o trecho faltante
 * e recarrega automaticamente.
 *
 * Leitura via RPC get_ads_metrics (agrega meta_ads_daily + junta metadados).
 * Retorna linhas por anúncio no mesmo formato que as páginas consomem.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { syncMetaRange } from "../lib/syncMeta";
import { getPeriodDates, fmtDate, today } from "../lib/periods";

async function fetchSyncedRange() {
  const { data } = await supabase.rpc("get_synced_range");
  const row = Array.isArray(data) ? data[0] : data;
  return { min: row?.min_date ?? null, max: row?.max_date ?? null };
}

// Re-sincroniza o dia atual se o último sync tiver mais que isso
const TODAY_STALE_MS = 10 * 60 * 1000;

/** Timestamp do último sync que gravou o dia atual (null se nunca). */
async function fetchTodaySyncedAt(todayStr) {
  const { data } = await supabase
    .from("meta_ads_daily")
    .select("synced_at")
    .eq("date", todayStr)
    .order("synced_at", { ascending: false })
    .limit(1);
  return data?.[0]?.synced_at ?? null;
}

/** Calcula o trecho [start, end] que precisa ser sincronizado, ou null se já coberto. */
function computeGap(s, e, min, max) {
  const todayStr = fmtDate(today());
  const needEnd = e > todayStr ? todayStr : e; // nunca pedir o futuro
  if (!min || !max) return { start: s, end: needEnd };           // banco vazio
  if (s < min)       return { start: s, end: needEnd };           // falta histórico → busca o pedido
  if (needEnd > max) return { start: max, end: needEnd };         // falta o final → do último dia até o fim
  return null;                                                    // já coberto
}

export function usePeriodAds({ period, custom, productId, campaignId, enabled = true } = {}) {
  const qc = useQueryClient();
  const { s, e } = getPeriodDates(period, custom);

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [syncProgress, setSyncProgress] = useState(null); // última data já sincronizada

  // Auto-pull: garante cobertura do intervalo [s, e]
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const { min, max } = await fetchSyncedRange();
        if (cancelled) return;
        let gap = computeGap(s, e, min, max);

        // Intervalo coberto — mas se inclui o dia atual, re-sincroniza
        // quando o último sync de hoje estiver velho (dados quase ao vivo).
        if (!gap) {
          const todayStr = fmtDate(today());
          if (e >= todayStr) {
            const syncedAt = await fetchTodaySyncedAt(todayStr);
            if (cancelled) return;
            const age = syncedAt ? Date.now() - new Date(syncedAt).getTime() : Infinity;
            if (age > TODAY_STALE_MS) gap = { start: todayStr, end: todayStr };
          }
        }
        if (!gap || gap.start > gap.end) return; // já coberto e fresco

        setSyncing(true);
        setSyncError(null);
        setSyncProgress(null);
        // Atualiza a grade a cada bloco sincronizado (não espera o fim de tudo):
        // em períodos longos (ex.: 2025 inteiro) os anúncios vão aparecendo aos poucos.
        await syncMetaRange(gap.start, gap.end, {
          onProgress: ({ to }) => {
            if (cancelled) return;
            setSyncProgress(to);
            qc.invalidateQueries({ queryKey: ["period-ads"] });
          },
        });
        if (!cancelled) qc.invalidateQueries({ queryKey: ["period-ads"] });
      } catch (err) {
        if (!cancelled) setSyncError(err?.message ?? "Erro ao sincronizar período");
      } finally {
        if (!cancelled) { setSyncing(false); setSyncProgress(null); }
      }
    })();

    return () => { cancelled = true; };
  }, [s, e, enabled, qc]);

  const query = useQuery({
    queryKey: ["period-ads", s, e, productId ?? null, campaignId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ads_metrics", {
        p_start:    s,
        p_end:      e,
        p_product:  productId || null,
        p_campaign: campaignId || null,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled,
    staleTime: 1000 * 60 * 5,
  });

  return {
    rows:      query.data ?? [],
    // Não bloqueia a tela durante o sync: mostra os dados que já existem no
    // banco e atualiza quando o sync terminar. Só segura o loading quando
    // ainda não há NADA para mostrar (banco vazio para o intervalo).
    loading:   query.isLoading || (syncing && !(query.data?.length)),
    syncing,
    syncProgress,
    syncError,
    range:     { s, e },
    refetch:   query.refetch,
  };
}

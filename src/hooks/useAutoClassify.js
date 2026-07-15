/**
 * useAutoClassify — classificação ADSUP automática em segundo plano.
 *
 * Recebe uma lista de anúncios (Top Criativos, Matriz Criativa) e:
 *  1. Dispara sozinho sempre que o conjunto de ad_ids muda (novo período,
 *     novo vídeo/arte sincronizado) — sem precisar clicar em nada.
 *  2. Antes de gastar IA, verifica o que já está em creative_classifications
 *     e classifica só o que falta — nunca reprocessa um criativo já feito.
 *  3. Ao terminar, invalida a Matriz Criativa (React Query) para ela
 *     repopular sozinha com os novos resultados.
 *
 * A memória de "já tentado" (sucesso OU erro) é persistida em localStorage
 * (compartilhada entre Top Criativos e Matriz) — sem isso, um F5 recriava o
 * hook do zero e reprocessava para sempre os criativos que ficam falhando
 * (ex.: vídeo grande demais, erro transiente), fazendo a barra de progresso
 * reaparecer em todo recarregamento mesmo sem nada novo. Com a memória
 * persistida, a passada automática só aparece de novo quando um ad_id
 * genuinamente novo (ainda não visto localmente nem salvo no banco) surge.
 *
 * `runNow()` força uma nova passada ignorando essa memória local — usado
 * pelo botão manual "Classificar em lote" para tentar de novo os que falharam.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { classifyAd } from "../lib/classify";

const CONCURRENCY = 3;
const STORAGE_KEY = "clab:auto-classify-attempted";

function loadAttempted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set(); // localStorage indisponível (modo privado/quota) — segue só em memória
  }
}

function saveAttempted(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // silencioso — não é crítico, só perde a persistência entre recarregamentos
  }
}

export function useAutoClassify(ads, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const runningRef   = useRef(false);
  const attemptedRef = useRef(null); // ad_ids já tentados (sucesso ou erro) — carregado 1x do localStorage
  if (attemptedRef.current === null) attemptedRef.current = loadAttempted();
  const lastSigRef    = useRef(null);
  const [progress, setProgress] = useState({ running: false, done: 0, total: 0 });

  const runPass = useCallback(async (force = false) => {
    if (runningRef.current) return { done: 0, total: 0, errors: 0 };

    const list = (ads ?? []).filter((a) => a?.ad_id);
    if (!list.length) return { done: 0, total: 0, errors: 0 };

    const candidates = force ? list : list.filter((a) => !attemptedRef.current.has(a.ad_id));
    if (!candidates.length) return { done: 0, total: 0, errors: 0 };

    // Só classifica o que ainda não está salvo — é isso que evita gastar de novo.
    const ids = candidates.map((a) => a.ad_id);
    const { data: existing, error } = await supabase
      .from("creative_classifications")
      .select("ad_id")
      .in("ad_id", ids);
    if (error) return { done: 0, total: 0, errors: 0 };

    const already = new Set((existing ?? []).map((r) => r.ad_id));
    already.forEach((id) => attemptedRef.current.add(id));

    const todo = candidates.filter((a) => !already.has(a.ad_id));
    if (!todo.length) return { done: 0, total: 0, errors: 0 };

    runningRef.current = true;
    setProgress({ running: true, done: 0, total: todo.length });

    let completed = 0;
    let errors = 0;
    let newlyClassified = 0;
    let idx = 0;

    async function worker() {
      while (idx < todo.length) {
        const ad = todo[idx++];
        attemptedRef.current.add(ad.ad_id); // marca como tentado independente do resultado
        try {
          await classifyAd(ad);
          newlyClassified++;
        } catch {
          errors++;
        }
        completed++;
        setProgress({ running: true, done: completed, total: todo.length });
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

    runningRef.current = false;
    setProgress({ running: false, done: completed, total: todo.length });
    saveAttempted(attemptedRef.current); // persiste p/ não reprocessar isto em outro refresh

    if (newlyClassified > 0) {
      queryClient.invalidateQueries({ queryKey: ["matriz-criativa"] });
      queryClient.invalidateQueries({ queryKey: ["criativos-quadrante"] });
    }

    return { done: completed, total: todo.length, errors };
  }, [ads, queryClient]);

  // Assinatura estável do conjunto de ad_ids — evita disparar de novo só
  // porque a lista foi reordenada/filtrada (ex.: trocou de aba ou de sort).
  const signature = useMemo(
    () => (ads ?? []).map((a) => a?.ad_id).filter(Boolean).sort().join(","),
    [ads],
  );

  useEffect(() => {
    if (!enabled || !signature) return;
    if (signature === lastSigRef.current) return;
    lastSigRef.current = signature;
    runPass(false);
  }, [signature, enabled, runPass]);

  return { ...progress, runNow: () => runPass(true) };
}

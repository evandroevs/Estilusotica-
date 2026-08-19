import { useCallback, useSyncExternalStore } from "react";

/**
 * useIsMobile — true quando a viewport está abaixo do breakpoint `md` (768px)
 * do Tailwind. Usado pelo shell (sidebar vira drawer, topbar ganha hambúrguer)
 * onde a decisão precisa acontecer no JS, não só no CSS.
 */
export function useIsMobile(query = "(max-width: 767px)") {
  const subscribe = useCallback((onStoreChange) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", onStoreChange);
    return () => mq.removeEventListener("change", onStoreChange);
  }, [query]);

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

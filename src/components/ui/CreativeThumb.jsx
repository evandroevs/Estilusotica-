/**
 * CreativeThumb — thumbnail quadrada de um criativo (compartilhada).
 *
 * Extraída do Top Criativos para reuso na Matriz Criativa (e onde mais
 * precisar). Comportamento importante: URLs de thumbnail da Meta EXPIRAM —
 * quando a imagem do cache falha (ou não existe), o componente busca a
 * mídia fresca via meta-creative (useCreativeMedia), só quando o card fica
 * visível (IntersectionObserver) para não estourar chamadas à Meta.
 */
import { useState, useEffect, useRef } from "react";
import { Play, Loader2 } from "lucide-react";
import { useCreativeMedia } from "../../hooks/useCreativeMedia";
import { FUNIL_GRADIENT } from "../CreativeModal";

export function CreativeThumb({ ad }) {
  const [cachedFailed, setCachedFailed] = useState(false);
  const [freshFailed,  setFreshFailed]  = useState(false);
  const [visible,      setVisible]      = useState(false);
  const ref = useRef(null);

  const cachedOk   = !!ad.thumbnail_url && !cachedFailed;
  const needsFresh = !cachedOk; // sem thumb no cache ou a do cache expirou/falhou

  // Só observa visibilidade quando precisamos buscar mídia fresca — evita
  // disparar centenas de chamadas à Meta de uma vez.
  useEffect(() => {
    if (!needsFresh || visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [needsFresh, visible]);

  // Busca a thumbnail fresca (meta-creative) só quando visível e necessário.
  // refresh=true quando a thumb do cache existia mas falhou (URL da Meta
  // expirada) — sem isso o meta-creative devolveria a URL morta do cache.
  const { data: fresh, isFetching } = useCreativeMedia(
    needsFresh && visible ? ad.ad_id : null,
    { refresh: cachedFailed },
  );
  const freshThumb = fresh?.thumbnail_url ?? null;
  const freshOk    = !!freshThumb && !freshFailed;

  const src = cachedOk ? ad.thumbnail_url : (freshOk ? freshThumb : null);
  const gradient = FUNIL_GRADIENT[ad.funil] ?? FUNIL_GRADIENT.TOFU;
  const loadingFresh = needsFresh && visible && isFetching && !freshOk;

  return (
    <div ref={ref} className="aspect-square relative overflow-hidden" style={{ background: gradient }}>
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => { if (cachedOk) setCachedFailed(true); else setFreshFailed(true); }}
        />
      )}
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center">
          {loadingFresh ? (
            <Loader2 size={16} className="text-white/40 animate-spin" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
              <Play size={14} className="text-white/50 ml-0.5" fill="currentColor" />
            </div>
          )}
        </div>
      )}
      {ad.media_type === "video" && (
        <div className="absolute bottom-1.5 right-1.5 bg-black/60 rounded px-1.5 py-0.5">
          <span className="text-[9px] font-bold text-white/70 tracking-wide">VIDEO</span>
        </div>
      )}
    </div>
  );
}

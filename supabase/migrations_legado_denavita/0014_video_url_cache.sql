-- =============================================================
-- 0014 — Cache da URL reproduzível do vídeo (reduz chamadas à Meta)
-- =============================================================
-- A URL (source) do vídeo da Meta expira em algumas horas; guardamos a
-- última resolvida + timestamp. Enquanto fresca (< 2h), o meta-creative
-- devolve direto, sem bater na Meta — corta o rate limit ao reabrir vídeos.

alter table public.meta_ads_cache
  add column if not exists video_url    text,
  add column if not exists video_url_at timestamptz;

comment on column public.meta_ads_cache.video_url    is 'Última URL reproduzível do vídeo (cache; expira ~horas).';
comment on column public.meta_ads_cache.video_url_at is 'Quando video_url foi resolvida — base do TTL de cache.';

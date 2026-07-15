-- =============================================================
-- 0017 — Snapshot de métricas em pasta_itens
-- -------------------------------------------------------------
-- Ao salvar um criativo numa pasta (Edge Function save-media), as
-- métricas do período visível (ROAS, CTR, gasto, compras, etc.) são
-- guardadas em `metricas` (jsonb). Antes, a Biblioteca dependia de uma
-- busca ao vivo em meta_ads_cache — que tem 1 linha por anúncio (janela
-- mais recente), então as métricas do período em que o vídeo foi salvo
-- (ex.: 2025 inteiro) se perdiam. O snapshot preserva o que o usuário viu.
-- =============================================================

alter table public.pasta_itens add column if not exists metricas       jsonb;
alter table public.pasta_itens add column if not exists periodo_inicio date;
alter table public.pasta_itens add column if not exists periodo_fim    date;

comment on column public.pasta_itens.metricas is
  'Snapshot das métricas do anúncio no momento em que foi salvo na pasta. Chaves: spend, revenue, roas, purchases, cpa, cpm, cpc, ctr, conversion_rate, connect_rate, thumbstop_rate, impressions, link_clicks, landing_page_views.';
comment on column public.pasta_itens.periodo_inicio is 'Início do período a que o snapshot de métricas se refere.';
comment on column public.pasta_itens.periodo_fim    is 'Fim do período a que o snapshot de métricas se refere.';

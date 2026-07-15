-- =============================================================
-- 0027 — RPCs do Relatório Executivo (sub-aba Dashboard → Relatório)
-- =============================================================
-- Três funções de agregação server-side (evitam o teto de 1000
-- linhas do PostgREST e o transporte de dezenas de milhares de
-- linhas diárias ao browser):
--
--   get_report_segments(p_start, p_end)
--     Spend/compras/receita por LINHA DE PRODUTO × SEGMENTO de
--     público (user_segment_key da Meta, via meta_ads_segments):
--     prospecting = cold · engaged = remarketing · existing = clientes.
--
--   get_report_campaigns_daily(p_start, p_end)
--     Série diária por campanha (contadores aditivos) para o front
--     calcular WoW de CTR/CPA, streak de CPA na meta, fadiga e zumbis.
--
--   get_report_ads(p_start, p_end)
--     Agregado por anúncio no intervalo, com effective_status, para
--     vencedores/perdedores (régua de significância), zumbis e o
--     padrão "versão melhor pausada enquanto ativo fraco roda".
--
-- Linha de produto: mesma regra da Matriz (0026) — derivada do NOME
-- DA CAMPANHA, generalizada para as 4 linhas.
-- =============================================================

create or replace function public.report_product_of(p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_name is null then 'Outros'
    when lower(p_name) like '%laranja%' or lower(p_name) like '%moro%' then 'LM'
    when lower(p_name) like '%tons%'    then 'Tons'
    when lower(p_name) like '%jejoom%'  then 'Jejoom'
    when lower(p_name) like '%vinagre%' then 'Vinagre'
    else 'Outros'
  end;
$$;

comment on function public.report_product_of(text) is
  'Linha de produto a partir do nome da campanha (mesma regra da Matriz 0026).';

-- ── 1. Segmentos (cold / remarketing / clientes) ─────────────────────────
create or replace function public.get_report_segments(p_start date, p_end date)
returns table (
  produto   text,
  segment   text,
  spend     numeric,
  purchases numeric,
  revenue   numeric
)
language sql
stable
security invoker
as $$
  select
    public.report_product_of(mac.campaign_name) as produto,
    s.segment,
    sum(s.spend)     as spend,
    sum(s.purchases) as purchases,
    sum(s.revenue)   as revenue
  from public.meta_ads_segments s
  join public.meta_ads_cache mac on mac.ad_id = s.ad_id
  where s.date >= p_start and s.date <= p_end
  group by 1, 2;
$$;

-- ── 2. Série diária por campanha ─────────────────────────────────────────
create or replace function public.get_report_campaigns_daily(p_start date, p_end date)
returns table (
  campaign_id        text,
  campaign_name      text,
  campaign_status    text,
  produto            text,
  date               date,
  spend              numeric,
  revenue            numeric,
  purchases          bigint,
  impressions        bigint,
  link_clicks        bigint,
  landing_page_views bigint,
  video_views_3s     numeric
)
language sql
stable
security invoker
as $$
  select
    d.campaign_id,
    mc.campaign_name,
    mc.effective_status                          as campaign_status,
    public.report_product_of(mc.campaign_name)   as produto,
    d.date,
    sum(d.spend)               as spend,
    sum(d.revenue)             as revenue,
    sum(d.purchases)::bigint   as purchases,
    sum(d.impressions)::bigint as impressions,
    sum(d.link_clicks)::bigint as link_clicks,
    sum(d.landing_page_views)::bigint as landing_page_views,
    sum(d.video_views_3s)      as video_views_3s
  from public.meta_ads_daily d
  left join public.meta_campaigns mc on mc.campaign_id = d.campaign_id
  where d.date >= p_start and d.date <= p_end
  group by d.campaign_id, mc.campaign_name, mc.effective_status, d.date;
$$;

-- ── 3. Agregado por anúncio (com status real) ────────────────────────────
create or replace function public.get_report_ads(p_start date, p_end date)
returns table (
  ad_id              text,
  ad_name            text,
  campaign_id        text,
  campaign_name      text,
  produto            text,
  effective_status   text,
  thumbnail_url      text,
  days_active        bigint,
  spend              numeric,
  revenue            numeric,
  purchases          bigint,
  impressions        bigint,
  link_clicks        bigint,
  landing_page_views bigint,
  video_views_3s     numeric
)
language sql
stable
security invoker
as $$
  select
    d.ad_id,
    mac.ad_name,
    mac.campaign_id,
    mac.campaign_name,
    public.report_product_of(mac.campaign_name) as produto,
    mac.effective_status,
    mac.thumbnail_url,
    count(distinct d.date) filter (where d.spend > 0) as days_active,
    sum(d.spend)               as spend,
    sum(d.revenue)             as revenue,
    sum(d.purchases)::bigint   as purchases,
    sum(d.impressions)::bigint as impressions,
    sum(d.link_clicks)::bigint as link_clicks,
    sum(d.landing_page_views)::bigint as landing_page_views,
    sum(d.video_views_3s)      as video_views_3s
  from public.meta_ads_daily d
  join public.meta_ads_cache mac on mac.ad_id = d.ad_id
  where d.date >= p_start and d.date <= p_end
  group by d.ad_id, mac.ad_name, mac.campaign_id, mac.campaign_name,
           mac.effective_status, mac.thumbnail_url;
$$;

grant execute on function public.report_product_of(text)                to authenticated;
grant execute on function public.get_report_segments(date, date)        to authenticated;
grant execute on function public.get_report_campaigns_daily(date, date) to authenticated;
grant execute on function public.get_report_ads(date, date)             to authenticated;

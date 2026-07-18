-- =============================================================
-- Creative Lab v2 — Granularidade diária de métricas
-- =============================================================
-- Adiciona meta_ads_daily (1 linha por anúncio por dia, somente
-- contadores aditivos) e a função get_ads_metrics() que agrega o
-- diário sobre qualquer intervalo e junta os metadados/criativo/IA
-- de meta_ads_cache. Permite filtros diário/semanal/mensal/custom
-- com números corretos, calculados na hora a partir do banco.
-- =============================================================

-- =============================================================
-- 1. META_ADS_DAILY
-- Série temporal de contadores por anúncio por dia.
-- Escrita exclusiva pela Edge Function meta-sync (service_role).
-- =============================================================

create table if not exists public.meta_ads_daily (
  ad_id               text        not null,
  date                date        not null,

  -- Classificação (denormalizada para filtros rápidos sem join)
  campaign_id         text,
  product_id          uuid        references public.products (id) on delete set null,
  funil               text        check (funil in ('TOFU', 'MOFU', 'BOFU')),

  -- Contadores ADITIVOS (somáveis entre dias). Taxas são derivadas depois.
  spend               numeric     not null default 0,
  revenue             numeric     not null default 0,
  purchases           integer     not null default 0,
  impressions         integer     not null default 0,
  clicks              integer     not null default 0,   -- cliques totais
  link_clicks         integer     not null default 0,   -- cliques no link
  landing_page_views  integer     not null default 0,
  video_views_3s      numeric     not null default 0,   -- views 3s (para thumbstop)
  initiate_checkout   numeric     not null default 0,
  add_payment_info    numeric     not null default 0,

  synced_at           timestamptz not null default now(),

  constraint meta_ads_daily_pk unique (ad_id, date)
);

comment on table public.meta_ads_daily is
  'Série temporal: contadores aditivos por anúncio por dia (time_increment=1). Taxas (ROAS, CTR, etc.) são derivadas via get_ads_metrics().';

create index if not exists mad_date_idx        on public.meta_ads_daily (date);
create index if not exists mad_ad_idx          on public.meta_ads_daily (ad_id);
create index if not exists mad_product_idx     on public.meta_ads_daily (product_id);
create index if not exists mad_campaign_idx    on public.meta_ads_daily (campaign_id);
create index if not exists mad_date_ad_idx     on public.meta_ads_daily (date, ad_id);

alter table public.meta_ads_daily enable row level security;

drop policy if exists "meta_ads_daily: read for authenticated" on public.meta_ads_daily;
create policy "meta_ads_daily: read for authenticated"
  on public.meta_ads_daily for select
  to authenticated using (true);


-- =============================================================
-- 2. get_ads_metrics()
-- Agrega meta_ads_daily sobre [p_start, p_end], recalcula todas as
-- taxas a partir das somas e junta metadados/criativo/IA de
-- meta_ads_cache. Retorna 1 linha por anúncio, no mesmo formato que
-- o frontend já consome (colunas de meta_ads_cache + extras).
-- =============================================================

create or replace function public.get_ads_metrics(
  p_start    date,
  p_end      date,
  p_product  uuid default null,
  p_campaign text default null
)
returns table (
  ad_id               text,
  ad_name             text,
  campaign_id         text,
  campaign_name       text,
  product_id          uuid,
  funil               text,
  date_start          date,
  date_stop           date,
  thumbnail_url       text,
  video_id            text,
  media_type          text,
  transcricao         text,
  analise_video       jsonb,
  video_analisado_em  timestamptz,
  spend               numeric,
  revenue             numeric,
  roas                numeric,
  purchases           integer,
  cpa                 numeric,
  cpm                 numeric,
  cpc                 numeric,
  ctr                 numeric,
  conversion_rate     numeric,
  connect_rate        numeric,
  thumbstop_rate      numeric,
  impressions         integer,
  link_clicks         integer,
  landing_page_views  integer,
  initiate_checkout   numeric,
  add_payment_info    numeric,
  ticket_medio        numeric,
  cplpv               numeric
)
language sql
stable
security invoker
as $$
  with agg as (
    select
      d.ad_id,
      sum(d.spend)              as spend,
      sum(d.revenue)            as revenue,
      sum(d.purchases)          as purchases,
      sum(d.impressions)        as impressions,
      sum(d.clicks)             as clicks,
      sum(d.link_clicks)        as link_clicks,
      sum(d.landing_page_views) as landing_page_views,
      sum(d.video_views_3s)     as video_views_3s,
      sum(d.initiate_checkout)  as initiate_checkout,
      sum(d.add_payment_info)   as add_payment_info
    from public.meta_ads_daily d
    where d.date >= p_start
      and d.date <= p_end
      and (p_product  is null or d.product_id  = p_product)
      and (p_campaign is null or d.campaign_id = p_campaign)
    group by d.ad_id
  )
  select
    a.ad_id,
    m.ad_name,
    m.campaign_id,
    m.campaign_name,
    m.product_id,
    m.funil,
    p_start as date_start,
    p_end   as date_stop,
    m.thumbnail_url,
    m.video_id,
    m.media_type,
    m.transcricao,
    m.analise_video,
    m.video_analisado_em,
    a.spend,
    a.revenue,
    case when a.spend       > 0 then a.revenue / a.spend                         else 0 end as roas,
    a.purchases::integer,
    case when a.purchases   > 0 then a.spend / a.purchases                       else 0 end as cpa,
    case when a.impressions > 0 then (a.spend / a.impressions) * 1000            else 0 end as cpm,
    case when a.link_clicks > 0 then a.spend / a.link_clicks                     else 0 end as cpc,
    case when a.impressions > 0 then (a.link_clicks::numeric / a.impressions) * 100        else 0 end as ctr,
    case when a.landing_page_views > 0 then (a.purchases::numeric / a.landing_page_views) * 100 else 0 end as conversion_rate,
    case when a.link_clicks > 0 then (a.landing_page_views::numeric / a.link_clicks) * 100 else 0 end as connect_rate,
    case when a.impressions > 0 then (a.video_views_3s / a.impressions) * 100    else 0 end as thumbstop_rate,
    a.impressions::integer,
    a.link_clicks::integer,
    a.landing_page_views::integer,
    a.initiate_checkout,
    a.add_payment_info,
    case when a.purchases   > 0 then a.revenue / a.purchases                     else 0 end as ticket_medio,
    case when a.landing_page_views > 0 then a.spend / a.landing_page_views       else 0 end as cplpv
  from agg a
  left join public.meta_ads_cache m on m.ad_id = a.ad_id;
$$;

comment on function public.get_ads_metrics(date, date, uuid, text) is
  'Agrega meta_ads_daily no intervalo [p_start,p_end] e junta metadados de meta_ads_cache. 1 linha por anúncio com taxas recalculadas.';

grant execute on function public.get_ads_metrics(date, date, uuid, text) to authenticated;


-- =============================================================
-- 3. get_synced_range()
-- Min/max das datas já sincronizadas em meta_ads_daily.
-- Usado pelo frontend para decidir auto-pull.
-- =============================================================

create or replace function public.get_synced_range()
returns table (min_date date, max_date date)
language sql
stable
security invoker
as $$
  select min(date), max(date) from public.meta_ads_daily;
$$;

grant execute on function public.get_synced_range() to authenticated;

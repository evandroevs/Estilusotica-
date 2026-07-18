-- =============================================================
-- 0010 — Taxa de Conversão = Compras ÷ Cliques no Link
-- =============================================================
-- Antes: compras ÷ visualizações de página (LPV). Alinhado com a
-- métrica usada pelo gestor no Gerenciador da Meta (compras ÷ cliques).

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
    case when a.link_clicks > 0 then (a.purchases::numeric / a.link_clicks) * 100           else 0 end as conversion_rate,
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
  'Agrega meta_ads_daily no intervalo [p_start,p_end] e junta metadados de meta_ads_cache. Taxa de conversão = compras ÷ cliques no link.';

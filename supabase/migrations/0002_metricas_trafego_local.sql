-- =============================================================
-- 0002 — Métricas para negócio local (formato "Tráfego Local")
-- =============================================================
-- Novos contadores aditivos por anúncio/dia, preenchidos pelo meta-sync:
--   messages — conversas iniciadas por mensagem (WhatsApp/Messenger/Direct)
--              (Meta: onsite_conversion.messaging_conversation_started_7d)
--   reach    — alcance diário. Somar dias SUPERESTIMA o alcance único do
--              período (a mesma pessoa conta em dias diferentes) — o
--              dashboard usa como aproximação, padrão de mercado.
-- get_ads_metrics passa a devolver os dois somados no período.
-- =============================================================

alter table public.meta_ads_daily
  add column if not exists messages numeric not null default 0,
  add column if not exists reach    numeric not null default 0;

comment on column public.meta_ads_daily.messages is
  'Conversas por mensagem iniciadas (messaging_conversation_started_7d). Base do Custo por Mensagem.';
comment on column public.meta_ads_daily.reach is
  'Alcance diário. Soma no período = aproximação (superestima alcance único).';

-- Return type muda → DROP antes do CREATE.
drop function if exists public.get_ads_metrics(date, date, uuid, text);

create function public.get_ads_metrics(
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
  body_rate           numeric,
  impressions         integer,
  link_clicks         integer,
  landing_page_views  integer,
  initiate_checkout   numeric,
  add_payment_info    numeric,
  ticket_medio        numeric,
  cplpv               numeric,
  messages            numeric,
  reach               numeric,
  cost_per_message    numeric
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
      sum(d.video_views_p75)    as video_views_p75,
      sum(d.initiate_checkout)  as initiate_checkout,
      sum(d.add_payment_info)   as add_payment_info,
      sum(d.messages)           as messages,
      sum(d.reach)              as reach
    from public.meta_ads_daily d
    where d.workspace_id = public.current_workspace_id()
      and d.date >= p_start
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
    case when a.spend       > 0 then a.revenue / a.spend                                   else 0 end as roas,
    a.purchases::integer,
    case when a.purchases   > 0 then a.spend / a.purchases                                 else 0 end as cpa,
    case when a.impressions > 0 then (a.spend / a.impressions) * 1000                      else 0 end as cpm,
    case when a.link_clicks > 0 then a.spend / a.link_clicks                               else 0 end as cpc,
    case when a.impressions > 0 then (a.link_clicks::numeric / a.impressions) * 100        else 0 end as ctr,
    case when a.link_clicks > 0 then (a.purchases::numeric / a.link_clicks) * 100          else 0 end as conversion_rate,
    case when a.link_clicks > 0 then (a.landing_page_views::numeric / a.link_clicks) * 100 else 0 end as connect_rate,
    case when a.impressions > 0 then (a.video_views_3s / a.impressions) * 100              else 0 end as thumbstop_rate,
    case when a.impressions > 0 then (a.video_views_p75 / a.impressions) * 100             else 0 end as body_rate,
    a.impressions::integer,
    a.link_clicks::integer,
    a.landing_page_views::integer,
    a.initiate_checkout,
    a.add_payment_info,
    case when a.purchases          > 0 then a.revenue / a.purchases                        else 0 end as ticket_medio,
    case when a.landing_page_views > 0 then a.spend / a.landing_page_views                 else 0 end as cplpv,
    a.messages,
    a.reach,
    case when a.messages > 0 then a.spend / a.messages                                     else 0 end as cost_per_message
  from agg a
  left join public.meta_ads_cache m
    on m.ad_id = a.ad_id
   and m.workspace_id = public.current_workspace_id();
$$;

grant execute on function public.get_ads_metrics(date, date, uuid, text) to authenticated;

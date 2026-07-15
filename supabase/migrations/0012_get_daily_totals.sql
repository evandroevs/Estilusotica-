-- =============================================================
-- 0012 — get_daily_totals: série diária agregada p/ gráficos da Dash
-- =============================================================

create or replace function public.get_daily_totals(
  p_start   date,
  p_end     date,
  p_product uuid default null
)
returns table (
  date      date,
  spend     numeric,
  revenue   numeric,
  purchases numeric,
  lpv       numeric
)
language sql
stable
security invoker
as $$
  select
    d.date,
    sum(d.spend)              as spend,
    sum(d.revenue)            as revenue,
    sum(d.purchases)          as purchases,
    sum(d.landing_page_views) as lpv
  from public.meta_ads_daily d
  where d.date >= p_start
    and d.date <= p_end
    and (p_product is null or d.product_id = p_product)
  group by d.date
  order by d.date
$$;

comment on function public.get_daily_totals(date, date, uuid) is
  'Totais por dia no intervalo (opcional por produto) — base dos gráficos ROAS×CPA e ROAS×Conv. LP.';

grant execute on function public.get_daily_totals(date, date, uuid) to authenticated;

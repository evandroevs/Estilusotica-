-- =============================================================
-- 0011 — Segmentos de público por anúncio (funil real de entrega)
-- =============================================================
-- A Meta reporta, por anúncio/dia, a entrega e conversão por segmento
-- (breakdown user_segment_key): prospecting (público novo), engaged
-- (engajados), existing (clientes). Preenchida pela Edge Function
-- meta-segments. O segmento com mais compras define o "funil real":
-- prospecting → TOFU · engaged → MOFU · existing → BOFU.

create table public.meta_ads_segments (
  ad_id     text        not null,
  date      date        not null,
  segment   text        not null,  -- prospecting | engaged | existing | unknown
  spend     numeric     not null default 0,
  purchases numeric     not null default 0,
  revenue   numeric     not null default 0,
  synced_at timestamptz not null default now(),
  primary key (ad_id, date, segment)
);

create index meta_ads_segments_date_idx on public.meta_ads_segments (date);

alter table public.meta_ads_segments enable row level security;

-- Leitura para autenticados; escrita somente via service_role (Edge Function)
create policy "meta_ads_segments: read for authenticated"
  on public.meta_ads_segments for select
  to authenticated using (true);

-- ── RPC: funil real por anúncio no período ────────────────────────────────
-- Dominância por compras; sem compras, por investimento (entrega).
-- Empate resolve para o mais fundo do funil (existing > engaged > prospecting).

create or replace function public.get_funil_real(p_start date, p_end date)
returns table (
  ad_id               text,
  compras_prospecting numeric,
  compras_engaged     numeric,
  compras_existing    numeric,
  funil_real          text
)
language sql
stable
security invoker
as $$
  with agg as (
    select s.ad_id, s.segment, sum(s.purchases) as p, sum(s.spend) as sp
    from public.meta_ads_segments s
    where s.date >= p_start and s.date <= p_end
    group by s.ad_id, s.segment
  ), piv as (
    select
      a.ad_id,
      coalesce(sum(a.p)  filter (where a.segment = 'prospecting'), 0) as p_pros,
      coalesce(sum(a.p)  filter (where a.segment = 'engaged'),     0) as p_eng,
      coalesce(sum(a.p)  filter (where a.segment = 'existing'),    0) as p_exi,
      coalesce(sum(a.sp) filter (where a.segment = 'prospecting'), 0) as s_pros,
      coalesce(sum(a.sp) filter (where a.segment = 'engaged'),     0) as s_eng,
      coalesce(sum(a.sp) filter (where a.segment = 'existing'),    0) as s_exi
    from agg a
    group by a.ad_id
  )
  select
    v.ad_id,
    v.p_pros,
    v.p_eng,
    v.p_exi,
    case
      when greatest(v.p_pros, v.p_eng, v.p_exi) > 0 then
        case greatest(v.p_pros, v.p_eng, v.p_exi)
          when v.p_exi then 'BOFU'
          when v.p_eng then 'MOFU'
          else 'TOFU'
        end
      when greatest(v.s_pros, v.s_eng, v.s_exi) > 0 then
        case greatest(v.s_pros, v.s_eng, v.s_exi)
          when v.s_exi then 'BOFU'
          when v.s_eng then 'MOFU'
          else 'TOFU'
        end
      else null
    end as funil_real
  from piv v
$$;

comment on function public.get_funil_real(date, date) is
  'Funil real por anúncio no período, pelo segmento de público com mais compras (fallback: investimento). prospecting→TOFU, engaged→MOFU, existing→BOFU.';

grant execute on function public.get_funil_real(date, date) to authenticated;

-- ── Cron: segmentos de ontem+hoje a cada hora (minuto 40) ─────────────────

do $$
begin
  if exists (select 1 from cron.job where jobname = 'meta-segments-hourly') then
    perform cron.unschedule('meta-segments-hourly');
  end if;
end $$;

select cron.schedule(
  'meta-segments-hourly',
  '40 * * * *',
  $$
  select net.http_post(
    url     := 'https://wuooediygigawvmdbfob.supabase.co/functions/v1/meta-segments',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'sb_publishable_VOSSpEsqkZtvmXy1DB7_OA_Kq5DeMto',
      'Authorization', 'Bearer sb_publishable_VOSSpEsqkZtvmXy1DB7_OA_Kq5DeMto'
    ),
    body    := jsonb_build_object(
      'date_start', (now() - interval '1 day')::date::text,
      'date_stop',  now()::date::text
    )
  );
  $$
);

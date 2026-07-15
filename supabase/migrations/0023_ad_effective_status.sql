-- =============================================================
-- 0023 — Status real POR ANÚNCIO (effective_status) na Matriz Criativa
-- -------------------------------------------------------------
-- Até aqui o "ativo" era só por campanha (meta_campaigns). Um anúncio
-- pausado individualmente dentro de uma campanha ativa continuava contando
-- na Matriz. Agora meta_ads_cache guarda o effective_status do PRÓPRIO
-- anúncio (ACTIVE | PAUSED | CAMPAIGN_PAUSED | ADSET_PAUSED | ARCHIVED...),
-- preenchido pela Edge Function sync-ad-status:
--   • disparada ao abrir a aba Matriz Criativa (números fresquinhos na hora)
--   • e por cron horário (minuto 45), para manter atualizado em segundo plano
--
-- Tolerância: effective_status null (anúncio ainda não sincronizado) conta
-- como ativo — mesma regra usada para campanhas sem linha em meta_campaigns.
-- =============================================================

alter table public.meta_ads_cache
  add column if not exists effective_status text,
  add column if not exists status_synced_at timestamptz;

comment on column public.meta_ads_cache.effective_status is
  'Status real do ANÚNCIO na Meta (ACTIVE | PAUSED | CAMPAIGN_PAUSED | ADSET_PAUSED | ARCHIVED...). Atualizado pela Edge Function sync-ad-status (abertura da Matriz + cron horário). Null = ainda não sincronizado (tratado como ativo).';
comment on column public.meta_ads_cache.status_synced_at is
  'Última vez que o effective_status deste anúncio foi sincronizado da Meta.';

create index if not exists meta_ads_cache_effective_status_idx
  on public.meta_ads_cache (effective_status);

-- ── View da Matriz: agora exige o ANÚNCIO ativo, além da campanha ─────────────
create or replace view public.matriz_criativa_view
with (security_invoker = on) as
select
  cc.persona,
  cc.etapa_funil,
  count(*)::int as qtd
from public.creative_classifications cc
join public.meta_ads_cache mac on mac.ad_id = cc.ad_id
join public.products       p   on p.id = mac.product_id
left join public.meta_campaigns mc on mc.campaign_id = mac.campaign_id
where cc.persona     is not null and cc.persona     <> 'indeterminado'
  and cc.etapa_funil is not null and cc.etapa_funil <> 'indeterminado'
  and p.slug = 'laranja-moro'
  and (mc.effective_status  is null or mc.effective_status  = 'ACTIVE')
  and (mac.effective_status is null or mac.effective_status = 'ACTIVE')
group by cc.persona, cc.etapa_funil;

comment on view public.matriz_criativa_view is
  'Agrega creative_classifications por persona × etapa, restrito ao Laranja Moro com CAMPANHA ativa e ANÚNCIO ativo (effective_status; null = tolerado como ativo). Alimenta a aba Matriz Criativa.';

grant select on public.matriz_criativa_view to authenticated;

-- ── Cron horário do sync-ad-status (minuto 45 — livre de colisões: meta-sync
--    usa 0 e 30, classify-batch usa 2-57/5) ────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-ad-status-hourly') then
    perform cron.unschedule('sync-ad-status-hourly');
  end if;
end $$;

select cron.schedule(
  'sync-ad-status-hourly',
  '45 * * * *',
  $$
  select net.http_post(
    url     := 'https://wuooediygigawvmdbfob.supabase.co/functions/v1/sync-ad-status',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'sb_publishable_VOSSpEsqkZtvmXy1DB7_OA_Kq5DeMto',
      'Authorization', 'Bearer sb_publishable_VOSSpEsqkZtvmXy1DB7_OA_Kq5DeMto'
    ),
    body    := '{}'::jsonb
  );
  $$
);

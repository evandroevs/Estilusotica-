-- ── Cron diário do google-ads-sync ───────────────────────────────────────
-- Mantém o google_ads_cache atualizado sozinho, no lugar do export manual
-- do Supermetrics. Roda 09:20 UTC (06:20 BRT) — horário livre de colisão
-- com os crons do Meta (que usam os minutos 0, 30 e 45).
--
-- A function sincroniza os últimos 30 dias a cada execução: além de pegar
-- o dia anterior, recaptura as conversões que o Google atribui com atraso.
--
-- SEGREDOS: ficam no Vault do Supabase, não neste arquivo. Antes de agendar,
-- crie os dois abaixo (uma vez só, no SQL Editor):
--
--   select vault.create_secret('COLE_A_PUBLISHABLE_KEY', 'edge_anon_key');
--   select vault.create_secret('COLE_UM_SEGREDO_ALEATORIO', 'google_cron_secret');
--
-- O mesmo valor de google_cron_secret precisa ir para os Secrets das Edge
-- Functions com o nome CRON_SECRET — é o que a google-ads-sync compara.
-- Enquanto os segredos não existirem, o job roda e não faz nada (o coalesce
-- abaixo evita disparar uma chamada sem credencial).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'google-ads-sync-daily') then
    perform cron.unschedule('google-ads-sync-daily');
  end if;
end $$;

select cron.schedule(
  'google-ads-sync-daily',
  '20 9 * * *',
  $$
  with segredos as (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'edge_anon_key')       as anon_key,
      (select decrypted_secret from vault.decrypted_secrets where name = 'google_cron_secret')  as cron_secret
  )
  select net.http_post(
    url     := 'https://zkdeczpqvybswawrxaxk.supabase.co/functions/v1/google-ads-sync',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'apikey',         s.anon_key,
      'Authorization',  'Bearer ' || s.anon_key,
      'x-cron-secret',  s.cron_secret
    ),
    body    := '{}'::jsonb
  )
  from segredos s
  where s.anon_key is not null and s.cron_secret is not null;
  $$
);

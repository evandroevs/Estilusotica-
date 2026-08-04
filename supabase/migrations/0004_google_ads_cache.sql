-- ── Google Ads: cache de métricas diárias por campanha, por loja ─────────
-- Alimentado de fora (Supermetrics via service_role); o frontend só lê.
-- Mesmo modelo de segurança do meta_ads_cache: RLS por workspace.

create table public.google_ads_cache (
  id               bigint generated always as identity primary key,
  workspace_id     uuid        not null references public.workspaces (id) on delete cascade,
  date             date        not null,
  account_id       text        not null,
  campaign_id      text        not null,
  campaign_name    text        not null,
  impressions      bigint      not null default 0,
  clicks           bigint      not null default 0,
  cost             numeric     not null default 0,
  conversions      numeric     not null default 0,
  conversion_value numeric     not null default 0,
  synced_at        timestamptz not null default now(),

  constraint google_ads_cache_unique unique (workspace_id, date, account_id, campaign_id)
);

comment on table public.google_ads_cache is
  'Métricas diárias do Google Ads por campanha. Uma conta Google Ads por loja; escrita só via service_role (sync externo).';

create index gac_ws_date_idx on public.google_ads_cache (workspace_id, date);

alter table public.google_ads_cache enable row level security;

create policy "google_ads_cache: members read"
  on public.google_ads_cache for select
  to authenticated using (workspace_id = public.current_workspace_id());

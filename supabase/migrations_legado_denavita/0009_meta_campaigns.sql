-- =============================================================
-- 0009 — Campanhas com status real da Meta
-- =============================================================
-- Preenchida pelo meta-sync (service_role) a cada sincronização.
-- Usada para filtrar o seletor de campanhas (apenas ativas).

create table public.meta_campaigns (
  campaign_id      text        primary key,
  campaign_name    text        not null,
  effective_status text,       -- ACTIVE | PAUSED | ARCHIVED | ...
  synced_at        timestamptz not null default now()
);

comment on table public.meta_campaigns is
  'Campanhas da conta Meta com effective_status — fonte do filtro de campanhas ativas.';

alter table public.meta_campaigns enable row level security;

-- Leitura para usuários autenticados; escrita somente via service_role (Edge Function)
create policy "meta_campaigns: read for authenticated"
  on public.meta_campaigns for select
  to authenticated using (true);

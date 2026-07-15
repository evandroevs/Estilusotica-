-- =============================================================
-- 0015 — Conexões Google Analytics 4 (OAuth)
-- =============================================================
-- Guarda o refresh_token do GA4 por usuário + a propriedade selecionada.
-- O refresh_token é sensível: lido apenas pela Edge Function (service_role).
-- RLS dá acesso ao dono; o frontend lê só colunas não sensíveis.

create table public.ga4_connections (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  property_id   text,
  property_name text,
  refresh_token text        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id)
);

comment on table public.ga4_connections is 'Conexão OAuth do GA4 por usuário (refresh_token + propriedade selecionada).';

alter table public.ga4_connections enable row level security;

create policy "ga4: owner full access"
  on public.ga4_connections for all
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

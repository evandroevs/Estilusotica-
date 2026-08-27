-- ── Conexão OAuth do Google Ads por workspace ────────────────────────────
-- Mesmo modelo do Meta (migration 0001): a conexão em si é legível pelos
-- membros do workspace; o refresh_token fica numa tabela SEM policy de
-- leitura, acessível apenas pelas Edge Functions (service_role).
--
-- Substitui o preenchimento manual do google_ads_cache via Supermetrics:
-- a Edge Function google-ads-sync passa a escrever nessa mesma tabela.

create table public.google_connections (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references public.workspaces (id) on delete cascade,
  google_email   text,                    -- conta Google que autorizou
  customer_id    text,                    -- ID da conta Google Ads, só dígitos (sem hífens)
  customer_name  text,
  login_customer_id text,                 -- MCC pai, quando a conta é acessada via administradora
  status         text        not null default 'pending_account'
                             check (status in ('pending_account', 'active', 'error')),
  last_error     text,
  last_synced_at timestamptz,
  connected_by   uuid        references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint google_connections_workspace_unique unique (workspace_id)
);

comment on table public.google_connections is
  'Conexão Google Ads do workspace (1 por workspace). pending_account = OAuth feito, aguardando escolha da conta de anúncios.';
comment on column public.google_connections.customer_id is
  'Customer ID do Google Ads sem formatação (ex.: 5549722788). Corresponde a google_ads_cache.account_id.';
comment on column public.google_connections.login_customer_id is
  'Customer ID da conta administradora (MCC) usada no header login-customer-id. Null quando a conta é acessada diretamente.';

alter table public.google_connections enable row level security;

create policy "google_connections: members read"
  on public.google_connections for select
  to authenticated using (workspace_id = public.current_workspace_id());

-- Tokens: SEM policies → apenas service_role (Edge Functions) lê/escreve.
create table public.google_connection_secrets (
  connection_id    uuid        primary key references public.google_connections (id) on delete cascade,
  refresh_token    text        not null,   -- não expira; gera access_token a cada sync
  access_token     text,                   -- cache do último access_token (1h de vida)
  token_expires_at timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table public.google_connection_secrets is
  'Tokens OAuth do Google por conexão. NUNCA exposto ao frontend: sem policies de RLS → somente service_role.';

alter table public.google_connection_secrets enable row level security;

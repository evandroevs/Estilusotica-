-- ── Trackeamento v2: atribuição real do WhatsApp → Meta CAPI ─────────────
--
-- O que muda:
--   1. `leads` passa a guardar o ctwa_clid (o identificador do clique no
--      anúncio click-to-WhatsApp). É ELE que amarra a venda ao anúncio —
--      sem isso a Meta só consegue casar por telefone, o que é bem mais fraco.
--   2. `leads` passa a registrar o que foi enviado para a Meta (idempotência).
--   3. Nova conexão por loja com o dataset/WABA/token usados pela CAPI.
--
-- Ver docs/TRACKEAMENTO.md para o passo a passo de configuração.

-- =============================================================
-- 1. LEADS: atribuição, produto e rastro do envio para a Meta
-- =============================================================

alter table public.leads
  -- Atribuição (vem do webhook do WhatsApp, ninguém digita)
  add column if not exists ctwa_clid      text,
  add column if not exists wa_message_id  text,
  add column if not exists email          text,

  -- Dados da ordem de serviço
  add column if not exists produto        text,
  add column if not exists avulsa         boolean not null default false,

  -- Rastro do envio para a Meta (Conversions API)
  add column if not exists meta_event_id  text,
  add column if not exists meta_status    text not null default 'pendente',
  add column if not exists meta_enviado_em timestamptz,
  add column if not exists meta_erro      text,
  add column if not exists meta_tentativas int not null default 0;

-- A foto pode ser ordem de serviço, nota fiscal ou comprovante — o nome
-- antigo (nota_fiscal_url) descrevia só um dos casos.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads'
      and column_name = 'nota_fiscal_url'
  ) then
    alter table public.leads rename column nota_fiscal_url to documento_url;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_meta_status_check'
  ) then
    alter table public.leads add constraint leads_meta_status_check
      check (meta_status in ('pendente', 'enviado', 'erro', 'nao_aplicavel'));
  end if;
end $$;

comment on column public.leads.ctwa_clid is
  'Click-to-WhatsApp Click ID: identificador do clique no anúncio, vindo de referral.ctwa_clid no webhook do WhatsApp. Enviado sem hash para a Meta na CAPI.';
comment on column public.leads.wa_message_id is
  'ID da mensagem do WhatsApp que originou o lead. Usado para não duplicar quando a Meta reentrega o webhook.';
comment on column public.leads.avulsa is
  'Venda registrada na loja sem vir de anúncio. Conta no faturamento, nunca é enviada para a Meta.';
comment on column public.leads.meta_status is
  'pendente = venda ainda não sinalizada · enviado = Meta confirmou · erro = falhou (ver meta_erro) · nao_aplicavel = venda sem origem de anúncio.';
comment on column public.leads.meta_event_id is
  'event_id enviado para a Meta. Estável por lead — é o que impede a Meta de contar a mesma compra duas vezes.';

-- Venda avulsa é criada direto pelo frontend (o vendedor não escolhe loja):
-- o banco resolve o workspace igual já faz em `products`.
alter table public.leads
  alter column workspace_id set default public.current_workspace_id();

-- Não deixa o mesmo clique virar dois leads.
create unique index if not exists leads_ctwa_clid_uniq
  on public.leads (ctwa_clid) where ctwa_clid is not null;

create unique index if not exists leads_wa_message_id_uniq
  on public.leads (wa_message_id) where wa_message_id is not null;

-- Fila de reenvio: vendas confirmadas que a Meta ainda não recebeu.
create index if not exists leads_meta_pendentes_idx
  on public.leads (workspace_id, meta_status)
  where status = 'vendido' and meta_status in ('pendente', 'erro');

-- Busca por telefone no cruzamento da ordem de serviço.
create index if not exists leads_ws_telefone_idx
  on public.leads (workspace_id, telefone);

-- =============================================================
-- 2. CONEXÃO CAPI POR LOJA
-- =============================================================

create table if not exists public.meta_capi_connections (
  id                  uuid        primary key default gen_random_uuid(),
  workspace_id        uuid        not null references public.workspaces (id) on delete cascade,

  dataset_id          text,       -- Dataset (pixel) que recebe os eventos
  waba_id             text,       -- WhatsApp Business Account ID
  wa_phone_number_id  text,       -- Número do WhatsApp: roteia o webhook para esta loja
  test_event_code     text,       -- Preenchido só enquanto testa no Events Manager

  status              text        not null default 'pending_config'
                      check (status in ('pending_config', 'active', 'error')),
  last_error          text,
  ultimo_evento_em    timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint meta_capi_connections_workspace_unique unique (workspace_id)
);

comment on table public.meta_capi_connections is
  'Configuração da Conversions API por loja: para onde mandar a venda da loja física (dataset) e de qual WhatsApp os leads chegam.';

create unique index if not exists meta_capi_wa_phone_number_id_uniq
  on public.meta_capi_connections (wa_phone_number_id)
  where wa_phone_number_id is not null;

alter table public.meta_capi_connections enable row level security;

-- Membros leem a configuração (o token fica na tabela de segredos).
drop policy if exists "meta_capi: members read" on public.meta_capi_connections;
create policy "meta_capi: members read"
  on public.meta_capi_connections for select
  to authenticated using (workspace_id = public.current_workspace_id());

drop policy if exists "meta_capi: members write" on public.meta_capi_connections;
create policy "meta_capi: members write"
  on public.meta_capi_connections for all
  to authenticated
  using      (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- Token: SEM policies → só service_role (Edge Functions) lê/escreve.
create table if not exists public.meta_capi_secrets (
  connection_id uuid        primary key references public.meta_capi_connections (id) on delete cascade,
  access_token  text        not null,   -- system user token (não expira)
  updated_at    timestamptz not null default now()
);

comment on table public.meta_capi_secrets is
  'Token da Conversions API por conexão. NUNCA exposto ao frontend: sem policies de RLS → somente service_role.';

alter table public.meta_capi_secrets enable row level security;

drop trigger if exists meta_capi_touch_updated_at on public.meta_capi_connections;
create trigger meta_capi_touch_updated_at
  before update on public.meta_capi_connections
  for each row execute function public.touch_updated_at();

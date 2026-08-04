-- ── Trackeamento: leads do WhatsApp → venda na loja física ───────────────
-- Cada conversa iniciada vira um lead (via Edge Function lead-webhook).
-- O vendedor só confirma a venda (valor + foto da NF) ou marca "não comprou".

create table public.leads (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references public.workspaces (id) on delete cascade,

  -- dados que chegam prontos do WhatsApp/anúncio (vendedor não digita nada)
  nome           text        not null default 'Sem nome',
  telefone       text,
  iniciado_em    timestamptz not null default now(),
  origem         text        not null default 'outro'
                 check (origem in ('meta', 'google', 'outro')),
  campanha       text,
  anuncio        text,
  vendedor       text,

  -- fluxo do vendedor
  status         text        not null default 'em_atendimento'
                 check (status in ('em_atendimento', 'vendido', 'nao_comprou', 'aguardando')),
  valor_venda    numeric,
  vendido_em     timestamptz,
  confirmado_por uuid        references auth.users (id) on delete set null,
  nota_fiscal_url text,
  motivo_nao_compra text
                 check (motivo_nao_compra is null or motivo_nao_compra in
                   ('nao_retornou', 'preco', 'comprou_outro_lugar', 'sem_estoque', 'desistiu', 'outro')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.leads is
  'Leads de WhatsApp por loja (aba Trackeamento). Entrada automática via lead-webhook; vendedor só confirma venda ou não-compra.';

create index leads_ws_iniciado_idx on public.leads (workspace_id, iniciado_em desc);
create index leads_ws_status_idx   on public.leads (workspace_id, status);

alter table public.leads enable row level security;

create policy "leads: members full access"
  on public.leads for all
  to authenticated
  using      (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();

-- Realtime: lead novo aparece na tela sem recarregar
alter publication supabase_realtime add table public.leads;

-- ── Storage: fotos de nota fiscal ────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('notas-fiscais', 'notas-fiscais', true)
on conflict (id) do nothing;

create policy "notas-fiscais: upload autenticado"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'notas-fiscais');

create policy "notas-fiscais: leitura autenticada"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'notas-fiscais');

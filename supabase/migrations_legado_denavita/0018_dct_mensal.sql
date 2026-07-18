-- =============================================================
-- 0018 — Planilha de gestão de testes de criativos (DCT)
-- =============================================================
-- Gestão de testes de criativos pela técnica DCT (Direct Creative Testing)
-- por produto/mês. Cada teste (DCT 01, DCT 02, …) guarda os campos do teste
-- + uma lista de "elementos" (Criativo / Copy / Headline) sendo variados.
-- Guardado como array JSON por produto/mês, independente do mapa mental e da
-- planilha de demanda.

create table public.dct_mensal (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  product_id uuid        references public.products (id) on delete cascade,
  mes        text        not null,
  testes     jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, product_id, mes)
);

comment on table  public.dct_mensal       is 'Planilha de testes de criativos (DCT) por produto/mês: cada teste + elementos variados (Criativo/Copy/Headline).';
comment on column public.dct_mensal.mes    is 'Formato YYYY-MM. Ex: 2026-06.';
comment on column public.dct_mensal.testes is 'Array de testes DCT (campos do teste + array de elementos).';

create index dct_mensal_user_mes_idx on public.dct_mensal (user_id, mes);
create index dct_mensal_product_idx  on public.dct_mensal (product_id);

alter table public.dct_mensal enable row level security;

create policy "dct_mensal: owner full access"
  on public.dct_mensal for all
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

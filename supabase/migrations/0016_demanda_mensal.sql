-- =============================================================
-- 0016 — Planilha de demanda mensal de criativos
-- =============================================================
-- Linhas de demanda do próximo mês por produto: funil × ângulo × modelo ×
-- influ, com status (verificação do que já chegou) e observação.
-- Guardada como array JSON por produto/mês (independente do mapa mental).

create table public.demanda_mensal (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  product_id uuid        references public.products (id) on delete cascade,
  mes        text        not null,
  linhas     jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, product_id, mes)
);

comment on table public.demanda_mensal is 'Planilha de demanda de criativos por produto/mês (funil, ângulo, modelo, influ, status, obs).';

alter table public.demanda_mensal enable row level security;

create policy "demanda: owner full access"
  on public.demanda_mensal for all
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

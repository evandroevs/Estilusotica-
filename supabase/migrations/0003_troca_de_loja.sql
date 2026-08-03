-- =============================================================
-- Troca de loja — múltiplos workspaces por usuário
-- =============================================================
-- Cada LOJA é um workspace. O seletor no topo da sidebar manda o
-- workspace escolhido no header `x-workspace-id`; current_workspace_id()
-- passa a respeitar esse header (validando que o usuário é membro dele)
-- em vez de fixar sempre o primeiro workspace.
--
-- Nada mais muda: todas as RPCs e policies continuam chamando
-- current_workspace_id(), então o dashboard é exatamente o mesmo —
-- só o workspace resolvido é outro.
-- =============================================================

-- ── 1. current_workspace_id() com loja selecionada ───────────
-- Ordem de resolução:
--   1. workspace pedido no header, SE o usuário for membro dele;
--   2. senão, o primeiro workspace do usuário (comportamento antigo).
-- O header vem de PostgREST (request.headers) — quando a função roda
-- fora de um request HTTP (cron, psql), o setting não existe e o
-- coalesce cai direto no fallback.

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with pedido as (
    select case
             when h ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then h::uuid
           end as id
    from (
      select coalesce(
               current_setting('request.headers', true)::json ->> 'x-workspace-id',
               ''
             ) as h
    ) t
  )
  select coalesce(
    -- loja escolhida (só vale se o usuário for membro dela)
    (select m.workspace_id
       from public.workspace_members m
       join pedido p on p.id = m.workspace_id
      where m.user_id = auth.uid()
      limit 1),
    -- fallback: primeira loja do usuário
    (select m.workspace_id
       from public.workspace_members m
      where m.user_id = auth.uid()
      order by m.created_at
      limit 1)
  )
$$;

grant execute on function public.current_workspace_id() to authenticated;

comment on function public.current_workspace_id() is
  'Workspace (loja) ativo do usuário. Respeita o header x-workspace-id quando o usuário é membro do workspace pedido; senão usa o primeiro.';

-- ── 2. Listar TODAS as lojas do usuário ──────────────────────
-- A policy antiga só deixava ler o workspace ativo — o seletor precisa
-- enxergar todos os workspaces em que o usuário é membro.

drop policy if exists "workspaces: members read" on public.workspaces;

create policy "workspaces: members read"
  on public.workspaces for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members m
      where m.workspace_id = workspaces.id
        and m.user_id = auth.uid()
    )
  );

-- ── 3. Segunda loja: Estilus Select ──────────────────────────
-- Idempotente: só cria para quem ainda não tem, e nomeia a loja
-- original (criada como 'Meu Workspace' pelo trigger de signup).

update public.workspaces
   set nome = 'Estilus Ótica'
 where nome = 'Meu Workspace';

do $$
declare
  dono uuid;
  nova uuid;
begin
  for dono in select distinct owner_id from public.workspaces loop
    if not exists (
      select 1 from public.workspaces
       where owner_id = dono and nome = 'Estilus Select'
    ) then
      insert into public.workspaces (nome, owner_id)
      values ('Estilus Select', dono)
      returning id into nova;

      insert into public.workspace_members (workspace_id, user_id, role)
      values (nova, dono, 'owner')
      on conflict do nothing;
    end if;
  end loop;
end $$;

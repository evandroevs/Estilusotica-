-- =============================================================
-- Creative Lab v2 — Biblioteca estilo Drive
-- =============================================================
-- Hierarquia de pastas (parent_id), compartilhamento revogável
-- (share_token nullable), tags automáticas nos itens e navegação
-- pública em subpastas.
-- =============================================================

-- ── 1. Hierarquia de pastas ──────────────────────────────────

alter table public.pastas
  add column if not exists parent_id uuid references public.pastas (id) on delete cascade;

create index if not exists pastas_parent_idx on public.pastas (parent_id);

-- ── 2. Compartilhamento revogável ────────────────────────────
-- share_token nulo = pasta NÃO compartilhada. Gerar/limpar o token
-- equivale a ativar/desativar o link público.

alter table public.pastas alter column share_token drop not null;
alter table public.pastas alter column share_token drop default;

comment on column public.pastas.share_token is
  'Token do link público /p/<token>. NULL = compartilhamento desativado.';

-- ── 3. Tags automáticas nos itens ────────────────────────────
-- Preenchidas pela save-media a partir da análise do anúncio.

alter table public.pasta_itens add column if not exists funil  text;
alter table public.pasta_itens add column if not exists angulo text;
alter table public.pasta_itens add column if not exists modelo text;

create index if not exists pasta_itens_funil_idx  on public.pasta_itens (funil);
create index if not exists pasta_itens_angulo_idx on public.pasta_itens (angulo);
create index if not exists pasta_itens_modelo_idx on public.pasta_itens (modelo);

-- ── 4. Upload direto pelo frontend (bucket creatives) ────────
-- Usuários autenticados podem subir/remover arquivos do bucket.

drop policy if exists "creatives: authenticated upload" on storage.objects;
create policy "creatives: authenticated upload"
  on storage.objects for insert
  to authenticated with check (bucket_id = 'creatives');

drop policy if exists "creatives: authenticated update" on storage.objects;
create policy "creatives: authenticated update"
  on storage.objects for update
  to authenticated using (bucket_id = 'creatives');

drop policy if exists "creatives: authenticated delete" on storage.objects;
create policy "creatives: authenticated delete"
  on storage.objects for delete
  to authenticated using (bucket_id = 'creatives');

-- ── 5. RPC pública com navegação em subpastas ────────────────
-- p_folder permite navegar para uma subpasta DENTRO da árvore da
-- pasta compartilhada (valida que é descendente do root do token).

drop function if exists public.get_shared_folder(uuid);
drop function if exists public.get_shared_folder(uuid, uuid);

create function public.get_shared_folder(p_token uuid, p_folder uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_root   public.pastas%rowtype;
  v_target public.pastas%rowtype;
begin
  select * into v_root from public.pastas where share_token = p_token;
  if not found then
    return null;
  end if;

  if p_folder is null or p_folder = v_root.id then
    v_target := v_root;
  else
    -- valida que p_folder é descendente do root compartilhado
    with recursive tree as (
      select id from public.pastas where id = v_root.id
      union all
      select p.id from public.pastas p join tree t on p.parent_id = t.id
    )
    select * into v_target from public.pastas
    where id = p_folder and id in (select id from tree);
    if not found then
      return null;
    end if;
  end if;

  return jsonb_build_object(
    'root_id',   v_root.id,
    'root_nome', v_root.nome,
    'folder_id', v_target.id,
    'nome',      v_target.nome,
    'subpastas', coalesce(
      (select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome) order by s.nome)
       from public.pastas s where s.parent_id = v_target.id),
      '[]'::jsonb),
    'itens', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', i.id, 'nome', i.nome, 'media_type', i.media_type,
          'storage_path', i.storage_path, 'funil', i.funil,
          'angulo', i.angulo, 'modelo', i.modelo,
          'created_at', i.created_at) order by i.created_at desc)
       from public.pasta_itens i where i.pasta_id = v_target.id),
      '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_shared_folder(uuid, uuid) to anon, authenticated;

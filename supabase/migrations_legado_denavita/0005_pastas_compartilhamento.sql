-- =============================================================
-- Creative Lab v2 — Pastas de criativos com compartilhamento público
-- =============================================================
-- O gestor salva vídeos/imagens em pastas; os arquivos são copiados
-- para o Storage (URLs da Meta expiram). Cada pasta tem um share_token
-- — quem tiver o link /p/<token> vê e baixa sem login.
-- =============================================================

-- ── 1. PASTAS ────────────────────────────────────────────────

create table if not exists public.pastas (
  id          uuid        primary key default gen_random_uuid(),
  nome        text        not null,
  share_token uuid        not null default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint pastas_share_token_unique unique (share_token)
);

comment on table  public.pastas             is 'Pastas de criativos salvos. share_token dá acesso público de leitura via get_shared_folder().';
comment on column public.pastas.share_token is 'Token não-adivinhável do link público /p/<token>.';

create index if not exists pastas_user_idx on public.pastas (user_id);

alter table public.pastas enable row level security;

drop policy if exists "pastas: owner full access" on public.pastas;
create policy "pastas: owner full access"
  on public.pastas for all
  to authenticated using     (auth.uid() = user_id)
                  with check (auth.uid() = user_id);

-- ── 2. PASTA_ITENS ───────────────────────────────────────────

create table if not exists public.pasta_itens (
  id           uuid        primary key default gen_random_uuid(),
  pasta_id     uuid        not null references public.pastas (id) on delete cascade,
  ad_id        text,
  nome         text,
  media_type   text        check (media_type in ('image', 'video')),
  storage_path text        not null,   -- caminho no bucket "creatives"
  created_at   timestamptz not null default now(),

  constraint pasta_itens_pasta_ad_unique unique (pasta_id, ad_id)
);

comment on table public.pasta_itens is 'Itens salvos em pastas. storage_path aponta para o bucket público creatives.';

create index if not exists pasta_itens_pasta_idx on public.pasta_itens (pasta_id);

alter table public.pasta_itens enable row level security;

drop policy if exists "pasta_itens: owner full access" on public.pasta_itens;
create policy "pasta_itens: owner full access"
  on public.pasta_itens for all
  to authenticated
  using     (exists (select 1 from public.pastas p where p.id = pasta_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.pastas p where p.id = pasta_id and p.user_id = auth.uid()));

-- ── 3. BUCKET PÚBLICO "creatives" ────────────────────────────
-- Leitura pública via URL /storage/v1/object/public/creatives/...
-- Escrita apenas pelas Edge Functions (service_role ignora RLS).

insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do nothing;

-- ── 4. get_shared_folder() — acesso público por token ────────

create or replace function public.get_shared_folder(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nome',       p.nome,
    'created_at', p.created_at,
    'itens', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'id',           i.id,
           'nome',         i.nome,
           'media_type',   i.media_type,
           'storage_path', i.storage_path,
           'created_at',   i.created_at
         ) order by i.created_at desc)
       from public.pasta_itens i
       where i.pasta_id = p.id),
      '[]'::jsonb
    )
  )
  from public.pastas p
  where p.share_token = p_token;
$$;

comment on function public.get_shared_folder(uuid) is
  'Retorna pasta + itens pelo share_token. SECURITY DEFINER: permite visualização pública (anon) sem expor as tabelas.';

grant execute on function public.get_shared_folder(uuid) to anon, authenticated;

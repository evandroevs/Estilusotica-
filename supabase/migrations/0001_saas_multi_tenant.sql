-- =============================================================
-- Estilusótica SaaS — Schema inicial multi-tenant
-- =============================================================
-- Cada cliente do SaaS é um WORKSPACE. Todo dado de métricas carrega
-- workspace_id e o RLS garante que um cliente só enxerga o próprio
-- workspace. O workspace é resolvido a partir do usuário logado por
-- current_workspace_id() — assim as RPCs mantêm a MESMA assinatura
-- que o frontend já usa (get_ads_metrics, get_synced_range, etc.).
--
-- Tokens da Meta ficam em meta_connection_secrets, tabela SEM policy
-- de leitura — só as Edge Functions (service_role) acessam.
-- =============================================================

create extension if not exists "pgcrypto";

-- =============================================================
-- 1. WORKSPACES + MEMBROS
-- =============================================================

create table public.workspaces (
  id         uuid        primary key default gen_random_uuid(),
  nome       text        not null default 'Meu Workspace',
  owner_id   uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.workspaces is
  'Um workspace por cliente do SaaS. Criado automaticamente no signup (trigger handle_new_user).';

create table public.workspace_members (
  workspace_id uuid        not null references public.workspaces (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  role         text        not null default 'owner' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;

-- Resolve o workspace do usuário logado. SECURITY DEFINER para poder ser
-- usada dentro de policies sem recursão de RLS.
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid()
  order by created_at
  limit 1
$$;

grant execute on function public.current_workspace_id() to authenticated;

create policy "workspaces: members read"
  on public.workspaces for select
  to authenticated using (id = public.current_workspace_id());

create policy "workspaces: owner update"
  on public.workspaces for update
  to authenticated using (owner_id = auth.uid());

create policy "workspace_members: own rows"
  on public.workspace_members for select
  to authenticated using (user_id = auth.uid());

-- ── Auto-criação de workspace no signup ──────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
begin
  insert into public.workspaces (nome, owner_id)
  values (
    coalesce(nullif(new.raw_user_meta_data ->> 'workspace_name', ''), 'Meu Workspace'),
    new.id
  )
  returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================
-- 2. CONEXÃO META (OAuth por workspace)
-- =============================================================

create table public.meta_connections (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.workspaces (id) on delete cascade,
  fb_user_id    text,
  fb_user_name  text,
  account_id    text,                    -- ID numérico da conta de anúncios (sem "act_")
  account_name  text,
  status        text        not null default 'pending_account'
                            check (status in ('pending_account', 'active', 'error')),
  last_error    text,
  connected_by  uuid        references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint meta_connections_workspace_unique unique (workspace_id)
);

comment on table public.meta_connections is
  'Conexão Meta Ads do workspace (1 por workspace na v1). pending_account = OAuth feito, aguardando escolha da conta de anúncios.';

alter table public.meta_connections enable row level security;

-- Membros veem a conexão (sem token — o token fica em meta_connection_secrets).
create policy "meta_connections: members read"
  on public.meta_connections for select
  to authenticated using (workspace_id = public.current_workspace_id());

-- Tokens: SEM policies → apenas service_role (Edge Functions) lê/escreve.
create table public.meta_connection_secrets (
  connection_id    uuid        primary key references public.meta_connections (id) on delete cascade,
  access_token     text        not null,   -- token longo (60 dias) do usuário Meta
  token_expires_at timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table public.meta_connection_secrets is
  'Token OAuth da Meta por conexão. NUNCA exposto ao frontend: sem policies de RLS → somente service_role.';

alter table public.meta_connection_secrets enable row level security;

-- =============================================================
-- 3. PRODUCTS (por workspace)
-- =============================================================

create table public.products (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null default public.current_workspace_id()
                           references public.workspaces (id) on delete cascade,
  nome         text        not null,
  slug         text        not null,
  keywords     text[]      not null default '{}',  -- palavras no nome do anúncio que identificam o produto
  ativo        boolean     not null default true,
  cpa_meta     numeric,
  roas_meta    numeric,
  ticket_medio numeric,
  created_at   timestamptz not null default now(),

  constraint products_workspace_slug_unique unique (workspace_id, slug)
);

comment on column public.products.keywords is
  'Palavras/siglas que identificam o produto no nome do anúncio ou campanha (case-insensitive). Usadas pelo meta-sync para classificar.';

create index products_workspace_idx on public.products (workspace_id);

alter table public.products enable row level security;

create policy "products: members full access"
  on public.products for all
  to authenticated
  using     (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- =============================================================
-- 4. META_ADS_CACHE (snapshot por anúncio, por workspace)
-- =============================================================

create table public.meta_ads_cache (
  id                  uuid        primary key default gen_random_uuid(),
  workspace_id        uuid        not null references public.workspaces (id) on delete cascade,

  ad_id               text        not null,
  ad_name             text,
  campaign_id         text,
  campaign_name       text,

  product_id          uuid        references public.products (id) on delete set null,
  funil               text        check (funil in ('TOFU', 'MOFU', 'BOFU')),

  date_start          date,
  date_stop           date,

  spend               numeric,
  revenue             numeric,
  roas                numeric,
  purchases           integer,
  cpa                 numeric,
  cpm                 numeric,
  cpc                 numeric,
  ctr                 numeric,
  conversion_rate     numeric,
  connect_rate        numeric,
  thumbstop_rate      numeric,
  body_rate           numeric,
  impressions         integer,
  link_clicks         integer,
  landing_page_views  integer,

  -- Mídia
  thumbnail_url       text,
  video_id            text,
  media_type          text        check (media_type in ('image', 'video')),
  video_url           text,       -- URL direta do vídeo (expira — cache TTL 2h)
  video_url_at        timestamptz,

  -- Status real do anúncio na Meta (null = ainda não sincronizado)
  effective_status    text,
  status_synced_at    timestamptz,

  -- Análise de vídeo (Edge Function transcribe)
  transcricao         text,
  analise_video       jsonb,
  video_analisado_em  timestamptz,

  raw                 jsonb,
  synced_at           timestamptz,

  constraint meta_ads_cache_ws_ad_unique unique (workspace_id, ad_id)
);

create index mac_workspace_idx on public.meta_ads_cache (workspace_id);
create index mac_product_idx   on public.meta_ads_cache (product_id);
create index mac_campaign_idx  on public.meta_ads_cache (workspace_id, campaign_id);
create index mac_synced_idx    on public.meta_ads_cache (synced_at desc);

alter table public.meta_ads_cache enable row level security;

create policy "meta_ads_cache: members read"
  on public.meta_ads_cache for select
  to authenticated using (workspace_id = public.current_workspace_id());

-- =============================================================
-- 5. META_ADS_DAILY (série temporal, por workspace)
-- =============================================================

create table public.meta_ads_daily (
  workspace_id        uuid        not null references public.workspaces (id) on delete cascade,
  ad_id               text        not null,
  date                date        not null,

  campaign_id         text,
  product_id          uuid        references public.products (id) on delete set null,
  funil               text        check (funil in ('TOFU', 'MOFU', 'BOFU')),

  spend               numeric     not null default 0,
  revenue             numeric     not null default 0,
  purchases           integer     not null default 0,
  impressions         integer     not null default 0,
  clicks              integer     not null default 0,
  link_clicks         integer     not null default 0,
  landing_page_views  integer     not null default 0,
  video_views_3s      numeric     not null default 0,
  video_views_p75     numeric     not null default 0,
  initiate_checkout   numeric     not null default 0,
  add_payment_info    numeric     not null default 0,

  synced_at           timestamptz not null default now(),

  constraint meta_ads_daily_pk unique (workspace_id, ad_id, date)
);

create index mad_ws_date_idx    on public.meta_ads_daily (workspace_id, date);
create index mad_ws_ad_idx      on public.meta_ads_daily (workspace_id, ad_id);
create index mad_product_idx    on public.meta_ads_daily (product_id);
create index mad_campaign_idx   on public.meta_ads_daily (workspace_id, campaign_id);

alter table public.meta_ads_daily enable row level security;

create policy "meta_ads_daily: members read"
  on public.meta_ads_daily for select
  to authenticated using (workspace_id = public.current_workspace_id());

-- =============================================================
-- 6. META_ADS_SEGMENTS (funil real de entrega, por workspace)
-- =============================================================

create table public.meta_ads_segments (
  workspace_id uuid       not null references public.workspaces (id) on delete cascade,
  ad_id     text          not null,
  date      date          not null,
  segment   text          not null,  -- prospecting | engaged | existing | unknown
  spend     numeric       not null default 0,
  purchases numeric       not null default 0,
  revenue   numeric       not null default 0,
  synced_at timestamptz   not null default now(),
  primary key (workspace_id, ad_id, date, segment)
);

create index meta_ads_segments_ws_date_idx on public.meta_ads_segments (workspace_id, date);

alter table public.meta_ads_segments enable row level security;

create policy "meta_ads_segments: members read"
  on public.meta_ads_segments for select
  to authenticated using (workspace_id = public.current_workspace_id());

-- =============================================================
-- 7. META_CAMPAIGNS (status por campanha, por workspace)
-- =============================================================

create table public.meta_campaigns (
  workspace_id     uuid        not null references public.workspaces (id) on delete cascade,
  campaign_id      text        not null,
  campaign_name    text        not null,
  effective_status text,
  synced_at        timestamptz not null default now(),
  primary key (workspace_id, campaign_id)
);

alter table public.meta_campaigns enable row level security;

create policy "meta_campaigns: members read"
  on public.meta_campaigns for select
  to authenticated using (workspace_id = public.current_workspace_id());

-- =============================================================
-- 8. CREATIVE_CLASSIFICATIONS (IA — ADSUP, por workspace)
-- =============================================================

create table public.creative_classifications (
  id                        uuid        primary key default gen_random_uuid(),
  workspace_id              uuid        not null references public.workspaces (id) on delete cascade,
  ad_id                     text        not null,
  nome_criativo             text,

  persona                   text,
  etapa_funil               text,
  angulo                    text,
  pilar_estrutura           text,
  gancho_tipo               text,
  formato                   text,

  confidence_score          numeric,
  justificativa             text,
  alinhamento_gancho_angulo boolean,
  observacao_alinhamento    text,

  provider                  text,
  classificado_em           timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint creative_classifications_ws_ad_unique unique (workspace_id, ad_id)
);

alter table public.creative_classifications enable row level security;

create policy "creative_classifications: members read"
  on public.creative_classifications for select
  to authenticated using (workspace_id = public.current_workspace_id());

-- =============================================================
-- 9. PASTAS + PASTA_ITENS (acervo salvo, por usuário)
-- =============================================================

create table public.pastas (
  id          uuid        primary key default gen_random_uuid(),
  nome        text        not null,
  parent_id   uuid        references public.pastas (id) on delete cascade,
  share_token uuid,                      -- NULL = compartilhamento desativado
  user_id     uuid        not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint pastas_share_token_unique unique (share_token)
);

create index pastas_user_idx   on public.pastas (user_id);
create index pastas_parent_idx on public.pastas (parent_id);

alter table public.pastas enable row level security;

create policy "pastas: owner full access"
  on public.pastas for all
  to authenticated using     (auth.uid() = user_id)
                  with check (auth.uid() = user_id);

create table public.pasta_itens (
  id             uuid        primary key default gen_random_uuid(),
  pasta_id       uuid        not null references public.pastas (id) on delete cascade,
  ad_id          text,
  nome           text,
  media_type     text        check (media_type in ('image', 'video')),
  storage_path   text        not null,
  funil          text,
  angulo         text,
  modelo         text,
  metricas       jsonb,
  periodo_inicio date,
  periodo_fim    date,
  created_at     timestamptz not null default now(),

  constraint pasta_itens_pasta_ad_unique unique (pasta_id, ad_id)
);

create index pasta_itens_pasta_idx on public.pasta_itens (pasta_id);

alter table public.pasta_itens enable row level security;

create policy "pasta_itens: owner full access"
  on public.pasta_itens for all
  to authenticated
  using     (exists (select 1 from public.pastas p where p.id = pasta_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.pastas p where p.id = pasta_id and p.user_id = auth.uid()));

-- Bucket público de mídia salva (escrita só via Edge Functions/service_role)
insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do nothing;

-- Acesso público de leitura a uma pasta compartilhada por token
create or replace function public.get_shared_folder(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pasta', jsonb_build_object('id', p.id, 'nome', p.nome, 'created_at', p.created_at),
    'itens', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id', i.id, 'ad_id', i.ad_id, 'nome', i.nome,
         'media_type', i.media_type, 'storage_path', i.storage_path,
         'funil', i.funil, 'angulo', i.angulo, 'modelo', i.modelo,
         'metricas', i.metricas,
         'periodo_inicio', i.periodo_inicio, 'periodo_fim', i.periodo_fim,
         'created_at', i.created_at
       ) order by i.created_at desc)
       from public.pasta_itens i where i.pasta_id = p.id),
      '[]'::jsonb
    )
  )
  from public.pastas p
  where p.share_token = p_token
$$;

grant execute on function public.get_shared_folder(uuid) to anon, authenticated;

-- =============================================================
-- 10. BIBLIOTECA (criativos validados, por usuário)
-- =============================================================

create table public.biblioteca (
  id             uuid        primary key default gen_random_uuid(),
  nome           text        not null,
  ad_id          text,
  product_id     uuid        references public.products (id) on delete set null,
  funil          text        check (funil in ('TOFU', 'MOFU', 'BOFU')),
  tipo           text        check (tipo in ('Vídeo', 'Arte')),
  modelo_video   text,
  angulo         text,
  hook_texto     text,
  status         text        not null default 'Em Teste'
                             check (status in ('Validado', 'Em Teste', 'Reprovado')),
  roas           numeric,
  ctr            numeric,
  thumbstop_rate numeric,
  compras        integer,
  cpa            numeric,
  link           text,
  thumbnail_url  text,
  observacoes    text,
  created_at     timestamptz not null default now(),
  user_id        uuid        not null references auth.users (id) on delete cascade
);

create index biblioteca_user_idx on public.biblioteca (user_id);

alter table public.biblioteca enable row level security;

create policy "biblioteca: owner full access"
  on public.biblioteca for all
  to authenticated using     (auth.uid() = user_id)
                  with check (auth.uid() = user_id);

-- =============================================================
-- 11. CONFIG (globais + por usuário)
-- =============================================================

create table public.config (
  id       uuid primary key default gen_random_uuid(),
  chave    text not null,
  valor    jsonb not null,
  user_id  uuid references auth.users (id) on delete cascade
);

create unique index config_chave_global_uniq on public.config (chave)
  where user_id is null;

create unique index config_chave_user_uniq on public.config (chave, user_id)
  where user_id is not null;

alter table public.config enable row level security;

create policy "config: read global and own"
  on public.config for select
  to authenticated using (user_id is null or auth.uid() = user_id);

create policy "config: insert own"
  on public.config for insert
  to authenticated with check (auth.uid() = user_id);

create policy "config: update own"
  on public.config for update
  to authenticated using (auth.uid() = user_id);

create policy "config: delete own"
  on public.config for delete
  to authenticated using (auth.uid() = user_id);

-- Benchmarks padrão do sistema (PRD seção 4)
insert into public.config (chave, valor, user_id) values (
  'benchmarks',
  '{
    "ctr_bom":             1.5,
    "ctr_excelente":       3.0,
    "roas_qualificado":    3.0,
    "roas_excelente":      5.0,
    "thumbstop_bom":       25,
    "thumbstop_excelente": 40,
    "body_rate_bom":       15,
    "body_rate_excelente": 30,
    "frequencia_tofu_max": 1.15,
    "frequencia_mofu_max": 2.0
  }'::jsonb,
  null
);

-- =============================================================
-- 12. RPCs — mesmas assinaturas que o frontend já usa.
-- O workspace é resolvido internamente via current_workspace_id().
-- =============================================================

create or replace function public.get_ads_metrics(
  p_start    date,
  p_end      date,
  p_product  uuid default null,
  p_campaign text default null
)
returns table (
  ad_id               text,
  ad_name             text,
  campaign_id         text,
  campaign_name       text,
  product_id          uuid,
  funil               text,
  date_start          date,
  date_stop           date,
  thumbnail_url       text,
  video_id            text,
  media_type          text,
  transcricao         text,
  analise_video       jsonb,
  video_analisado_em  timestamptz,
  spend               numeric,
  revenue             numeric,
  roas                numeric,
  purchases           integer,
  cpa                 numeric,
  cpm                 numeric,
  cpc                 numeric,
  ctr                 numeric,
  conversion_rate     numeric,
  connect_rate        numeric,
  thumbstop_rate      numeric,
  body_rate           numeric,
  impressions         integer,
  link_clicks         integer,
  landing_page_views  integer,
  initiate_checkout   numeric,
  add_payment_info    numeric,
  ticket_medio        numeric,
  cplpv               numeric
)
language sql
stable
security invoker
as $$
  with agg as (
    select
      d.ad_id,
      sum(d.spend)              as spend,
      sum(d.revenue)            as revenue,
      sum(d.purchases)          as purchases,
      sum(d.impressions)        as impressions,
      sum(d.clicks)             as clicks,
      sum(d.link_clicks)        as link_clicks,
      sum(d.landing_page_views) as landing_page_views,
      sum(d.video_views_3s)     as video_views_3s,
      sum(d.video_views_p75)    as video_views_p75,
      sum(d.initiate_checkout)  as initiate_checkout,
      sum(d.add_payment_info)   as add_payment_info
    from public.meta_ads_daily d
    where d.workspace_id = public.current_workspace_id()
      and d.date >= p_start
      and d.date <= p_end
      and (p_product  is null or d.product_id  = p_product)
      and (p_campaign is null or d.campaign_id = p_campaign)
    group by d.ad_id
  )
  select
    a.ad_id,
    m.ad_name,
    m.campaign_id,
    m.campaign_name,
    m.product_id,
    m.funil,
    p_start as date_start,
    p_end   as date_stop,
    m.thumbnail_url,
    m.video_id,
    m.media_type,
    m.transcricao,
    m.analise_video,
    m.video_analisado_em,
    a.spend,
    a.revenue,
    case when a.spend       > 0 then a.revenue / a.spend                                   else 0 end as roas,
    a.purchases::integer,
    case when a.purchases   > 0 then a.spend / a.purchases                                 else 0 end as cpa,
    case when a.impressions > 0 then (a.spend / a.impressions) * 1000                      else 0 end as cpm,
    case when a.link_clicks > 0 then a.spend / a.link_clicks                               else 0 end as cpc,
    case when a.impressions > 0 then (a.link_clicks::numeric / a.impressions) * 100        else 0 end as ctr,
    case when a.link_clicks > 0 then (a.purchases::numeric / a.link_clicks) * 100          else 0 end as conversion_rate,
    case when a.link_clicks > 0 then (a.landing_page_views::numeric / a.link_clicks) * 100 else 0 end as connect_rate,
    case when a.impressions > 0 then (a.video_views_3s / a.impressions) * 100              else 0 end as thumbstop_rate,
    case when a.impressions > 0 then (a.video_views_p75 / a.impressions) * 100             else 0 end as body_rate,
    a.impressions::integer,
    a.link_clicks::integer,
    a.landing_page_views::integer,
    a.initiate_checkout,
    a.add_payment_info,
    case when a.purchases          > 0 then a.revenue / a.purchases                        else 0 end as ticket_medio,
    case when a.landing_page_views > 0 then a.spend / a.landing_page_views                 else 0 end as cplpv
  from agg a
  left join public.meta_ads_cache m
    on m.ad_id = a.ad_id
   and m.workspace_id = public.current_workspace_id();
$$;

grant execute on function public.get_ads_metrics(date, date, uuid, text) to authenticated;

create or replace function public.get_synced_range()
returns table (min_date date, max_date date)
language sql
stable
security invoker
as $$
  select min(d.date), max(d.date)
  from public.meta_ads_daily d
  where d.workspace_id = public.current_workspace_id()
$$;

grant execute on function public.get_synced_range() to authenticated;

create or replace function public.get_daily_totals(
  p_start   date,
  p_end     date,
  p_product uuid default null
)
returns table (
  date      date,
  spend     numeric,
  revenue   numeric,
  purchases numeric,
  lpv       numeric
)
language sql
stable
security invoker
as $$
  select
    d.date,
    sum(d.spend)              as spend,
    sum(d.revenue)            as revenue,
    sum(d.purchases)          as purchases,
    sum(d.landing_page_views) as lpv
  from public.meta_ads_daily d
  where d.workspace_id = public.current_workspace_id()
    and d.date >= p_start
    and d.date <= p_end
    and (p_product is null or d.product_id = p_product)
  group by d.date
  order by d.date
$$;

grant execute on function public.get_daily_totals(date, date, uuid) to authenticated;

create or replace function public.get_funil_real(p_start date, p_end date)
returns table (
  ad_id               text,
  compras_prospecting numeric,
  compras_engaged     numeric,
  compras_existing    numeric,
  funil_real          text
)
language sql
stable
security invoker
as $$
  with agg as (
    select s.ad_id, s.segment, sum(s.purchases) as p, sum(s.spend) as sp
    from public.meta_ads_segments s
    where s.workspace_id = public.current_workspace_id()
      and s.date >= p_start and s.date <= p_end
    group by s.ad_id, s.segment
  ), piv as (
    select
      a.ad_id,
      coalesce(sum(a.p)  filter (where a.segment = 'prospecting'), 0) as p_pros,
      coalesce(sum(a.p)  filter (where a.segment = 'engaged'),     0) as p_eng,
      coalesce(sum(a.p)  filter (where a.segment = 'existing'),    0) as p_exi,
      coalesce(sum(a.sp) filter (where a.segment = 'prospecting'), 0) as s_pros,
      coalesce(sum(a.sp) filter (where a.segment = 'engaged'),     0) as s_eng,
      coalesce(sum(a.sp) filter (where a.segment = 'existing'),    0) as s_exi
    from agg a
    group by a.ad_id
  )
  select
    v.ad_id,
    v.p_pros,
    v.p_eng,
    v.p_exi,
    case
      when greatest(v.p_pros, v.p_eng, v.p_exi) > 0 then
        case greatest(v.p_pros, v.p_eng, v.p_exi)
          when v.p_exi then 'BOFU'
          when v.p_eng then 'MOFU'
          else 'TOFU'
        end
      when greatest(v.s_pros, v.s_eng, v.s_exi) > 0 then
        case greatest(v.s_pros, v.s_eng, v.s_exi)
          when v.s_exi then 'BOFU'
          when v.s_eng then 'MOFU'
          else 'TOFU'
        end
      else null
    end as funil_real
  from piv v
$$;

grant execute on function public.get_funil_real(date, date) to authenticated;

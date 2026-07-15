-- =============================================================
-- Creative Lab v2 — Schema inicial
-- =============================================================

-- Extensão para gen_random_uuid() (já disponível no Supabase por padrão)
create extension if not exists "pgcrypto";

-- =============================================================
-- 1. PRODUCTS
-- Produtos cobertos (Laranja Moro, Vinagre de Maçã, Tons, Jejoom, Digestino)
-- =============================================================

create table public.products (
  id           uuid        primary key default gen_random_uuid(),
  nome         text        not null,
  slug         text        not null,
  ativo        boolean     not null default true,
  cpa_meta     numeric,                          -- custo por compra alvo
  roas_meta    numeric,                          -- ROAS mínimo esperado
  ticket_medio numeric,                          -- ticket médio em R$
  created_at   timestamptz not null default now(),

  constraint products_slug_unique unique (slug)
);

comment on table  public.products                is 'Produtos da Denavita cobertos pela plataforma.';
comment on column public.products.cpa_meta       is 'CPA alvo — usado para colorir alertas em toda a UI.';
comment on column public.products.roas_meta      is 'ROAS mínimo qualificado para este produto.';

-- Índice de busca por nome
create index products_nome_idx on public.products (nome);

alter table public.products enable row level security;

-- Qualquer usuário autenticado lê; CRUD feito pela UI de Configurações
create policy "products: read for authenticated"
  on public.products for select
  to authenticated using (true);

create policy "products: insert for authenticated"
  on public.products for insert
  to authenticated with check (true);

create policy "products: update for authenticated"
  on public.products for update
  to authenticated using (true);

create policy "products: delete for authenticated"
  on public.products for delete
  to authenticated using (true);


-- =============================================================
-- 2. META_ADS_CACHE
-- Cache de anúncios/insights buscados da Meta Marketing API.
-- Atualizado exclusivamente pelas Edge Functions (service_role).
-- =============================================================

create table public.meta_ads_cache (
  id                  uuid        primary key default gen_random_uuid(),

  -- Identificadores Meta
  ad_id               text        not null,   -- ID único do anúncio na Meta
  ad_name             text,                   -- Ex: "AD - FRAN MOFU PDP COQ10"
  campaign_id         text,
  campaign_name       text,

  -- Classificação interna
  product_id          uuid        references public.products (id) on delete set null,
  funil               text        check (funil in ('TOFU', 'MOFU', 'BOFU')),

  -- Janela de tempo
  date_start          date,
  date_stop           date,

  -- Métricas de performance (glossário seção 4 do PRD)
  spend               numeric,               -- Investimento (R$)
  revenue             numeric,               -- Receita (valor das compras)
  roas                numeric,               -- ROAS = revenue / spend
  purchases           integer,               -- Compras
  cpa                 numeric,               -- Custo por compra
  cpm                 numeric,               -- CPM
  cpc                 numeric,               -- CPC (clique no link)
  ctr                 numeric,               -- CTR % (cliques / impressões)
  conversion_rate     numeric,               -- Taxa de Conversão % (compras / LPV)
  connect_rate        numeric,               -- Connect Rate % (LPV / cliques)
  thumbstop_rate      numeric,               -- Thumbstop/Hook Rate % (views 3s / impressões)
  impressions         integer,
  link_clicks         integer,
  landing_page_views  integer,

  -- Mídia
  thumbnail_url       text,
  video_id            text,
  media_type          text        check (media_type in ('image', 'video')),

  -- Análise de vídeo — preenchido sob demanda pela Edge Function 'transcribe'
  transcricao         text,                  -- Transcrição da fala (Whisper)
  analise_video       jsonb,                 -- Análise Gemini: hook_3s, angulo, cenas, cta, transcricao_completa
  video_analisado_em  timestamptz,           -- Quando a análise foi feita (cache guard)

  -- Metadados
  raw                 jsonb,                 -- Payload bruto da Meta API
  synced_at           timestamptz,           -- Última vez que meta-sync gravou este registro

  constraint meta_ads_cache_ad_id_unique unique (ad_id)
);

comment on table  public.meta_ads_cache                    is 'Cache de anúncios e insights da Meta Marketing API. Escrita feita pelas Edge Functions com service_role.';
comment on column public.meta_ads_cache.thumbstop_rate     is 'views 3s / impressões × 100. Chamado de Thumbstop Rate ou Hook Rate.';
comment on column public.meta_ads_cache.transcricao        is 'Transcrição da fala (via Whisper). Preenchido pela Edge Function transcribe.';
comment on column public.meta_ads_cache.analise_video      is 'Análise multimodal (via Gemini): {hook_3s, angulo, cenas, cta, transcricao_completa}.';
comment on column public.meta_ads_cache.video_analisado_em is 'Timestamp da última análise de vídeo. Se preenchido, a Edge Function transcribe não reprocessa.';

-- Índices de consulta frequentes
create index mac_product_idx   on public.meta_ads_cache (product_id);
create index mac_campaign_idx  on public.meta_ads_cache (campaign_id);
create index mac_funil_idx     on public.meta_ads_cache (funil);
create index mac_dates_idx     on public.meta_ads_cache (date_start, date_stop);
create index mac_synced_idx    on public.meta_ads_cache (synced_at desc);

alter table public.meta_ads_cache enable row level security;

-- Qualquer usuário autenticado lê; escrita feita pelo service_role das Edge Functions
create policy "meta_ads_cache: read for authenticated"
  on public.meta_ads_cache for select
  to authenticated using (true);


-- =============================================================
-- 3. BIBLIOTECA
-- Acervo de criativos validados — a fonte de verdade para a IA.
-- =============================================================

create table public.biblioteca (
  id            uuid        primary key default gen_random_uuid(),
  nome          text        not null,  -- "[FUNIL] | [MODELO] | [ÂNGULO] | descrição"
  ad_id         text,                  -- Referência ao anúncio de origem na Meta
  product_id    uuid        references public.products (id) on delete set null,
  funil         text        check (funil in ('TOFU', 'MOFU', 'BOFU')),
  modelo_video  text,
  angulo        text,
  hook_texto    text,                  -- Frase de abertura do criativo
  status        text        not null default 'Em Teste'
                            check (status in ('Validado', 'Em Teste', 'Reprovado')),
  roas          numeric,
  ctr           numeric,
  thumbstop_rate numeric,
  compras       integer,
  cpa           numeric,
  link          text,
  thumbnail_url text,
  observacoes   text,
  created_at    timestamptz not null default now(),
  user_id       uuid        not null references auth.users (id) on delete cascade
);

comment on table  public.biblioteca              is 'Criativos validados — fonte de verdade para IA de planejamento.';
comment on column public.biblioteca.ad_id        is 'ID do anúncio de origem na Meta (quando veio do fluxo Análise → Biblioteca).';
comment on column public.biblioteca.hook_texto   is 'Frase exata de abertura do vídeo. Alimenta a IA de planejamento de hooks.';

create index biblioteca_user_idx         on public.biblioteca (user_id);
create index biblioteca_user_product_idx on public.biblioteca (user_id, product_id);
create index biblioteca_user_funil_idx   on public.biblioteca (user_id, funil);
create index biblioteca_user_status_idx  on public.biblioteca (user_id, status);

alter table public.biblioteca enable row level security;

create policy "biblioteca: owner full access"
  on public.biblioteca for all
  to authenticated using     (auth.uid() = user_id)
                  with check (auth.uid() = user_id);


-- =============================================================
-- 4. PLANO_MENSAL
-- Mapa mental mensal por produto, gerado pela IA e editável.
-- =============================================================

create table public.plano_mensal (
  id             uuid        primary key default gen_random_uuid(),
  mes            text        not null,  -- "YYYY-MM"
  product_id     uuid        references public.products (id) on delete set null,
  gerado_por_ia  boolean     not null default false,
  mapa           jsonb,                 -- Estrutura React Flow: {nodes: [...], edges: [...]}
  anotacoes      text,                  -- Ajustes manuais do gestor
  status         text        not null default 'rascunho'
                             check (status in ('rascunho', 'aprovado')),
  created_at     timestamptz not null default now(),
  user_id        uuid        not null references auth.users (id) on delete cascade
);

comment on table  public.plano_mensal        is 'Planejamento mensal de criativos por produto. Mapa editável gerado pela IA.';
comment on column public.plano_mensal.mes    is 'Formato YYYY-MM. Ex: 2025-07.';
comment on column public.plano_mensal.mapa   is 'Estrutura de nós/arestas compatível com @xyflow/react.';

create index plano_mensal_user_mes_idx on public.plano_mensal (user_id, mes);
create index plano_mensal_product_idx  on public.plano_mensal (product_id);

alter table public.plano_mensal enable row level security;

create policy "plano_mensal: owner full access"
  on public.plano_mensal for all
  to authenticated using     (auth.uid() = user_id)
                  with check (auth.uid() = user_id);


-- =============================================================
-- 5. SOLICITACOES
-- Itens de demanda gerados pelo plano mensal.
-- =============================================================

create table public.solicitacoes (
  id                 uuid        primary key default gen_random_uuid(),
  plano_id           uuid        not null references public.plano_mensal (id) on delete cascade,
  product_id         uuid        references public.products (id) on delete set null,
  tipo               text        not null
                                 check (tipo in ('replicar', 'novo_teste_angulo', 'novo_teste_hook')),
  funil              text        check (funil in ('TOFU', 'MOFU', 'BOFU')),
  modelo_video       text,
  angulo             text,
  hook_sugerido      text,
  baseado_em_ad_id   text,       -- ID do anúncio vencedor de referência
  quantidade         integer,    -- Nº de vídeos solicitados
  justificativa      text,       -- Por que a IA pediu isso
  prioridade         text        check (prioridade in ('alta', 'media', 'baixa')),
  status             text        not null default 'planejado'
                                 check (status in ('planejado', 'solicitado', 'produzido', 'no_ar')),
  created_at         timestamptz not null default now(),
  user_id            uuid        not null references auth.users (id) on delete cascade
);

comment on table  public.solicitacoes                      is 'Itens de demanda de vídeo gerados pelo ai-plan por produto e funil.';
comment on column public.solicitacoes.baseado_em_ad_id     is 'ad_id de referência em meta_ads_cache. Permite à IA consultar fala/cenas do vencedor.';
comment on column public.solicitacoes.hook_sugerido        is 'Texto de abertura proposto pela IA para o novo vídeo.';

create index solicitacoes_plano_idx   on public.solicitacoes (plano_id);
create index solicitacoes_user_idx    on public.solicitacoes (user_id);
create index solicitacoes_product_idx on public.solicitacoes (product_id);

alter table public.solicitacoes enable row level security;

create policy "solicitacoes: owner full access"
  on public.solicitacoes for all
  to authenticated using     (auth.uid() = user_id)
                  with check (auth.uid() = user_id);


-- =============================================================
-- 6. CONFIG
-- Configurações por usuário: modelos, ângulos, benchmarks.
-- Registros com user_id NULL = padrões globais (somente leitura para usuários).
-- =============================================================

create table public.config (
  id       uuid primary key default gen_random_uuid(),
  chave    text not null,
  valor    jsonb not null,
  user_id  uuid references auth.users (id) on delete cascade
);

comment on table  public.config         is 'Pares chave/valor de configuração. user_id NULL = padrão global do sistema.';
comment on column public.config.chave   is 'Exemplos: benchmarks | modelos_video | angulos | mapeamento_meta.';
comment on column public.config.valor   is 'JSON livre. Cada chave define seu próprio schema.';

-- Uma entrada global por chave (user_id NULL) e uma por usuário por chave
create unique index config_chave_global_uniq on public.config (chave)
  where user_id is null;

create unique index config_chave_user_uniq on public.config (chave, user_id)
  where user_id is not null;

alter table public.config enable row level security;

-- Qualquer usuário autenticado lê globais (user_id NULL) + as próprias linhas
create policy "config: read global and own"
  on public.config for select
  to authenticated
  using (user_id is null or auth.uid() = user_id);

-- Usuário só escreve nas próprias linhas (não altera globais)
create policy "config: insert own"
  on public.config for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "config: update own"
  on public.config for update
  to authenticated
  using (auth.uid() = user_id);

create policy "config: delete own"
  on public.config for delete
  to authenticated
  using (auth.uid() = user_id);

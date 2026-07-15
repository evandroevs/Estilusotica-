-- =============================================================
-- 0019 — Classificação de criativos (framework Ecommerce Rocket / ADSUP)
-- -------------------------------------------------------------
-- Cada criativo (vídeo, imagem ou carrossel) é classificado por IA
-- segundo o framework ADSUP: persona, etapa de consciência, ângulo,
-- estrutura (pilar), tipo de gancho e formato. A classificação é feita
-- pela Edge Function `classify-creative` (Claude → fallback Gemini) e
-- gravada aqui via service_role. O frontend apenas LÊ (write-protected),
-- no mesmo padrão de meta_ads_cache.
--
-- Idempotente (if not exists / drop policy if exists) para poder reaplicar
-- com segurança caso um push anterior tenha ficado parcial.
--
-- NOTA: uma tabela `creative_classifications` de um protótipo anterior existia
-- em produção com chave `creative_id` (sem dados reais — só teste). Ela é
-- descartada aqui e recriada com o schema keyed em `ad_id`, alinhado ao
-- restante do projeto (meta_ads_cache, biblioteca).
-- =============================================================

drop table if exists public.creative_classifications cascade;

create table if not exists public.creative_classifications (
  id                        uuid        primary key default gen_random_uuid(),

  -- Identificador do criativo na Meta (mesma chave usada em meta_ads_cache.ad_id)
  ad_id                     text        not null,
  nome_criativo             text,

  -- Resultado da classificação ADSUP
  persona                   text,       -- INS | PRAT | RES | PRECO | PREM | EXP | indeterminado
  etapa_funil               text,       -- INC | PROB | SOL | PROD | CONS | indeterminado
  angulo                    text,       -- DOR | BEN | TRANS | PROVA | COMP | CURIO | AUT | ROT | QC | indeterminado
  pilar_estrutura           text,       -- DSB | FF | ASK | indeterminado
  gancho_tipo               text,       -- pergunta_dor | numero_prova | afirmacao_contraria | segredo_revelado | antes_depois_visual | identificacao_direta | indeterminado
  formato                   text,       -- VIDEO | IMAGEM | CARROSSEL | UGC

  confidence_score          numeric,    -- 0.0 a 1.0
  justificativa             text,       -- 1-2 frases citando trecho que sustenta a classificação
  alinhamento_gancho_angulo boolean,    -- gancho é o recomendado para o ângulo?
  observacao_alinhamento    text,       -- explicação quando alinhamento = false

  -- Metadados
  provider                  text,       -- 'anthropic' | 'gemini' (qual LLM classificou)
  classificado_em           timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- 1 classificação por criativo (permite upsert idempotente por ad_id)
  constraint creative_classifications_ad_id_unique unique (ad_id)
);

comment on table public.creative_classifications is
  'Classificação ADSUP dos criativos (persona/etapa/ângulo/estrutura/gancho/formato). Gravada pela Edge Function classify-creative via service_role.';
comment on column public.creative_classifications.ad_id is
  'ID do anúncio na Meta — mesma chave de meta_ads_cache.ad_id.';
comment on column public.creative_classifications.confidence_score is
  'Confiança da classificação (0.0–1.0). Abaixo de 0.6 os campos tendem a "indeterminado".';
comment on column public.creative_classifications.provider is
  'Provedor de IA que produziu a classificação: anthropic (Claude) ou gemini (fallback).';

create index if not exists creative_classifications_ad_id_idx   on public.creative_classifications (ad_id);
create index if not exists creative_classifications_persona_idx on public.creative_classifications (persona);
create index if not exists creative_classifications_angulo_idx  on public.creative_classifications (angulo);
create index if not exists creative_classifications_formato_idx on public.creative_classifications (formato);

-- ── RLS: leitura para autenticados; escrita apenas via service_role ──────────
alter table public.creative_classifications enable row level security;

-- Frontend LÊ (authenticated). Sem policies de insert/update/delete →
-- somente o service_role (Edge Function) escreve, mesmo padrão de meta_ads_cache.
drop policy if exists "creative_classifications: read for authenticated"
  on public.creative_classifications;
create policy "creative_classifications: read for authenticated"
  on public.creative_classifications for select
  to authenticated using (true);

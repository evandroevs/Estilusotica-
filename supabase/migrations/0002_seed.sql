-- =============================================================
-- Creative Lab v2 — Seed de dados iniciais
-- Executar APÓS 0001_init.sql
-- =============================================================

-- =============================================================
-- PRODUTOS
-- (sem seed — os produtos das óticas serão cadastrados conforme
--  as campanhas de cada conta; os benchmarks abaixo são globais)
-- =============================================================


-- =============================================================
-- CONFIG — BENCHMARKS (globais, user_id NULL)
-- Fonte: seção 4 do PRD
-- =============================================================

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
-- CONFIG — MODELOS DE VÍDEO (globais, user_id NULL)
-- Fonte: seção 5 do PRD
-- =============================================================

insert into public.config (chave, valor, user_id) values (
  'modelos_video',
  '[
    {
      "id": "m1",
      "nome": "React",
      "descricao": "Apresentador reage a conteúdo de referência em tempo real",
      "is_default": true
    },
    {
      "id": "m2",
      "nome": "Narrado",
      "descricao": "Voice-over descrevendo o produto enquanto o visual reforça a mensagem",
      "is_default": true
    },
    {
      "id": "m3",
      "nome": "Low Fi",
      "descricao": "Estética casual e autêntica filmada com celular",
      "is_default": true
    },
    {
      "id": "m4",
      "nome": "Corte Stories",
      "descricao": "Vertical, dinâmico, com textos e transições rápidas",
      "is_default": true
    },
    {
      "id": "m5",
      "nome": "Podcast",
      "descricao": "Conversa longa e aprofundada entre dois apresentadores",
      "is_default": true
    },
    {
      "id": "m6",
      "nome": "Especialista",
      "descricao": "Autoridade falando diretamente para a câmera com credibilidade",
      "is_default": true
    },
    {
      "id": "m7",
      "nome": "Tela Dividida",
      "descricao": "Split screen para comparação antes/depois ou versus concorrente",
      "is_default": true
    },
    {
      "id": "m8",
      "nome": "Chroma Key",
      "descricao": "Fundo removido com cenário artificial ou produto em destaque",
      "is_default": true
    }
  ]'::jsonb,
  null
);


-- =============================================================
-- CONFIG — ÂNGULOS DE COMUNICAÇÃO (globais, user_id NULL)
-- Fonte: seção 5 do PRD + nível de consciência da v1
-- =============================================================

insert into public.config (chave, valor, user_id) values (
  'angulos',
  '[
    {
      "id": "a1",
      "nome": "Dor",
      "psicologia": "Foco no problema e no desconforto atual do público",
      "nivel": "Consciente do Problema",
      "is_default": true
    },
    {
      "id": "a2",
      "nome": "Desejo",
      "psicologia": "Foco na transformação aspiracional e no estado ideal conquistado",
      "nivel": "Consciente da Solução",
      "is_default": true
    },
    {
      "id": "a3",
      "nome": "Medo",
      "psicologia": "Agita as consequências negativas de não agir agora",
      "nivel": "Inconsciente / Consciente do Problema",
      "is_default": true
    },
    {
      "id": "a4",
      "nome": "Prova",
      "psicologia": "Dados, autoridade e resultados comprovados por terceiros",
      "nivel": "Consciente do Produto",
      "is_default": true
    },
    {
      "id": "a5",
      "nome": "Comparação",
      "psicologia": "Produto superior às alternativas existentes no mercado",
      "nivel": "Consciente da Solução / Produto",
      "is_default": true
    },
    {
      "id": "a6",
      "nome": "Contexto Social",
      "psicologia": "Pertencimento, validação social e comportamento de grupo",
      "nivel": "Consciente da Solução",
      "is_default": true
    },
    {
      "id": "a7",
      "nome": "Urgência Legítima",
      "psicologia": "Motivo real e verificável para ação imediata (não manipulação)",
      "nivel": "Consciente da Oferta",
      "is_default": true
    }
  ]'::jsonb,
  null
);

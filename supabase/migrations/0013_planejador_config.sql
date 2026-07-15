-- =============================================================
-- 0013 — Configuração do Planejador Mensal de Criativos
-- =============================================================
-- Parâmetros por produto (meta de validados, capacidade, distribuição
-- de funil) + regras globais. Editável por usuário (linha própria
-- sobrepõe a global, mesmo padrão das demais configs).

insert into public.config (chave, valor, user_id)
select
  'planejador',
  '{
    "produtos": [
      { "codigo": "LMORO",  "nome": "Laranja Moro",   "meta_validados_mes": 10, "taxa_validacao": "auto", "capacidade_producao_max": 30, "distribuicao_funil": { "TOFU": 0.5, "MOFU": 0.3, "BOFU": 0.2 } },
      { "codigo": "TONS",   "nome": "Tons",            "meta_validados_mes": 8,  "taxa_validacao": "auto", "capacidade_producao_max": 25, "distribuicao_funil": { "TOFU": 0.5, "MOFU": 0.3, "BOFU": 0.2 } },
      { "codigo": "VMACA",  "nome": "Vinagre de Maçã", "meta_validados_mes": 10, "taxa_validacao": "auto", "capacidade_producao_max": 30, "distribuicao_funil": { "TOFU": 0.5, "MOFU": 0.3, "BOFU": 0.2 } },
      { "codigo": "JEJOOM", "nome": "Jejoom",          "meta_validados_mes": 10, "taxa_validacao": "auto", "capacidade_producao_max": 30, "distribuicao_funil": { "TOFU": 0.5, "MOFU": 0.3, "BOFU": 0.2 } }
    ],
    "regra_portfolio": { "replicar": 0.7, "variacao": 0.2, "aposta": 0.1 },
    "margem_seguranca": 0.2,
    "taxa_validacao_padrao": 0.35,
    "minimo_testes_para_conclusao": 2,
    "minimo_influs_por_angulo": 2
  }'::jsonb,
  null
where not exists (
  select 1 from public.config where chave = 'planejador' and user_id is null
);

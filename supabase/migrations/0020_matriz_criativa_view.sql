-- =============================================================
-- 0020 — View da Matriz Criativa (Persona × Etapa de consciência)
-- -------------------------------------------------------------
-- Recria a view `matriz_criativa_view` (perdida no cascade do 0019),
-- agora VERSIONADA no repositório e apontando para a nova tabela
-- creative_classifications (keyed em ad_id). Agrega a contagem de
-- criativos classificados por quadrante Persona × Etapa — inclusive
-- os classificados a partir da análise de vídeo (Gemini multimodal).
--
-- security_invoker = on → a view respeita a RLS de creative_classifications
-- (leitura para authenticated). Aggregate de contagem, sem dado sensível.
-- =============================================================

create or replace view public.matriz_criativa_view
with (security_invoker = on) as
select
  cc.persona,
  cc.etapa_funil,
  count(*)::int as qtd
from public.creative_classifications cc
where cc.persona     is not null and cc.persona     <> 'indeterminado'
  and cc.etapa_funil is not null and cc.etapa_funil <> 'indeterminado'
group by cc.persona, cc.etapa_funil;

comment on view public.matriz_criativa_view is
  'Agrega creative_classifications por persona × etapa de consciência (qtd por quadrante). Alimenta a aba Matriz Criativa.';

grant select on public.matriz_criativa_view to authenticated;

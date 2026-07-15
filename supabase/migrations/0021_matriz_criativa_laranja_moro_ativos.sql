-- =============================================================
-- 0021 — Matriz Criativa: só anúncios ATIVOS do produto Laranja Moro
-- -------------------------------------------------------------
-- A Matriz Criativa deve refletir apenas o que está de fato no ar: criativos
-- do produto Laranja Moro cuja campanha está ACTIVE na Meta (effective_status
-- em meta_campaigns, preenchido pelo meta-sync — mesmo padrão já usado no
-- filtro de campanhas da página Análise). Criativos de outros produtos, ou de
-- campanhas pausadas/arquivadas, continuam podendo ser classificados (ex.:
-- pelo botão do modal ou pelo lote do Top Criativos) — eles só não entram
-- nesta agregação.
--
-- Fallback: se meta_campaigns ainda não sincronizou a campanha do anúncio
-- (linha ausente), trata como ativo — mesma lógica de tolerância usada em
-- Análise antes do primeiro sync popular a tabela.
-- =============================================================

create or replace view public.matriz_criativa_view
with (security_invoker = on) as
select
  cc.persona,
  cc.etapa_funil,
  count(*)::int as qtd
from public.creative_classifications cc
join public.meta_ads_cache mac on mac.ad_id = cc.ad_id
join public.products       p   on p.id = mac.product_id
left join public.meta_campaigns mc on mc.campaign_id = mac.campaign_id
where cc.persona     is not null and cc.persona     <> 'indeterminado'
  and cc.etapa_funil is not null and cc.etapa_funil <> 'indeterminado'
  and p.slug = 'laranja-moro'
  and (mc.effective_status is null or mc.effective_status = 'ACTIVE')
group by cc.persona, cc.etapa_funil;

comment on view public.matriz_criativa_view is
  'Agrega creative_classifications por persona × etapa, restrito ao produto Laranja Moro (products.slug) e a campanhas ACTIVE na Meta (meta_campaigns.effective_status; sem linha = trata como ativo). Alimenta a aba Matriz Criativa.';

grant select on public.matriz_criativa_view to authenticated;

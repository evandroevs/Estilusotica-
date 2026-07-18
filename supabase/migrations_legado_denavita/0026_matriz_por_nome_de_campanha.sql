-- =============================================================
-- 0026 — Matriz Criativa: escopo por NOME DA CAMPANHA ("laranja moro")
-- -------------------------------------------------------------
-- A inferência de produto por palavras-chave (product_id) é ambígua em
-- criativos com códigos/nomes mistos (ex.: vídeo de VM rodando com termos
-- que casam com Laranja Moro). A regra do usuário é direta e determinística:
-- a Matriz considera SÓ anúncios de campanhas cujo NOME contém "laranja
-- moro" (case-insensitive, com qualquer separador), que estejam ativas na
-- Meta, e cujo anúncio esteja ativo. product_id sai do escopo da Matriz
-- (continua existindo para o resto do app).
-- =============================================================

create or replace view public.matriz_criativa_view
with (security_invoker = on) as
select
  cc.persona,
  cc.etapa_funil,
  count(*)::int as qtd
from public.creative_classifications cc
join public.meta_ads_cache mac on mac.ad_id = cc.ad_id
left join public.meta_campaigns mc on mc.campaign_id = mac.campaign_id
where cc.persona     is not null and cc.persona     <> 'indeterminado'
  and cc.etapa_funil is not null and cc.etapa_funil <> 'indeterminado'
  and mac.campaign_name ilike '%laranja%moro%'
  and (mc.effective_status  is null or mc.effective_status  = 'ACTIVE')
  and (mac.effective_status is null or mac.effective_status = 'ACTIVE')
group by cc.persona, cc.etapa_funil;

comment on view public.matriz_criativa_view is
  'Agrega creative_classifications por persona × etapa, restrito a anúncios ATIVOS de campanhas ATIVAS cujo nome contém "laranja moro". Alimenta a aba Matriz Criativa.';

grant select on public.matriz_criativa_view to authenticated;

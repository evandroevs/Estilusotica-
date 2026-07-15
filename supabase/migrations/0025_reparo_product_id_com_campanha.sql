-- =============================================================
-- 0025 — Correção do reparo 0024: produto é inferido por ANÚNCIO + CAMPANHA
-- -------------------------------------------------------------
-- O meta-sync infere o produto a partir de `${ad_name} ${campaign_name}`
-- (fullName). O reparo 0024 recomputou usando SÓ ad_name — anúncios cujo
-- produto vem do nome da CAMPANHA (ex.: campanha "Laranja Moro" com anúncios
-- "[Tofu] [Carol] [Vsl]") ficaram com product_id nulo e a Matriz colapsou.
-- Este reparo refaz o cômputo sobre ad_name + campaign_name, com as mesmas
-- regras de precedência (explícitos primeiro; siglas curtas só como token).
-- As classificações (creative_classifications) nunca foram tocadas — com o
-- product_id restaurado, a Matriz volta a agregá-las imediatamente.
-- =============================================================

update public.meta_ads_cache
set product_id = case
  -- explícitos/longos primeiro (não ambíguos)
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '(LARANJAMORO|LARANJA|MORO)'   then (select id from public.products where slug = 'laranja-moro')
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '(VINAGRE|GUMMIES|GUMMY|MACA)' then (select id from public.products where slug = 'vinagre-de-maca')
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '(JEJOOM|JEJU)'                then (select id from public.products where slug = 'jejoom')
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '(DIGESTINO|DIGES)'            then (select id from public.products where slug = 'digestino')
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '\yTONS?\y'                    then (select id from public.products where slug = 'tons')
  -- siglas curtas: apenas token inteiro (\y = word boundary)
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '\yLM\y'                       then (select id from public.products where slug = 'laranja-moro')
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '\yVMG\y'                      then (select id from public.products where slug = 'vinagre-de-maca')
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '\yJEJ\y'                      then (select id from public.products where slug = 'jejoom')
  when (coalesce(ad_name,'') || ' ' || coalesce(campaign_name,'')) ~* '\yDIG\y'                      then (select id from public.products where slug = 'digestino')
  else null
end;

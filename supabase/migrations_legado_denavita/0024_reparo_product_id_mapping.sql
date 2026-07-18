-- =============================================================
-- 0024 — Reparo do mapeamento anúncio → produto em meta_ads_cache
-- -------------------------------------------------------------
-- O inferProductId antigo do meta-sync casava siglas curtas como SUBSTRING
-- ("LM" batia em "...fiLMe...", etc.) e retornava o PRIMEIRO produto na
-- ordem do banco (Laranja Moro é o primeiro do seed) — anúncios de outros
-- produtos (ex.: Tons) caíam no Laranja Moro e vazavam para a Matriz.
--
-- O meta-sync foi corrigido (siglas ≤3 chars só casam como token inteiro;
-- keyword mais longa vence). Este reparo recomputa o product_id de TODAS as
-- linhas já gravadas com as mesmas regras. É seguro sobrescrever: o próprio
-- meta-sync já recomputa product_id em todo upsert de sincronização.
-- Precedência: keywords longas/explícitas primeiro; siglas curtas (token \y)
-- por último.
-- =============================================================

update public.meta_ads_cache
set product_id = case
  -- explícitos/longos primeiro (não ambíguos)
  when ad_name ~* '(LARANJAMORO|LARANJA|MORO)'          then (select id from public.products where slug = 'laranja-moro')
  when ad_name ~* '(VINAGRE|GUMMIES|GUMMY|MACA)'        then (select id from public.products where slug = 'vinagre-de-maca')
  when ad_name ~* '(JEJOOM|JEJU)'                       then (select id from public.products where slug = 'jejoom')
  when ad_name ~* '(DIGESTINO|DIGES)'                   then (select id from public.products where slug = 'digestino')
  when ad_name ~* '\yTONS?\y'                           then (select id from public.products where slug = 'tons')
  -- siglas curtas: apenas token inteiro (\y = word boundary)
  when ad_name ~* '\yLM\y'                              then (select id from public.products where slug = 'laranja-moro')
  when ad_name ~* '\yVMG\y'                             then (select id from public.products where slug = 'vinagre-de-maca')
  when ad_name ~* '\yJEJ\y'                             then (select id from public.products where slug = 'jejoom')
  when ad_name ~* '\yDIG\y'                             then (select id from public.products where slug = 'digestino')
  else null
end
where ad_name is not null;

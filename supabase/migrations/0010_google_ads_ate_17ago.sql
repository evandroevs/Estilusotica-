-- ── Google Ads: atualização de 2026-08-04 a 2026-08-17 ──────────────────
-- Continua de onde o 0005_google_ads_seed.sql parou (cobria até 2026-08-03).
-- Fonte: export do próprio Google Ads (Campanhas → segmentado por dia),
-- contas 554-972-2788 (Estilus Ótica) e 936-153-3015 (Estilus Select),
-- extraído em 2026-08-17. Só as campanhas com veiculação entram.
--
-- Conferência com a interface do Google Ads no momento da extração:
--   Estilus Ótica  → 2.540 impressões · R$ 313,64 · 24 conversões
--   Estilus Select → 5.436 impressões · R$ 460,20 · 39 conversões
--
-- A conta Select não exporta a coluna "Valor de conv."; usamos o número de
-- conversões, que é idêntico ao valor em todas as linhas da outra conta e em
-- todo o seed anterior.

with dados (date, account_id, campaign_id, campaign_name,
            impressions, clicks, cost, conversions, conversion_value) as (
  values
    ('2026-08-04','5549722788','23960641839','Estílus Ótica - Search',215,10,25.19,2,2),
    ('2026-08-04','9361533015','23965718855','Estilus Select Search',148,11,54.19,4,4),
    ('2026-08-05','5549722788','23960641839','Estílus Ótica - Search',108,5,25.12,1,1),
    ('2026-08-05','9361533015','23965718855','Estilus Select Search',252,16,35.79,2,2),
    ('2026-08-06','5549722788','23960641839','Estílus Ótica - Search',235,9,23.84,3,3),
    ('2026-08-06','9361533015','23965718855','Estilus Select Search',183,14,43.29,6,6),
    ('2026-08-07','5549722788','23960641839','Estílus Ótica - Search',125,8,19.28,1,1),
    ('2026-08-07','9361533015','23965718855','Estilus Select Search',87,6,18.14,1,1),
    ('2026-08-08','5549722788','23960641839','Estílus Ótica - Search',159,10,19.78,2,2),
    ('2026-08-08','9361533015','23965718855','Estilus Select Search',202,7,13.11,3,3),
    ('2026-08-09','5549722788','23960641839','Estílus Ótica - Search',293,7,21.72,1,1),
    ('2026-08-09','9361533015','23965718855','Estilus Select Search',158,3,5.21,1,1),
    ('2026-08-10','5549722788','23960641839','Estílus Ótica - Search',283,11,22.09,3,3),
    ('2026-08-10','9361533015','23965718855','Estilus Select Search',395,31,67.79,6.5,6.5),
    ('2026-08-11','5549722788','23960641839','Estílus Ótica - Search',82,8,19.62,1,1),
    ('2026-08-11','9361533015','23965718855','Estilus Select Search',334,24,47.57,3.5,3.5),
    ('2026-08-12','5549722788','23960641839','Estílus Ótica - Search',164,10,19.49,2,2),
    ('2026-08-12','9361533015','23965718855','Estilus Select Search',311,16,36.41,1,1),
    ('2026-08-13','5549722788','23960641839','Estílus Ótica - Search',139,8,20.14,2,2),
    ('2026-08-13','9361533015','23965718855','Estilus Select Search',509,17,34.74,2,2),
    ('2026-08-14','5549722788','23960641839','Estílus Ótica - Search',203,12,19.68,1,1),
    ('2026-08-14','9361533015','23965718855','Estilus Select Search',489,18,29.26,3,3),
    ('2026-08-15','5549722788','23960641839','Estílus Ótica - Search',248,8,17.25,1,1),
    ('2026-08-15','9361533015','23965718855','Estilus Select Search',687,25,27.11,1,1),
    ('2026-08-16','5549722788','23960641839','Estílus Ótica - Search',60,2,23.09,1,1),
    ('2026-08-16','9361533015','23965718855','Estilus Select Search',685,19,8.6,3,3),
    ('2026-08-17','5549722788','23960641839','Estílus Ótica - Search',226,16,37.35,3,3),
    ('2026-08-17','9361533015','23965718855','Estilus Select Search',996,31,38.99,2,2)
),
mapa as (
  -- workspaces já vinculados a cada conta pelo seed — garante que as novas
  -- linhas caiam exatamente nos mesmos workspaces das antigas
  select distinct account_id, workspace_id from public.google_ads_cache
)
insert into public.google_ads_cache
  (workspace_id, date, account_id, campaign_id, campaign_name,
   impressions, clicks, cost, conversions, conversion_value)
select m.workspace_id, d.date::date, d.account_id, d.campaign_id, d.campaign_name,
       d.impressions, d.clicks, d.cost::numeric, d.conversions::numeric, d.conversion_value::numeric
  from dados d
  join mapa m using (account_id)
on conflict (workspace_id, date, account_id, campaign_id) do update set
  campaign_name    = excluded.campaign_name,
  impressions      = excluded.impressions,
  clicks           = excluded.clicks,
  cost             = excluded.cost,
  conversions      = excluded.conversions,
  conversion_value = excluded.conversion_value,
  synced_at        = now();

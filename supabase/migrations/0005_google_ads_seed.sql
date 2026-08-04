-- ── Seed do google_ads_cache — contas Google Ads das lojas ──────────────
-- Estilus Ótica  → conta 5549722788 · Estilus Select → conta 9361533015
-- Período coberto: 2026-05-06 a 2026-08-03 (dias sem veiculação não têm linha).
-- Fonte: Google Ads via Supermetrics, sync de 2026-08-04.

with contas (account_id, loja) as (
  values ('5549722788', 'Estilus Ótica'),
         ('9361533015', 'Estilus Select')
),
mapa as (
  -- todos os workspaces cujo nome bate (ignora acento/caixa) — cobre
  -- as lojas duplicadas por usuário (evandro@ e demo@)
  select c.account_id, w.id as workspace_id
    from contas c
    join public.workspaces w
      on replace(lower(w.nome), 'ó', 'o') = replace(lower(c.loja), 'ó', 'o')
),
dados (date, account_id, campaign_id, campaign_name,
       impressions, clicks, cost, conversions, conversion_value) as (
  values
    ('2026-06-22','9361533015','23965718855','Estilus Select Search',18,0,0,0,0),
    ('2026-06-23','9361533015','23965718855','Estilus Select Search',299,11,40,2,2),
    ('2026-06-24','9361533015','23965718855','Estilus Select Search',72,5,16.38,0,0),
    ('2026-06-25','9361533015','23965718855','Estilus Select Search',456,26,80.87,3,3),
    ('2026-06-26','9361533015','23965718855','Estilus Select Search',355,13,64.0779,0,0),
    ('2026-06-27','9361533015','23965718855','Estilus Select Search',193,10,20.5571,4,4),
    ('2026-06-28','9361533015','23965718855','Estilus Select Search',132,7,22.3691,0,0),
    ('2026-06-29','9361533015','23965718855','Estilus Select Search',189,7,21.1197,1,1),
    ('2026-06-30','9361533015','23965718855','Estilus Select Search',137,11,16.3452,0,0),
    ('2026-07-01','9361533015','23965718855','Estilus Select Search',314,14,23.873,2,2),
    ('2026-07-02','9361533015','23965718855','Estilus Select Search',197,19,21.7797,2,2),
    ('2026-07-03','5549722788','23960641839','Estílus Ótica - Search',188,7,23.68,1,1),
    ('2026-07-03','9361533015','23965718855','Estilus Select Search',130,11,18.29,3,3),
    ('2026-07-04','5549722788','23960641839','Estílus Ótica - Search',157,10,18.71,0,0),
    ('2026-07-04','9361533015','23965718855','Estilus Select Search',221,9,13.3176,2,2),
    ('2026-07-05','5549722788','23960641839','Estílus Ótica - Search',261,9,24.98,0,0),
    ('2026-07-05','9361533015','23965718855','Estilus Select Search',166,10,12.4123,0,0),
    ('2026-07-06','5549722788','23960641839','Estílus Ótica - Search',227,11,17.41,1,1),
    ('2026-07-06','9361533015','23965718855','Estilus Select Search',115,6,33.49,2,2),
    ('2026-07-07','5549722788','23960641839','Estílus Ótica - Search',326,17,14.6353,0,0),
    ('2026-07-07','9361533015','23965718855','Estilus Select Search',249,9,19.13,2,2),
    ('2026-07-08','5549722788','23960641839','Estílus Ótica - Search',503,15,18.48,1,1),
    ('2026-07-08','9361533015','23965718855','Estilus Select Search',97,7,21.28,1,1),
    ('2026-07-09','5549722788','23960641839','Estílus Ótica - Search',489,11,13.62,0,0),
    ('2026-07-09','9361533015','23965718855','Estilus Select Search',186,10,22.5361,3,3),
    ('2026-07-10','5549722788','23960641839','Estílus Ótica - Search',680,23,28.8076,0,0),
    ('2026-07-10','9361533015','23965718855','Estilus Select Search',143,7,19.9019,2,2),
    ('2026-07-11','5549722788','23960641839','Estílus Ótica - Search',539,19,23.07,1,1),
    ('2026-07-11','9361533015','23965718855','Estilus Select Search',98,8,6.8,1,1),
    ('2026-07-12','5549722788','23960641839','Estílus Ótica - Search',36,1,1.23,0,0),
    ('2026-07-12','9361533015','23965718855','Estilus Select Search',219,12,18.6224,2,2),
    ('2026-07-13','5549722788','23960641839','Estílus Ótica - Search',4,0,0,0,0),
    ('2026-07-13','9361533015','23965718855','Estilus Select Search',250,18,39.0992,2,2),
    ('2026-07-14','5549722788','23960641839','Estílus Ótica - Search',2,0,0,0,0),
    ('2026-07-14','9361533015','23965718855','Estilus Select Search',151,11,20.2857,3,3),
    ('2026-07-15','5549722788','23960641839','Estílus Ótica - Search',12,0,0,0,0),
    ('2026-07-15','9361533015','23965718855','Estilus Select Search',149,10,21.4496,2,2),
    ('2026-07-16','5549722788','23960641839','Estílus Ótica - Search',2,0,0,0,0),
    ('2026-07-16','9361533015','23965718855','Estilus Select Search',179,11,22.51,2,2),
    ('2026-07-17','5549722788','23960641839','Estílus Ótica - Search',292,8,41.17,2,2),
    ('2026-07-17','9361533015','23965718855','Estilus Select Search',207,22,33.6206,4,4),
    ('2026-07-18','5549722788','23960641839','Estílus Ótica - Search',474,10,40,2,2),
    ('2026-07-18','9361533015','23965718855','Estilus Select Search',237,19,20.3701,1,1),
    ('2026-07-19','5549722788','23960641839','Estílus Ótica - Search',331,12,39.9487,2,2),
    ('2026-07-19','9361533015','23965718855','Estilus Select Search',268,16,9.0852,1,1),
    ('2026-07-20','5549722788','23960641839','Estílus Ótica - Search',247,6,39.965,2,2),
    ('2026-07-20','9361533015','23965718855','Estilus Select Search',642,22,63.6214,4,4),
    ('2026-07-21','5549722788','23960641839','Estílus Ótica - Search',183,8,51.33,0,0),
    ('2026-07-21','9361533015','23965718855','Estilus Select Search',240,16,55.9825,3,3),
    ('2026-07-22','5549722788','23960641839','Estílus Ótica - Search',83,4,31.1,2,2),
    ('2026-07-22','9361533015','23965718855','Estilus Select Search',185,16,32.8988,3,3),
    ('2026-07-23','5549722788','23960641839','Estílus Ótica - Search',167,7,25.51,1,1),
    ('2026-07-23','9361533015','23965718855','Estilus Select Search',330,10,27.9416,2,2),
    ('2026-07-24','5549722788','23960641839','Estílus Ótica - Search',188,11,20.885,1,1),
    ('2026-07-24','9361533015','23965718855','Estilus Select Search',209,15,34.9366,3,3),
    ('2026-07-25','5549722788','23960641839','Estílus Ótica - Search',115,7,18.7984,2,2),
    ('2026-07-25','9361533015','23965718855','Estilus Select Search',386,20,20.7249,2,2),
    ('2026-07-26','5549722788','23960641839','Estílus Ótica - Search',26,2,3.91,0,0),
    ('2026-07-26','9361533015','23965718855','Estilus Select Search',290,13,17.2413,2,2),
    ('2026-07-27','5549722788','23960641839','Estílus Ótica - Search',6,0,0,0,0),
    ('2026-07-27','9361533015','23965718855','Estilus Select Search',412,12,19.4988,2,2),
    ('2026-07-28','5549722788','23960641839','Estílus Ótica - Search',15,0,0,0,0),
    ('2026-07-28','9361533015','23965718855','Estilus Select Search',845,28,53.4948,3,3),
    ('2026-07-29','5549722788','23960641839','Estílus Ótica - Search',1,1,0.03,0,0),
    ('2026-07-29','9361533015','23965718855','Estilus Select Search',432,25,30.482,4,4),
    ('2026-07-30','9361533015','23965718855','Estilus Select Search',345,17,25.0276,1,1),
    ('2026-07-31','5549722788','23960641839','Estílus Ótica - Search',235,14,39.9666,1,1),
    ('2026-07-31','9361533015','23965718855','Estilus Select Search',198,12,15.5557,3,3),
    ('2026-08-01','5549722788','23960641839','Estílus Ótica - Search',162,7,26.725,3,3),
    ('2026-08-01','9361533015','23965718855','Estilus Select Search',177,9,7.4389,0,0),
    ('2026-08-02','5549722788','23960641839','Estílus Ótica - Search',125,5,28.1665,0,0),
    ('2026-08-02','9361533015','23965718855','Estilus Select Search',329,13,8.1243,1,1),
    ('2026-08-03','5549722788','23960641839','Estílus Ótica - Search',143,7,24.42,3,3),
    ('2026-08-03','9361533015','23965718855','Estilus Select Search',358,15,63.9549,3,3)
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

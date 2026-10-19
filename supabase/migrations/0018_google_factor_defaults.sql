/* Incrementality defaults changed 2026-10-19: Google non-brand 0.75 -> 0.65, Google brand 0.3 -> 0.15, Google brand returning 0.3 -> 0.15
   (brand search is mostly harvested demand; CTC benchmark 0.27 was judged too high, Canon range 0.1 to 0.2). Only clients still on the old default
   are moved; any factor a client set by hand (for example from a geo-holdout test) is left alone. The column default changes for new clients. */

alter table client_settings alter column multipliers set default
  '{"google_nonbrand":0.65,"google_brand":0.15,"google_nonbrand_returning":0.6,"google_brand_returning":0.15,"meta_acquisition":1.2,"meta_returning":0.6,"pinterest":0.3}';

update client_settings set multipliers = jsonb_set(multipliers, '{google_nonbrand}', '0.65') where (multipliers->>'google_nonbrand')::numeric = 0.75;
update client_settings set multipliers = jsonb_set(multipliers, '{google_brand}', '0.15') where (multipliers->>'google_brand')::numeric = 0.3;
update client_settings set multipliers = jsonb_set(multipliers, '{google_brand_returning}', '0.15') where (multipliers->>'google_brand_returning')::numeric = 0.3;

/* Incrementality defaults, second change 2026-10-19. Meta acquisition 1.2 -> 1.15 (analysed accounts sit at 1.1 to 1.15; CTC median 1.14).
   Google returning channels follow Google brand / non-brand, because there is no data by customer segment: google_nonbrand_returning 0.6 -> 0.65
   (google_brand_returning already moved to 0.15 in 0018). Only clients still on the old default are moved; hand-set factors stay. */

alter table client_settings alter column multipliers set default
  '{"google_nonbrand":0.65,"google_brand":0.15,"google_nonbrand_returning":0.65,"google_brand_returning":0.15,"meta_acquisition":1.15,"meta_returning":0.6,"pinterest":0.3}';

update client_settings set multipliers = jsonb_set(multipliers, '{meta_acquisition}', '1.15') where (multipliers->>'meta_acquisition')::numeric = 1.2;
update client_settings set multipliers = jsonb_set(multipliers, '{google_nonbrand_returning}', '0.65') where (multipliers->>'google_nonbrand_returning')::numeric = 0.6;

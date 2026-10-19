/* Creative Score: the zero-spend rate (share of the ads that are active right now that had no spend in the 30 days to p_to).
   creative_active_ads: one row per non-catalog ad whose saved Meta status is ACTIVE, with its spend over the 30 days to p_to (0 when it has no
   ad-days: the sync stores every active ad, see `refreshActiveAds`). Read-only, runs as the caller, so row-level security on meta_ads and
   meta_ad_daily applies. The zero-spend metric was withdrawn 2026-10-19 (the score uses the zero-revenue rate again); this function stays as applied but is no longer called. */

create or replace function public.creative_active_ads(p_client uuid, p_to date)
returns table (ad_id text, spend_30 numeric)
language sql stable set search_path to 'public' as $$
  select a.ad_id,
         coalesce(sum(d.spend) filter (where d.date between p_to - 29 and p_to), 0)
  from meta_ads a
  left join meta_ad_daily d on d.client_id = a.client_id and d.ad_id = a.ad_id and d.date between p_to - 29 and p_to
  where a.client_id = p_client and a.status = 'ACTIVE' and not coalesce(a.is_catalog, false)
  group by a.ad_id;
$$;

revoke execute on function public.creative_active_ads(uuid, date) from public, anon;
grant execute on function public.creative_active_ads(uuid, date) to authenticated;

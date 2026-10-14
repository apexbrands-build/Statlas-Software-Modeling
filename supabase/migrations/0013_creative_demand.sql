/* Creative Score and Creative Demand: read functions over the ad-level tables of migration 0012 (plan 2026-10-13-creative-score-and-demand.md, Task 6).
   All are read-only and run as the caller, so row-level security on meta_ads, meta_ad_daily and clients applies. The browser only ever receives
   these aggregates, never the daily ad rows.

   Launch date of an ad = its Meta creation date in the client's timezone, or its first spend day when Meta did not describe it.
   Catalog ads (is_catalog) are left out of every figure except where a column says catalog.

   creative_launch:     one row per ad of the client (ad_id, name, format, is_catalog, launch_date). Helper for the others.
   creative_ads:        one row per ad launched in the range, with spend and revenue in its first 7 and 30 days and in total.
   creative_months:     per month: non-catalog spend, catalog spend, non-catalog spend on ads launched before the month began (carried),
                        and non-catalog launches by format.
   creative_days:       per day: non-catalog spend and revenue, catalog spend, non-catalog launches by format.
   creative_score_ads:  per non-catalog ad that spent in the 30 days to p_to or launched in them: spend and revenue over those 30 days and
                        spend in four 7-day weeks ending p_to (w1 oldest). */

/* No `set search_path` here on purpose: a SQL function with one cannot be inlined, so every caller would re-run it as a black box. With the
   tables schema-qualified it inlines into the functions below. If the client row is not visible to the caller the timezone subquery gives
   NULL and the launch date falls back to the first spend day. */
create or replace function public.creative_launch(p_client uuid)
returns table (ad_id text, name text, format text, is_catalog boolean, launch_date date)
language sql stable as $$
  select d.ad_id,
         max(a.name),
         coalesce(max(a.format), 'other'),
         coalesce(bool_or(a.is_catalog), false),
         coalesce((max(a.created_at) at time zone (select coalesce(c.timezone, 'UTC') from public.clients c where c.id = p_client))::date, min(d.date))
  from public.meta_ad_daily d
  left join public.meta_ads a on a.client_id = d.client_id and a.ad_id = d.ad_id
  where d.client_id = p_client
  group by d.ad_id;
$$;

create or replace function public.creative_ads(p_client uuid, p_from date, p_to date)
returns table (ad_id text, name text, format text, is_catalog boolean, launch_date date, spend_7d numeric, spend_30d numeric, revenue_30d numeric, spend_total numeric, revenue_total numeric)
language sql stable set search_path to 'public' as $$
  select l.ad_id, l.name, l.format, l.is_catalog, l.launch_date,
         coalesce(sum(d.spend) filter (where d.date >= l.launch_date and d.date <= l.launch_date + 6), 0),
         coalesce(sum(d.spend) filter (where d.date >= l.launch_date and d.date <= l.launch_date + 29), 0),
         coalesce(sum(d.revenue) filter (where d.date >= l.launch_date and d.date <= l.launch_date + 29), 0),
         coalesce(sum(d.spend), 0),
         coalesce(sum(d.revenue), 0)
  from creative_launch(p_client) l
  left join meta_ad_daily d on d.client_id = p_client and d.ad_id = l.ad_id
  where l.launch_date between p_from and p_to
  group by l.ad_id, l.name, l.format, l.is_catalog, l.launch_date;
$$;

create or replace function public.creative_months(p_client uuid, p_from date, p_to date)
returns table (month date, spend numeric, catalog_spend numeric, carried_spend numeric, launched_video int, launched_image int, launched_carousel int, launched_other int)
language sql stable set search_path to 'public' as $$
  with l as (select * from creative_launch(p_client)),
  spent as (
    select date_trunc('month', d.date)::date as m,
           coalesce(sum(d.spend) filter (where not l.is_catalog), 0) as spend,
           coalesce(sum(d.spend) filter (where l.is_catalog), 0) as catalog_spend,
           coalesce(sum(d.spend) filter (where not l.is_catalog and l.launch_date < date_trunc('month', d.date)::date), 0) as carried_spend
    from meta_ad_daily d join l on l.ad_id = d.ad_id
    where d.client_id = p_client and d.date between p_from and p_to
    group by 1
  ),
  launches as (
    select date_trunc('month', launch_date)::date as m,
           (count(*) filter (where format = 'video'))::int as v,
           (count(*) filter (where format = 'image'))::int as i,
           (count(*) filter (where format = 'carousel'))::int as c,
           (count(*) filter (where format = 'other'))::int as o
    from l
    where not is_catalog and launch_date between p_from and p_to
    group by 1
  )
  select coalesce(s.m, n.m), coalesce(s.spend, 0), coalesce(s.catalog_spend, 0), coalesce(s.carried_spend, 0),
         coalesce(n.v, 0), coalesce(n.i, 0), coalesce(n.c, 0), coalesce(n.o, 0)
  from spent s full join launches n on n.m = s.m
  order by 1;
$$;

create or replace function public.creative_days(p_client uuid, p_from date, p_to date)
returns table (date date, spend numeric, revenue numeric, catalog_spend numeric, launched_video int, launched_image int, launched_carousel int, launched_other int)
language sql stable set search_path to 'public' as $$
  with l as (select * from creative_launch(p_client)),
  spent as (
    select d.date as dt,
           coalesce(sum(d.spend) filter (where not l.is_catalog), 0) as spend,
           coalesce(sum(d.revenue) filter (where not l.is_catalog), 0) as revenue,
           coalesce(sum(d.spend) filter (where l.is_catalog), 0) as catalog_spend
    from meta_ad_daily d join l on l.ad_id = d.ad_id
    where d.client_id = p_client and d.date between p_from and p_to
    group by d.date
  ),
  launches as (
    select launch_date as dt,
           (count(*) filter (where format = 'video'))::int as v,
           (count(*) filter (where format = 'image'))::int as i,
           (count(*) filter (where format = 'carousel'))::int as c,
           (count(*) filter (where format = 'other'))::int as o
    from l
    where not is_catalog and launch_date between p_from and p_to
    group by launch_date
  )
  select coalesce(s.dt, n.dt), coalesce(s.spend, 0), coalesce(s.revenue, 0), coalesce(s.catalog_spend, 0),
         coalesce(n.v, 0), coalesce(n.i, 0), coalesce(n.c, 0), coalesce(n.o, 0)
  from spent s full join launches n on n.dt = s.dt
  order by 1;
$$;

create or replace function public.creative_score_ads(p_client uuid, p_to date)
returns table (ad_id text, launch_date date, spend_30 numeric, revenue_30 numeric, w1 numeric, w2 numeric, w3 numeric, w4 numeric)
language sql stable set search_path to 'public' as $$
  select l.ad_id, l.launch_date,
         coalesce(sum(d.spend), 0),
         coalesce(sum(d.revenue), 0),
         coalesce(sum(d.spend) filter (where d.date between p_to - 27 and p_to - 21), 0),
         coalesce(sum(d.spend) filter (where d.date between p_to - 20 and p_to - 14), 0),
         coalesce(sum(d.spend) filter (where d.date between p_to - 13 and p_to - 7), 0),
         coalesce(sum(d.spend) filter (where d.date between p_to - 6 and p_to), 0)
  from creative_launch(p_client) l
  left join meta_ad_daily d on d.client_id = p_client and d.ad_id = l.ad_id and d.date between p_to - 29 and p_to
  where not l.is_catalog
  group by l.ad_id, l.launch_date
  having l.launch_date between p_to - 29 and p_to or coalesce(sum(d.spend), 0) > 0;
$$;

revoke execute on function public.creative_launch(uuid) from public, anon;
revoke execute on function public.creative_ads(uuid, date, date) from public, anon;
revoke execute on function public.creative_months(uuid, date, date) from public, anon;
revoke execute on function public.creative_days(uuid, date, date) from public, anon;
revoke execute on function public.creative_score_ads(uuid, date) from public, anon;
grant execute on function public.creative_launch(uuid) to authenticated;
grant execute on function public.creative_ads(uuid, date, date) to authenticated;
grant execute on function public.creative_months(uuid, date, date) to authenticated;
grant execute on function public.creative_days(uuid, date, date) to authenticated;
grant execute on function public.creative_score_ads(uuid, date) to authenticated;

/* Best Creatives report: server-side ranking of a client's Meta ads for a date range, against the ad-level tables of migration 0012.
   Both functions are read-only and run as the caller, so row-level security on meta_ads and meta_ad_daily applies. Only one page of rows and the
   per-format totals ever reach the browser. `lib/creative/aggregate.ts` is the specification: same filters, same order, same tie-break.

   creative_ads_report:  one row per ad that spent in [p_from, p_to], with its range totals, its first and last spend day, the days it spent,
                         and its spend and revenue in two rolling 7-day windows (they may start before the range; null dates give zeros).
                         Filters: p_format ('all' or a format), p_campaign (case-insensitive 'contains', '' = none), p_catalog ('all', 'exclude',
                         'only'), p_live ('all', 'live' = Meta status ACTIVE, 'not_live'). Order: p_sort value descending with nulls last, then
                         spend descending, then ad id ascending. total_count is the number of ads matching the filters on every row.
                         p_sort: spend, revenue, roas, purchases, estCm (revenue x p_margin - spend, null without a margin), gain (current
                         window spend minus previous). p_limit is clamped to 1-200.
   creative_format_totals: one row per format for the whole account in the range (filters do not apply), plus the two windows. */

create or replace function public.creative_ads_report(
  p_client uuid, p_from date, p_to date,
  p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date,
  p_format text, p_campaign text, p_catalog text, p_live text, p_sort text, p_margin numeric, p_limit int, p_offset int
)
returns table (
  ad_id text, name text, campaign_name text, format text, is_catalog boolean, status text,
  launched date, first_spend date, last_spend date, active_days int,
  spend numeric, revenue numeric, purchases numeric, impressions numeric, clicks numeric,
  cur_spend numeric, cur_revenue numeric, prev_spend numeric, prev_revenue numeric, total_count bigint
)
language plpgsql stable set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_limit int := least(200, greatest(1, coalesce(p_limit, 50)));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_tz text;
  v_lo date := least(p_from, coalesce(p_prev_from, p_from));
  v_hi date := greatest(p_to, coalesce(p_cur_to, p_to));
begin
  if p_sort not in ('spend', 'revenue', 'roas', 'purchases', 'estCm', 'gain') then
    raise exception 'unknown sort %', p_sort;
  end if;
  if p_catalog not in ('all', 'exclude', 'only') then
    raise exception 'unknown catalog filter %', p_catalog;
  end if;
  if p_live not in ('all', 'live', 'not_live') then
    raise exception 'unknown live filter %', p_live;
  end if;
  select coalesce(c.timezone, 'UTC') into v_tz from clients c where c.id = p_client;

  return query
  with agg as (
    select d.ad_id,
           coalesce(sum(d.spend) filter (where d.date between p_from and p_to), 0) as spend,
           coalesce(sum(d.revenue) filter (where d.date between p_from and p_to), 0) as revenue,
           coalesce(sum(d.purchases) filter (where d.date between p_from and p_to), 0) as purchases,
           coalesce(sum(d.impressions) filter (where d.date between p_from and p_to), 0)::numeric as impressions,
           coalesce(sum(d.clicks) filter (where d.date between p_from and p_to), 0)::numeric as clicks,
           min(d.date) filter (where d.date between p_from and p_to and d.spend > 0) as first_spend,
           max(d.date) filter (where d.date between p_from and p_to and d.spend > 0) as last_spend,
           (count(distinct d.date) filter (where d.date between p_from and p_to and d.spend > 0))::int as active_days,
           coalesce(sum(d.spend) filter (where p_cur_from is not null and d.date between p_cur_from and p_cur_to), 0) as cur_spend,
           coalesce(sum(d.revenue) filter (where p_cur_from is not null and d.date between p_cur_from and p_cur_to), 0) as cur_revenue,
           coalesce(sum(d.spend) filter (where p_prev_from is not null and d.date between p_prev_from and p_prev_to), 0) as prev_spend,
           coalesce(sum(d.revenue) filter (where p_prev_from is not null and d.date between p_prev_from and p_prev_to), 0) as prev_revenue
    from meta_ad_daily d
    where d.client_id = p_client and d.date between v_lo and v_hi
    group by d.ad_id
  ),
  j as (
    select g.ad_id,
           coalesce(a.name, g.ad_id) as name,
           a.campaign_name,
           coalesce(a.format, 'other') as format,
           coalesce(a.is_catalog, false) as is_catalog,
           a.status,
           coalesce((a.created_at at time zone coalesce(v_tz, 'UTC'))::date, g.first_spend) as launched,
           g.first_spend, g.last_spend, g.active_days,
           g.spend, g.revenue, g.purchases, g.impressions, g.clicks,
           g.cur_spend, g.cur_revenue, g.prev_spend, g.prev_revenue
    from agg g
    left join meta_ads a on a.client_id = p_client and a.ad_id = g.ad_id
    where g.spend > 0
  ),
  f as (
    select j.* from j
    where (p_format = 'all' or j.format = p_format)
      and (coalesce(p_campaign, '') = '' or position(lower(p_campaign) in lower(coalesce(j.campaign_name, ''))) > 0)
      and (p_catalog = 'all' or (p_catalog = 'only' and j.is_catalog) or (p_catalog = 'exclude' and not j.is_catalog))
      and (p_live = 'all' or (p_live = 'live' and j.status = 'ACTIVE') or (p_live = 'not_live' and j.status is distinct from 'ACTIVE'))
  ),
  r as (
    select f.*,
           (case p_sort
              when 'spend' then f.spend
              when 'revenue' then f.revenue
              when 'purchases' then f.purchases
              when 'roas' then case when f.spend > 0 then f.revenue / f.spend end
              when 'estCm' then case when p_margin is null then null else f.revenue * p_margin - f.spend end
              when 'gain' then f.cur_spend - f.prev_spend
            end)::numeric as sort_value,
           count(*) over () as total_count
    from f
  )
  select r.ad_id, r.name, r.campaign_name, r.format, r.is_catalog, r.status,
         r.launched, r.first_spend, r.last_spend, r.active_days,
         r.spend, r.revenue, r.purchases, r.impressions, r.clicks,
         r.cur_spend, r.cur_revenue, r.prev_spend, r.prev_revenue, r.total_count
  from r
  order by r.sort_value desc nulls last, r.spend desc, r.ad_id collate "C" asc
  limit v_limit offset v_offset;
end $$;

create or replace function public.creative_format_totals(
  p_client uuid, p_from date, p_to date,
  p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
)
returns table (
  format text, ads bigint, spend numeric, revenue numeric, purchases numeric, impressions numeric, clicks numeric,
  cur_spend numeric, cur_revenue numeric, prev_spend numeric, prev_revenue numeric
)
language sql stable set search_path to 'public' as $$
  with per_ad as (
    select d.ad_id,
           coalesce(sum(d.spend) filter (where d.date between p_from and p_to), 0) as spend,
           coalesce(sum(d.revenue) filter (where d.date between p_from and p_to), 0) as revenue,
           coalesce(sum(d.purchases) filter (where d.date between p_from and p_to), 0) as purchases,
           coalesce(sum(d.impressions) filter (where d.date between p_from and p_to), 0)::numeric as impressions,
           coalesce(sum(d.clicks) filter (where d.date between p_from and p_to), 0)::numeric as clicks,
           coalesce(sum(d.spend) filter (where p_cur_from is not null and d.date between p_cur_from and p_cur_to), 0) as cur_spend,
           coalesce(sum(d.revenue) filter (where p_cur_from is not null and d.date between p_cur_from and p_cur_to), 0) as cur_revenue,
           coalesce(sum(d.spend) filter (where p_prev_from is not null and d.date between p_prev_from and p_prev_to), 0) as prev_spend,
           coalesce(sum(d.revenue) filter (where p_prev_from is not null and d.date between p_prev_from and p_prev_to), 0) as prev_revenue
    from meta_ad_daily d
    where d.client_id = p_client
      and d.date between least(p_from, coalesce(p_prev_from, p_from)) and greatest(p_to, coalesce(p_cur_to, p_to))
    group by d.ad_id
  ),
  typed as (
    select p.*, coalesce(a.format, 'other') as format
    from per_ad p
    left join meta_ads a on a.client_id = p_client and a.ad_id = p.ad_id
  )
  select f.format,
         (count(t.ad_id) filter (where t.spend > 0))::bigint,
         coalesce(sum(t.spend), 0), coalesce(sum(t.revenue), 0), coalesce(sum(t.purchases), 0),
         coalesce(sum(t.impressions), 0), coalesce(sum(t.clicks), 0),
         coalesce(sum(t.cur_spend), 0), coalesce(sum(t.cur_revenue), 0),
         coalesce(sum(t.prev_spend), 0), coalesce(sum(t.prev_revenue), 0)
  from (values ('video'), ('image'), ('carousel'), ('other')) as f(format)
  left join typed t on t.format = f.format
  group by f.format
  order by array_position(array['video', 'image', 'carousel', 'other'], f.format);
$$;

revoke execute on function public.creative_ads_report(uuid, date, date, date, date, date, date, text, text, text, text, text, numeric, int, int) from public, anon;
revoke execute on function public.creative_format_totals(uuid, date, date, date, date, date, date) from public, anon;
grant execute on function public.creative_ads_report(uuid, date, date, date, date, date, date, text, text, text, text, text, numeric, int, int) to authenticated;
grant execute on function public.creative_format_totals(uuid, date, date, date, date, date, date) to authenticated;

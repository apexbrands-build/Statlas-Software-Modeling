-- Sample store with made-up numbers: "Kettle & Co Coffee (demo data)".
--
-- Why it exists: the other-sales-channel screens (Home views, channel models, the halo layer) only appear for a
-- store that has other sales channels, and they need data to show anything. This store has both, so every screen
-- can be seen in the live app before a real brand's data is connected.
--
-- How to use it:
--   1. Create the store in the app (Store Settings > Add New Store) with exactly the name above.
--   2. Run this file against the database. It fills the store's own-site days, ad channels, cohorts, other
--      channels' sales and its settings. Running it again updates the same rows and extends the days to yesterday.
--   3. Build the store's plan in the app (Planning), like for any store.
--
-- The numbers follow the demo client in lib/repository/seed.ts (same shapes, different noise).
-- Campaigns are made up from the ad channels' days. Not filled: orders, customers and ads, so the reports built on
-- those stay empty for this store.
-- Needs migrations up to 0022 (channel metrics).
-- It only inserts and updates rows of this one store. To remove the store, see the end of this file.

begin;

create or replace function pg_temp.u(k text) returns float8 language sql immutable
  as $$ select (('x' || substr(md5(k), 1, 8))::bit(32)::bigint)::float8 / 4294967296.0 $$;
create or replace function pg_temp.nz(k text, s float8) returns float8 language sql immutable
  as $$ select 1 + (pg_temp.u(k) - 0.5) * 2 * s $$;

update public.clients set timezone = 'America/New_York', currency = 'USD'
where name = 'Kettle & Co Coffee (demo data)';

-- One row per day: the expected day (season, weekday, growth) and the noisy actuals built on it.
create temp table demo_day on commit drop as
with p as (
  select id as cid from public.clients where name = 'Kettle & Co Coffee (demo data)'
), d as (
  select p.cid, g::date as date from p, generate_series(date '2024-10-01', current_date - 1, interval '1 day') g
), s as (
  select d.*,
    (array[1.05,1.15,1.0,0.95,1.0,0.95,0.9,0.95,1.0,1.05,1.75,1.45])[extract(month from date)::int]::float8 as mseason,
    (array[1.12,1.02,0.94,0.92,0.96,1.0,1.08])[extract(dow from date)::int + 1]::float8 as dow_eff,
    extract(dow from date)::int as dow,
    (date - date '2024-01-01') / 365.0 as years,
    -- Days from the last Friday of November (Black Friday), November only.
    case when extract(month from date) = 11 then
      date - (make_date(extract(year from date)::int, 11, 30)
              - ((extract(dow from make_date(extract(year from date)::int, 11, 30))::int - 5 + 7) % 7))
    end as bf_off
  from d
), e as (
  select s.*,
    mseason * case when bf_off = 0 then 2.4 when bf_off between 1 and 3 then 1.8 when bf_off between -3 and -1 then 1.2 else 1 end as season
  from s
), x as (
  select e.*,
    210.0 * season * dow_eff * power(1.09, years) as orders_e,
    least(0.85, 0.48 * (1 + (season - 1) * 0.15)) as new_share,
    26.0 * (1 + (season - 1) * 0.12) * (1 + years * 0.04) as cac,
    cid::text || '|' || date::text || '|' as k
  from e
), f as (
  select x.*,
    greatest(1, round(orders_e * new_share * pg_temp.nz(k || 'newo', 0.14)))::int as new_orders,
    greatest(0, round(orders_e * (1 - new_share) * pg_temp.nz(k || 'reto', 0.16)))::int as ret_orders,
    orders_e * new_share * cac * pg_temp.nz(k || 'spend', 0.10) as total_spend
  from x
), r as (
  select f.*,
    new_orders * 46 * 0.95 * pg_temp.nz(k || 'newa', 0.04) as new_rev,
    ret_orders * 46 * 1.08 * pg_temp.nz(k || 'reta', 0.05) as ret_rev
  from f
)
select r.*, new_rev + ret_rev as order_rev from r;

-- Own site, one row per day.
insert into public.daily_facts (client_id, date, gross_sales, discounts, net_sales, shipping_collected, tax,
  new_order_revenue, returning_order_revenue, new_orders, returning_orders, refunds, cogs, cogs_unmapped_sales,
  email_revenue, email_campaign_revenue, email_flow_revenue, email_orders, email_sent)
select cid, date,
  round((order_rev - shipping - tax + discounts)::numeric, 2),
  round(discounts::numeric, 2),
  round((order_rev - shipping - tax - refunds)::numeric, 2),
  round(shipping::numeric, 2),
  round(tax::numeric, 2),
  round(new_rev::numeric, 2),
  round(ret_rev::numeric, 2),
  new_orders,
  ret_orders,
  round(refunds::numeric, 2),
  round(((order_rev - shipping - tax - refunds) * 0.34 * pg_temp.nz(k || 'cogs', 0.03))::numeric, 2),
  0,
  round(email_rev::numeric, 2),
  round((email_rev * case when dow in (2, 4) then 0.6 else 0.3 end)::numeric, 2),
  round((email_rev * case when dow in (2, 4) then 0.4 else 0.7 end)::numeric, 2),
  round(email_rev / (46 * 1.05))::int,
  round(case when dow in (2, 4) then 260000 * pg_temp.nz(k || 'sent', 0.15) else 260000 * 0.03 end)::bigint
from (
  select t.*,
    order_rev * 0.07 * pg_temp.nz(k || 'ship', 0.05) as shipping,
    order_rev * 0.06 as tax,
    order_rev * 0.03 * pg_temp.nz(k || 'ref', 0.55) as refunds,
    order_rev * 0.31 * pg_temp.nz(k || 'email', 0.18) as email_rev
  from demo_day t
) a
cross join lateral (select ((a.order_rev - a.shipping - a.tax) / 0.8) * 0.2 * pg_temp.nz(a.k || 'disc', 0.08) as discounts) b
on conflict (client_id, date) do update set
  gross_sales = excluded.gross_sales, discounts = excluded.discounts, net_sales = excluded.net_sales,
  shipping_collected = excluded.shipping_collected, tax = excluded.tax,
  new_order_revenue = excluded.new_order_revenue, returning_order_revenue = excluded.returning_order_revenue,
  new_orders = excluded.new_orders, returning_orders = excluded.returning_orders, refunds = excluded.refunds,
  cogs = excluded.cogs, cogs_unmapped_sales = excluded.cogs_unmapped_sales, email_revenue = excluded.email_revenue,
  email_campaign_revenue = excluded.email_campaign_revenue, email_flow_revenue = excluded.email_flow_revenue,
  email_orders = excluded.email_orders, email_sent = excluded.email_sent, updated_at = now();

-- Ad channels, one row per day and channel.
insert into public.daily_channel_facts (client_id, date, channel, spend, platform_revenue, platform_purchases)
select t.cid, t.date, c.ch,
  round(a.sp::numeric, 2),
  round(b.pr::numeric, 2),
  round((b.pr / (46 * pg_temp.nz(t.k || 'pa-' || c.ch, 0.08)))::numeric, 2)
from demo_day t
cross join (values ('google_nonbrand', 0.22, 2.9), ('google_brand', 0.08, 8.0), ('meta_acquisition', 0.60, 1.7), ('meta_returning', 0.10, 3.4)) as c(ch, mix, roas)
cross join lateral (select t.total_spend * c.mix * pg_temp.nz(t.k || 'sp-' || c.ch, 0.12) as sp) a
cross join lateral (select a.sp * c.roas * pg_temp.nz(t.k || 'pr-' || c.ch, 0.14) as pr) b
on conflict (client_id, date, channel) do update set
  spend = excluded.spend, platform_revenue = excluded.platform_revenue, platform_purchases = excluded.platform_purchases, updated_at = now();

-- Campaigns: each ad channel's day shared out to a few named campaigns, so the trackers and the Paid Media report
-- have rows. The campaigns of a channel add up to the channel's day exactly.
insert into public.ad_spend_daily (client_id, date, platform, campaign_id, campaign_name, category, audience_type, spend, platform_revenue, platform_purchases)
select x.client_id, x.date, x.platform, x.id, x.name, x.category, x.audience,
  round((x.spend * x.ws / sum(x.ws) over w)::numeric, 2),
  round((x.platform_revenue * x.rs / sum(x.rs) over w)::numeric, 2),
  round((x.platform_purchases * x.rs / sum(x.rs) over w)::numeric, 2)
from (
  select f.client_id, f.date, f.channel, f.spend, f.platform_revenue, f.platform_purchases, c.platform, c.id, c.name, c.category, c.audience,
    c.w * pg_temp.nz(f.date::text || '|cw|' || c.id, 0.30) as ws,
    c.w * pg_temp.nz(f.date::text || '|cw|' || c.id, 0.30) * c.eff * pg_temp.nz(f.date::text || '|ce|' || c.id, 0.15) as rs
  from public.daily_channel_facts f
  join (values
    ('meta_acquisition', 'meta', 'demo-m1', 'ACQ | Evergreen | Broad', 'acquisition', 'new', 0.55, 1.05),
    ('meta_acquisition', 'meta', 'demo-m2', 'ACQ | Creative testing', 'acquisition', 'new', 0.20, 0.80),
    ('meta_acquisition', 'meta', 'demo-m3', 'ACQ | Catalog', 'acquisition', 'new', 0.25, 1.05),
    ('meta_returning', 'meta', 'demo-m4', 'RTN | Evergreen', 'retention', 'returning', 0.70, 1.00),
    ('meta_returning', 'meta', 'demo-m5', 'RTN | Promo', 'retention', 'returning', 0.30, 1.00),
    ('google_nonbrand', 'google_ads', 'demo-g1', 'PMax | All products', 'acquisition', 'unknown', 0.60, 1.10),
    ('google_nonbrand', 'google_ads', 'demo-g2', 'Search | NB | Coffee beans', 'acquisition', 'unknown', 0.40, 0.85),
    ('google_brand', 'google_ads', 'demo-g3', 'Search | Brand', 'brand', 'unknown', 1.00, 1.00)
  ) as c(channel, platform, id, name, category, audience, w, eff) on c.channel = f.channel
  where f.client_id = (select id from public.clients where name = 'Kettle & Co Coffee (demo data)')
) x
window w as (partition by x.client_id, x.date, x.channel)
on conflict (client_id, date, platform, campaign_id) do update set
  campaign_name = excluded.campaign_name, category = excluded.category, audience_type = excluded.audience_type,
  spend = excluded.spend, platform_revenue = excluded.platform_revenue, platform_purchases = excluded.platform_purchases;

-- Cohorts: first-order revenue per month, repeat revenue fading with age, for the months that have passed.
-- A period is a 30-day window that sits half in one calendar month and half in the next, so its revenue follows
-- the season of those two months (the busy months carry more repeat orders, as on the own-site days above).
create temp table demo_cohort on commit drop as
with m as (
  select cid, date_trunc('month', date)::date as cohort_month, sum(new_orders)::int as customers, sum(new_rev) as first_revenue
  from demo_day group by 1, 2
)
select m.cid, m.cohort_month, m.customers, m.first_revenue, g.p as period,
  m.first_revenue * (0.09 * power(0.78, g.p - 1) + 0.012)
    * (( (array[1.05,1.15,1.0,0.95,1.0,0.95,0.9,0.95,1.0,1.05,2.0,1.45])[extract(month from m.cohort_month + make_interval(months => g.p - 1))::int]
       + (array[1.05,1.15,1.0,0.95,1.0,0.95,0.9,0.95,1.0,1.05,2.0,1.45])[extract(month from m.cohort_month + make_interval(months => g.p))::int] ) / 2 / 1.1)
    * pg_temp.nz(m.cid::text || '|' || m.cohort_month::text || '|' || g.p::text, 0.15) as revenue
from m
left join lateral generate_series(1, least(36,
  (extract(year from age(date_trunc('month', current_date), m.cohort_month)) * 12
   + extract(month from age(date_trunc('month', current_date), m.cohort_month)))::int)) as g(p) on true;

insert into public.cohort_stats (client_id, cohort_month, customers, first_revenue, rev_60d, rev_365d)
select cid, cohort_month, max(customers), round(max(first_revenue)::numeric, 2),
  round(coalesce(sum(revenue) filter (where period <= 2), 0)::numeric, 2),
  round(coalesce(sum(revenue) filter (where period <= 12), 0)::numeric, 2)
from demo_cohort group by 1, 2
on conflict (client_id, cohort_month) do update set
  customers = excluded.customers, first_revenue = excluded.first_revenue, rev_60d = excluded.rev_60d, rev_365d = excluded.rev_365d;

insert into public.cohort_periods (client_id, cohort_month, period, revenue, orders)
select cid, cohort_month, period, round(revenue::numeric, 2), round(revenue / (46 * 1.08))::int
from demo_cohort where period is not null
on conflict (client_id, cohort_month, period) do update set revenue = excluded.revenue, orders = excluded.orders;

-- Other sales channels. A marketplace sells a base that follows the business plus what its own ads bring
-- (so its model has a line to find), and its ad spend is higher in the busy months, like the own site's.
-- Retail follows the retailer frame in the settings and has no ad spend.
-- Rows loaded through the app's import are left alone.
insert into public.channel_sales (client_id, date, sales_channel, retailer, revenue, orders, units, ad_spend, source)
select cid, date, key, '', round(rev::numeric, 2), round(rev / aov), round(rev / aov * 1.4), round(ad::numeric, 2), 'demo'
from (
  select t.cid, t.date, c.key, c.aov, a.ad,
    t.order_rev * c.share * 0.55 * pg_temp.nz(t.cid::text || '|' || c.key || '|' || t.date::text || '|b', 0.12)
      + a.ad * (0.45 / c.spend_rate) * pg_temp.nz(t.cid::text || '|' || c.key || '|' || t.date::text || '|r', 0.06) as rev
  from demo_day t
  cross join (values ('amazon', 0.34, 0.09, 38.0), ('tiktok_shop', 0.11, 0.16, 29.0)) as c(key, share, spend_rate, aov)
  cross join lateral (select 210 * 46 * c.share * c.spend_rate * t.mseason * pg_temp.nz(t.cid::text || '|' || c.key || '|' || t.date::text || '|s', 0.45) as ad) a
) m
union all
select cid, date, 'retail', 'Target', round(rev::numeric, 2), 0, round(rev / 7), 0, 'demo'
from (
  -- 900 doors x 2.4 units per store per week x $14 on shelf x 50% net = $2,160 a day, a little higher in the busy months.
  select t.cid, t.date, 2160 * (1 + 0.15 * (t.mseason - 1)) * pg_temp.nz(t.cid::text || '|retail|' || t.date::text || '|b', 0.12) as rev
  from demo_day t where t.date >= date '2025-03-01'
) r
on conflict (client_id, date, sales_channel, retailer) do update set
  revenue = excluded.revenue, orders = excluded.orders, units = excluded.units, ad_spend = excluded.ad_spend, updated_at = now()
  where channel_sales.source = 'demo';

-- The platforms' own numbers on the Amazon and TikTok Shop rows (needs migration 0022). They are built from each row's four core
-- numbers with the same shares as the app's demo data (lib/repository/seed.ts), so they always agree with them. A row loaded through
-- the app keeps the values it already has.
update public.channel_sales cs
set metrics = case when cs.source = 'demo' then cs.metrics || x.m else x.m || cs.metrics end
from (
  select b.client_id, b.date, b.sales_channel, b.retailer,
    case b.sales_channel
      when 'amazon' then jsonb_build_object(
        'sp_spend', b.sp, 'sb_spend', b.sb, 'sd_spend', b.sd,
        'sp_sales', a.sp_sales, 'sb_sales', a.sb_sales, 'sd_sales', a.sd_sales,
        'sp_orders', round(a.sp_sales / 38), 'sb_orders', round(a.sb_sales / 38), 'sd_orders', round(a.sd_sales / 38),
        'sp_clicks', round(b.sp / 1.05), 'sb_clicks', round(b.sb / 1.4), 'sd_clicks', round(b.sd / 0.7),
        'sp_impressions', round(round(b.sp / 1.05) / 0.0045), 'sb_impressions', round(round(b.sb / 1.4) / 0.006), 'sd_impressions', round(round(b.sd / 0.7) / 0.002),
        'sb_ntb_sales', round(a.sb_sales * 0.58, 2), 'sb_ntb_orders', round(round(a.sb_sales / 38) * 0.6),
        'sd_ntb_sales', round(a.sd_sales * 0.45, 2), 'sd_ntb_orders', round(round(a.sd_sales / 38) * 0.45),
        'sessions', a.sessions, 'page_views', round(a.sessions * 1.32),
        'buy_box_views', round(round(a.sessions * 1.32) * least(1, 0.975 * pg_temp.nz(b.k || 'bb', 0.015))::numeric),
        'units_refunded', round(b.units * 0.012),
        'sns_sales', round((b.revenue * 0.24 * pg_temp.nz(b.k || 'sns', 0.08))::numeric, 2), 'sns_units', round(b.units * 0.22),
        'active_subscriptions', 4200 + round((b.date - date '2024-01-01') * 1.5))
      else jsonb_build_object(
        'affiliate_gmv', t.affiliate, 'seller_gmv', round(b.revenue - t.affiliate, 2),
        'live_gmv', t.live, 'card_gmv', t.card, 'video_gmv', round(b.revenue - t.live - t.card, 2),
        'ads_gmv', t.ads_gmv, 'ads_orders', round(t.ads_gmv / 29),
        'buyers', round(b.orders * 0.96), 'visitors', t.visitors, 'page_views', round(t.visitors * 1.4), 'add_to_carts', round(t.visitors * 0.11),
        'refunds', round((b.revenue * 0.032 * pg_temp.nz(b.k || 'ref', 0.3))::numeric, 2),
        'creators_with_sales', greatest(1, round((55 * pg_temp.nz(b.k || 'creators', 0.25))::numeric)),
        'videos_posted', round((38 * pg_temp.nz(b.k || 'videos', 0.3))::numeric),
        'lives_held', round((2 * pg_temp.nz(b.k || 'lives', 0.5))::numeric),
        'samples_shipped', round((18 * pg_temp.nz(b.k || 'samples', 0.4))::numeric),
        'affiliate_commission', round(t.affiliate * 0.15, 2))
    end as m
  from (
    select c.client_id, c.date, c.sales_channel, c.retailer, c.revenue, c.orders, c.units, c.ad_spend,
      c.client_id::text || '|' || c.sales_channel || '|' || c.date::text || '|m|' as k,
      round(c.ad_spend * 0.72, 2) as sp, round(c.ad_spend * 0.18, 2) as sb,
      round(c.ad_spend - round(c.ad_spend * 0.72, 2) - round(c.ad_spend * 0.18, 2), 2) as sd
    from public.channel_sales c
    where c.client_id = (select id from public.clients where name = 'Kettle & Co Coffee (demo data)') and c.sales_channel in ('amazon', 'tiktok_shop')
  ) b
  cross join lateral (select
    round((b.sp * 3.6 * pg_temp.nz(b.k || 'sp-sales', 0.1))::numeric, 2) as sp_sales,
    round((b.sb * 4.2 * pg_temp.nz(b.k || 'sb-sales', 0.1))::numeric, 2) as sb_sales,
    round((b.sd * 2.2 * pg_temp.nz(b.k || 'sd-sales', 0.1))::numeric, 2) as sd_sales,
    round((b.units / (0.19 * pg_temp.nz(b.k || 'conv', 0.1)))::numeric) as sessions) a
  cross join lateral (select
    round((b.revenue * least(0.9, 0.58 * pg_temp.nz(b.k || 'aff', 0.1)))::numeric, 2) as affiliate,
    round((b.revenue * 0.12 * pg_temp.nz(b.k || 'live', 0.3))::numeric, 2) as live,
    round((b.revenue * 0.27 * pg_temp.nz(b.k || 'card', 0.1))::numeric, 2) as card,
    round((b.ad_spend * 4.6 * pg_temp.nz(b.k || 'roi', 0.1))::numeric, 2) as ads_gmv,
    round((b.orders * 29 * pg_temp.nz(b.k || 'vis', 0.1))::numeric) as visitors) t
) x
where cs.client_id = x.client_id and cs.date = x.date and cs.sales_channel = x.sales_channel and cs.retailer = x.retailer;

-- Settings: cost of delivery, the three other sales channels and one halo factor (a public benchmark).
-- Written once: later edits made in the app are kept.
update public.client_settings s
set other_variable_pct = 8,
    delivery_cost_per_order = 2,
    extra = coalesce(s.extra, '{}'::jsonb) || jsonb_build_object('halo', '{
      "channels": [
        {"key": "amazon", "label": "Amazon", "kind": "marketplace", "costPct": 62, "aov": 38, "ltv365": 1.6},
        {"key": "tiktok_shop", "label": "TikTok Shop", "kind": "marketplace", "costPct": 70, "aov": 29},
        {"key": "retail", "label": "Retail", "kind": "retail", "costPct": 55, "aov": 14, "netPct": 50,
         "retailers": [{"retailer": "Target", "launchMonth": "2025-03", "doors": 900, "unitsPerStoreWeek": 2.4, "shelfPrice": 14}]}
      ],
      "cells": {"meta_acquisition": {"amazon": {"value": 0.2, "source": "benchmark", "note": "Public benchmark, not this store''s own test"}}}
    }'::jsonb),
    updated_at = now()
where s.client_id in (select cid from demo_day)
  and not (coalesce(s.extra, '{}'::jsonb) ? 'halo');

commit;

-- To remove the sample store completely (run by hand; its plans go with the store):
--   delete from public.channel_sales       where client_id = (select id from public.clients where name = 'Kettle & Co Coffee (demo data)');
--   delete from public.cohort_periods      where client_id = (select id from public.clients where name = 'Kettle & Co Coffee (demo data)');
--   delete from public.cohort_stats        where client_id = (select id from public.clients where name = 'Kettle & Co Coffee (demo data)');
--   delete from public.ad_spend_daily      where client_id = (select id from public.clients where name = 'Kettle & Co Coffee (demo data)');
--   delete from public.daily_channel_facts where client_id = (select id from public.clients where name = 'Kettle & Co Coffee (demo data)');
--   delete from public.daily_facts         where client_id = (select id from public.clients where name = 'Kettle & Co Coffee (demo data)');
--   delete from public.clients             where name = 'Kettle & Co Coffee (demo data)';

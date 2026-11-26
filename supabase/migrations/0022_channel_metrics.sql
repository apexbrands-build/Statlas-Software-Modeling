-- Channel metrics (slice 1 of the operating-system build, 2026-11-26). Additive.
--
-- 1. `channel_sales.metrics`: the platform's own numbers for the day (sessions, ad sales by type, GMV by source and so on), keyed as in
--    the app's metric catalog (lib/omni/metrics.ts). A new metric needs no database change.
-- 2. `channel_sales.period_days`: how many days a row covers, ending on `date` (1 = a day, 7 = a week). Used for retail data that only
--    comes by week.
-- 3. `channel_sales_merge`: saves rows by merging them into what is there, in one statement. A core number that is not given (null)
--    keeps its stored value; metrics are merged key by key. It replaces the app's delete-then-insert, which was not one transaction.
--    It runs with the caller's rights, so the table's row-level rules decide who may write.

alter table public.channel_sales
  add column if not exists metrics jsonb not null default '{}'::jsonb,
  add column if not exists period_days integer not null default 1;

create or replace function public.channel_sales_merge(p_client uuid, p_channel text, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Days that are already there: change only what was given.
  update public.channel_sales t set
    revenue = coalesce(s.revenue, t.revenue),
    orders = coalesce(s.orders, t.orders),
    units = coalesce(s.units, t.units),
    ad_spend = coalesce(s.ad_spend, t.ad_spend),
    metrics = t.metrics || s.metrics,
    source = s.source,
    period_days = coalesce(s.period_days, t.period_days),
    updated_at = now()
  from (
    select (r->>'date')::date as date, coalesce(r->>'retailer', '') as retailer,
      (r->>'revenue')::numeric as revenue, (r->>'orders')::numeric as orders, (r->>'units')::numeric as units, (r->>'ad_spend')::numeric as ad_spend,
      coalesce(r->'metrics', '{}'::jsonb) as metrics, coalesce(r->>'source', 'import') as source, (r->>'period_days')::integer as period_days
    from jsonb_array_elements(p_rows) as r
  ) s
  where t.client_id = p_client and t.sales_channel = p_channel and t.date = s.date and t.retailer = s.retailer;

  -- New days: what was not given starts at zero.
  insert into public.channel_sales (client_id, date, sales_channel, retailer, revenue, orders, units, ad_spend, metrics, source, period_days)
  select p_client, (r->>'date')::date, p_channel, coalesce(r->>'retailer', ''),
    coalesce((r->>'revenue')::numeric, 0), coalesce((r->>'orders')::numeric, 0), coalesce((r->>'units')::numeric, 0), coalesce((r->>'ad_spend')::numeric, 0),
    coalesce(r->'metrics', '{}'::jsonb), coalesce(r->>'source', 'import'), coalesce((r->>'period_days')::integer, 1)
  from jsonb_array_elements(p_rows) as r
  on conflict (client_id, date, sales_channel, retailer) do nothing;

  return jsonb_array_length(p_rows);
end;
$$;

revoke all on function public.channel_sales_merge(uuid, text, jsonb) from public;
grant execute on function public.channel_sales_merge(uuid, text, jsonb) to authenticated, service_role;

/* Hourly report, step 1 (spec docs/superpowers/specs/2026-11-27-hourly-report-design.md). Additive, safe to run again.

   1. orders_by_hour: a store's orders by day and hour of the store's own clock, for a range of days.
      Hour = the hour the order was placed (orders.created_at) in the client's time zone (clients.timezone, UTC when it is not set).
      The day is orders.order_date, which the sync already stores in the store's time zone.
      Same filter as the daily rollup (rebuild_daily_facts, migration 0005): DTC orders with order revenue above zero, new = is_first_order.
      So the hours of a day add up to that day's daily_facts numbers (order revenue, new and returning revenue and orders, gross sales,
      discounts, shipping, tax). Refunds are not here: they are dated by the refund, not by the order.
      last_order_at = the latest order of that hour, so the page can say how far today's orders are loaded.
      Read-only and run as the caller, so row-level security on `orders` and `clients` applies. Hours with no order return no row.

   2. marketing_events.send_time: the time of day of an event or send, on the store's clock (optional). The hourly report puts a send
      on its hour; an event without a time is listed for the day only. */

create or replace function public.orders_by_hour(p_client uuid, p_from date, p_to date)
returns table (
  order_date date,
  hour integer,
  order_revenue numeric,
  new_revenue numeric,
  returning_revenue numeric,
  orders bigint,
  new_orders bigint,
  returning_orders bigint,
  gross_sales numeric,
  discounts numeric,
  shipping_collected numeric,
  tax numeric,
  last_order_at timestamptz
)
language sql stable set search_path to 'public' as $$
  select o.order_date,
         extract(hour from (o.created_at at time zone z.tz))::integer,
         coalesce(sum(o.order_revenue), 0),
         coalesce(sum(o.order_revenue) filter (where o.is_first_order), 0),
         coalesce(sum(o.order_revenue) filter (where not o.is_first_order), 0),
         count(*),
         count(*) filter (where o.is_first_order),
         count(*) filter (where not o.is_first_order),
         coalesce(sum(o.gross_sales), 0),
         coalesce(sum(o.discounts), 0),
         coalesce(sum(o.shipping_collected), 0),
         coalesce(sum(o.tax), 0),
         max(o.created_at)
  from orders o
  cross join (select coalesce((select c.timezone from clients c where c.id = p_client), 'UTC') as tz) z
  where o.client_id = p_client
    and o.is_dtc
    and o.order_revenue > 0
    and o.order_date between p_from and p_to
  group by 1, 2
  order by 1, 2;
$$;

revoke execute on function public.orders_by_hour(uuid, date, date) from public, anon;
grant execute on function public.orders_by_hour(uuid, date, date) to authenticated;

alter table marketing_events add column if not exists send_time time;

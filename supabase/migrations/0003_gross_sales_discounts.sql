/* Store gross sales and discounts in the daily rollup, and let plans forecast them.
   Invariant: net_sales = gross_sales - discounts - refunds. Order revenue = gross - discounts + shipping + tax. */

alter table daily_facts add column if not exists gross_sales numeric not null default 0;
alter table daily_facts add column if not exists discounts numeric not null default 0;

-- Plan targets: the P&L-level lines the forecasting layer will fill (all optional, daily).
alter table plan_targets add column if not exists gross_sales numeric;
alter table plan_targets add column if not exists discounts numeric;
alter table plan_targets add column if not exists shipping numeric;
alter table plan_targets add column if not exists refunds numeric;

create or replace function public.rebuild_daily_facts(p_client uuid, p_from date, p_to date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into daily_facts (client_id, date, gross_sales, discounts, net_sales, shipping_collected, tax, new_order_revenue, returning_order_revenue,
                           new_orders, returning_orders, refunds, cogs, cogs_unmapped_sales, updated_at)
  select p_client, d.day,
         coalesce(o.gross, 0), coalesce(o.disc, 0),
         coalesce(o.rev - o.ship - o.tax, 0) - coalesce(r.returns, 0),
         coalesce(o.ship, 0), coalesce(o.tax, 0),
         coalesce(o.new_rev, 0), coalesce(o.ret_rev, 0),
         coalesce(o.new_n, 0), coalesce(o.ret_n, 0),
         coalesce(r.returns, 0), coalesce(o.cogs, 0), coalesce(o.unmapped, 0), now()
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(ts)
  cross join lateral (select g.ts::date as day) d
  left join (
    select order_date,
           sum(order_revenue) as rev, sum(shipping_collected) as ship, sum(tax) as tax,
           sum(gross_sales) as gross, sum(discounts) as disc,
           sum(order_revenue) filter (where is_first_order) as new_rev,
           sum(order_revenue) filter (where not is_first_order) as ret_rev,
           count(*) filter (where is_first_order) as new_n,
           count(*) filter (where not is_first_order) as ret_n,
           sum(cogs) as cogs, sum(cogs_unmapped_sales) as unmapped
    from orders
    where client_id = p_client and is_dtc and order_date between p_from and p_to
    group by order_date
  ) o on o.order_date = d.day
  left join (
    select rf.refund_date, sum(rf.items_subtotal) as returns
    from order_refunds rf
    join orders x on x.client_id = rf.client_id and x.order_id = rf.order_id
    where rf.client_id = p_client and x.is_dtc and rf.refund_date between p_from and p_to
    group by rf.refund_date
  ) r on r.refund_date = d.day
  on conflict (client_id, date) do update set
    gross_sales = excluded.gross_sales, discounts = excluded.discounts,
    net_sales = excluded.net_sales, shipping_collected = excluded.shipping_collected, tax = excluded.tax,
    new_order_revenue = excluded.new_order_revenue, returning_order_revenue = excluded.returning_order_revenue,
    new_orders = excluded.new_orders, returning_orders = excluded.returning_orders, refunds = excluded.refunds,
    cogs = excluded.cogs, cogs_unmapped_sales = excluded.cogs_unmapped_sales, updated_at = now();
end $function$;

-- Backfill existing days from the stored orders (no need to re-sync Shopify).
update daily_facts f set gross_sales = o.g, discounts = o.d
from (select client_id, order_date, sum(gross_sales) g, sum(discounts) d from orders where is_dtc group by client_id, order_date) o
where f.client_id = o.client_id and f.date = o.order_date;

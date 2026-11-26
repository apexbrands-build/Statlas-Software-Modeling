/* Today's orders: new vs returning within the hour (Hourly report, step 1 item 3; spec docs/superpowers/specs/2026-11-27-hourly-report-design.md).
   Additive, safe to run again.

   The hourly job pulls each store's orders of today (lib/today-pull.ts) and the Hourly report splits them into new and returning by
   hour, so orders.is_first_order has to be right for them straight after each pull. recompute_first_orders (migration 0005) rewrites
   every order of the client on every call, changed or not: fine once a day, too heavy every hour for a store with a long history.

   1. recompute_first_orders_since(p_client, p_since): the same rule, applied only to the customers who have an order placed at or after
      p_since, and to the guest orders placed since then. For each of those customers it reads all their orders, exactly as the full
      function does, and writes only the rows whose flag changes. A customer with no order since p_since is neither read nor written:
      nothing about them changed. Server only (service role), like recompute_first_orders.
      The order_date conditions add nothing to the result (order_date is created_at's day on the store's clock, never more than a day
      from its UTC day); they are there so the existing index on (client_id, order_date) finds the recent orders.
      Until this migration is applied the app falls back to recompute_first_orders (lib/sync/run-shopify.ts, classifySince).

   2. orders_client_customer: an index on (client_id, customer_id), so "every order of these customers" is read by customer instead of
      going through the client's whole order history. */

create or replace function public.recompute_first_orders_since(p_client uuid, p_since timestamptz)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update orders set is_first_order = (order_revenue > 0)
  where client_id = p_client and customer_id is null
    and created_at >= p_since and order_date >= (p_since at time zone 'UTC')::date - 2
    and is_first_order is distinct from (order_revenue > 0);

  update orders o set is_first_order = (o.order_revenue > 0 and o.created_at = c.first_at and coalesce(c.life, 0) - c.n <= 0)
  from (
    select x.customer_id,
           min(x.created_at) filter (where x.order_revenue > 0) as first_at,
           count(*) as n,
           max(x.customer_lifetime_orders) as life
    from orders x
    where x.client_id = p_client
      and x.customer_id in (
        select t.customer_id from orders t
        where t.client_id = p_client and t.customer_id is not null
          and t.created_at >= p_since and t.order_date >= (p_since at time zone 'UTC')::date - 2
      )
    group by x.customer_id
  ) c
  where o.client_id = p_client and o.customer_id = c.customer_id
    and o.is_first_order is distinct from (o.order_revenue > 0 and o.created_at = c.first_at and coalesce(c.life, 0) - c.n <= 0);
end $$;

revoke execute on function public.recompute_first_orders_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.recompute_first_orders_since(uuid, timestamptz) to service_role;

create index if not exists orders_client_customer on orders (client_id, customer_id);

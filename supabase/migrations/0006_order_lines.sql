/* Order line items, for the Product by First Product report.
   Filled by the Shopify sync from now on; run a history reload to backfill older orders. */

create table if not exists order_lines (
  client_id uuid not null references clients(id) on delete cascade,
  order_id text not null,
  line_id text not null,
  product_id text,
  title text not null,
  variant_id text,
  quantity int not null default 1,
  sales numeric not null default 0,
  primary key (client_id, order_id, line_id)
);
create index if not exists order_lines_client_order on order_lines (client_id, order_id);
alter table order_lines enable row level security;
create policy order_lines_read on order_lines for select to authenticated using (public.has_client_access(client_id));

/* One row per product bought in a customer's FIRST paid DTC order (customers whose first order falls in the range).
   Every product in that order gets credit for the customer's whole later behaviour, as Statlas does.
   o1..o4 = orders by sequence (4 = 4th and later), s1..s4 = Order Revenue of those orders. */
create or replace function public.first_product_report(p_client uuid, p_from date, p_to date)
returns table (product text, o1 int, o2 int, o3 int, o4 int, s1 numeric, s2 numeric, s3 numeric, s4 numeric, refund_orders int, refund_amount numeric)
language sql stable set search_path to 'public' as $$
  with paid as (
    select order_id, customer_id, order_date, order_revenue, is_first_order,
           row_number() over (partition by customer_id order by created_at) as seq
    from orders
    where client_id = p_client and is_dtc and order_revenue > 0 and customer_id is not null
  ),
  firsts as (
    select customer_id, order_id as first_order from paid
    where seq = 1 and is_first_order and order_date between p_from and p_to
  ),
  prods as (
    select f.customer_id, max(ol.title) as title
    from firsts f
    join order_lines ol on ol.client_id = p_client and ol.order_id = f.first_order
    group by f.customer_id, f.first_order, coalesce(ol.product_id, ol.title)
  ),
  x as (
    select pr.title, least(p.seq, 4) as b, p.order_revenue,
           (select coalesce(sum(rf.items_subtotal), 0) from order_refunds rf where rf.client_id = p_client and rf.order_id = p.order_id) as refund_amt
    from prods pr join paid p on p.customer_id = pr.customer_id
  )
  select title,
         (count(*) filter (where b = 1))::int, (count(*) filter (where b = 2))::int, (count(*) filter (where b = 3))::int, (count(*) filter (where b = 4))::int,
         coalesce(sum(order_revenue) filter (where b = 1), 0), coalesce(sum(order_revenue) filter (where b = 2), 0),
         coalesce(sum(order_revenue) filter (where b = 3), 0), coalesce(sum(order_revenue) filter (where b = 4), 0),
         (count(*) filter (where refund_amt > 0))::int, coalesce(sum(refund_amt), 0)
  from x group by title
  order by count(*) filter (where b = 1) desc
  limit 1000;
$$;
grant execute on function public.first_product_report(uuid, date, date) to authenticated;

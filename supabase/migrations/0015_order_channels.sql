/* Store Settings > Edit > Channels: the sales channels found on a client's orders, so the switches list the store's real channels
   (for example "Online Store", "Draft Orders" or an import app such as "Matrixify App") instead of a fixed list.
   Read-only and run as the caller, so row-level security on `orders` applies. Counts every order, whether or not its channel is switched on. */

create or replace function public.order_channels(p_client uuid)
returns table (channel text, orders bigint, revenue numeric)
language sql stable set search_path to 'public' as $$
  select sales_channel, count(*), coalesce(sum(order_revenue), 0)
  from orders
  where client_id = p_client and sales_channel is not null and trim(sales_channel) <> ''
  group by sales_channel
  order by count(*) desc, sales_channel;
$$;

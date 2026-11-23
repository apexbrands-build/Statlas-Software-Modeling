/* Sales of a client's other sales channels (Amazon, TikTok Shop, retail): one row per client, day, channel and retailer.
   Filled by a file import in Store Settings, by a roll-up of synced Shopify orders, and later by connectors.
   `sales_channel` is the key of the channel in the client's settings (client_settings.extra -> halo -> channels).
   Additive: nothing existing changes. Read and written from the browser, under the same access rule as the other client tables. */

create table if not exists channel_sales (
  client_id uuid not null references clients(id) on delete cascade,
  date date not null,
  sales_channel text not null,
  retailer text not null default '',
  revenue numeric not null default 0,
  orders numeric not null default 0,
  units numeric not null default 0,
  ad_spend numeric not null default 0,
  source text not null default 'import',
  updated_at timestamptz not null default now(),
  primary key (client_id, date, sales_channel, retailer)
);

alter table channel_sales enable row level security;

create policy channel_sales_read on channel_sales for select to authenticated using (public.has_client_access(client_id));
create policy channel_sales_insert on channel_sales for insert to authenticated with check (public.has_client_access(client_id));
create policy channel_sales_update on channel_sales for update to authenticated using (public.has_client_access(client_id)) with check (public.has_client_access(client_id));
create policy channel_sales_delete on channel_sales for delete to authenticated using (public.has_client_access(client_id));

/* A channel fed by Shopify sales channels (for example TikTok Shop orders synced into Shopify): their orders by day.
   Read-only and run as the caller, so row-level security on `orders` applies. The app saves the result into channel_sales. */
create or replace function public.channel_sales_from_orders(p_client uuid, p_channels text[], p_from date, p_to date)
returns table (date date, revenue numeric, orders bigint)
language sql stable set search_path to 'public' as $$
  select o.order_date, coalesce(sum(o.order_revenue), 0), count(*)
  from orders o
  where o.client_id = p_client
    and o.order_date between p_from and p_to
    and o.order_revenue > 0
    and lower(trim(o.sales_channel)) = any (select lower(trim(c)) from unnest(p_channels) as c)
  group by o.order_date
  order by o.order_date;
$$;

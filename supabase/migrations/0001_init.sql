-- Apex dashboard schema. Every data table carries client_id and is protected by row-level security:
-- signed-in users read only clients they have access to (admins read all).
-- Writes from connectors/sync jobs use the service role key on the server only. Tokens live in
-- integration_secrets, which no browser client can read.

create extension if not exists pgcrypto;

/* ---------- people and access ---------- */

create table pods (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  pod_id uuid references pods(id),
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'USD',
  timezone text not null default 'UTC',
  pod_id uuid references pods(id),
  revenue_definition text not null default 'order_revenue',
  created_at timestamptz not null default now()
);

create table client_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  primary key (user_id, client_id)
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.has_client_access(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (select 1 from client_access where user_id = auth.uid() and client_id = cid)
    or exists (
      select 1 from profiles p join clients c on c.pod_id = p.pod_id
      where p.id = auth.uid() and c.id = cid and p.pod_id is not null
    );
$$;

-- Only @apexbrands.io accounts may sign up; the first admin is admin@apexbrands.io.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) not like '%@apexbrands.io' then
    raise exception 'Sign-up is restricted to apexbrands.io accounts';
  end if;
  insert into profiles (id, email, role)
  values (new.id, lower(new.email), case when lower(new.email) = 'admin@apexbrands.io' then 'admin' else 'member' end);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

/* ---------- connections ---------- */

create table integrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  provider text not null check (provider in ('shopify','meta','google_ads','pinterest','klaviyo','ga4','tiktok','postscript','other')),
  account_id text not null,          -- shop domain, ad account id, customer id...
  account_name text,
  status text not null default 'pending' check (status in ('pending','connected','error','disconnected')),
  coverage_start date,
  coverage_end date,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (client_id, provider, account_id)
);

-- Encrypted credentials (AES-GCM, key in server env). RLS on with no policies = server (service role) only.
create table integration_secrets (
  integration_id uuid primary key references integrations(id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  integration_id uuid references integrations(id) on delete set null,
  provider text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','error')),
  rows_written int,
  message text
);

/* ---------- commerce data (Shopify) ---------- */

create table customers (
  client_id uuid not null references clients(id) on delete cascade,
  customer_id text not null,
  first_order_date date,
  primary key (client_id, customer_id)
);

create table orders (
  client_id uuid not null references clients(id) on delete cascade,
  order_id text not null,
  customer_id text,
  created_at timestamptz not null,
  order_date date not null,             -- in the store timezone
  sales_channel text,
  tags text[] not null default '{}',
  gross_sales numeric not null default 0,
  discounts numeric not null default 0,
  shipping_collected numeric not null default 0,
  tax numeric not null default 0,
  refunds numeric not null default 0,   -- deducted from net sales
  cogs numeric not null default 0,
  is_first_order boolean not null default false,
  is_dtc boolean not null default true,
  primary key (client_id, order_id)
);
create index orders_client_date on orders (client_id, order_date);

create table products (
  client_id uuid not null references clients(id) on delete cascade,
  variant_id text not null,
  title text,
  sku text,
  unit_cost numeric,
  cost_source text not null default 'shopify' check (cost_source in ('shopify','inputted','csv')),
  primary key (client_id, variant_id)
);

/* ---------- daily rollups the dashboard reads (mirror lib/types.ts) ---------- */

create table daily_facts (
  client_id uuid not null references clients(id) on delete cascade,
  date date not null,
  net_sales numeric not null default 0,            -- gross - discounts - refunds
  shipping_collected numeric not null default 0,
  tax numeric not null default 0,
  new_order_revenue numeric not null default 0,    -- Order Revenue (refunds not deducted)
  returning_order_revenue numeric not null default 0,
  new_orders int not null default 0,
  returning_orders int not null default 0,
  refunds numeric not null default 0,
  cogs numeric not null default 0,
  email_revenue numeric not null default 0,
  email_campaign_revenue numeric not null default 0,
  email_flow_revenue numeric not null default 0,
  email_orders int not null default 0,
  email_sent bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (client_id, date)
);

create table daily_channel_facts (
  client_id uuid not null references clients(id) on delete cascade,
  date date not null,
  channel text not null check (channel in ('google_nonbrand','google_brand','meta_acquisition','meta_returning','pinterest')),
  spend numeric not null default 0,
  platform_revenue numeric not null default 0,     -- 7-day click attribution
  platform_purchases numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (client_id, date, channel)
);

-- Raw campaign-level spend; category and audience are derived at ingest
-- (brand = campaign name contains the client's brand keyword; Meta returning = existing-customer audience).
create table ad_spend_daily (
  client_id uuid not null references clients(id) on delete cascade,
  date date not null,
  platform text not null,
  campaign_id text not null,
  campaign_name text,
  category text not null default 'acquisition' check (category in ('acquisition','brand','retention','test')),
  audience_type text not null default 'unknown' check (audience_type in ('new','returning','unknown')),
  spend numeric not null default 0,
  platform_revenue numeric not null default 0,
  platform_purchases numeric not null default 0,
  clicks bigint,
  impressions bigint,
  primary key (client_id, date, platform, campaign_id)
);

/* ---------- settings ---------- */

create table client_settings (
  client_id uuid primary key references clients(id) on delete cascade,
  multipliers jsonb not null default '{"google_nonbrand":0.75,"google_brand":0.3,"meta_acquisition":1.2,"meta_returning":0.6,"pinterest":0.3}',
  other_variable_pct numeric not null default 0,      -- cost of delivery, % of net sales + shipping
  delivery_cost_per_order numeric not null default 0,
  monthly_fixed_costs numeric not null default 0,     -- P&L only, not part of contribution margin
  attribution_window text not null default '7d_click',
  brand_campaign_keyword text not null default 'branded',
  dtc_channels text[] not null default '{"Online Store","Shop"}',
  excluded_order_tags text[] not null default '{}',
  exclude_brand_from_amer boolean not null default false,
  exclude_meta_returning_from_amer boolean not null default false,
  updated_at timestamptz not null default now()
);

/* ---------- plans and calendar (later phases) ---------- */

create table plan_versions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table plan_targets (
  plan_id uuid not null references plan_versions(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  date date not null,
  order_revenue numeric,
  new_revenue numeric,
  returning_revenue numeric,
  orders numeric,
  new_orders numeric,
  spend numeric,
  cm numeric,
  spend_by_channel jsonb not null default '{}',
  primary key (plan_id, date)
);

create table marketing_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  date date not null,
  end_date date,
  category text not null,
  title text not null,
  source text not null default 'manual' check (source in ('manual','klaviyo','sms','import')),
  created_at timestamptz not null default now()
);

/* ---------- row-level security ---------- */

alter table pods enable row level security;
alter table profiles enable row level security;
alter table clients enable row level security;
alter table client_access enable row level security;
alter table integration_secrets enable row level security;   -- no policies: server only

create policy pods_read on pods for select to authenticated using (true);
create policy profiles_read_self on profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy clients_read on clients for select to authenticated using (public.has_client_access(id));
create policy client_access_read on client_access for select to authenticated using (user_id = auth.uid() or public.is_admin());

do $$
declare t text;
begin
  foreach t in array array[
    'integrations','sync_runs','customers','orders','products','daily_facts','daily_channel_facts',
    'ad_spend_daily','client_settings','plan_versions','plan_targets','marketing_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (public.has_client_access(client_id))',
      t || '_read', t);
  end loop;
end $$;

-- Settings are editable by people who can access the client.
create policy client_settings_write on client_settings for insert to authenticated
  with check (public.has_client_access(client_id));
create policy client_settings_update on client_settings for update to authenticated
  using (public.has_client_access(client_id)) with check (public.has_client_access(client_id));

/* ---------- function permissions (applied as a second migration on the live project) ---------- */
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.has_client_access(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_client_access(uuid) to authenticated;

/* ---------- applied later as migration "shopify_returns_and_cogs_coverage" ---------- */
alter table orders add column if not exists order_revenue numeric not null default 0;
alter table orders add column if not exists cogs_unmapped_sales numeric not null default 0;
alter table daily_facts add column if not exists cogs_unmapped_sales numeric not null default 0;
alter table client_settings add column if not exists cogs_fallback_pct numeric not null default 0;

create table if not exists order_refunds (
  client_id uuid not null references clients(id) on delete cascade,
  refund_id text not null,
  order_id text not null,
  refund_date date not null,
  created_at timestamptz not null,
  total_refunded numeric not null default 0,
  items_subtotal numeric not null default 0,
  primary key (client_id, refund_id)
);
create index if not exists order_refunds_client_date on order_refunds (client_id, refund_date);
alter table order_refunds enable row level security;
create policy order_refunds_read on order_refunds for select to authenticated using (public.has_client_access(client_id));

/* ---------- applied later as migration "settings_extra_and_flat_cogs" ---------- */
alter table client_settings add column if not exists extra jsonb not null default '{}'::jsonb;
alter table client_settings add column if not exists cogs_flat_rate boolean not null default false;

/* ---------- applied later as migration "more_channel_keys" ---------- */
alter table daily_channel_facts drop constraint if exists daily_channel_facts_channel_check;
alter table daily_channel_facts add constraint daily_channel_facts_channel_check check (channel in (
  'google_nonbrand','google_brand','meta_acquisition','meta_returning',
  'pinterest','pinterest_returning','youtube','youtube_returning','bing','bing_returning',
  'applovin','applovin_returning','tiktok','tiktok_returning','snapchat','snapchat_returning'));

/* ---------- applied later as migration "agency_secrets" ---------- */
create table if not exists agency_secrets (
  provider text primary key,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);
alter table agency_secrets enable row level security;

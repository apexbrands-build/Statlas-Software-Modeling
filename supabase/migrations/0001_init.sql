-- Apex dashboard schema (Phase 1). Not applied yet: the beta runs on seed data
-- behind lib/repository. Every data table carries client_id and is protected by RLS
-- so a pod only sees its own clients.

create extension if not exists "pgcrypto";

create table pods (
  id uuid primary key default gen_random_uuid(),
  name text not null
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

-- Supabase auth users map to pods; client_access lists which clients a user can read.
create table pod_members (
  user_id uuid not null,
  pod_id uuid not null references pods(id),
  role text not null default 'member',
  primary key (user_id, pod_id)
);

create table client_access (
  user_id uuid not null,
  client_id uuid not null references clients(id),
  primary key (user_id, client_id)
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  provider text not null check (provider in ('shopify','meta','google_ads','pinterest','klaviyo','ga4','tiktok','postscript','other')),
  account_id text,
  status text not null default 'pending',
  coverage_start date,
  coverage_end date,
  -- Tokens are stored encrypted server-side only (Vault / app-level encryption); never sent to the browser.
  credentials_ref text,
  created_at timestamptz not null default now()
);

create table customers (
  client_id uuid not null references clients(id),
  customer_id text not null,
  first_order_date date,
  primary key (client_id, customer_id)
);

create table orders (
  client_id uuid not null references clients(id),
  order_id text not null,
  customer_id text,
  created_at timestamptz not null,
  sales_channel text,
  tags text[] default '{}',
  gross_sales numeric not null default 0,
  discounts numeric not null default 0,
  shipping_collected numeric not null default 0,
  tax numeric not null default 0,
  refunds numeric not null default 0,
  is_first_order boolean not null default false,
  is_dtc boolean not null default true,
  primary key (client_id, order_id)
);

create table products (
  client_id uuid not null references clients(id),
  variant_id text not null,
  title text,
  sku text,
  unit_cost numeric,
  cost_source text not null default 'shopify' check (cost_source in ('shopify','inputted','csv')),
  primary key (client_id, variant_id)
);

create table variant_cost_history (
  client_id uuid not null,
  variant_id text not null,
  effective_from date not null,
  unit_cost numeric not null,
  primary key (client_id, variant_id, effective_from),
  foreign key (client_id, variant_id) references products(client_id, variant_id)
);

create table order_items (
  client_id uuid not null references clients(id),
  order_id text not null,
  variant_id text not null,
  quantity int not null,
  unit_price numeric not null,
  primary key (client_id, order_id, variant_id),
  foreign key (client_id, order_id) references orders(client_id, order_id)
);

create table ad_spend_daily (
  client_id uuid not null references clients(id),
  date date not null,
  platform text not null,
  campaign_id text not null,
  campaign_name text,
  -- Derived at ingest: brand if campaign name contains the client's brand keyword; Meta returning = existing-customer audience.
  category text not null default 'acquisition' check (category in ('acquisition','brand','retention','test')),
  audience_type text not null default 'unknown' check (audience_type in ('new','returning','unknown')),
  spend numeric not null default 0,
  platform_revenue numeric not null default 0, -- 7-day click attribution
  platform_purchases numeric not null default 0,
  clicks bigint,
  impressions bigint,
  primary key (client_id, date, platform, campaign_id)
);

create table email_daily (
  client_id uuid not null references clients(id),
  date date not null,
  source text not null default 'klaviyo',
  campaign_revenue numeric not null default 0,
  flow_revenue numeric not null default 0,
  orders int not null default 0,
  sent bigint not null default 0,
  primary key (client_id, date, source)
);

-- Materialised daily rollup recomputed by scheduled jobs. Every value carries its source.
create table metrics_daily (
  client_id uuid not null references clients(id),
  date date not null,
  metric text not null,
  value numeric,
  source text not null check (source in ('shopify','platform','klaviyo','derived','settings')),
  primary key (client_id, date, metric)
);

create table cost_settings (
  client_id uuid primary key references clients(id),
  other_variable_pct numeric not null default 0,
  shipping_cost_per_order numeric not null default 0,
  monthly_fixed_costs numeric not null default 0,
  effective_from date not null default current_date
);

create table store_settings (
  client_id uuid primary key references clients(id),
  attribution_window text not null default '7d_click',
  brand_campaign_keyword text not null default 'branded',
  dtc_channels text[] not null default '{"Online Store","Shop"}',
  excluded_order_tags text[] not null default '{}',
  exclude_brand_from_amer boolean not null default false,
  exclude_meta_returning_from_amer boolean not null default false
);

-- Incrementality (iROAS) factors, editable per client.
create table incrementality_factors (
  client_id uuid not null references clients(id),
  channel text not null check (channel in ('google_nonbrand','google_brand','meta_acquisition','meta_returning','pinterest')),
  multiplier numeric not null check (multiplier >= 0),
  primary key (client_id, channel)
);

create table plan_versions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table plan_targets (
  plan_id uuid not null references plan_versions(id),
  client_id uuid not null references clients(id),
  date date not null,
  order_revenue numeric,
  new_revenue numeric,
  returning_revenue numeric,
  orders numeric,
  new_orders numeric,
  spend numeric,
  cm numeric,
  spend_by_channel jsonb default '{}',
  primary key (plan_id, date)
);

-- Marketing calendar: past events inferred from Klaviyo/SMS sends, future initiatives entered by the team.
create table marketing_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  date date not null,
  end_date date,
  category text not null, -- promotion, product_launch, pr, vip_drop, email, sms, creative, funnel, other
  title text not null,
  source text not null default 'manual' check (source in ('manual','klaviyo','sms','import')),
  created_at timestamptz not null default now()
);

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  provider text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  message text
);

-- Row-level security: a user reads only clients listed in client_access.
do $$
declare t text;
begin
  foreach t in array array[
    'integrations','customers','orders','products','variant_cost_history','order_items','ad_spend_daily',
    'email_daily','metrics_daily','cost_settings','store_settings','incrementality_factors',
    'plan_versions','plan_targets','marketing_events','sync_runs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select using (client_id in (select client_id from client_access where user_id = auth.uid()))',
      t || '_read', t);
  end loop;
end $$;

alter table clients enable row level security;
create policy clients_read on clients for select
  using (id in (select client_id from client_access where user_id = auth.uid()));

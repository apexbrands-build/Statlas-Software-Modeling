/* Ad-level Meta data (creative stage 1, plan 2026-10-12-creative-ad-data.md).
   meta_ads:      one row per ad (name, campaign, launch date, format, catalog flag, status).
   meta_ad_daily: one row per ad and day with spend, impressions, clicks, purchases and revenue; rows only on days with spend.
   Only ids, names, dates, formats and metrics are stored: no images, texts or audiences. Written by the service role (the Meta sync);
   read by people who can access the client (row-level security). */

create table if not exists meta_ads (
  client_id uuid not null references clients(id) on delete cascade,
  ad_id text not null,
  name text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  created_at timestamptz,
  format text not null default 'other' check (format in ('video', 'image', 'carousel', 'other')),
  is_catalog boolean not null default false,
  status text,
  updated_at timestamptz not null default now(),
  primary key (client_id, ad_id)
);

create table if not exists meta_ad_daily (
  client_id uuid not null references clients(id) on delete cascade,
  ad_id text not null,
  date date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  purchases numeric not null default 0,
  revenue numeric not null default 0,
  primary key (client_id, ad_id, date)
);
create index if not exists meta_ad_daily_client_date on meta_ad_daily (client_id, date);

alter table meta_ads enable row level security;
alter table meta_ad_daily enable row level security;
create policy meta_ads_read on meta_ads for select to authenticated using (public.has_client_access(client_id));
create policy meta_ad_daily_read on meta_ad_daily for select to authenticated using (public.has_client_access(client_id));

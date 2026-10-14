/* Ad-level Meta data (creative stage 1, plan 2026-10-12-creative-ad-data.md).
   meta_ads:      one row per ad (name, campaign, launch date, format, catalog flag, status).
   meta_ad_daily: one row per ad and day with spend, impressions, clicks, purchases and revenue; rows only on days with spend.
   Only ids, names, dates, formats and metrics are stored: no images, texts or audiences. Written by the service role (the Meta sync);
   read by people who can access the client (row-level security). */

create table if not exists meta_ads (
  client_id uuid not null references clients(id) on delete cascade,
  /* The ad account the ad was read from: a client can have several Meta accounts, and a sync only clears its own. */
  account_id text not null,
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
  account_id text not null,
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

/* Re-flags every saved ad of a client against the current catalog keywords (comma separated, any case; none flags nothing), so a changed
   keyword list reaches old ads and not only the ads of the window being synced. Called at the start of each Meta sync. */
create or replace function public.refresh_meta_ad_catalog(p_client uuid, p_keywords text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  with kw as (
    select btrim(lower(x)) as k from unnest(string_to_array(coalesce(p_keywords, ''), ',')) as x
  ), words as (
    select k from kw where k <> ''
  )
  update meta_ads a
     set is_catalog = exists (select 1 from words w where strpos(lower(coalesce(a.campaign_name, '')), w.k) > 0)
   where a.client_id = p_client
     and a.is_catalog is distinct from exists (select 1 from words w where strpos(lower(coalesce(a.campaign_name, '')), w.k) > 0);
$$;
revoke execute on function public.refresh_meta_ad_catalog(uuid, text) from public, anon, authenticated;
grant execute on function public.refresh_meta_ad_catalog(uuid, text) to service_role;

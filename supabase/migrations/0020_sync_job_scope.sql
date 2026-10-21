-- Background sync jobs get a scope: 'all' (everything the provider pulls, the default), 'campaign' (campaign-level spend only)
-- or 'ads' (ad-level / creative data only). A Meta history load runs campaign first (fast, what forecasting needs) and then
-- queues the ad-level load as its own job. Additive: existing rows and old code keep working with the default.
alter table sync_jobs add column if not exists scope text not null default 'all' check (scope in ('all','campaign','ads'));

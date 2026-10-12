/* Connector foundation (spec 2026-10-11-connector-foundation-design.md).
   1) Allow every provider the app has a slot for (omnisend, bing, snapchat, youtube and applovin were missing).
   2) Count consecutive failed daily syncs per connection; Store Settings shows "Needs attention" at 2 or more.
   Additive only: no data is changed. */

alter table integrations drop constraint if exists integrations_provider_check;
alter table integrations add constraint integrations_provider_check
  check (provider in ('shopify','meta','google_ads','pinterest','tiktok','bing','snapchat','youtube','applovin','klaviyo','postscript','omnisend','ga4','other'));

alter table integrations add column if not exists consecutive_failures int not null default 0;

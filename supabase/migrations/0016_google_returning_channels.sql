/* Google campaigns tagged for returning customers (ACQ / RTN in the campaign name, see the Google sync) get two more channels next to
   google_nonbrand and google_brand: google_nonbrand_returning and google_brand_returning. Additive: the channel check on daily_channel_facts
   accepts them, and every client's incrementality factors get the defaults for them (0.6 and 0.3, like Meta returning and Google brand) unless
   the client already has its own. Nothing is rewritten; a Google history sync fills the new channels. */

alter table daily_channel_facts drop constraint if exists daily_channel_facts_channel_check;
alter table daily_channel_facts add constraint daily_channel_facts_channel_check check (channel in (
  'google_nonbrand','google_brand','google_nonbrand_returning','google_brand_returning','meta_acquisition','meta_returning',
  'pinterest','pinterest_returning','youtube','youtube_returning','bing','bing_returning',
  'applovin','applovin_returning','tiktok','tiktok_returning','snapchat','snapchat_returning'));

update client_settings
set multipliers = '{"google_nonbrand_returning":0.6,"google_brand_returning":0.3}'::jsonb || multipliers
where not (multipliers ? 'google_nonbrand_returning') or not (multipliers ? 'google_brand_returning');

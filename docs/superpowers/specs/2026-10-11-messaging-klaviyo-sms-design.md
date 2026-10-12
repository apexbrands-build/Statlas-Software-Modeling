# Messaging: Klaviyo, Postscript, Omnisend (email and SMS data)

Date: 2026-10-11. Status: draft for the strategist's review. Depends on `2026-10-11-connector-foundation-design.md`. Followed by the GA4 and Email Metrics spec and the Email/SMS plan and trackers spec (not yet written, see "Next").

## Goal
Email and SMS revenue and engagement flow into the daily numbers and into a message-level table, measured on the Apex attribution standard. Klaviyo first (email and SMS), then Postscript, then Omnisend.

## Attribution standard (SOP)
Apex standard is **3-day click, 0-day open** for email, from the CTC Canon (email chapter; the Canon states 1-day click once and 3-day elsewhere, we use 3-day). SMS uses the same 3-day click until we have our own comparison; the Canon has no SMS window. The window is an account setting inside Klaviyo, Postscript or Omnisend, so the app reads what the platform computed and cannot change it (read-only rule). The team procedure is `Agency/Company/Processes/email-sms-attribution-sop.md`.

In the app:
- New settings in `client_settings.extra` (`ExtraSettings` in `lib/types.ts`, defaults in `lib/defaults.ts`): `smsRevenueSource` (`none`, `klaviyo`, `postscript`, `omnisend`; default `none`), `emailAttrClickDays` (3), `emailAttrOpenDays` (0), `smsAttrClickDays` (3). `emailRevenueSource` already exists (`klaviyo`) and gains `omnisend` and `none`.
- The attribution values record what the account is set to. They are shown beside the email and SMS numbers ("3-day click, 0-day open, set in Klaviyo"). If the platform's API exposes the real window, the sync compares it with the recorded one and flags a mismatch on the connection.
- An "Email & SMS" accordion in the Store Settings Edit pop-up holds the two sources and the attribution values.

## Data model (migration `0010_messaging.sql`)
- **`message_stats_daily`**, primary key `(client_id, date, source, channel, message_id)`: `source` (`klaviyo`, `postscript`, `omnisend`), `channel` (`email`, `sms`), `kind` (`campaign`, `flow`), `message_name`, `recipients` (sent), `delivered`, `opens`, `clicks`, `unsubscribes`, `bounces`, `spam`, `orders`, `revenue`, `revenue_basis` (`order` or `send`). Engagement columns sit on the send date; `orders` and `revenue` sit on the order date when `revenue_basis = 'order'`, otherwise on the send date. A message can have rows on several dates. Row-level security: read by `has_client_access`, written by the service role.
- **`daily_facts`**: new `sms_revenue`, `sms_orders`, `sms_sent`. The existing `email_*` columns finally get real data.
- **`marketing_events`**: new `external_id text` and a unique index on `(client_id, source, external_id)` where `external_id` is not null.
- **`rebuild_messaging_facts(p_client, p_from, p_to)`** (security definer, same pattern as `rebuild_daily_facts`): for each day, upserts the email and SMS columns of `daily_facts` from `message_stats_daily`, taking only the source chosen in settings for each channel, so a client with Klaviyo email and Postscript SMS never double counts. `email_sent` and `sms_sent` are the sum of `recipients`. Campaign and flow revenue split by `kind`. It inserts the day if Shopify has not created it yet; `rebuild_daily_facts` does not touch these columns.

## Connectors
Each is one provider file registered in `lib/sync/registry.ts`, using a read-only API key per client stored encrypted (foundation spec, section 3). The sync writes `message_stats_daily`, then `finalize` calls `rebuild_messaging_facts` for the synced window.

- **Klaviyo.** Planned data: attributed revenue and orders by order date per campaign and flow, from the Metrics Aggregates API on the Placed Order metric grouped by attributed message; sends, delivered, opens, clicks, unsubscribes, bounces and spam by send date from the Reporting API; the campaign list with send time and channel. Exact endpoints and fields are confirmed against Klaviyo's current docs when implementation starts.
- **Postscript** (SMS). Campaigns and automations with sent, clicks, orders and revenue. Revenue basis is whatever the API provides, recorded per row.
- **Omnisend** (email and SMS). Campaigns and automations, same shape.

## Sync policy
- History in 30-day chunks like the other connectors; recent job re-pulls the last 14 days because late conversions change recent days.
- Respect each API's rate limits: honour `Retry-After`, stop at the chunk `deadline` and let the runner continue. Klaviyo's reporting endpoints are tightly limited, so chunk size is set from the real limits in step 1 of the plan.
- Daily numbers can be incomplete when a quota runs out, and Klaviyo's own screens group by send time while the dashboard groups by order time. Monthly totals are the reliable figure. The Email Metrics footer says so.

## Home wiring
- `DailyFact`, `Totals`, the repository mapping (`lib/repository/supabase.ts`) and the seed gain the SMS fields.
- New Home section "SMS" under "Email" with SMS Revenue, SMS Orders and SMS Revenue per 1k sent.
- Organic Revenue and Organic Orders subtract email and SMS together, matching the "Total Rev - iPaid - Email/SMS" definition already in `lib/defaults.ts`. Metric formula text and the metric tests are updated.

## Calendar events
Each sent campaign becomes a `marketing_events` row: category `email` or `sms` (both exist in `lib/planning/events.ts`), title = campaign name, date = send date, `segment_size` = recipients, `external_id` = `<source>:campaign:<id>`. Re-syncs update these rows. Editing a synced event in the Calendar tab changes its source to `manual`, so the sync never overwrites a strategist's edit. Flows are not events.

## Onboarding checklist
A new section "Email, SMS and analytics" in `lib/onboarding-checklist.ts`: Klaviyo connected with the Apex attribution standard set (SOP); SMS tool identified and its source chosen; attribution values recorded in Store Settings; two reference months compared with the platform's own UI at the same window.

## Verify before build (plan step 1, each answered in writing)
1. Klaviyo endpoints, fields and real rate limits for revenue by order date and for engagement.
2. Whether Klaviyo's API exposes the account's attribution window, and whether it restates past revenue when the window changes.
3. What Postscript and Omnisend return (daily or per message totals, revenue date basis) and whether their windows can match the standard.

## Tests
- Mapping tests per provider from anonymised sample payloads saved as fixtures.
- Metric tests for SMS tiles and the new Organic formula.
- After migration 0010 on the live database: a query comparing the sum of `message_stats_daily` for a month with `daily_facts`, and a pilot client month compared with the platform's UI at the same window. Proposed acceptance: monthly totals within 2%.

## Not in scope
Email and SMS Trackers, the Email Plan and the link to the forecast (next spec); list health beyond stored bounce, spam and unsubscribe counts; segments; campaign type classification (promotion, product, content, loyalty), which the plan spec adds when it needs it.

## Next
The Email/SMS plan and trackers spec turns this data into targets and gaps against the forecast. It waits for the strategist's decision on how email and SMS targets are set.

## Done when
Klaviyo syncs history and recent days for the pilot client; Home shows real email and SMS tiles and the corrected Organic; the pilot month matches the platform within the agreed tolerance; synced campaigns appear on the calendar; migration 0010 is applied.

# GA4 and the Email Metrics report

Date: 2026-10-11. Status: draft for the strategist's review. Depends on the connector foundation and messaging specs.

## Goal
Connect GA4 for the clients that have it (most do) and ship the Email Metrics report as the first consumer of the messaging data: delivered, recipients, opens, clicks, orders and revenue per campaign and flow, with the GA4 view alongside.

## GA4 connector
- **Auth:** `agency-google`. It reuses the agency Google login in `agency_secrets`. `lib/google.ts` today requests one scope (`adwords`); the install route gains `analytics.readonly` and requests both, so an admin re-authorizes once and Google Ads keeps working. The client (or the strategist) gives that Google login Viewer access to the client's GA4 property.
- **Per client:** the numeric GA4 property ID, entered in Add Connection; `verify` makes a small Data API call to confirm access.
- **Data (`ga4_daily`, migration `0011_ga4.sql`):** `client_id, date, channel_group, sessions, transactions, revenue`, primary key on the first three, from the Data API with date and default channel group. Row-level security like the other fact tables. Chunked history plus the 14-day recent re-pull; GA4 revenue is reprocessed for a day or two, so recent days are re-pulled every day.
- **Open question (answered before build):** the Google Cloud OAuth consent screen must allow the new scope for the agency login. If the app type is Internal it should work without Google verification; if External, check whether verification is required. The strategist owns that project.

## Email Metrics report (`/reporting/email-metrics`)
Rules come from the Statlas docs archive (`docs/statlas-docs/reports.md`, "Email Metrics") and the data-and-integrations notes.

- **Rows:** campaigns and flows from `message_stats_daily`, with channel (email or SMS) and source. Group by type, channel or message; time view day, week or month.
- **Columns:** recipients, delivered, opens, clicks, orders, revenue, bounces, spam, unsubscribes; rates open, click, revenue per recipient (RPR), unsubscribe and spam.
- **Platform wins for engagement:** opens and deliverability come from the messaging platform only.
- **GA4 strip (channel totals, not per message):** sessions, transactions and revenue for the channel groups that are email or SMS (names containing email, mail or sms; organic, paid search, direct, social and display excluded), shown next to the platform totals with the difference. The Statlas rule "GA sessions add to platform clicks" is applied at this channel-total level, because GA4 does not carry our message IDs. Per-message merging by UTM campaign is not in scope.
- **Colour guardrails from the Canon email chapter:** spam rate under 0.10% good, 0.10 to 0.20% caution, above 0.20% danger; hard bounce above 0.5% flagged. Flows with RPR under 30% of the client's own median for that flow are flagged.
- **Shared pieces:** `ReportFrame`, `ReportTable` (heat map, CSV), date picker and compare logic. Pure logic in `lib/reports/email-metrics.ts` with tests (grouping, rates, GA4 merge, thresholds).
- **Footer notes:** attribution window recorded for the client, the send-time vs order-time difference, and that monthly totals are the reliable figure.
- **Registry:** `email-metrics` moves from `waiting` to ready when the page exists; `ReportRouter` maps the slug. Until a messaging source is connected the existing "waiting for data" page shows.

## Tests
Pure-logic tests for the report; mapping tests for the GA4 response from a saved fixture; after migration 0011, a pilot month compared with GA4's own UI.

## Not in scope
Email and SMS Trackers and the Email Plan (separate spec); GA4 as a revenue source for the dashboard; sessions or conversion-rate tiles on Home; per-message GA4 attribution.

## Done when
GA4 syncs for the pilot client, Email Metrics shows real rows and the GA4 strip, the Google re-authorization is done, and migration 0011 is applied.

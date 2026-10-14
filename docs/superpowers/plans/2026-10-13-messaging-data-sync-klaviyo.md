# Messaging connectors, phase 2: Klaviyo data sync (Postscript and Omnisend deferred) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A connected Klaviyo account loads 12 months of email and SMS campaign and flow numbers into a message-level table, re-pulls the last 14 days every night, fills the email and SMS columns of `daily_facts`, puts sent and scheduled campaigns on the marketing calendar, and Home shows real Email and SMS tiles with the corrected Organic formula. Postscript and Omnisend stay connect-only until a test account exists (deferred sections at the end).

**Architecture:** Thin Klaviyo calls in `lib/messaging/klaviyo-api.ts` (on the existing `requestJson`), pure mapping in `lib/messaging/klaviyo-map.ts` tested against fixtures recorded from a real account, and a sync in `lib/sync/run-klaviyo.ts` registered in `SYNCS` so the existing job runner, history loader and daily tick drive it. A SQL function `rebuild_messaging_facts` rolls the message table into `daily_facts`, taking only the source chosen per channel in Store Settings. Data comes from Klaviyo's Reporting API, which dates revenue by send date (that is what the Klaviyo screens show); monthly totals are the reliable figure.

**Tech Stack:** Next.js 16 route handlers and server library code, Supabase (Postgres function, service-role writes), Vitest with injected `fetch` and recorded fixtures.

**Spec:** `docs/superpowers/specs/2026-10-11-messaging-klaviyo-sms-design.md` (including "Update 2026-10-12"). Phase 1 plan: `docs/superpowers/plans/2026-10-12-messaging-connect.md` (built).

## Global Constraints

- Read-only against Klaviyo: GET for lists, and POST only to the `*-values-reports` / `*-series-reports` query endpoints, which read data and change nothing. The key never leaves the server (`readApiKey` in `lib/integration-secrets.ts`, `redact` in `lib/connect.ts`).
- The software is **Apex Analytics** in every label, message and doc line. Klaviyo is named as the data source; Statlas is never named in the UI.
- Migration: the spec's `0010_messaging.sql` number is taken (0010 = AOV functions, 0011 = scenarios; 0012 is planned by the creative ad-data plan and 0013 by the subscriptions plan). Use **the next free number at build time** (`supabase/migrations/00NN_messaging.sql`). Additive only; applied to the live database only after the strategist's go.
- Attribution standard (SOP `Agency/Company/Processes/email-sms-attribution-sop.md`): email 3-day click, 0-day open; SMS 3-day click. The window is set inside Klaviyo; the app records it (`emailAttrClickDays` 3, `emailAttrOpenDays` 0, `smsAttrClickDays` 3) and never changes Klaviyo.
- `AGENTS.md`: every task that adds or edits a route or page reads the matching guide in `node_modules/next/dist/docs/01-app` first (Tasks 1 and 9 say so).
- Tests live in `lib/**/*.test.ts` only; components are checked with `npx tsc --noEmit`, `npx eslint .`, `npm run build` and a browser check in demo mode (`NEXT_PUBLIC_DATA_MODE=seed`, Supabase env vars blanked).

### Klaviyo facts used by this plan (read on developers.klaviyo.com, 2026-10-13, revision `2026-07-15`)

| Call | Facts confirmed in the reference | Still unverified until a real key runs (Task 1 records it) |
|---|---|---|
| `GET /api/metrics` (scope `metrics:read`, 10/s burst, 150/min) | filter only on `integration.name` / `integration.category`; `attributes.name`, `attributes.integration`; `page[cursor]`, `links.next`, 200 per page | how many metrics are named "Placed Order" and which integration the Shopify one carries |
| `GET /api/campaigns?filter=equals(messages.channel,'email')` (and `'sms'`) (scope `campaigns:read`, 10/s, 150/min) | the channel filter is required; filter on `status`, `scheduled_at`, `updated_at`, `created_at` (not `send_time`); attributes `name`, `status`, `send_time`, `scheduled_at`, `audiences`; `include=campaign-messages`; 100 per page, `links.next` | whether `send_time` is set for every sent campaign, its timezone offset |
| `GET /api/campaign-recipient-estimations/{id}` (scope `campaigns:read`, 10/s, 150/min) | `data.attributes.estimated_recipient_count` | whether it answers for Scheduled campaigns (the reference does not say) |
| `POST /api/campaign-values-reports` (scope `campaigns:read`) | body `data.type = "campaign-values-report"`, `attributes.statistics`, `timeframe` (`{start,end}`, company timezone, offset ignored, **max 1 year**), `conversion_metric_id` (required), `group_by` (default and required `campaign_id`, `campaign_message_id`, plus `send_channel`), `filter`; response `data.attributes.results[] = { groupings, statistics }`; **no per-day breakdown**; limits **1/s burst, 2/min steady, 225/day** | the `page_cursor` follow-up (the reference names the parameter but not where the next cursor appears); whether `timeframe` selects by send date; whether `end` is exclusive |
| `POST /api/flow-series-reports` (scope `flows:read`) | `interval: "daily"` with **max 60 days per request**; `group_by` may add `flow_name`, `flow_message_name`; response `date_times[]` and `results[].statistics.<name>[]` aligned by index; same **1/s, 2/min, 225/day** limits | pagination, which date a flow conversion lands on, whether `date_times` carry the account timezone |
| Statistics names | `recipients`, `delivered`, `opens_unique`, `clicks_unique`, `unsubscribe_uniques`, `bounced`, `spam_complaints`, `conversions`, `conversion_value` | — |
| Attribution window | no endpoint in the reference exposes it | if the real account shows one anywhere, the mismatch flag in the spec becomes possible (not built here) |

Whether the 225/day quota is per endpoint or shared across reporting endpoints is not documented; the sync is paced as if shared. Scopes the sync needs: `accounts:read`, `metrics:read`, `campaigns:read`, `flows:read` (all in the card's setup steps). The spec's `forms:read` and `segments:read` are not needed for this phase and are not asked for.

## Review Focus

1. Klaviyo's quota runs out mid-history (2 calls a minute, 225 a day): the job stops with a plain "continues tomorrow" message, keeps what it loaded, is never halved into ever-smaller chunks that hammer the API, and Resume picks up where it stopped. Tested in Task 5.
2. A client with Klaviyo email and Postscript SMS, or with the SMS source left at `none`: SMS revenue is never counted twice and never silently included; Organic subtracts only what the chosen sources report. Tested in Task 6.
3. A strategist edits or deletes a synced campaign in the Calendar: the next sync neither overwrites the edit nor re-creates the deleted event, and never makes a duplicate. Tested in Task 7.
4. The Klaviyo account's timezone differs from the client's store timezone: dates are kept as Klaviyo reports them and the run message says so, so a mismatch is visible and not silently shifted. Tested in Task 4.
5. A campaign with no Placed Order conversions, an SMS campaign with zero opens, a flow message with no sends on most days, or no "Placed Order" metric at all: zeros are stored as zeros, rows with nothing are dropped, and a missing metric fails the sync with "Klaviyo has no Placed Order metric: is Shopify connected to Klaviyo?". Tested in Tasks 3 and 4.

---

### Task 1: Probe: record real Klaviyo responses as fixtures

**Files:**
- Create: `lib/messaging/probe.ts`, `lib/messaging/probe.test.ts`, `app/api/integrations/probe/route.ts`
- Modify: `components/settings/StoreSettingsPage.tsx` (admin-only "Download sample for the build" link on a connected Klaviyo row)
- Later (after the strategist runs it): `lib/messaging/fixtures/klaviyo/{accounts,metrics,campaigns-email,campaigns-sms,campaign-values,flow-series,recipient-estimation}.json`

**Interfaces:**
- Produces: `anonymiseProbe(sample: Record<string, unknown>, seed: string): Record<string, unknown>`. Every `id`, every `*_id` value and every `name`/`*_name`/`title`/`subject`/`organization_name` string becomes a stable placeholder (`id-1`, `Campaign 1`, `Flow 1`...; the same input maps to the same output in all files); keys named `email`, `phone_number`, `from_email`, `from_label`, `address`, `contact_information` are removed; every numeric statistic is multiplied by one factor drawn from `seed` (ratios kept, real amounts hidden); JSON structure, key names, arrays, `links` (with the host and cursor values replaced) and dates are kept.
- Produces: `POST /api/integrations/probe` body `{ integrationId }`: admin only (`profiles.role = 'admin'`, else 403), Klaviyo connections only; makes at most 3 reporting calls (`campaign-values-reports` and `flow-series-reports` for the last 30 days, `interval: "daily"`) and the cheap list calls, and returns the anonymised JSON as a download. Uses the request functions of Task 3 if built, else raw `requestJson` calls with the same headers as `verifyKlaviyo`.

- [ ] **Step 1: Write the failing test** `lib/messaging/probe.test.ts`: `anonymiseProbe` on a doc-shaped sample replaces `"Black Friday VIP"` with `"Campaign 1"` everywhere it appears; the same campaign id in two places maps to the same placeholder; `from_email` and `contact_information` are gone; `conversion_value` 1000 and `recipients` 500 keep their 2:1 ratio and are no longer 1000 and 500; `date_times` are unchanged; the output contains no `@`.
- [ ] **Step 2: Run** `npx vitest run lib/messaging/probe.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `anonymiseProbe`, then the route (read the route-handler guide in `node_modules/next/dist/docs/01-app` first) and the admin link.
- [ ] **Step 4: Run** the test, `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Hand-off (gate for Task 4).** After deploy, the strategist connects the client key that has granted access, clicks "Download sample for the build" once, and sends the file. Claude splits it into the fixture files above and writes, at the top of `lib/messaging/fixtures/klaviyo/README.txt`, the answers to every cell of the "unverified" column (cursor location, end-exclusive or not, timezone of `date_times`, the Placed Order metric's integration, estimation on Scheduled campaigns). Tasks 2, 3, 6, 8 and 9 may proceed meanwhile; Task 4 waits.

### Task 2: Migration, settings and types

**Files:**
- Create: `supabase/migrations/00NN_messaging.sql` (next free number)
- Modify: `lib/types.ts`, `lib/defaults.ts`, `lib/metrics.ts` (`Totals`, `emptyTotals`, `aggregate`), `lib/repository/supabase.ts` (fact mapping), `lib/repository/seed.ts`, `lib/planning/events.ts` (`MarketingEvent.externalId?`)
- Test: `lib/metrics.test.ts`, `lib/defaults.test.ts` (create if absent)

**Interfaces:**
- Produces tables and columns:
  - `message_stats_daily(client_id uuid, date date, source text check in ('klaviyo','postscript','omnisend'), channel text check in ('email','sms'), kind text check in ('campaign','flow'), message_id text, parent_id text, parent_name text, message_name text, recipients bigint, delivered bigint, opens bigint, clicks bigint, unsubscribes bigint, bounces bigint, spam bigint, orders numeric, revenue numeric, revenue_basis text check in ('order','send','utm'), updated_at timestamptz; primary key (client_id, date, source, channel, message_id); index (client_id, date))`. RLS: select by `has_client_access(client_id)`, no browser writes (service role). `parent_id`/`parent_name` = campaign or flow id and name (**added to the spec's columns** because the trackers plan needs flow-level and campaign-level rows).
  - `daily_facts`: `sms_revenue numeric not null default 0`, `sms_orders int not null default 0`, `sms_sent bigint not null default 0`.
  - `marketing_events`: `external_id text`, `hidden boolean not null default false`; unique index on `(client_id, external_id) where external_id is not null` (**deviation:** the spec's `(client_id, source, external_id)` would let a synced event whose source flipped to `manual` be inserted again; `external_id` already starts with the source).
  - `rebuild_messaging_facts(p_client uuid, p_from date, p_to date)` (security definer, `search_path public`, same pattern as `rebuild_daily_facts` in `0005_exclude_free_orders.sql`): per day of `generate_series(p_from, p_to)`, upserts `email_revenue`, `email_campaign_revenue`, `email_flow_revenue`, `email_orders`, `email_sent`, `sms_revenue`, `sms_orders`, `sms_sent` from `message_stats_daily` rows where `source` = `client_settings.extra->>'emailRevenueSource'` (default `'klaviyo'`) for `channel = 'email'` and `= extra->>'smsRevenueSource'` (default `'none'`, which matches nothing) for `channel = 'sms'`; days with no rows get zeros; inserts the day when Shopify has not; updates only these eight columns plus `updated_at`. (`rebuild_daily_facts` does not touch them: checked.)
- Produces types: `DailyFact.smsRevenue`, `smsOrders`, `smsSent: number`; the same three on `Totals`; `ExtraSettings.emailRevenueSource: "klaviyo" | "omnisend" | "ga4" | "none"`, `smsRevenueSource: "none" | "klaviyo" | "postscript" | "omnisend"`, `emailAttrClickDays: number`, `emailAttrOpenDays: number`, `smsAttrClickDays: number`; defaults `"klaviyo"`, `"none"`, 3, 0, 3. `MarketingEvent.externalId?: string`.
- Produces type `MessageStatRow` in `lib/types.ts` (camelCase of the table columns) and `Repository.getMessageStats(clientId: string, from: string, to: string): Promise<MessageStatRow[]>` (Supabase reads the table; seed returns a generated set: two flows and weekly campaigns per channel, so the trackers plan can be built in demo mode).

- [ ] **Step 1: Write failing tests:** `defaultExtra()` has `smsRevenueSource "none"`, `emailAttrClickDays 3`, `emailAttrOpenDays 0`, `smsAttrClickDays 3`, `emailRevenueSource "klaviyo"`; `aggregate` sums `smsRevenue`, `smsOrders`, `smsSent` over two facts; the seed repository's facts carry non-negative SMS numbers and `getMessageStats` returns rows whose email revenue for a month equals that month's `emailRevenue` in its facts (within 1 currency unit).
- [ ] **Step 2: Run** `npx vitest run lib/metrics.test.ts lib/defaults.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, defaults, aggregation, repository mapping (`sms_revenue` etc.), seed SMS (about 4% of order revenue; seed email numbers are derived from the same message rows) and the migration with comments in the style of 0008/0009.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS. Do not apply the migration.

### Task 3: Klaviyo request functions and pacing

**Files:**
- Create: `lib/messaging/klaviyo-api.ts`, `lib/messaging/klaviyo-api.test.ts`, `lib/messaging/pace.ts`, `lib/messaging/pace.test.ts`
- Modify: `lib/messaging/http.ts` (+ `http.test.ts`)

**Interfaces:**
- Consumes: `requestJson`, `PlatformError`, `KLAVIYO_REVISION`.
- Produces in `http.ts`: `PlatformError.retryAfterMs?: number`; a 429 whose `Retry-After` exceeds `maxWaitMs` throws `rate_limited` at once with `retryAfterMs` set (no waiting a whole day inside a 60-second task).
- Produces in `pace.ts`: `createPacer(o: { minGapMs: number; now?: () => number; sleep?: (ms: number) => Promise<void>; deadline: number }): (bucket: string) => Promise<void>`; waits so two calls in the same bucket are at least `minGapMs` apart and calls in any bucket at least 1100 ms apart; throws `PlatformError("rate_limited", "Klaviyo needs a pause between report requests; the next part continues in the next run.")` when the wait would pass `deadline`.
- Produces in `klaviyo-api.ts` (each takes `apiKey: string, o: { fetchImpl?: typeof fetch; pace: (bucket: string) => Promise<void> }`):
  - `findPlacedOrderMetricId(...): Promise<string>` (pages `GET /api/metrics`; picks `name === "Placed Order"`, preferring `integration.name` Shopify, else the only one; none: throws "Klaviyo has no Placed Order metric: is Shopify connected to Klaviyo?").
  - `listCampaigns(apiKey, channel: "email" | "sms", o & { updatedSince?: string }): Promise<KlaviyoCampaign[]>` with `KlaviyoCampaign = { id: string; name: string; status: string; sendTime: string | null; scheduledAt: string | null; channel: "email" | "sms" }`; follows `links.next`.
  - `campaignValues(apiKey, metricId: string, range: { from: string; to: string }, o): Promise<unknown[]>` (raw `results`), bucket `"campaign-values"`, statistics `["recipients","delivered","opens_unique","clicks_unique","unsubscribe_uniques","bounced","spam_complaints","conversions","conversion_value"]`, `group_by ["campaign_id","campaign_message_id","send_channel"]`.
  - `flowSeries(apiKey, metricId, range, o): Promise<{ dateTimes: string[]; results: unknown[] }>`, bucket `"flow-series"`, `interval "daily"`, same statistics, `group_by ["flow_id","flow_message_id","send_channel","flow_name","flow_message_name"]`; a range longer than 60 days throws before any call.
  - `estimateRecipients(apiKey, campaignId: string, o): Promise<number | null>` (404 or missing value: null).
  - `getAccountTimezone(apiKey, o): Promise<string>` (`GET /api/accounts`, `data[0].attributes.timezone`; the same call `verifyKlaviyo` makes).
  - Timeframe sent as `{ start: "<from>T00:00:00", end: "<to + 1 day>T00:00:00" }` until Task 1 says otherwise; page follow-up per Task 1's README.

- [ ] **Step 1: Write failing tests** with an injected `fetch` and doc-shaped bodies (replaced by the Task 1 fixtures in Task 4): the metric lookup picks the Shopify "Placed Order" among two and throws the exact message when none; `listCampaigns` sends `filter=equals(messages.channel,'sms')`, follows two pages and stops when `links.next` is null; `campaignValues` POSTs to `https://a.klaviyo.com/api/campaign-values-reports` with header `revision: 2026-07-15`, `content-type: application/vnd.api+json` and the statistics above; `flowSeries` refuses a 61-day range; no function ever sends DELETE, PATCH or PUT, and no POST goes anywhere but a `*-reports` URL. `pace.test.ts` (fake clock): two calls in one bucket 31000 ms apart, two buckets 1100 ms apart, throws when the wait passes the deadline. `http.test.ts`: `Retry-After: 3600` with `maxWaitMs 30000` throws `rate_limited` with `retryAfterMs 3600000` without sleeping.
- [ ] **Step 2: Run** `npx vitest run lib/messaging`. Expected: FAIL.
- [ ] **Step 3: Implement** (reporting buckets use `minGapMs: 31000`; background calls use `retries: 1`, `maxWaitMs: 30000`).
- [ ] **Step 4: Run** `npx vitest run lib/messaging`. Expected: PASS.

### Task 4: Mapping to message rows and campaign events (needs the Task 1 fixtures)

**Files:**
- Create: `lib/messaging/klaviyo-map.ts`, `lib/messaging/klaviyo-map.test.ts`

**Interfaces:**
- Consumes: Task 1 fixtures, `KlaviyoCampaign`, `MessageStatRow`.
- Produces:
  - `mapCampaignValues(results: unknown[], campaigns: Map<string, KlaviyoCampaign>, tz: string, clientId: string): MessageStatRow[]`: one row per campaign message, `kind "campaign"`, `date` = the campaign's `sendTime` as a date in `tz`, `parent_id` = campaign id, `parent_name` and `message_name` = campaign name, `revenue_basis "send"`; a result whose campaign is unknown or unsent is dropped and counted.
  - `mapFlowSeries(series: { dateTimes: string[]; results: unknown[] }, clientId: string): MessageStatRow[]`: one row per flow message and day with any non-zero value, `kind "flow"`, `parent_id` = flow id, `parent_name` = flow name, `message_name` = flow message name, `revenue_basis "send"`; `push-notification` and `whatsapp` channels are skipped.
  - `campaignEvents(campaigns: KlaviyoCampaign[], recipients: Map<string, number>, tz: string): SyncedEvent[]` with `SyncedEvent = { externalId: string; date: string; type: "email" | "sms"; name: string; segmentSize: number | null; notes?: string }`: sent and Scheduled campaigns only (Draft and Cancelled* are skipped); `externalId = "klaviyo:campaign:<id>"`; a Scheduled campaign has `notes: "Scheduled in Klaviyo"` and its estimated audience.
  - `timezoneNote(klaviyoTz: string, clientTz: string): string | null` ("Klaviyo reports in America/New_York, the store in America/Los_Angeles: email and SMS days follow Klaviyo." or null when equal).

- [ ] **Step 1: Write failing tests** on the recorded fixtures: the row count and the sum of `revenue` and `recipients` equal the fixture's totals; a campaign sent at 23:30 UTC lands on the right local date for `America/New_York`; rates are never stored (only counts); a statistic missing from a result is 0; an all-zero flow day is not a row; an SMS campaign row has `channel "sms"` and `opens 0`; a Draft campaign is no event, a Scheduled one has its estimate; `timezoneNote` returns null for equal zones.
- [ ] **Step 2: Run** `npx vitest run lib/messaging/klaviyo-map.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four functions (date in a timezone with `Intl.DateTimeFormat`, as `lib/sync/run-shopify.ts` does for order dates).
- [ ] **Step 4: Run.** Expected: PASS.

### Task 5: The sync, the registry and rate-limit stops

**Files:**
- Create: `lib/sync/run-klaviyo.ts`
- Modify: `lib/sync/registry.ts`, `lib/sync/registry.test.ts`, `lib/providers.ts`, `lib/providers.test.ts`, `lib/job-plan.ts`, `lib/job-plan.test.ts`, `lib/jobs.ts`

**Interfaces:**
- Consumes: Tasks 2 to 4, `readApiKey`, `SyncContext`, `getAdminClient`.
- Produces: `syncKlaviyo(integrationId: string, range: SyncRange, ctx: SyncContext): Promise<{ rows: number; note?: string }>`; `finalizeKlaviyo(integrationId: string, range: SyncRange): Promise<void>` (calls `rebuild_messaging_facts` over the range, then the event merge of Task 7). `SYNCS.klaviyo = { chunkDays: 60, sync, finalize, verify }` (the verifier moves from `VERIFIERS` into the sync entry); `PROVIDERS.klaviyo.syncs = true`. In `job-plan.ts`: `onChunkError(job, message, window, o?: { rateLimited?: boolean })`; with `rateLimited` it returns `{ retry: false, message }` without halving, where message = "Klaviyo's report limit is used up for today. Loaded up to <window.to>; the daily sync continues by itself and Resume finishes the history tomorrow."
- One chunk: metric id, account timezone (`getAccountTimezone`), campaigns both channels (only on `firstChunk` or `kind === "recent"`, kept in memory per chunk otherwise re-listed; the list calls are cheap), one `campaignValues` and one `flowSeries` call for the window, then delete `message_stats_daily` rows for this client, `source 'klaviyo'` and the window, insert in 500-row batches, update `coverage_start`/`coverage_end`, `sync_runs` and `integrations` like `syncMeta` (`lib/sync/run-meta.ts`). The run message carries `timezoneNote` and the count of dropped results.

- [ ] **Step 1: Write failing tests:** `registry.test.ts` ("syncs means it has a sync" still holds; `getSync("klaviyo").chunkDays === 60`; `getVerifier("klaviyo")` still defined; Postscript and Omnisend still have no sync); `providers.test.ts` (Klaviyo `syncs: true`); `job-plan.test.ts` (a rate-limited error with `chunk_days 60` returns `retry: false`, the message above with the window end, and is not halved; a normal error still halves).
- [ ] **Step 2: Run** `npx vitest run lib/sync lib/providers.test.ts lib/job-plan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `run-klaviyo.ts` (server-only), the registry entry, and in `lib/jobs.ts` pass `{ rateLimited: e instanceof PlatformError && e.kind === "rate_limited" }` to `onChunkError`. The phase 1 sentence "Pulling data from Klaviyo is the next build" in `StoreSettingsPage.tsx` disappears for Klaviyo by itself (`syncs` is true).
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 6: Metrics, Home tiles and the Organic formula

**Files:** Modify `lib/metrics.ts`, `lib/metrics.test.ts`, `lib/reports/home-links.ts` (+ test), `components/Dashboard.tsx`.

**Interfaces:**
- Produces `METRICS.smsRevenue` (label "SMS Revenue", `currency0`, up), `METRICS.smsOrders` ("SMS Orders", `number`), `METRICS.smsRevPer1k` ("SMS Revenue / 1K Sent", `currency2`, `div(smsRevenue, smsSent / 1000)`); `source` of the email and SMS metrics stays `"Klaviyo"` (the `Source` union has no generic value; Omnisend clients get a label change when that connector lands). Organic Revenue = `max(0, orderRevenue − paid iRevenue − emailRevenue − smsRevenue)`, formula text "Order Revenue − Paid iRevenue − Email Revenue − SMS Revenue (floored at 0)"; Organic Orders, Organic AOV and Organic % of Paid subtract `smsOrders` / `smsRevenue` the same way.
- Home: a "SMS" section under "Email" with `smsRevenue`, `smsOrders`, `smsRevPer1k`; under both sections one line: "From Klaviyo, dated by send date as in Klaviyo. Monthly totals are the reliable figure. Attribution: <emailAttrClickDays>-day click, <emailAttrOpenDays>-day open, set in Klaviyo." When `smsRevenueSource` is `none` the SMS section shows "Choose the SMS source in Store Settings, Edit, Email & SMS" instead of zeros. `HOME_REPORT_LINKS` maps the three SMS keys to `sms-tracker` (no link until that report is `ready`).

- [ ] **Step 1: Write failing tests:** on a fixture total with order revenue 10,000, paid iRevenue 4,000, email 2,000, SMS 500: Organic Revenue 3,500; with SMS 9,000 it is 0 (floored); Organic Orders subtracts `smsOrders`; `smsRevPer1k` with 0 sent is null; `homeReportHref("smsRevenue")` is null while `sms-tracker` is `waiting`.
- [ ] **Step 2: Run** `npx vitest run lib/metrics.test.ts lib/reports/home-links.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the metrics and the Dashboard section.
- [ ] **Step 4: Run** tests, `npx tsc --noEmit`, `npx eslint .`; check Home in demo mode shows the SMS row and the note.

### Task 7: Calendar events from campaigns

**Files:**
- Create: `lib/messaging/event-merge.ts`, `lib/messaging/event-merge.test.ts`
- Modify: `lib/sync/run-klaviyo.ts` (finalize), `lib/repository/supabase.ts` (`eventOf`, `listEvents` filters `hidden = false`, `deleteEvent` sets `hidden = true` when the row has an `external_id`), `components/planning/CalendarStep.tsx` (saving an event whose source is `klaviyo` or `sms` saves it as `manual`)

**Interfaces:**
- Consumes: `campaignEvents` (Task 4).
- Produces: `mergeSyncedEvents(incoming: SyncedEvent[], existing: { id: string; externalId: string; source: string; hidden: boolean }[]): { insert: SyncedEvent[]; update: (SyncedEvent & { id: string })[] }`: new external ids are inserted with source `klaviyo`; existing ones with source `klaviyo` are updated (date, name, size, notes); existing ones with source `manual` (edited) or `hidden` (deleted) are left alone. Flows never become events. The sync writes with the service role, matching on `external_id`.

- [ ] **Step 1: Write failing tests:** a new campaign is one insert; the same campaign on the next sync is one update and no insert; an edited (manual) one and a hidden one produce nothing; a Scheduled campaign that is now Sent updates its date and size and drops the "Scheduled in Klaviyo" note.
- [ ] **Step 2: Run** `npx vitest run lib/messaging/event-merge.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, wire into `finalizeKlaviyo` (campaigns from today minus the job range to every Scheduled one), and the repository and Calendar changes.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`. Expected: PASS.

### Task 8: Store Settings "Email & SMS" accordion and onboarding checklist

**Files:** Modify `components/settings/EditStoreDialog.tsx`, `lib/onboarding-checklist.ts` (+ create `lib/onboarding-checklist.test.ts`).

**Interfaces:**
- The "Email/Organic Settings" accordion (line ~309, now marked `notApplied`) becomes "Email & SMS" (applied): Email revenue source (Klaviyo, Omnisend, GA4, None), SMS revenue source (None, Klaviyo, Postscript, Omnisend), Email click window (days), Email open window (days), SMS click window (days), hint "Records what the platform is set to (Apex standard: 3-day click, 0-day open). It does not change Klaviyo. A changed source applies at the next sync." Organic definition stays, still `notApplied`.
- New checklist section `"7. Email, SMS and analytics"` with ids `klaviyo-attr` ("Klaviyo connected and set to the Apex attribution standard: 3-day click, 0-day open (SOP)"), `sms-source` ("SMS tool identified and its source chosen in Store Settings"), `attr-recorded` ("Attribution values recorded in Store Settings, Edit, Email & SMS"), `email-ref-months` ("Two reference months of email and SMS revenue compared with the platform at the same window").

- [ ] **Step 1: Write a failing test:** checklist ids are unique across sections and section 7 holds the four ids above.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** tests, `npx tsc --noEmit`, `npx eslint .`, `npm run build`; open the Edit dialog in demo mode.

### Task 9: Live run, acceptance and docs

**Files:** Modify `docs/connector-setup.md`, `docs/changelog.md`, `CLAUDE.md` (one line each), `lib/reports/registry.ts` (`email-metrics`, `email-tracker`, `sms-tracker` keep `waiting`; `needs` becomes "Email and SMS plan (next build)").

- [ ] **Step 1: Strategist applies the migration** (with go) and starts a 12-month history load on the pilot Klaviyo connection. Expected: about 7 chunks of 60 days, 2 reporting calls each, finishing within the day; if it stops on the quota, Resume the next day.
- [ ] **Step 2: Acceptance query** (Supabase, read-only): for one complete month, `sum(revenue)` of `message_stats_daily` by channel equals `daily_facts.email_revenue` / `sms_revenue` for that month; the same month compared with Klaviyo's own campaign and flow screens at the same window is within **2%** (spec). Record the result in `docs/changelog.md`.
- [ ] **Step 3: Check** that the sent campaigns appear on the calendar, Home shows the email and SMS tiles and Organic dropped by the SMS amount, and the next nightly run re-pulls 14 days.

---

## DEFERRED: Omnisend data sync

Not built in this plan: there is no Omnisend account to test with. The connector stays connect-only (`syncs: false`).

**Known (Omnisend docs, 2026-10-12):** Reports API `POST https://api.omnisend.com/api/analytics/reports`, key in `X-API-KEY` plus an `Omnisend-Version` header; sent, opened, clicked and revenue per campaign and automation, by channel; revenue grouped by send date; **10 requests a minute and 55 a day per brand**.

**Question that decides it:** does one report request return per-campaign and per-automation rows with a send date (so a 60 to 180 day chunk costs one or two requests), or only totals per period (so a daily history costs one request per day, which 55 a day cannot carry for 12 months)?

**A test account must show:** at least one sent email campaign, one SMS campaign and one live automation in the last 60 days; a report response for that window; whether its attribution window can be set to 3-day click to match the SOP.

**When unblocked (about 1.5 days):** probe route variant (Task 1 pattern) recording an Omnisend report; `lib/messaging/omnisend-api.ts` and `omnisend-map.ts` writing `message_stats_daily` with `source 'omnisend'`, `revenue_basis 'send'`; `SYNCS.omnisend` with a chunk size set from the answer above and the pacer at 6100 ms gap and a 50-a-day stop; `rebuild_messaging_facts` already handles the source; Omnisend campaigns become events once `marketing_events.source` accepts `'omnisend'` (its check today allows only `manual, klaviyo, sms, import`).

## DEFERRED: Postscript SMS data

Not built in this plan: there is no Postscript account to test with.

**Known (developers.postscript.io, 2026-10-12):** the public API lists subscribers, subscriber events, unsubscribe and redact; **no campaign, message or revenue endpoint**.

**Question that decides it:** does a Postscript key reach any campaign or automation revenue (a partner or undocumented endpoint, or an export)? If yes, the same pattern as Omnisend with `source 'postscript'`. If no, SMS revenue comes from the order side: orders whose landing UTM is `utm_source=postscript` (Postscript's default), recorded with `revenue_basis 'utm'` and labelled last-click, not Postscript's number; or GA4 `sessionSource` once GA4 is built.

**What the code lacks for the UTM path (checked):** Shopify orders are stored without landing site, referrer or UTM fields (no such column in any migration, none in `lib/sync/shopify.ts`). That path needs a Shopify order field (`customerJourneySummary` or `landingSite`) added to the order sync and a history reload, which touches the Shopify app scopes and submission.

**A test account must show:** the API reference reachable with the Private key, any campaign list or stats endpoint, and two or three real Shopify orders known to come from Postscript SMS so their UTMs can be read.

**When unblocked:** 1 day (API path) or 2 to 3 days (UTM path, including the Shopify order field and a history reload).

---

## Self-review

- **Spec coverage:** `message_stats_daily`, the `daily_facts` SMS columns, `marketing_events.external_id`, `rebuild_messaging_facts` (Task 2); Reporting API sync with Placed Order lookup, history chunks and the 14-day recent re-pull (Tasks 3 to 5, recent window from `createJob`); attribution settings and the Email & SMS accordion (Tasks 2, 8); Home SMS tiles and corrected Organic (Task 6); calendar events with edit protection (Task 7); onboarding section (Task 8); acceptance within 2% (Task 9); verify-before-build answered by the reference table plus Task 1. Postscript and Omnisend are deferred on purpose.
- **Deviations on purpose:** revenue by send date from the Reporting API (spec update), not the Metrics Aggregates API by order date (spec body); `parent_id`/`parent_name` columns; unique index on `(client_id, external_id)`; `hidden` column for deleted synced events; scheduled campaigns become events now because the trackers plan needs them; the attribution-window mismatch flag is not built (Klaviyo exposes no window); the Email Metrics report page is not in this spec and stays `waiting`.
- **Type consistency:** `MessageStatRow`, `KlaviyoCampaign`, `SyncedEvent`, `getMessageStats`, `syncKlaviyo`, `finalizeKlaviyo`, `mergeSyncedEvents`, `createPacer` are spelled the same in every task.
- **Proportion:** nine tasks plus two deferred outlines; signatures, the exact values the spec and the Klaviyo reference fix, and test assertions only.

**Sizing:** about **5 working days** for Claude (test first, plus one independent review), of which half a day waits on the probe file. What could blow it up: Klaviyo's 2-per-minute and 225-per-day report limits if pagination turns out to need many pages for a big account (history would take several days per client, not hours); `timeframe` selecting by something other than send date; the 2% match failing because the account's window changed during the year. **From the strategist:** one client's Klaviyo Private API key (Read-Only), from a client that granted API access, connected in Store Settings; one click on "Download sample for the build" and the file sent back; the go to apply the migration; the acceptance month compared with Klaviyo's own screens.

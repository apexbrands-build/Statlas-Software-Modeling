# GA4 connector and Email Metrics report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client's GA4 property connects through the agency Google login, and its daily sessions, engaged sessions, transactions and revenue per default channel group land in a new `ga4_daily` table. Apex Analytics then uses that table for two things: the organic and email share of traffic (the strategist's "organic traffic %"), and the GA4 strip of a new Email Metrics report (`/reporting/email-metrics`). The report's rows come from the messaging tables when they exist; with GA4 alone it still shows the GA4 strip.

**Architecture:** The agency Google OAuth flow (`lib/google.ts`, `app/api/google/*`) asks for `analytics.readonly` as well as `adwords`. The callback refuses to save a token that lacks `adwords`, so Google Ads keeps working. GA4 is registered like the other connectors: a `ga4` entry in `lib/sync/registry.ts` with `verify` and `sync`, a pure mapping module, and a thin Data API client. The general connect route already accepts `agency-google` without a key. The report's logic lives in a pure module `lib/reports/email-metrics.ts`, and the page is a thin client component on `ReportFrame` and `ReportTable`.

**Tech Stack:** Next.js 16.3.7 route handlers and client components, Supabase (service-role writes, RLS reads), Google Analytics Data API v1beta, Vitest with saved JSON fixtures.

**Spec:** `docs/superpowers/specs/2026-10-11-ga4-email-metrics-design.md`. Also read `docs/superpowers/specs/2026-10-11-connector-foundation-design.md` (registry, `agency-google`) and `docs/superpowers/specs/2026-10-11-messaging-klaviyo-sms-design.md` (data model of `message_stats_daily`).

## Global Constraints

- **Read-only:** the only GA4 calls are `POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:runReport`, which is a read even though it is a POST, and optionally `GET https://analyticsadmin.googleapis.com/v1beta/properties/{id}` for the display name. Nothing is ever written to Google.
- **Privacy line:** only aggregates by date and default channel group are requested and stored. No user, client or session ids, no page paths, no device or geo data, no `user*` dimensions. The fixture tests assert that the request body contains exactly the four metrics and two dimensions below.
- **Request (verified on developers.google.com, 2026-10-13):** `dimensions: [{name:"date"},{name:"sessionDefaultChannelGroup"}]`, `metrics: [{name:"sessions"},{name:"engagedSessions"},{name:"transactions"},{name:"purchaseRevenue"}]`, `limit: 10000` (the API allows up to 250,000), `offset` paging while `offset < rowCount`, `keepEmptyRows: false`, `returnPropertyQuota: true`. `date` comes back as `YYYYMMDD`. Metric values come back as strings. The property path is `properties/<numeric id>`. Scope: `https://www.googleapis.com/auth/analytics.readonly`.
- **Quotas, Standard property (verified):** 200,000 core tokens per property per day and 40,000 per hour, shared with every other tool reading that property (Looker Studio, other agencies). 14,000 tokens per project per property per hour. 10 concurrent requests per property. 10 server errors per project per property per hour; past that, every request from the project to that property is blocked. Running out returns `429 RESOURCE_EXHAUSTED`. Daily quotas reset at midnight Pacific.
- **Freshness (Google help article, not an SLA):** daily data usually arrives within about 12 hours and can change for 24 to 48 hours. Some events arrive up to 7 days late. The sync never asks for today (`createJob` ends at yesterday). The 14-day recent job re-pulls yesterday every day. The report marks yesterday and today as "GA4 still processing".
- **Not verified, settle in Task 7 with the pilot property:** the exact error bodies for a property the login cannot see, a disabled API and a missing scope (the plan assumes 403 with `status: PERMISSION_DENIED` and a reason in `error.details[].reason`); the real token cost per request (recorded from `propertyQuota`); whether `transactions` and `purchaseRevenue` combine with `sessionDefaultChannelGroup` in every property (docs give no restriction; check once with `checkCompatibility` or a live call); the Admin API display-name call.
- **Naming:** the table is `ga4_daily`, as the spec and the Growth Quotient spec call it. The migration takes the next free number at build time. 0011 is already used by plan scenarios, 0012 is reserved by the creative ad-data plan and 0013 by the subscriptions plan.
- `AGENTS.md`: before any route or page code, read the matching guide in `node_modules/next/dist/docs/01-app` (route handlers in `03-api-reference`, client components in `02-guides`). Tasks 1 and 6 touch routes or pages.
- **Wording:** user-facing text says Apex Analytics. Statlas is never named in the UI. The report's layout and copy are our own.

## Dependency on the messaging data sync

The per-message rows of Email Metrics read `message_stats_daily`. That table comes from the messaging data-sync plan (`docs/superpowers/plans/2026-10-13-messaging-data-sync-klaviyo.md`), which may not exist yet. This plan needs these columns, as given in the messaging spec: `client_id, date, source, channel ('email'|'sms'), kind ('campaign'|'flow'), message_id, message_name, recipients, delivered, opens, clicks, unsubscribes, bounces, spam, orders, revenue, revenue_basis`. It also needs these settings in `client_settings.extra`: `emailAttrClickDays`, `emailAttrOpenDays`, `smsAttrClickDays`.

- If that plan has landed and added a repository reader for `message_stats_daily`, Task 4 uses that reader and skips its own.
- If the table is missing, the reader returns `null` and the report runs in GA4-only mode.
- The footer falls back to "attribution window: not recorded" when the settings keys are absent.

Tasks 1 to 4 and 7 do not depend on the messaging plan at all.

## Review Focus

1. **Re-authorizing Google drops or narrows the Ads scope** (the admin unticks a box on Google's granular consent screen). Expected: the old token is kept, Google Ads keeps syncing, and the admin sees "Google Ads permission was not granted; nothing changed". Tested in Task 1.
2. **The agency login cannot see the property, or the ID is a G- measurement ID or a UA ID.** Expected: connecting fails with a message that says what to do ("add the agency Google login as Viewer in GA4 Admin, Property access management" / "use the numeric property ID, not G-…"), and nothing is saved. Tested in Tasks 2 and 3.
3. **A property with sessions but no ecommerce events.** Expected: sessions sync normally; transactions and revenue are 0; the connection shows a note "No purchase events in GA4"; the report says GA4 revenue is unavailable instead of showing a misleading $0 difference. Tested in Tasks 2, 3 and 5.
4. **Quota errors (429 RESOURCE_EXHAUSTED) mid-history, or the server-error budget.** Expected: the chunk fails with "GA4 quota for this property is used up; it retries on the next run". Rows already written for earlier chunks stay. The recent job counts the failure toward "Needs attention". Tested in Tasks 2 and 3.
5. **Freshness:** yesterday and today are incomplete. Expected: they are flagged in the report, re-pulled the next day, and not compared with the platform as if they were final. Tested in Task 5.

---

### Task 1: Google consent adds GA4 without breaking Google Ads

**Files:**
- Create: `lib/google-scopes.ts`, `lib/google-scopes.test.ts`
- Modify: `lib/google.ts`, `app/api/google/install/route.ts`, `app/api/google/callback/route.ts`, `app/api/google/status/route.ts`, `components/settings/StoreSettingsPage.tsx` (`GoogleConnect`, around lines 481-530)

**What the code does today (verified):**
- `GOOGLE_SCOPE` is the `adwords` scope alone. The install route sends that one scope with `access_type=offline` and `prompt=consent`.
- The callback saves `{ refreshToken }` encrypted into `agency_secrets` (provider `google`) without looking at which scopes were granted.
- `accessToken()` is private.
- So the current consent does **not** cover GA4. A one-time re-consent is needed.

**Interfaces:**
- Produces in `lib/google-scopes.ts` (no `server-only`):
  - `ADS_SCOPE`
  - `ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"`
  - `GOOGLE_SCOPES: string[]`
  - `parseGrantedScopes(scope: string | undefined): string[]`
  - `consentOutcome(granted: string[]): "ok" | "ads_missing" | "analytics_missing"`
- Produces in `lib/google.ts`:
  - `export async function agencyAccessToken(): Promise<string>` (the current `accessToken`, renamed and exported, behaviour unchanged)
  - `saveRefreshToken(refreshToken: string, scopes: string[])`
  - `googleAuthState(): Promise<{ authorized: boolean; analytics: boolean }>`. A stored secret with no `scopes` field (today's token) counts as `analytics: false`.
- The status route returns `{ configured, authorized, analytics }`.

- [ ] **Step 1: Write the failing tests** in `lib/google-scopes.test.ts`:
  - `parseGrantedScopes("a b  c")` gives `["a","b","c"]`, and `undefined` gives `[]`.
  - `consentOutcome([ADS_SCOPE, ANALYTICS_SCOPE])` is `"ok"`.
  - `consentOutcome([ANALYTICS_SCOPE])` is `"ads_missing"`.
  - `consentOutcome([ADS_SCOPE])` is `"analytics_missing"`.
  - `GOOGLE_SCOPES` contains both scopes and `GOOGLE_SCOPES.join(" ")` has no comma.
- [ ] **Step 2: Run** `npx vitest run lib/google-scopes.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Read the route handler guide first (AGENTS.md).
  - Install route: `scope = GOOGLE_SCOPES.join(" ")` and add `include_granted_scopes=true`. Keep `prompt=consent` so Google returns a new refresh token.
  - Callback: read `json.scope` from the token response.
    - `ads_missing`: do not save, redirect with `error=google_ads_scope_missing`.
    - `analytics_missing`: save, then redirect with `connected=google_authorization&ga4=missing`.
    - `ok`: save with the scopes.
  - `GoogleConnect` shows a "Re-authorize Google to add GA4 (Google Ads keeps working)" link to `/api/google/install` for admins when `authorized && !analytics`.
  - Map the two new query values to messages where Store Settings already reads `error=` / `connected=`.
  - `googleConfigured()` is unchanged. GA4 calls never send `login-customer-id` or `developer-token`.
- [ ] **Step 4: Run** `npx vitest run lib` and `npx tsc --noEmit`. Expected: PASS, no type errors. `syncGoogle` still imports only `adsSearch`.

### Task 2: GA4 Data API client and pure mapping

**Files:**
- Create: `lib/sync/ga4-map.ts`, `lib/sync/ga4-map.test.ts`, `lib/sync/ga4-fixtures.ts` (anonymised responses: normal, paged in two pages, no-ecommerce, thresholded, 403 permission, 403 scope, 403 service disabled, 429 quota)
- Create: `lib/ga4.ts` (server-only)

**Interfaces:**
- Produces in `lib/sync/ga4-map.ts`:
  - `normalizePropertyId(input: string): { ok: true; id: string } | { ok: false; error: string }`. It accepts `123456789` and `properties/123456789`, with spaces trimmed.
  - `buildRunReportBody(range: SyncRange, offset: number): object`
  - `interface Ga4Row { date: string; channelGroup: string; sessions: number; engagedSessions: number; transactions: number; revenue: number }`
  - `mapRunReport(json: unknown): { rows: Ga4Row[]; rowCount: number; notes: string[]; tokensRemaining?: number }`
  - `describeGa4Error(status: number, json: unknown, propertyId: string): { kind: "no_access" | "scope" | "api_disabled" | "quota" | "not_found" | "unavailable"; message: string }`
  - `hasNoEcommerce(rows: Ga4Row[]): boolean` (sessions > 0 and transactions = 0 over the rows)
- Produces in `lib/ga4.ts`:
  - `runReportAll(propertyId: string, range: SyncRange, deps?: { fetchImpl?: typeof fetch; token?: () => Promise<string>; deadline?: number }): Promise<{ rows: Ga4Row[]; notes: string[]; tokensRemaining?: number }>`
  - `ga4PropertyName(propertyId: string, deps?): Promise<string | null>` (Admin API, `null` on any failure)

- [ ] **Step 1: Write the failing tests** in `lib/sync/ga4-map.test.ts`:
  - `normalizePropertyId(" properties/123456789 ")` gives `{ ok: true, id: "123456789" }`.
  - `"G-AB12CD34"` gives the error "This is a measurement ID (G-…). Use the numeric property ID from GA4 Admin, Property settings."
  - `"UA-1234-1"` gives the error "Universal Analytics IDs are not supported. Use the numeric GA4 property ID."
  - `""` and `"12ab"` give "Enter the numeric GA4 property ID (e.g. 123456789)".
  - `buildRunReportBody` has exactly dimensions `date, sessionDefaultChannelGroup` and metrics `sessions, engagedSessions, transactions, purchaseRevenue`, `keepEmptyRows: false`, `returnPropertyQuota: true`, `limit: 10000`, and no other dimension names (the privacy assertion).
  - `mapRunReport(normal)` turns `"20260901"` into `"2026-09-01"`, parses the string metrics as numbers, and keeps the channel group as given (`"Email"`, `"Unassigned"`).
  - A response with `metadata.subjectToThresholding: true` adds the note "GA4 applied thresholding: small numbers may be hidden".
  - A response with `samplingMetadatas` adds a note on sampling.
  - A response with `dataLossFromOtherRow` adds a note on "(other)".
  - `propertyQuota.tokensPerDay.remaining` is returned as `tokensRemaining`.
  - `describeGa4Error`:
    - 403 permission: kind `no_access`, message "The agency Google login cannot read GA4 property 123456789. In GA4 Admin, Property access management, add the agency Google login as Viewer, then try again."
    - 403 scope: `scope`, "Re-authorize Google in Store Settings to add GA4 access."
    - 403 `SERVICE_DISABLED`: `api_disabled`, "The Google Analytics Data API is not enabled in the agency Google Cloud project."
    - 429: `quota`, "GA4 quota for this property is used up; it retries on the next run."
    - 404 or 400 naming the property: `not_found`.
    - 5xx: `unavailable`.
  - `hasNoEcommerce(noEcommerceFixture)` is true and `hasNoEcommerce(normal)` is false.
- [ ] **Step 2: Run** `npx vitest run lib/sync/ga4-map.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `ga4-map.ts`. Then implement `lib/ga4.ts` on `agencyAccessToken` from Task 1:
  - Page with `offset` until `offset >= rowCount`.
  - Stop and throw "GA4 paging stopped at the deadline" if `deadline` passes.
  - Throw `new Error(describeGa4Error(...).message)` on any non-2xx.
  - No retries inside: the job runner retries a failed chunk at half size.
- [ ] **Step 4: Run** `npx vitest run lib/sync/ga4-map.test.ts`. Expected: PASS.

### Task 3: `ga4_daily`, the sync, and GA4 in the registry

**Files:**
- Create: `supabase/migrations/<next>_ga4.sql`, `lib/sync/run-ga4.ts`
- Modify: `lib/sync/registry.ts`, `lib/sync/registry.test.ts`, `lib/providers.ts`, `lib/providers.test.ts`, `lib/connect.test.ts` (only if a fixture registry needs `syncs`)

**Interfaces:**
- Consumes: `runReportAll`, `ga4PropertyName`, `normalizePropertyId`, `hasNoEcommerce` (Task 2).
- Produces:
  - Table `ga4_daily (client_id uuid references clients(id) on delete cascade, date date, channel_group text, sessions bigint not null default 0, engaged_sessions bigint not null default 0, transactions int not null default 0, revenue numeric not null default 0, updated_at timestamptz not null default now(), primary key (client_id, date, channel_group))`.
  - RLS enabled with policy `ga4_daily_read` for select using `public.has_client_access(client_id)`. No write policy (service role only). `ga4` is already in the 0009 provider check, so that check does not change.
  - `syncGa4(integrationId: string, range: SyncRange, ctx: SyncContext): Promise<void>`
  - `verifyGa4(input: { accountId: string }, deps?): Promise<{ accountName: string; accountId: string }>`
  - `SYNCS.ga4 = { chunkDays: 90, sync, verify }`
  - `PROVIDERS.ga4` gets `available: true` and `syncs: true`, with setup steps:
    1. "In GA4 open Admin, Property access management, and add the agency Google login as Viewer."
    2. "Copy the numeric Property ID from Admin, Property settings (not the G- measurement ID)."
    3. "Paste it below. Apex Analytics checks access with a small report before saving."

- [ ] **Step 1: Write the failing tests.**
  - In `registry.test.ts`, the registry is exactly `ga4, google_ads, meta, shopify` and `SYNCS.ga4.chunkDays` is 90. Mock `./run-ga4` the way `./run-google` is mocked. `getVerifier("ga4")` is a function.
  - The existing rule "syncs means it has a sync" still holds.
  - In `providers.test.ts`, the `available` list gains `ga4` and the `syncs` list becomes `["ga4","google_ads","meta","shopify"]`.
  - Add `lib/sync/run-ga4.test.ts`, with `server-only`, `@/lib/ga4` and `@/lib/supabase/server` mocked by a fake admin client that records calls:
    - Verify on `"G-XXXX"` throws the measurement-ID message without calling `runReportAll`.
    - Verify on `"123456789"` calls `runReportAll` over the last 7 days ending yesterday. It returns `accountId: "123456789"` and `accountName` = the Admin display name, or "GA4 property 123456789" when that is `null`.
    - Verify passes the `no_access` message through unchanged.
    - Sync deletes `ga4_daily` rows for the client and range, then inserts the mapped rows in batches of 500.
    - Sync on the no-ecommerce fixture sets `status: "connected"` with `last_error` = "No purchase events in GA4: transactions and revenue are 0, sessions are fine."
    - Sync on a quota error leaves `ga4_daily` untouched and rethrows. The runner's own tests already cover the half-size retry and the failure counter.
    - The `sync_runs` message includes the tokens remaining.
- [ ] **Step 2: Run** `npx vitest run lib/sync lib/providers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Write the migration (pattern: `0006_order_lines.sql` lines 16-17).
  - Write `syncGa4` following `syncGoogle`: insert a `sync_runs` row, delete then insert, update the coverage dates, `status`, `consecutive_failures: 0` and `last_error` (the note or `null`). On error, set `status: "error"` and rethrow.
  - Register it in `lib/sync/registry.ts` and set the provider flags.
  - The connect route needs no change: `parseConnectBody` already lets `agency-google` through without a key, and `connectProvider` keeps the `accountId` returned by `verify`.
  - Do **not** apply the migration. Ask the strategist first.
- [ ] **Step 4: Run** `npx vitest run lib` and `npx tsc --noEmit`. Expected: PASS. The tick route queues GA4 automatically through `syncableProviderIds()`.

### Task 4: Repository readers and demo data

**Files:**
- Modify: `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`, `lib/types.ts`

**Interfaces:**
- In `lib/types.ts`:
  - `interface Ga4Day { date: string; channelGroup: string; sessions: number; engagedSessions: number; transactions: number; revenue: number }`
  - `interface MessageStatRow { date: string; source: "klaviyo"|"postscript"|"omnisend"; channel: "email"|"sms"; kind: "campaign"|"flow"; messageId: string; messageName: string; recipients: number; delivered: number; opens: number; clicks: number; unsubscribes: number; bounces: number; spam: number; orders: number; revenue: number; revenueBasis: "order"|"send"|"utm" }`
- In the `Repository` interface:
  - `getGa4Days(clientId: string, from: string, to: string): Promise<Ga4Day[] | null>`. It returns `null` when the table is missing (error code `42P01` or a PostgREST "relation does not exist" message) and `[]` when the table exists but has no rows.
  - `getMessageStats(clientId: string, from: string, to: string): Promise<MessageStatRow[] | null>`. Skip this one if the messaging data-sync plan already added an equivalent; then use its name in Tasks 5 and 6.
- Seed data: about 60 days of GA4 rows across eight channel groups, including `Email` and `SMS`, plus about 12 campaigns and 4 flows of message rows for the first seed client. Every other seed client returns `null` for messages, so the GA4-only mode can be seen in demo mode.

- [ ] **Step 1: Implement** both readers with `fetchAll` paging, as `getCohortData` does, mapping snake_case to camelCase. Add the seed generators, deterministic like the existing seed.
- [ ] **Step 2: Verify** with `npx tsc --noEmit` and `npm test`. Expected: no errors, all tests pass.

### Task 5: Email Metrics logic and organic traffic share

**Files:**
- Create: `lib/reports/email-metrics.ts`, `lib/reports/email-metrics.test.ts`

**Interfaces:**
- Consumes: `Ga4Day`, `MessageStatRow` (Task 4); `GroupBy` and `groupDates` from `lib/reports/grouping.ts`; `Tone` from `lib/metrics.ts`.
- Produces:
  - `isMessagingGroup(name: string): boolean`: true when the name contains `email`, `mail` or `sms` (case-insensitive) and does not contain organic, paid, direct, social or display.
  - `PAID_GROUPS: string[]` = Paid Search, Paid Social, Paid Shopping, Paid Video, Paid Other, Display, Cross-network, Audio, Affiliates. This is a strategist decision, see Sizing.
  - `organicTrafficShare(days: Ga4Day[]): { organicPct: number; emailPct: number; sessions: number } | null`. Organic = sessions not in a paid group ÷ all sessions, with email and SMS counted as organic. It returns `null` when there are 0 sessions.
  - `type MessageGrouping = "type" | "channel" | "message"`
  - `buildMessageRows(rows: MessageStatRow[], by: MessageGrouping, time: "daily"|"weekly"|"monthly"): EmailMetricsRow[]`, where each row carries recipients, delivered, opens, clicks, orders, revenue, bounces, spam, unsubscribes and the rates `openRate`, `clickRate`, `rpr`, `unsubRate`, `spamRate`, each a fraction or `null` when the divisor is 0. Open, click, unsubscribe and spam rates divide by `delivered`. RPR divides by `recipients`.
  - `ga4Strip(days: Ga4Day[], platform: { clicks: number; orders: number; revenue: number } | null): { sessions: number; transactions: number; revenue: number; clicksPlusSessions: number | null; diffOrders: number | null; diffRevenue: number | null; noEcommerce: boolean }`
  - `spamTone(rate: number): Tone`: under 0.001 is `good`, 0.001 to 0.002 is `neutral` (shown as caution), above 0.002 is `bad`.
  - `bounceFlag(rate: number): boolean`: true above 0.005.
  - `weakFlows(current: EmailMetricsRow[], history: MessageStatRow[]): Set<string>`: flows whose RPR is under 30% of the median of that flow's own monthly RPR over the 12 months before the range.
  - `provisionalDates(today: string): Set<string>` gives today and yesterday.
  - `mode(messages: MessageStatRow[] | null, ga4: Ga4Day[] | null): "full" | "ga4-only" | "messages-only" | "none"`

- [ ] **Step 1: Write the failing tests** with exact values:
  - Channel group filter:
    - `isMessagingGroup("Email")`, `("SMS")` and `("Klaviyo mail")` are true.
    - `("Organic Search")`, `("Paid Social")`, `("Direct")` and `("Display")` are false.
  - Organic traffic share:
    - Days with Organic Search 400, Email 100, Paid Social 300 and Direct 200 sessions give `organicPct` 0.7 and `emailPct` 0.1.
    - All zeros gives `null`.
  - Message rows and rates:
    - Two campaigns and a flow grouped by `type` give two rows. Grouped by `channel`, email and SMS split. Grouped by `message`, one row per `messageId`, and the same id on several dates sums.
    - A row with `delivered` 0 has `openRate` `null`, never `NaN`.
    - Weekly grouping follows `groupDates`.
  - GA4 strip:
    - `ga4Strip` adds Email and SMS sessions to the platform clicks (`clicksPlusSessions`).
    - With `platform: null` (GA4-only), `clicksPlusSessions` and the diffs are `null`.
    - The no-ecommerce fixture gives `noEcommerce: true` and `diffRevenue: null`.
  - Thresholds:
    - `spamTone(0.0009)` is `good`, `(0.0015)` is `neutral`, `(0.0021)` is `bad`.
    - `bounceFlag(0.006)` is true.
  - `weakFlows`: a flow at RPR 0.2 against a history median of 1.0 is flagged; one at 0.5 is not.
  - `provisionalDates("2026-10-13")` equals `{"2026-10-12","2026-10-13"}`.
  - `mode`:
    - `(null, [])` is `ga4-only`.
    - `(null, null)` is `none`.
    - `([], null)` is `messages-only`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/email-metrics.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions. Keep them pure, with no React and no repository calls.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 6: Email Metrics page, registry, router and checklist

**Files:**
- Create: `components/reports/EmailMetricsReport.tsx`
- Modify: `components/reports/ReportRouter.tsx`, `lib/reports/registry.ts`, `lib/reports/registry.test.ts`, `lib/onboarding-checklist.ts`, `components/settings/ProviderCards.tsx` (GA4 card: when `/api/google/status` says `analytics: false`, show the re-authorize hint instead of the form)

**Interfaces:**
- Consumes: Task 4 readers and all of Task 5.
- Registry: `email-metrics` becomes `status: "ready"` with `needs` removed. The router adds `case "email-metrics": return <EmailMetricsReport />;`. The registry test moves `email-metrics` from the waiting test to the ready list.

- [ ] **Step 1: Update the registry test** (expect `ready`) and add a checklist test in a new `lib/onboarding-checklist.test.ts`: an item with id `ga4` exists. Run `npx vitest run lib/reports/registry.test.ts lib/onboarding-checklist.test.ts`. Expected: FAIL.
- [ ] **Step 2: Implement.** Read the client-component guide first (AGENTS.md).
  - The page uses `useReportRange`, `ReportFrame` and `ReportTable` (heat map, CSV).
  - Controls: Group by type / channel / message, and Time day / week / month.
  - Header: the GA4 strip (sessions, transactions, revenue, and "GA4 vs platform" differences only in `full` mode) and an "Organic and email traffic" tile from `organicTrafficShare`, with the label "GA4 sessions outside paid channel groups".
  - Modes:
    - `ga4-only`: the table is replaced by "Connect Klaviyo, Omnisend or Postscript to see each campaign and flow. GA4 traffic is shown above."
    - `none`: render `WaitingForData` with outline lines (campaigns and flows, rates, GA4 strip).
  - Colour: the spam-rate cells use `spamTone`. Bounce and weak-flow flags are shown as a "check" tone with a tooltip.
  - Provisional days are dimmed (`faint`) with the note "GA4 still processing".
  - Footer: the recorded attribution window (or "not recorded"); "Messaging platforms group engagement by send date and revenue by order date or send date, as each row says"; "Monthly totals are the reliable figure".
  - Checklist: add the item `{ id: "ga4", text: "GA4 connected: agency Google login added as Viewer and the numeric property ID entered", hint: "Check that the property has purchase events" }` under the section "Email, SMS and analytics". If the messaging plan has not created that section yet, create it as section 7.
- [ ] **Step 3: Run** `npx vitest run lib`, `npx tsc --noEmit`, `npx eslint .` (0 errors) and `npm run build`. Expected: all pass.
- [ ] **Step 4: Browser check in demo mode** (`NEXT_PUBLIC_DATA_MODE=seed`, Supabase env vars blank):
  - The first seed client shows message rows plus the GA4 strip.
  - Another seed client shows GA4-only mode.
  - The CSV downloads.
  - The GA4 card appears in Add Connection under analytics.

### Task 7: Live pilot (after the strategist's go)

- [ ] **Step 1:** The strategist confirms the Google Cloud prerequisites (see Sizing). An admin clicks Re-authorize Google, and the Google Ads tick still succeeds the next day.
- [ ] **Step 2:** Apply the migration through the Supabase connector (after the go). Connect the pilot client's property, run a 12-month history, and record in `docs/changelog.md`:
  - the tokens used per chunk;
  - whether any thresholding or sampling notes appeared;
  - the error bodies seen for a wrong property ID;
  - and fill in every "Not verified" line of the Global Constraints.
- [ ] **Step 3:** Compare one full month of sessions, transactions and revenue per channel group with GA4's own Traffic acquisition report (session default channel group). Proposed tolerance: within 2%.
- [ ] **Step 4:** Update `CLAUDE.md` Status and `docs/reports-plan.md` (Email Metrics built, GA4 connector live) and commit when asked.

---

## Self-review

- **Spec coverage:**
  - Auth and re-consent: Task 1.
  - Property ID and verify: Tasks 2 and 3.
  - Table, chunked history and 14-day re-pull: Task 3.
  - Report rows, columns, platform-wins rule, GA4 strip, guardrails and footer: Tasks 5 and 6.
  - Registry and router: Task 6.
  - Pilot comparison: Task 7.
  - The organic traffic share (Growth Quotient input) is computed in Task 5 and shown in the report. The Growth Quotient page itself is a separate, unbuilt spec, and there is no `gq_inputs` table yet.
- **Where this plan differs from the spec:**
  - The spec names the migration `0011_ga4.sql`, but 0011 is taken.
  - The spec's table has no `engaged_sessions`; this plan adds it.
  - The spec's "hard bounce above 0.5%" cannot be computed: `message_stats_daily` stores only `bounces`, so the flag uses all bounces and says so in its tooltip.
  - The spec's "RPR under 30% of the client's own median for that flow" is read as that flow's own monthly history.
- **Type consistency:** `Ga4Row` (sync) and `Ga4Day` (app) differ on purpose: one is stored, one is read. `MessageStatRow` is used by Tasks 4 to 6.
- **Proportion:** signatures and assertions only. No function bodies.

## Sizing

**About 5 working days for Claude**, including one independent review:
- Task 1: 0.5 day
- Task 2: 1 day
- Task 3: 1 day
- Task 4: 0.5 day
- Task 5: 1 day
- Task 6: 0.5 to 1 day
- Task 7 and the review: 0.5 day

**What could blow it up:**
- The Google Cloud consent screen is External and unverified, so Google demands verification for `analytics.readonly`, which can take days to weeks.
- Error bodies or metric combinations differ from the docs.
- The messaging data-sync plan lands with different column names, which means rework in Tasks 4 to 6.

**What the strategist must provide or decide:**
1. In the agency Google Cloud project: enable the Google Analytics Data API (and the Admin API, for property names), and say whether the OAuth consent screen is Internal or External.
2. One admin click on Re-authorize Google.
3. Add the agency Google login as Viewer to each client's GA4 property. This takes a few minutes per property across 30+ clients, done by the strategist or by each client.
4. The pilot client and its property ID.
5. The go-ahead for this phase and for applying the migration.
6. Two decisions: which channel groups count as paid for the organic share (Affiliates and Audio are paid in this plan), and whether "weak flow" means the flow's own history (this plan) or the median across the client's flows.

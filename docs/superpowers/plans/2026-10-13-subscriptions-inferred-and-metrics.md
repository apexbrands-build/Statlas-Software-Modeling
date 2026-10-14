# Subscriptions, stage A2: subscribers, churn and rebills from Shopify orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every client with a ticked subscription channel, Apex Analytics estimates its subscribers from Shopify orders alone (no app key): active, new, cancelled, churn, MRR equivalent, a retention triangle by start month, the next 12 weeks of expected rebills and the interval mix, all shown in the Subscriptions report from stage A1 with the line "Estimated from Shopify orders".

**Architecture:** One row per inferred subscription goes into a new `subscriptions` table (`source = 'inferred'`), rebuilt in SQL from `orders.is_subscription` (A1). A second rebuild fills `subscription_daily` (active, new, cancelled, MRR per day and source). Small read functions return only aggregates (order-count histogram, retention cells, upcoming due dates, interval mix), so the browser never downloads subscriber rows. Every SQL rule has a pure TypeScript twin in `lib/subscriptions/` that the tests pin, the demo (seed) data uses, and a rolled-back SQL fixture check compares against. The report page becomes its own page (cards, the A1 table extended with subscriber columns, triangle, upcoming rebills, mix).

**Tech Stack:** Supabase SQL (plpgsql), Next.js 16 client components, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-subscriptions-design.md` (sections "Inferred subscriptions", "Source per client", "Subscriptions report"; stage A, the subscriber half). Depends on stage A1: `docs/superpowers/plans/2026-10-12-subscriptions-orders-report.md`, which must land first.

## What this plan consumes from A1 (must exist before Task 4)

- `orders.is_subscription boolean` and the SQL functions `mark_subscription_orders(uuid, text[])`, `rebuild_subscription_facts(uuid, date, date)` (A1 migration `0013_subscription_orders.sql`).
- `ExtraSettings.subscriptionChannels: string[]`, `isSubscriptionChannel`, `suggestSubscriptionChannels` (`lib/subscriptions/channels.ts`).
- `runSubscriptionRollup(admin, clientId, channels, range)` (`lib/sync/subscription-facts.ts`) and its call in `finalizeShopify` (`lib/sync/run-shopify.ts`).
- `DailyFact.subOrders`, `subRevenue`, `subNewOrders`, `subNewRevenue` and the same fields on `Totals` (`lib/metrics.ts`).
- `SUBSCRIPTION_COLUMNS`, `buildSubscriptions(facts, by)` (`lib/reports/subscriptions.ts`), `components/reports/SubscriptionsReport.tsx`, the `subscriptions` entry in `lib/reports/registry.ts` (A1 adds it: there is no such entry today) and its case in `components/reports/ReportRouter.tsx`.

## Global Constraints

- Counted orders are A1's: DTC, `order_revenue > 0`, `is_subscription`, `customer_id is not null` (an order with no customer cannot be followed and is left out of subscriber counts; it still counts in A1's order columns).
- Inference rules, verbatim from the spec: cadence = median days between a customer's subscription orders; one order only: the client's median cadence (fallback 30 days when no customer has two orders); `next_billing_at` = last subscription order + cadence; cancelled once no subscription order has come within 1.5 cadences of the last, cancel date = last order + cadence. Rebill rate = share of due rebills that happened, by order index (2nd, 3rd, 4th and later).
- Decisions this plan adds (strategist may overrule at review): (a) a customer whose gap exceeds 1.5 cadences and who later orders again starts a **new** inferred subscription (one row per uninterrupted run, `external_id = '<customer_id>:<run>'`), so churn history shows the lapse and the return; (b) an active subscription whose next date is already past (inside the grace) is expected on the as-of day; (c) MRR equivalent = `next_amount x 30 / interval_days` with day 1, week 7, month 30, year 365; history uses each subscription's current amount over its active days; (d) the rebill rate for upcoming rebills is applied per step (the second future rebill carries the product of two rates).
- Dates are store-timezone dates (`orders.order_date`); "today" for the rebuild is `(now() at time zone clients.timezone)::date`, overridable by a `p_as_of` argument for the checks.
- No email, name or address is read or stored; the customer link is `customer_ref` = Shopify customer id (numeric text, as in `orders.customer_id`). The report never lists subscribers.
- Rebuild functions: `security definer set search_path to 'public'`, start with the `rebuild_cohorts` access check (`auth.role() = 'service_role'` or `has_client_access(p_client)`), `revoke all ... from public`, `grant execute ... to authenticated, service_role` (pattern of `0007_cohorts_and_models.sql`; the browser must be able to call them because client settings are saved from the browser, see Self-review). Read functions: `language sql stable`, run as the caller so row-level security applies, `grant execute ... to authenticated` (pattern of `0010_aov_histogram.sql`).
- Tables: row-level security on, select policy `has_client_access(client_id)`, writes by the rebuild functions and the service role only.
- Migration: the next free number at build time after A1's `0013` (expected `0014_subscriptions_inferred.sql`; the creative ad-level plan holds `0012`). Additive; applied to the live project only after the strategist's go.
- The `subscriptions.source` check already lists the stage B apps (`'inferred','recharge','loop','skio','juo','nextcommerce'`) so stage B does not alter this table.
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/01-app` before touching route or page code (Task 8 edits client components under an existing route; read `02-guides` on client components and data fetching first).
- Division by zero shows "–", never NaN (`div` from `lib/metrics`). Copy is our own; Statlas is never named.

## Review Focus

1. A customer with a single subscription order, one with irregular gaps, one who stops, and one who stops then returns: each gets the right cadence, status, dates and number of rows. Tested in Task 2 and in the SQL fixture check of Task 4.
2. A client with channels ticked but no subscription orders yet, or with the source set to "none": the report shows the A1 order table and a plain notice, never a row of zero subscribers dressed up as data. Tested in Tasks 7 and 1.
3. Retention cells in months that have not happened yet are empty (not 0%), and the newest cohort has only month 0. Tested in Task 3 and Task 7.
4. Upcoming rebills for weekly subscribers inside 12 weeks roll forward several times with compounding rates; a subscription whose next date is already past is expected today, not dropped. Tested in Task 3.
5. Unticking every channel or rebuilding twice leaves no stale inferred rows (the rebuild deletes the client's inferred rows first) and `subscription_daily` matches the rows. Tested in Task 4 (fixture check) and Task 5.

---

### Task 1: Source setting and its rule

**Files:** Create `lib/subscriptions/source.ts`, `lib/subscriptions/source.test.ts`. Modify `lib/types.ts` (`ExtraSettings.subscriptionSource`, `ExtraSettings.subscriptionSourceSetByUser`), `lib/defaults.ts`, `components/settings/EditStoreDialog.tsx` (a "Subscribers from" select beside A1's Subscription switches).

**Interfaces:**
- Produces `type SubscriptionAppId = "recharge" | "loop" | "skio" | "juo" | "nextcommerce"`; `type SubscriptionSource = "none" | "inferred" | SubscriptionAppId`; `SUBSCRIPTION_APP_LABELS: Record<SubscriptionAppId, string>` (Recharge, Loop, Skio, Juo, Next Commerce).
- Produces `interface SourceConnection { provider: SubscriptionAppId; status: string; lastSyncedAt: string | null; consecutiveFailures: number }` (filled by stage B; empty in A2).
- Produces `effectiveSource(setting: SubscriptionSource, hasChannels: boolean, connections?: SourceConnection[]): { source: "none" | "inferred" | SubscriptionAppId; note: string | null }`.
- Produces `sourceLine(source: "none" | "inferred" | SubscriptionAppId, connection?: SourceConnection | null, timeZone?: string): string`.
- Settings defaults: `subscriptionSource: "none"`, `subscriptionSourceSetByUser: false`.

- [ ] **Step 1: Write failing tests:** `defaultExtra()` has `subscriptionSource === "none"` and `subscriptionSourceSetByUser === false`; `effectiveSource("inferred", true)` is `{ source: "inferred", note: null }`; `effectiveSource("inferred", false)` is `none` with note "No subscription channel is ticked, so subscribers cannot be estimated."; `effectiveSource("none", true)` is `none` with note "Subscriber estimates are off. Choose 'Estimated from Shopify orders' in Store Settings, Edit, Sales channels."; `effectiveSource("loop", true, [])` falls back to `inferred` with note "Loop is not connected; showing the estimate from Shopify orders."; `sourceLine("inferred")` is "Estimated from Shopify orders"; `sourceLine("none")` is "".
- [ ] **Step 2: Run** `npx vitest run lib/subscriptions/source.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the module, the two settings fields and the select (options None, Estimated from Shopify orders, and an app only when a connection for it exists: none in A2). Choosing an option sets `subscriptionSourceSetByUser: true`. When A1's channel list goes from empty to non-empty and the source is `none` and not set by the user, the dialog sets it to `inferred`.
- [ ] **Step 4: Run** the test and `npx tsc --noEmit`. Expected: PASS, no errors.

### Task 2: Inference twin

**Files:** Create `lib/subscriptions/infer.ts`, `lib/subscriptions/infer.test.ts`.

**Interfaces:**
- Consumes nothing from earlier tasks.
- Produces `interface SubOrder { customerId: string; date: string; revenue: number }`.
- Produces `interface SubscriptionRecord { source: "inferred" | SubscriptionAppId; externalId: string; customerRef: string | null; status: "active" | "paused" | "cancelled"; startedAt: string; pausedAt: string | null; cancelledAt: string | null; cancelReason: string | null; intervalUnit: "day" | "week" | "month" | "year"; intervalCount: number; nextBillingAt: string | null; nextAmount: number | null; ordersCount: number; skipsCount: number | null; lastOrderAt: string | null; lastPaymentFailed: boolean | null }` (dates `YYYY-MM-DD`; the shape stage B maps every app into).
- Produces `customerCadence(dates: string[]): number | null` (median gap in days, null with fewer than two dates), `clientMedianCadence(orders: SubOrder[]): number` (median of customer cadences, 30 when none), `inferSubscriptions(orders: SubOrder[], asOf: string): SubscriptionRecord[]`.

- [ ] **Step 1: Write failing tests** on fixture orders (as of `2026-10-13`):
  - Customer A orders 2026-06-01, 07-01, 07-31, 08-30, 09-29: one row, `intervalUnit "day"`, `intervalCount 30`, `status "active"`, `startedAt "2026-06-01"`, `nextBillingAt "2026-10-29"`, `ordersCount 5`, `nextAmount` = revenue of 09-29, `externalId "A:1"`, `customerRef "A"`.
  - Customer B irregular 2026-01-10, 02-05, 03-12, 04-07 (gaps 26, 35, 26; 35 is inside 1.5 x 26, so one run): cadence 26; last + 39 days = 2026-05-16 is before as-of, so `cancelled`, `cancelledAt "2026-05-03"`, `nextBillingAt null`.
  - Customer C one order 2026-09-20 with the client median 30 (cadences of A, B, D, E: 30, 26, 30, 30): active, next `2026-10-20`.
  - Customer D 2026-01-01, 01-31, 03-02, then 2026-08-01, 08-31: two rows `D:1` (cancelled `2026-04-01`) and `D:2` (active, `startedAt "2026-08-01"`).
  - Customer E orders 2026-08-09 and 09-08, cadence 30: next date 2026-10-08 is past but inside the grace (until 2026-10-23), so active with `nextBillingAt "2026-10-13"` (the as-of day).
  - `customerCadence([])` and one date give null; `clientMedianCadence([])` is 30; orders out of date order give the same result as sorted ones; two orders on the same day count as one order (gap 0 ignored).
- [ ] **Step 2: Run:** FAIL (module missing).
- [ ] **Step 3: Implement** (dates with `addDays`/`diffDays` from `lib/dates`; median of an even count = mean of the middle two, rounded to whole days).
- [ ] **Step 4: Run:** PASS.

### Task 3: Aggregation twins

**Files:** Create `lib/subscriptions/aggregate.ts`, `lib/subscriptions/aggregate.test.ts`.

**Interfaces:**
- Consumes `SubscriptionRecord` (Task 2).
- Produces `intervalDays(unit: SubscriptionRecord["intervalUnit"], count: number): number`; `monthlyValue(r: SubscriptionRecord): number` (MRR equivalent of one row, 0 without amount).
- Produces `interface SubscriptionDay { date: string; active: number; newSubs: number; cancelled: number; mrr: number }` and `subscriptionDaily(rows: SubscriptionRecord[], from: string, to: string): SubscriptionDay[]` (active at the end of the day: `startedAt <= d` and not cancelled by d).
- Produces `interface OrderCountBin { ordersCount: number; status: SubscriptionRecord["status"]; subs: number }`, `orderCountHistogram(rows): OrderCountBin[]` and `rebillRates(bins: OrderCountBin[]): { 2: number | null; 3: number | null; 4: number | null }` (index k: happened = rows with `ordersCount >= k`; due = happened + cancelled rows with `ordersCount = k - 1`; 4 sums every k >= 4).
- Produces `interface RetentionCell { startMonth: string; offset: number; started: number; active: number }` and `retentionCells(rows, fromMonth: string, asOf: string): RetentionCell[]` (offsets only up to the month of `asOf`).
- Produces `interface DueRow { dueDate: string; firstIndex: number; step: number; subs: number; amount: number }` and `upcomingDue(rows, from: string, days: number): DueRow[]` (active rows only; `firstIndex = min(ordersCount + 1, 4)`; step 1 = `nextBillingAt`, later steps add the interval until past `from + days - 1`).
- Produces `interface IntervalBin { unit: SubscriptionRecord["intervalUnit"]; count: number; subs: number; mrr: number }` and `intervalMix(rows): IntervalBin[]` (active rows).

- [ ] **Step 1: Write failing tests:** `intervalDays("month", 1) === 30`, `("week", 2) === 14`, `("year", 1) === 365`, `("day", 45) === 45`; `monthlyValue` of a 2-week row with amount 50 is `50 * 30 / 14`; daily over the Task 2 fixture: active on 2026-05-02 counts B, on 2026-05-03 does not; `newSubs` on 2026-08-01 is 1 (D:2); the sum of `newSubs` over all days equals the row count; rebill rates on bins `[{ordersCount 1, cancelled, 2}, {2, active, 3}, {3, cancelled, 1}, {5, active, 4}]`: rate 2 = 8/10, rate 3 = 5/5 (the active rows with 2 orders are not due yet), rate 4 and later = 8/9 (k = 4: 4 of 5, k = 5: 4 of 4); no due rebills gives null; retention: a cohort that started in the as-of month has only offset 0, and no cell has an offset beyond the as-of month; upcoming: a weekly row due 2026-10-14 with `ordersCount 3` over 84 days yields steps 1..12 with `firstIndex 4`; a monthly row due today yields steps 1..3; a cancelled row yields nothing; interval mix counts active rows only.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

### Task 4: Migration and the SQL fixture check

**Files:** Create `supabase/migrations/0014_subscriptions_inferred.sql` (number may shift), `supabase/checks/0014_subscriptions_inferred.sql`.

**Interfaces:**
- Consumes A1's `orders.is_subscription`; the rules of Tasks 2 and 3 (the SQL must give the same numbers).
- Produces tables:
  - `subscriptions(client_id uuid, source text, external_id text, integration_id uuid null references integrations(id) on delete set null, customer_ref text, status text check in ('active','paused','cancelled'), started_at date not null, paused_at date, cancelled_at date, cancel_reason text, interval_unit text check in ('day','week','month','year'), interval_count int not null, next_billing_at date, next_amount numeric, currency text, orders_count int not null default 0, skips_count int, last_order_at date, last_payment_failed boolean, updated_at timestamptz default now(); pk (client_id, source, external_id); index (client_id, source, status))`, `source` check in ('inferred','recharge','loop','skio','juo','nextcommerce').
  - `subscription_items(client_id, source, external_id, item_id text, variant_id text, sku text, title text, quantity int, price numeric; pk (client_id, source, external_id, item_id); foreign key (client_id, source, external_id) references subscriptions on delete cascade)`; empty for inferred rows, filled by stage B.
  - `subscription_daily(client_id, source, date, active int, new_subs int, cancelled int, mrr numeric; pk (client_id, source, date))`.
- Produces functions:
  - `rebuild_inferred_subscriptions(p_client uuid, p_as_of date default null) returns int` (deletes the client's `source = 'inferred'` rows, inserts runs per Task 2, returns the row count).
  - `rebuild_subscription_daily(p_client uuid, p_source text, p_as_of date default null) returns void` (deletes and refills the source's days from the earliest `started_at` to the as-of day, per Task 3 `subscriptionDaily`).
  - Read: `subscription_order_histogram(p_client uuid, p_source text)` returns `(orders_count int, status text, subs bigint)`; `subscription_retention(p_client uuid, p_source text, p_from_month date, p_as_of date)` returns `(start_month date, month_offset int, started bigint, active bigint)`; `subscription_upcoming(p_client uuid, p_source text, p_from date, p_days int)` returns `(due_date date, first_index int, step int, subs bigint, amount numeric)`; `subscription_interval_mix(p_client uuid, p_source text)` returns `(interval_unit text, interval_count int, subs bigint, mrr numeric)`.

- [ ] **Step 1: Write the migration** (tables and policies like `0007_cohorts_and_models.sql`; rebuild functions with the access check and grants from Global Constraints; read functions like `0010_aov_histogram.sql`; the run split uses window functions over the customer's ordered subscription orders, `percentile_cont(0.5)` for medians).
- [ ] **Step 2: Write the fixture check:** one script wrapped in `begin; ... rollback;` that inserts a throwaway client and the Task 2 fixture orders (`is_subscription = true`, `is_dtc = true`), calls `rebuild_inferred_subscriptions(client, '2026-10-13')` and `rebuild_subscription_daily(client, 'inferred', '2026-10-13')`, and selects one boolean per Task 2 and Task 3 expectation (row count 6, D has two rows, E's next date is 2026-10-13, B cancelled 2026-05-03, `sum(new_subs) = count(*)`, the histogram and upcoming rows of the Task 3 fixture). Expected after applying: every value `true`. A second section, for a real client, checks `subscription_daily.active` on the last day equals `count(*) filter (where status = 'active')`.
- [ ] **Step 3: Strategist's go, then apply** through the Supabase connector and run the check. Expected: all `true`.

### Task 5: Rebuild wiring

**Files:** Create `lib/sync/subscription-rebuild.ts`, `lib/sync/subscription-rebuild.test.ts`. Modify `lib/sync/run-shopify.ts` (`finalizeShopify`, after A1's `runSubscriptionRollup`), `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts` (`rebuildSubscriptions`), `components/settings/EditStoreDialog.tsx` (after a save that changed `subscriptionChannels`, call `rebuildSubscriptions`).

**Interfaces:**
- Produces `runInferredRebuild(admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }, clientId: string): Promise<void>` (calls `rebuild_inferred_subscriptions` then `rebuild_subscription_daily` with `p_source 'inferred'`, throwing the database message).
- Produces `Repository.rebuildSubscriptions(clientId: string): Promise<void>` (same two calls through the user's session; seed: no-op).

- [ ] **Step 1: Write failing tests** with a fake `rpc`: the two calls happen in order with `{ p_client }` and `{ p_client, p_source: "inferred" }`; an error in the first stops the second and rethrows its message; `finalizeShopify` (mocked deps, as A1's test does) calls `runInferredRebuild` after the subscription rollup when the client has channels, and not when the list is empty and no inferred row exists; a rebuild failure is reported in the run message and does not fail the Shopify job (orders and `daily_facts` are already written).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run lib/sync`: PASS.

### Task 6: Reading the aggregates (live and demo)

**Files:** Create `lib/subscriptions/read.ts`, `lib/subscriptions/read.test.ts`. Modify `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`.

**Interfaces:**
- Consumes `SubscriptionDay`, `OrderCountBin`, `RetentionCell`, `DueRow`, `IntervalBin` (Task 3).
- Produces `interface SubscriptionSummary { histogram: OrderCountBin[]; retention: RetentionCell[]; upcoming: DueRow[]; mix: IntervalBin[] }` and pure mappers `mapDailyRows(rows: Record<string, unknown>[]): SubscriptionDay[]`, `mapSummary(parts: { histogram: Row[]; retention: Row[]; upcoming: Row[]; mix: Row[] }): SubscriptionSummary` (snake_case columns to the twin types, numbers coerced).
- Produces `Repository.getSubscriptionDaily(clientId: string, source: string, from: string, to: string): Promise<SubscriptionDay[] | null>` (select on `subscription_daily`; null when the table is missing, same error test as `getAovHistogram`) and `Repository.getSubscriptionSummary(clientId: string, source: string, asOf: string): Promise<SubscriptionSummary | null>` (the four read functions, retention from 12 months before `asOf`, upcoming 84 days from `asOf`).
- Seed: a deterministic synthetic history per demo client (subscription order counts consistent with the `sub_*` fields A1's seed gives that client), run through `inferSubscriptions` and the Task 3 twins.

- [ ] **Step 1: Write failing tests:** `mapDailyRows` turns `{ date, active: "12", new_subs: 1, cancelled: null, mrr: "300.5" }` into numbers with null as 0; `mapSummary` maps each part and keeps empty arrays empty; the seed repository returns non-empty daily rows and a summary for the first demo client and `null`-free numbers; its active count on the last day equals the active rows of its own synthetic set.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS; `npx tsc --noEmit` clean.

### Task 7: Report builders

**Files:** Create `lib/reports/subscribers.ts`, `lib/reports/subscribers.test.ts`.

**Interfaces:**
- Consumes A1's `buildSubscriptions`, `SUBSCRIPTION_COLUMNS`; `SubscriptionDay`, `SubscriptionSummary`, `rebillRates` (Tasks 3 and 6); `bucketFacts`, `groupDates` (`lib/reports`), `compare`, `div` (`lib/metrics`).
- Produces `interface SubscriberCard { key: string; label: string; value: number | null; format: Format; prev: number | null; yoy: number | null; direction: Direction }` and `buildSubscriberCards(input: { cur: SubscriptionDay[]; prev: SubscriptionDay[]; yoy: SubscriptionDay[]; facts: { cur: DailyFact[]; prev: DailyFact[]; yoy: DailyFact[] }; summary: SubscriptionSummary; asOf: string }): SubscriberCard[]` with, in order: Active subscribers (end of range), New subscribers, Cancelled, Churn in period (cancelled / active the day before the range starts), Subscription revenue, Share of order revenue, % of new customers on subscription, Subscriber AOV, One-time AOV, MRR equivalent (end of range), Expected rebills next 30 days (orders) and (revenue) with no comparison.
- Produces `SUBSCRIBER_COLUMNS: ColumnDef[]` (group "Subscribers": New, Cancelled, Net adds, Active at end, Churn %) and `buildSubscriberTable(facts: DailyFact[], days: SubscriptionDay[], by: GroupBy): NumTable` (A1's columns under group "Orders" after the subscriber columns, same rows and buckets).
- Produces `buildRetentionTriangle(cells: RetentionCell[]): { months: string[]; rows: { startMonth: string; started: number; pct: (number | null)[] }[] }`.
- Produces `buildUpcomingWeeks(due: DueRow[], rates: ReturnType<typeof rebillRates>, from: string): { weekStart: string; expectedOrders: number; expectedRevenue: number; dueOrders: number }[]` (12 weeks; probability for a step = product of `rate(min(firstIndex + j, 4))` for j < step; a null rate counts as 1 and sets `ratesMissing`).
- Produces `buildIntervalMix(mix: IntervalBin[]): { label: string; subs: number; share: number | null; mrr: number }[]` with `intervalLabel(unit, count)` ("Weekly", "Every 2 weeks", "Monthly", "Every 2 months", "Every 3 months", "Other"; inferred day counts map to the nearest: up to 10 days weekly, 11 to 20 every 2 weeks, 21 to 45 monthly, 46 to 75 every 2 months, 76 to 120 every 3 months).

- [ ] **Step 1: Write failing tests:** cards over a fixture month: churn = cancelled / active on the day before; a range starting before the first subscriber gives churn null (shown "–"); `prev` and `yoy` come from their own day arrays; expected rebills next 30 days apply the rates and ignore days after 30; table: net adds = new - cancelled, active at end is the last day of the bucket, churn per bucket uses the day before the bucket, A1 columns are unchanged from `buildSubscriptions` for the same facts; triangle: future offsets are null, offset 0 of a cohort is 100% when nobody cancelled in the start month; upcoming: two steps with rates 0.8 and 0.9 give 0.72 x amount on the second step; a week with nothing due has zeros, not missing; interval labels for (`day`, 28) Monthly, (`week`, 2) Every 2 weeks, (`month`, 1) Monthly, (`month`, 6) Other; no NaN anywhere when every input is empty.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

### Task 8: The report page

**Files:** Modify `components/reports/SubscriptionsReport.tsx` (A1's page, rebuilt as its own page on `ReportFrame`, `useReportRange` and `MetricsTable`, like `AovHistogramReport.tsx`); create `components/reports/SubscriberSections.tsx` (triangle, upcoming, mix).

**Interfaces:**
- Consumes `effectiveSource`, `sourceLine` (Task 1); the repository methods of Task 6; the builders of Task 7; `comparisonRange` (`lib/dates`); `MetricTile` (`components/MetricTile.tsx`) for the cards.

- [ ] **Step 1: Read** `node_modules/next/dist/docs/01-app` guides on client components and data fetching (AGENTS.md).
- [ ] **Step 2: Implement** the page: the source line under the title (`sourceLine`), the note from `effectiveSource` when there is one; A1's channel banner when no channel is ticked; cards with "vs previous period" and "vs last year" (both fetched with `comparisonRange("prev" | "yoy", range)`); the merged table with Group By; the retention triangle (start month rows, months since start columns, % still active, a line "Pauses are not in the history"); upcoming rebills by week (expected orders and revenue, with "Rebill rates by order: 2nd x%, 3rd y%, 4th and later z%"); the interval mix. Limits shown once at the bottom for the inferred source: "Estimated: no skips, pauses or cancel reasons; a customer with several subscriptions counts once; amounts come from the last subscription order." With source `none` only A1's table and the note show.
- [ ] **Step 3: Verify:** `npx tsc --noEmit`, `npx eslint .` (0 errors), `npm test`, `npm run build`; then the seed-mode dev server (`NEXT_PUBLIC_DATA_MODE=seed`, Supabase env vars blank): Reporting, Subscriptions shows the source line, cards, table, triangle and upcoming weeks with no NaN, at phone width too.

### Task 9: Docs and the live check

**Files:** Modify `docs/reports-plan.md`, `docs/changelog.md`, `CLAUDE.md`, `docs/connector-setup.md` (the "Subscription channels" note gets "Subscribers from").

- [ ] **Step 1: Write the docs** (what is estimated, the rules, the limits).
- [ ] **Step 2: Live check (strategist, after Task 4 is applied and one Shopify sync has finalized):** on a client using Recharge, Loop or Skio, open Subscriptions for the last full month and compare active subscribers, new and cancelled with the app's own dashboard; a gap above about 15% is expected for clients where customers hold several subscriptions or pause often; note the numbers in `docs/changelog.md`, since they tell stage B how much a connector adds.

---

## Self-review

- **Spec coverage:** inferred rows, cadence, next date, the cancel rule, rebill rate by order index, the source setting, the source line, cards (active, new, cancelled, churn, revenue and share, attach, subscriber vs one-time AOV, MRR, expected rebills 30 days), the table (new, cancelled, net adds, active, churn, orders, revenue, share, attach, AOV), the retention triangle, upcoming rebills and the interval mix are covered. Not here: skip and failed-payment rates, cancel reasons and top products (connector data, stage B), the forecast split and Home section (stage C).
- **Contradictions found in the repo:** (1) A1 Task 3 says a settings change reruns the rollup through "the route or action that saves client settings", but settings are saved from the browser (`SupabaseRepository.saveSettings`, a direct upsert), and A1 makes its functions service-role only, so A1 needs a small server route or browser-callable functions with an access check; this plan uses the latter (the `rebuild_cohorts` pattern). (2) A1 says the rollup functions are revoked from public "as the other rollup functions are", but `rebuild_daily_facts` and `recompute_first_orders` (0005) have no revoke or grant lines. (3) The multi-store spec names `daily_facts.rebill_revenue` and `rebill_orders`; A1 stores `sub_orders` and `sub_new_orders` and derives rebills, which this plan follows. (4) `localDate` lives privately in `lib/sync/run-shopify.ts`; stage B moves it to `lib/dates.ts`.
- **Deviation on purpose:** one inferred row per uninterrupted run instead of per customer (decision (a)); the TypeScript twins duplicate the SQL so rules are testable and the demo has data.
- **Type consistency:** `SubscriptionRecord`, `SubscriptionDay`, `OrderCountBin`, `RetentionCell`, `DueRow`, `IntervalBin`, `SubscriptionSummary`, `effectiveSource`, `sourceLine`, `runInferredRebuild`, `rebuildSubscriptions`, `getSubscriptionDaily`, `getSubscriptionSummary` are spelled the same in every task.
- **Proportion:** nine tasks, signatures and assertions only.

**Sizing:** about 4.5 working days for Claude (test first, plus one independent review): SQL and twins 2 days, report and seed 1.5, wiring, check and docs 1. What could blow it up: the run-splitting SQL on large clients (a slow rebuild inside the 60-second task would move it to its own job), the twins drifting from the SQL (the fixture check catches it), and A1 landing with different names. From the strategist: the go for the migration, a client whose app dashboard can be compared, and a yes or no on decisions (a) to (d).

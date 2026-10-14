# Subscriptions, stage C: split returning revenue into subscription rebills and other returning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For a client with a subscription source, the plan's returning revenue becomes two parts that always add up to the returning total: **Subscription rebills (expected)**, built from the subscription schedule, and **Other returning (model)**, the existing cohort model fed with non-subscription repeat revenue only. Scheduled rebills inside the next 30 to 60 days become fixed daily values, so daily targets spike on rebill days; Home gets a Subscriptions section. Clients without a subscription source see no change anywhere.

**Architecture:** One migration adds a non-subscription revenue column to `cohort_periods` (the cohort rebuild splits repeat orders on `orders.is_subscription`) and `plan_targets.sub_revenue`. A pure forecaster (`lib/planning/subscription-forecast.ts`) turns the stage A2 `subscriptions` table into expected rebills per day and per month. A pure split module (`lib/planning/returning-split.ts`) owns the month inputs of both parts (model, override, lock) and keeps `PlanMonthInputs.returningRevenue` equal to their sum, so Summary, the stretch solver, the Plan P&L and Home keep reading the one field they read today. `generateMonth` places the subscription part on its scheduled days and spreads the rest as now.

**Tech Stack:** Supabase SQL (plpgsql), Next.js 16 client components, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-subscriptions-design.md`, section "Forecast (stage C)" (approved), and `docs/superpowers/specs/2026-10-13-multi-store-group-design.md`, section "Subscription layer" (fixed daily values for the next 30 to 60 days, weekday-weighted spread beyond, the month reconciles to the Returning model).

**Depends on:**
- **Stage A1** (`docs/superpowers/plans/2026-10-12-subscriptions-orders-report.md`): `orders.is_subscription`, `daily_facts.sub_orders`, `sub_revenue`, `sub_new_orders`, `sub_new_revenue`, the same four fields on `DailyFact` and `Totals` (`subOrders`, `subRevenue`, `subNewOrders`, `subNewRevenue`), `ExtraSettings.subscriptionChannels`, `runSubscriptionRollup` in `lib/sync/subscription-facts.ts`. Rebill revenue of a day = `subRevenue - subNewRevenue` (A1 does not store a separate rebill column; the multi-store spec's `rebill_revenue` / `rebill_orders` are this same difference and are not added).
- **Stage A2** (inferred `subscriptions` table, planned by another writer; connectors fill the same table later). This plan reads it through one adapter (Task 1), so a naming difference in A2 is fixed in one file. The contract is below.

### Contract with stage A2 (check A2 against this list)

| Needed | Exact shape this plan reads | Used for |
|---|---|---|
| `subscriptions.client_id` | uuid | scope |
| `subscriptions.source` | text: `inferred`, `loop`, `skio` (later `recharge`, ...) | read only the client's chosen source |
| `subscriptions.status` | text: `active`, `paused`, `cancelled` | only `active` rows produce rebills |
| `subscriptions.next_billing_at` | date or timestamptz, nullable | first expected rebill date |
| `subscriptions.next_amount` | numeric, store currency, nullable | amount of each rebill |
| `subscriptions.interval_unit`, `interval_count` | text `day` / `week` / `month` / `year`; int >= 1 | roll-forward |
| `subscriptions.orders_count` | int (orders so far, first order included) | rebill index of the next rebill (`orders_count + 1`) |
| `ExtraSettings.subscriptionSource` | `"none" \| "inferred" \| "loop" \| "skio"`, default `"none"` | the switch (spec "Source per client") |
| Rebill rate by order index | `{ second: number; third: number; later: number }`, fractions 0 to 1 | probability a due rebill lands |
| Client median cadence | days, number | first rebill of new subscribers |
| Repository reads | `getSubscriptions(clientId): Promise<SubscriptionRecord[] \| null>` (null = table missing) and `getSubscriptionDaily(clientId, from, to)` with per-day `active`, `new`, `cancelled` | forecast; Home section |

If A2 lands without the rebill rates or the median cadence as an exported pure function, Task 1 adds `subscriptionStats(facts, subs)` computing them from A1's daily facts and the table (rates from `orders_count` and status per index; cadence = median of the interval in days over active rows). No other task changes.

## Global Constraints

- **The split is on only when** `subscriptionSplitOn(settings, subs)` is true: `settings.extra.subscriptionSource !== "none"`, `settings.extra.subscriptionChannels.length > 0` and at least one `active` row of that source. Otherwise every screen, number and saved row is exactly what it is today (same `generateMonth` output, no `sub_revenue` written).
- **Invariant:** for every plan month, `returningRevenue = otherPart + subPart`, where `otherPart = returningOverride ?? returningModel` and `subPart = subOverride ?? subModel`. Only `resolveReturning` in `lib/planning/returning-split.ts` writes `returningRevenue` for a split month.
- **No double counting:** "Other returning" is fed only with non-subscription repeat revenue, both in the cohort periods (`revenue_non_sub`) and in the actual monthly returning revenue the model calibrates on (`returningOrderRevenue - (subRevenue - subNewRevenue)`). `cohort_stats` (`rev_60d`, `rev_365d`, the New Customer Model's LTV multipliers) is not changed: a new customer's LTV still includes their rebills.
- Expected rebill of one due date = `next_amount x P(index)`; `P` chains the client's own rebill rates by index (`second`, `third`, `later` for 4th and after), which is the subscriber survival curve in rebill steps. No second churn factor is applied on top (it would count churn twice; see Self-review).
- Fixed daily values only for dates in `(lastData, lastData + horizonDays]`; `horizonDays` is a Returning model setting, `30 | 45 | 60`, default `60` for a connector source and `30` for `inferred`. Past the horizon the subscription part is a month total spread with the weekday weights, like today.
- The schedule is stored in the month's inputs when the strategist presses Create forecast; it is never recomputed live, so a locked month and a saved plan do not move when the `subscriptions` table refreshes.
- Migration `00NN_subscription_forecast.sql`: the next free number at build time, after A1's `0013` and A2's; additive; applied to the live project only after the strategist's go. Before it is applied, a client without the split works unchanged (`sub_revenue` is written only when a row carries it, like the scenario columns in `createPlan`).
- No route or page file is touched. If a task finds it needs one, read the matching guide in `node_modules/next/dist/docs/01-app` first (`AGENTS.md`).
- Tests only in `lib/**/*.test.ts`; components are checked by `npx tsc --noEmit`, `npx eslint .`, `npm run build` and the seed-mode browser check (`NEXT_PUBLIC_DATA_MODE=seed`, Supabase env vars blank).
- Division by zero shows a dash (`div` from `lib/metrics`); the software is **Apex Analytics** in every label and note.

## Review Focus

1. **Double counting (a rebill in both parts):** a rebill order must sit in the subscription part only. Holes: cohorts built before the migration (`revenue_non_sub` null), `actualReturning` still the full returning revenue, a source chosen with no channel ticked, a total override typed before the split. Tested in Tasks 3 (stale cohorts, actuals minus rebills), 1 (no channels means off) and 5 (legacy override converted).
2. **A client with no subscriptions:** `generateMonth`, `forecastReturning` inputs, the stretch solver and Home produce deep-equal results to today, and no `sub_revenue` column is written. Tested in Tasks 1, 3, 6, 9 and 10.
3. **A plan-locked month:** Create forecast and Regenerate skip it, its stored schedule keeps its daily rows identical after the `subscriptions` table changes, and the per-part locks never unlock it. Tested in Tasks 5 and 6.
4. **The stretch plan:** with the split on, stretch returning = other model for the stretch's new revenue + subscription part with the extra new subscribers; locked and ended months keep their numbers; without the split the stretch is byte-identical to today. Tested in Task 9.
5. **Horizon ending mid-month:** days up to the horizon carry the schedule, the remaining days share only the projected remainder, and the month total equals the subscription model for that month; a strategist override below the scheduled sum scales the scheduled days rather than going negative. Tested in Task 6.

---

### Task 1: Adapter, the switch and the stats

**Files:** Create `lib/subscriptions/schedule-input.ts`, `lib/subscriptions/schedule-input.test.ts`.

**Interfaces:**
- Consumes: A2's `SubscriptionRecord` (via the contract above); `ClientSettings` (`extra.subscriptionSource`, `extra.subscriptionChannels`).
- Produces: `interface ScheduleSub { id: string; status: "active" | "paused" | "cancelled"; nextBillingAt: string | null; nextAmount: number; intervalDays: number | null; intervalUnit: "day" | "week" | "month" | "year"; intervalCount: number; ordersCount: number }`; `toScheduleSubs(rows: SubscriptionRecord[], source: string): ScheduleSub[]` (rows of that source only, dates cut to `YYYY-MM-DD`, null amount becomes 0); `subscriptionSplitOn(settings: ClientSettings, subs: ScheduleSub[]): boolean`; `interface SubscriptionStats { rebillRate: { second: number; third: number; later: number }; medianCadenceDays: number; attachRate: number | null; newSubAmount: number | null }`; `rebillProbability(stats: SubscriptionStats, index: number): number` (index 2 → second, 3 → third, 4+ → later, clamped 0 to 1); `attachStats(facts: DailyFact[], asOf: string, days: number): { attachRate: number | null; newSubAmount: number | null }` (`sum(subNewOrders) / sum(newOrders)` and `sum(subNewRevenue) / sum(subNewOrders)` over the window, null on zero).

- [ ] **Step 1: Write failing tests:** `subscriptionSplitOn` is false for source `"none"`, false for `"inferred"` with `subscriptionChannels: []`, false when every row is `cancelled` or `paused`, true for `"skio"` with one channel and one active row; `toScheduleSubs` drops rows of another source and maps `next_billing_at: "2026-11-03T09:00:00Z"` to `"2026-11-03"`; `rebillProbability` gives `second` for 2, `third` for 3, `later` for 4 and 9, and 1 for a rate of 1.4; `attachStats` over 30 fixture days with 100 new orders and 25 subscription first orders gives `attachRate` 0.25, and `null` with 0 new orders.
- [ ] **Step 2: Run** `npx vitest run lib/subscriptions/schedule-input.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the types and functions. If A2 exports rate and cadence functions, re-export them here under these names; if not, add `subscriptionStats(subs: ScheduleSub[], facts: DailyFact[]): SubscriptionStats` with its own tests (rates per index from active vs cancelled rows that reached that index; cadence = median `intervalDays`).
- [ ] **Step 4: Run** the test. Expected: PASS.

### Task 2: Migration: non-subscription cohort revenue and `plan_targets.sub_revenue`

**Files:** Create `supabase/migrations/00NN_subscription_forecast.sql`, `supabase/checks/00NN_subscription_forecast.sql`; modify `lib/sync/subscription-facts.ts` (A1) and its test.

**Interfaces:**
- Produces: `cohort_periods.revenue_non_sub numeric` and `cohort_periods.orders_non_sub int` (both nullable: null = built before this migration); `plan_targets.sub_revenue numeric` (nullable; a slice of `returning_revenue`); `public._rebuild_cohorts_core(p_client uuid) returns void` (no access check, `security definer set search_path to 'public'`, executable by nobody but the owner: revoke from public, anon, authenticated); `public.rebuild_cohorts(p_client uuid)` keeps its signature, grants and access check and now calls the core.
- The core is today's body of `rebuild_cohorts` (0007) with one change: `_repeat` also selects `o.is_subscription as sub`, and the `cohort_periods` insert adds `sum(rev) filter (where not sub)` and `count(*) filter (where not sub)`. `cohort_stats` insert is unchanged.
- Backfill at the end of the migration: `for c in select distinct client_id from cohort_stats loop perform public._rebuild_cohorts_core(c); end loop;` (the public function would raise "no access" in the migration's session, which has no `auth.uid()`).
- `runSubscriptionRollup(admin, clientId, channels, range)` gains a fourth call, `rebuild_cohorts`, only when it is called for a channel-list change (new optional parameter `opts?: { rebuildCohorts?: boolean }`, true from the settings-save caller), so ticking a channel also refreshes the cohort split.

- [ ] **Step 1: Write the failing test** in `lib/sync/subscription-facts.test.ts`: with `{ rebuildCohorts: true }` the fake `rpc` sees `mark_subscription_orders`, `rebuild_subscription_facts`, `rebuild_cohorts` (args `{ p_client }`) in that order; without it, `rebuild_cohorts` is never called; an error from `rebuild_cohorts` rethrows its message. Run: FAIL.
- [ ] **Step 2: Write the migration** (pattern: 0007 for the function, 0005 for additive columns) **and implement** the runner option. Run the test: PASS.
- [ ] **Step 3: Write the check script** (not run by tests): per cohort month, `sum(revenue_non_sub) <= sum(revenue)`; for a client with ticked channels, `sum(revenue) - sum(revenue_non_sub)` over all periods equals the revenue of DTC, revenue > 0, `is_subscription`, non-first orders of customers who have a first order in the store; no `revenue_non_sub` is null after the backfill. Expected after applying: true, equal, 0 nulls.

### Task 3: Cohort and actuals inputs for "Other returning"

**Files:** Modify `lib/planning/returning.ts` (type only), `lib/repository/supabase.ts` (`getCohortData`), `lib/repository/seed.ts` (`getCohortData`), `lib/repository/types.ts` (doc comment); create `lib/planning/other-returning.ts`, `lib/planning/other-returning.test.ts`.

**Interfaces:**
- Produces: `CohortRow.otherPeriods?: number[]` (non-subscription repeat revenue per period; absent when the column is null for any period of that cohort); `getCohortData` also returns `splitReady: boolean` (true when every period row has `revenue_non_sub` not null); `otherReturningInputs(cohorts: CohortRow[], facts: DailyFact[], lastComplete: string, splitOn: boolean): { cohorts: CohortRow[]; actualReturning: Record<string, number>; stale: boolean }`. With `splitOn` false: `cohorts` is the same array and `actualReturning` = monthly `returningOrderRevenue` (what `ReturningModel.tsx` and `stretch-plan.ts` build today). With `splitOn` true: each cohort's `periods` replaced by `otherPeriods`, `actualReturning[m] = max(0, returningOrderRevenue - (subRevenue - subNewRevenue))`, and `stale` true (cohorts kept as they are) when any cohort has no `otherPeriods`.
- Seed: demo cohorts get `otherPeriods = periods x 0.7` for the demo client that has a subscription share (A1 seeds one), so the split can be seen in demo mode.

- [ ] **Step 1: Write failing tests:** `splitOn` false returns the input `cohorts` by reference and the plain monthly sums (deep-equal to the old inline code on a fixture); `splitOn` true on three cohorts with `otherPeriods` uses them and leaves `firstRevenue` alone; a month with returning 10,000, `subRevenue` 4,000 and `subNewRevenue` 1,000 gives actual other returning 7,000; a month where rebills exceed returning (bad data) gives 0, not negative; one cohort without `otherPeriods` gives `stale: true` and the full periods; only months up to `lastComplete` are in `actualReturning`.
- [ ] **Step 2: Run** `npx vitest run lib/planning/other-returning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the function and the repository mapping (`revenue_non_sub` read with `n()` only when not null).
- [ ] **Step 4: Run** the test and `npx tsc --noEmit`. Expected: PASS, no errors.

### Task 4: The subscription forecaster

**Files:** Create `lib/planning/subscription-forecast.ts`, `lib/planning/subscription-forecast.test.ts`.

**Interfaces:**
- Consumes: `ScheduleSub`, `SubscriptionStats`, `rebillProbability` (Task 1); `addDays`, `addMonths`, `endOfMonth`, `diffDays` from `lib/dates`.
- Produces:
  - `interface SubscriptionForecastInput { subs: ScheduleSub[]; stats: SubscriptionStats; lastData: string; horizonDays: number; to: string; plannedNewOrders: Record<string, number>; actualRebillsByDay: Record<string, number> }` (`plannedNewOrders`: month key → new-customer orders the plan expects; `actualRebillsByDay`: `subRevenue - subNewRevenue` for the elapsed days of the current month).
  - `interface SubscriptionMonth { month: string; actual: number; scheduled: number; projected: number; newSubscribers: number; total: number }`.
  - `interface SubscriptionForecast { horizonEnd: string; daily: Record<string, number>; months: SubscriptionMonth[] }` (`daily` = elapsed days of the current month (actual) plus every date in `(lastData, horizonEnd]` with its expected rebills, zero days omitted; values rounded to cents).
  - `forecastSubscriptions(input: SubscriptionForecastInput): SubscriptionForecast`.
- Rules (the tests pin each one):
  - Only `active` rows with `nextAmount > 0`, a `nextBillingAt` and a valid interval count.
  - Each row produces due dates `nextBillingAt`, then `+ intervalCount x intervalUnit` (day/week with `addDays`, month/year with month arithmetic that keeps the day of month, clamped to the month's last day) up to `to`.
  - A due date on or before `lastData` (overdue in an inferred schedule) rolls forward by whole intervals to the first date after `lastData`; it keeps the probability of the next index (no spike on the first forecast day).
  - Expected value of the k-th due date (k = 1 first) = `nextAmount x product of rebillProbability(ordersCount + j) for j = 1..k`.
  - Dates in `(lastData, horizonEnd]` add to `daily` and to the month's `scheduled`; later dates add to `projected`.
  - New subscribers: for each month key after `lastData`'s month, `plannedNewOrders[m] x attachRate` start on day 15 of that month; for `lastData`'s own month only the share of days after `lastData` counts. Their rebills fall every `medianCadenceDays` from the start, amount `newSubAmount`, probability chain from index 2; they always go to `newSubscribers`, never into `daily`. `attachRate` or `newSubAmount` null means no new subscribers.
  - `total = actual + scheduled + projected + newSubscribers`; months from `lastData`'s month to `to`.

- [ ] **Step 1: Write failing tests** with `lastData = "2026-10-15"`, `horizonDays = 30` (`horizonEnd = "2026-11-14"`), rates `{ second: 0.8, third: 0.9, later: 0.95 }`:
  - one monthly sub, `ordersCount` 1, next `2026-10-20`, amount 50: `daily["2026-10-20"] = 40`, `daily["2026-11-20"]` undefined, November `projected = 50 x 0.8 x 0.9 = 36`, December `projected = 36 x 0.95 = 34.2`;
  - a weekly sub (`ordersCount` 1, amount 20) due `2026-10-17` lands in `daily` on 17 Oct, 24 Oct, 31 Oct, 7 Nov and 14 Nov with 16, 14.4, 13.68, 13.0, 12.35 (rounded to cents), and 21 Nov is `projected`;
  - a `paused` and a `cancelled` row add nothing; a row with `nextAmount` 0 adds nothing;
  - overdue `nextBillingAt = "2026-10-01"` monthly moves to `2026-11-01` with probability `second`;
  - `plannedNewOrders["2026-12-01"] = 200`, `attachRate` 0.25, `newSubAmount` 40, cadence 30: 50 subscribers starting `2026-12-15` give December `newSubscribers` 0 and January `newSubscribers = 50 x 40 x 0.8 = 1,600`; October's planned orders count only 16 of 31 days;
  - `actualRebillsByDay` for 1 to 15 October appear in `daily` and in October `actual`;
  - every month's `total` equals the sum of its four parts, and `sum(daily over a month's dates after lastData) = scheduled` of that month;
  - an empty `subs` list with null attach rate gives all-zero months and an empty `daily` (apart from actuals).
- [ ] **Step 2: Run** `npx vitest run lib/planning/subscription-forecast.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `forecastSubscriptions`.
- [ ] **Step 4: Run** the test. Expected: PASS.

### Task 5: Month inputs of the two parts (model, override, lock)

**Files:** Modify `lib/planning/types.ts` (`PlanMonthInputs`), `lib/planning/models.ts` (`ReturningSettings`, `ReturningResults`, `DEFAULT_RETURNING`); create `lib/planning/returning-split.ts`, `lib/planning/returning-split.test.ts`.

**Interfaces:**
- `PlanMonthInputs` new optional fields: `subModel?: number` (expected rebills for the month, from Create forecast); `subOverride?: number | null`; `subDaily?: Record<string, number>` (the forecast's `daily` values that fall in this month); `subFixedThrough?: string` (the forecast's `horizonEnd`); `subLocked?: boolean`; `otherLocked?: boolean`. Doc comments of `returningModel` / `returningOverride` say: for a split month they hold **Other returning**; without the split they hold the whole returning line (unchanged meaning).
- `ReturningSettings.horizonDays?: 30 | 45 | 60` (missing = the source's default, Global Constraints); `ReturningResults.months[]` gains optional `sub` and `other`.
- Produces:
  - `isSplitMonth(i: PlanMonthInputs): boolean` (`subModel !== undefined`).
  - `resolveReturning(i: PlanMonthInputs): PlanMonthInputs` (sets `returningRevenue` from the invariant; a non-split month is returned unchanged).
  - `applyReturningForecast(i: PlanMonthInputs, f: { other: number; sub: SubscriptionMonth | null; subDaily: Record<string, number>; horizonEnd: string }): { inputs: PlanMonthInputs; convertedOverride: boolean }`: writes `returningModel = round(other)` unless `otherLocked`; when `sub` is given writes `subModel = round(sub.total)`, `subDaily`, `subFixedThrough` unless `subLocked`; when `sub` is null clears every `sub*` field (split switched off: back to today's single line). A month that was not split and has a `returningOverride` becomes split with `returningOverride = max(0, old - subModel)` and `convertedOverride: true` (the old number was a total). Ends with `resolveReturning`.
  - `setPartOverride(i, part: "sub" | "other", v: number | null): PlanMonthInputs` (`v <= 0` or null clears it) and `setPartLock(i, part, locked: boolean): PlanMonthInputs`, both ending with `resolveReturning`.
  - `combineReturning(other: ReturningResult, sub: SubscriptionForecast | null): { month: string; kind: "actual" | "forecast"; other: number; sub: number; total: number }[]` (sub 0 for every month when null; `total = other + sub`).
- The plan-month lock stays where it is: `editInputs` in `PlanEditor.tsx` already ignores a locked month, and Create forecast skips locked months; the part locks are inside an unlocked month.

- [ ] **Step 1: Write failing tests:** a month without `sub*` passes through `resolveReturning` and `applyReturningForecast(..., sub: null)` deep-equal to the old behaviour (`returningModel` set, `returningRevenue = override ?? model`); split month: model other 30,000 and sub 12,000 give `returningRevenue` 42,000; sub override 15,000 gives 45,000; clearing it gives 42,000 again; `otherLocked` keeps `returningModel` when the forecast says 31,000 while the sub part updates; `subLocked` keeps `subModel`, `subDaily` and `subFixedThrough`; a non-split month with `returningOverride` 50,000 and sub 12,000 becomes override 38,000 with `convertedOverride: true` (total stays 50,000, no rebill counted twice); `sub: null` on a split month removes every `sub*` field and returns to one line; `combineReturning` totals add up per month.
- [ ] **Step 2: Run** `npx vitest run lib/planning/returning-split.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and `npx tsc --noEmit`. Expected: PASS.

### Task 6: Daily rows: rebill days in `generateMonth`, `sub_revenue` saved and read

**Files:** Modify `lib/planning/generate.ts`, `lib/planning/generate.test.ts`, `lib/types.ts` (`PlanTargetDay.subRevenue?: number`), `lib/metrics.ts` (`PlanTotals.subRevenue: number | null`, `aggregatePlan`), `lib/metrics.test.ts`, `lib/repository/supabase.ts` (`savePlanMonths`, `getPlanTargets`), `lib/repository/seed.ts` (keeps `subRevenue` on saved rows).

**Interfaces:**
- Produces: `generateMonth` output rows carry `subRevenue` only for a split month (`isSplitMonth(inputs)`); every other field keeps its meaning and `returningRevenue` of a day = its subscription slice + its other slice.
- Day placement for a split month, with `T = subOverride ?? subModel`, `S` = sum of `subDaily` over the month's dates, fixed days = dates up to `subFixedThrough`, free days = the rest:
  - fixed days take `subDaily[d] ?? 0`; free days share `T - S` by the returning day weights (`wReturning`, events included);
  - when `T < S` or the month has no free days, the fixed days are scaled by `T / S` and free days get 0; when `S = 0`, `T` is spread over all days by the weights.
  - The other slice is `distribute(otherPart, d => ov[d]?.returningRevenue === undefined ? undefined : max(0, ov[d].returningRevenue - sub[d]), wReturning)`: a fixed day from the Spend step keeps its total and the other slice absorbs it; it cannot cut the scheduled rebills of that day (Spend step shows the day's rebills under the field, Task 8).
  - Orders, P&L lines and CM are computed from the day's `returningRevenue` as today.
- `PlanTotals.subRevenue` is null when no row has `subRevenue`.
- `savePlanMonths` adds `sub_revenue: r.subRevenue` to the insert only when at least one row of the batch has it (pre-migration safety); `getPlanTargets` maps `sub_revenue` when not null.

- [ ] **Step 1: Write failing tests** in `generate.test.ts`:
  - a month without `sub*` gives output deep-equal to the current function on the existing fixtures (no `subRevenue` key);
  - October 2026 with `lastData` the 15th: `subDaily` `{ "2026-10-20": 400, "2026-10-27": 300 }`, `subFixedThrough` `"2026-11-14"`, `subModel` 700, other 9,300: the 20th has `subRevenue` 400, a day without a rebill inside the horizon has 0, the month's `returningRevenue` sums to 10,000 and `subRevenue` to 700;
  - November with the horizon ending the 14th: days 1 to 14 carry their scheduled values, days 15 to 30 share `subModel - S` by weekday weight, the month sums to `subModel`;
  - `subOverride` below `S`: scheduled days scaled by `T / S`, no negative day, sum = `T`;
  - a day override of returning revenue 1,000 on a rebill day of 400: that day's total is 1,000 and the month total holds; an override of 300 on it gives 400 (rebills kept) and the month total still holds;
  - the split moves revenue between days but the month's `orderRevenue`, `orders` and `cm` equal those of the same month without the split and the same `returningRevenue` (so the Plan P&L, Summary and Home totals do not change);
  - a locked month's inputs, regenerated after the forecaster would give different numbers, produce identical rows (rows depend only on stored inputs).
  - `metrics.test.ts`: `aggregatePlan` sums `subRevenue` and gives null without it.
- [ ] **Step 2: Run** `npx vitest run lib/planning/generate.test.ts lib/metrics.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the placement, the type fields and the repository mapping.
- [ ] **Step 4: Run** the whole suite (`npm test`) and `npx tsc --noEmit`. Expected: PASS (the stretch and summary tests are untouched and still pass).

### Task 7: Returning model screen with both parts

**Files:** Modify `components/planning/models/ModelsStep.tsx` (load `getSubscriptions` and the client's stats once, pass `subs` and `splitOn` in `ModelCtx`), `components/planning/models/ReturningModel.tsx`.

**Interfaces:**
- Consumes: `subscriptionSplitOn`, `toScheduleSubs`, `attachStats` (Task 1); `otherReturningInputs` (Task 3); `forecastSubscriptions` (Task 4); `applyReturningForecast`, `combineReturning`, `setPartLock` (Task 5).
- `ModelCtx` gains `subs: ScheduleSub[]`, `subStats: SubscriptionStats | null`, `splitOn: boolean`.

- [ ] **Step 1: Wire the model.** `result` runs `forecastReturning` on `otherReturningInputs(...)` (same call when `splitOn` is false); a second memo runs `forecastSubscriptions` with `plannedNewOrders` from the plan rows' `newOrders` per month (gap months: recent average new orders, as `futureNew` does for revenue), `actualRebillsByDay` from `facts`, `horizonDays` from settings. `saveAndApply` calls `applyReturningForecast` per unlocked forecast month (locked months skipped and counted as today) and reports converted overrides in the note: "N months had a total override; it now overrides Other returning only, less the expected rebills."
- [ ] **Step 2: Screen.** With `splitOn`: the "Forecast by month" table shows Subscription rebills (expected), Other returning (model), Model returning revenue (their sum), and per part an "override" tag and a lock toggle (`setPartLock` through `editInputs`, disabled on a locked month); the Model results panel adds a "Fixed daily rebills for the next" 30 / 45 / 60 days select, the source line ("Schedule from Loop" or "Schedule estimated from Shopify orders") and the rebill rates used; the chart keeps the returning total. A `stale` result shows "Cohorts were built before subscription rebills were separated. Rebuild cohorts so rebills are not counted in Other returning." and disables Create forecast. Without `splitOn`, the screen is unchanged.
- [ ] **Step 3: Verify:** `npx tsc --noEmit`, `npx eslint .`, `npm run build`; seed mode: the demo subscription client shows both columns adding up to the total, the other client shows today's table.

### Task 8: Details and the other places that edit returning revenue

**Files:** Modify `components/planning/DetailsStep.tsx` (`ReturningLine`), `components/planning/MonthlyStep.tsx` (returning cell, line ~134), `components/planning/SpendStep.tsx` (day returning field, line ~267).

**Interfaces:** Consumes `isSplitMonth`, `setPartOverride`, `setPartLock` (Task 5).

- [ ] **Step 1: Details.** For a split month the table shows two sub-rows under the month: "Subscription rebills (expected)" and "Other returning (model)", each with Model, Override (with clear) and a lock toggle; the bold "Returning revenue (plan)" cell is their sum and the year row sums the three. Overrides go through `setPartOverride`; the help text says the two lines add up to returning revenue and that rebills inside the fixed window are placed on their billing days. A non-split month keeps today's single row and override.
- [ ] **Step 2: Overview and Spend.** In `MonthlyStep` a split month's returning cell is read-only with the title "Set in Details: Subscription rebills + Other returning". In `SpendStep` a day with `subRevenue > 0` shows "incl. rebills" and the amount under the returning field.
- [ ] **Step 3: Verify:** `npx tsc --noEmit`, `npx eslint .`, `npm run build`; seed mode: override each part, see the total change and the daily rows spike on rebill days in Input; lock a month in Overview and see both parts disabled.

### Task 9: Stretch plans with the split

**Files:** Modify `lib/planning/stretch.ts` (`StretchMonth.subRevenue?: number`, `stretchPlanMonths`), `lib/planning/stretch-plan.ts` (`StretchPlanInput.subscription?`, `returningFor`), `lib/planning/stretch-actions.ts` (`loadBaseline` loads subscriptions and passes them), `lib/planning/stretch-plan.test.ts`, `lib/planning/stretch.test.ts`, `lib/planning/stretch-fixtures.ts`.

**Interfaces:**
- `StretchPlanInput.subscription?: { subs: ScheduleSub[]; stats: SubscriptionStats; horizonDays: number }` (absent or `subscriptionSplitOn` false: today's code path exactly).
- With it, `returningFor(newByMonth)` = Other returning (`forecastReturning` on `otherReturningInputs`) + `forecastSubscriptions(...).months[k].total` with `plannedNewOrders[k] = newByMonth[k] / rates.newAov` of that month (0 when AOV is 0); the sub part per month is kept and set on each `StretchMonth.subRevenue`.
- `stretchPlanMonths`: when `s.subRevenue` is defined, sets `returningModel = round(returning - sub)`, `subModel = round(sub)`, both overrides null, both part locks false, keeps the baseline's `subDaily` / `subFixedThrough`, then `resolveReturning`; otherwise today's three fields.

- [ ] **Step 1: Write failing tests:** without `subscription` the outcome is deep-equal to today's on the existing fixtures (snapshot the current result in the test first); with one active monthly subscription, a stretch with a higher new-revenue goal has, in an open month, `returningRevenue = returningModel + subModel` and a `subModel` at least the baseline's (more new customers, more new subscribers); a month locked in the baseline and an ended month keep their numbers; `stretchPlanMonths` keeps the baseline `subDaily`; the rows of a stretch month still sum to its `returningRevenue`.
- [ ] **Step 2: Run** `npx vitest run lib/planning/stretch-plan.test.ts lib/planning/stretch.test.ts lib/planning/stretch-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite. Expected: PASS, including `summary.test.ts` unchanged.

### Task 10: Home "Subscriptions" section

**Files:** Create `lib/home-subscriptions.ts`, `lib/home-subscriptions.test.ts`; modify `lib/metrics.ts` (a `rebillRevenue` metric), `lib/dashboard-data.ts` (`DashData.subscriptions`), `components/Dashboard.tsx` (one `Section` after "Returning customers").

**Interfaces:**
- `METRICS.rebillRevenue`: label "Rebill Revenue", `value: (t) => t.subRevenue - t.subNewRevenue`, `target: (p) => p.subRevenue`, direction up, source Shopify, formula "Subscription orders that are not a customer's first order".
- `subscriptionHomeNumbers(cur: SubscriptionDay[], ref: SubscriptionDay[] | null): { active: TileNumbers; newSubs: TileNumbers; churnPct: TileNumbers }` (active = last day's `active`; churn = cancelled in the range / active on its first day; dash on zero; plan mode has no reference for these three).
- `DashData.subscriptions: { cur: SubscriptionDay[]; ref: SubscriptionDay[] | null } | null`, loaded in `useDashboardData` only when `subscriptionSplitOn` (or, with no plan, when `subscriptionSource !== "none"` and channels are ticked); otherwise `null` and no extra request.

- [ ] **Step 1: Write failing tests:** `subscriptionHomeNumbers` on fixture days (active 1,000 then 1,040, 60 new, 20 cancelled: churn 2.0%); zero active at the start gives a null churn; `rebillRevenue` value on a fixture `Totals` and target on `PlanTotals` with and without `subRevenue` (null target means no plan comparison, as other tiles).
- [ ] **Step 2: Run** `npx vitest run lib/home-subscriptions.test.ts lib/metrics.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and render the section: Active subscribers, New subscribers, Monthly churn, Rebill revenue (vs plan when the plan has `sub_revenue`), linking to the Subscriptions report like the other tiles. No section when `data.subscriptions` is null.
- [ ] **Step 4: Verify:** the suite, `npx tsc --noEmit`, `npx eslint .`, `npm run build`; seed mode: the subscription demo client shows the section, the other client's Home is unchanged.

### Task 11: Docs and the live check

**Files:** Modify `docs/planning-layer.md` (the split, the invariant, the fixed window), `docs/changelog.md`, `CLAUDE.md` (one line).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Live check (strategist, after the migration is applied and A1/A2 are live):** on a client with a ticked subscription channel, open the plan, Models, Returning Customer Model: both parts appear and add up; press Create forecast; in Details the two lines add up to returning revenue; in Input the daily rows spike on billing days for the next window; the Summary and the Plan P&L totals are the same as before Create forecast when the returning total is unchanged; run `supabase/checks/00NN_subscription_forecast.sql`. Compare next 30 days' expected rebills with the subscription app's own upcoming-orders view.

---

## Self-review

- **Spec coverage:** cohort inputs without rebills (Tasks 2, 3); the per-day schedule with rebill rate, interval roll-forward, survival decay and new subscribers from planned new orders x attach rate (Task 4); `plan_targets.sub_revenue` and fixed daily values on rebill days (Task 6); the Returning model screen and Details with override and lock per part (Tasks 5, 7, 8); Summary, stretch, Home, P&L unchanged without a source (Tasks 6, 9, 10); the Home section (Task 10); month reconciliation and the mid-month horizon (Tasks 4, 6).
- **Deliberate readings of the spec:** (1) churn decay = the chain of the client's rebill rates by index, not rebill rate x a separate survival curve, because the rebill rate already contains cancellations (applying both counts churn twice); if A2 provides a calendar survival curve and the strategist prefers it, only `rebillProbability` changes. (2) The multi-store spec's `rebill_revenue` / `rebill_orders` columns are not added; rebills = `sub_revenue - sub_new_revenue` from A1. (3) The current month's elapsed days carry actual rebills, so its subscription part is a full month like the other model's. (4) Paused subscriptions forecast nothing (the A2 contract has no resume date). (5) `rebuild_cohorts` cannot be called from a migration (its access check needs a signed-in user), hence the core function.
- **Type consistency:** `ScheduleSub`, `SubscriptionStats`, `forecastSubscriptions`, `SubscriptionMonth`, `applyReturningForecast`, `resolveReturning`, `setPartOverride`, `setPartLock`, `combineReturning`, `otherReturningInputs`, `subscriptionSplitOn`, the `sub*` input fields and `PlanTargetDay.subRevenue` are spelled the same in every task.
- **Proportion:** eleven tasks, no function bodies; exact values only where tests or users read them.

**Sizing:** about 7 working days for Claude (forecaster and day placement 2, migration and cohort inputs 1, split inputs and screens 2, stretch 1, Home and docs 0.5, one independent review 0.5). What could blow it up: A2 landing without rebill rates, cadence or a repository read (add about 1 day, Task 1); the cohort backfill timing out on a large client inside the migration (then run the core function per client from the SQL editor instead); seasonality and calibration of Other returning shifting once rebills leave it (needs the strategist's eye on one real client). From the strategist: go-ahead for this phase and the migration; the default fixed window (60 days for an app connection, 30 for the Shopify estimate); confirmation that paused subscriptions forecast nothing; one client with a ticked subscription channel and access to its subscription app's upcoming-orders view for the live check.

# Email and SMS plan and trackers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plan carries Email revenue and SMS revenue as a share of planned order revenue per month (inferred from the client's own history, overridable in Details), daily email and SMS targets land in `plan_targets`, Home colours the email and SMS tiles against the plan, and two reports (Email Trackers, SMS Trackers) show Target, Actual, Planned, Projected and Gap with a flow table, a campaign table, the Tier 1 flow checklist and gap actions.

**Architecture:** Pure logic in `lib/planning/email-sms.ts` (share inference, month target, daily spread) and `lib/reports/email-tracker.ts` (projection, gap, flow flags, gap actions), both tested. The plan side extends the existing Details line pattern (`components/planning/DetailsStep.tsx`) and `generateMonth`; the tracker reads `daily_facts`, `message_stats_daily` and the synced campaign events produced by the Klaviyo sync plan. Email and SMS are slices of the planned total, never extra revenue.

**Tech Stack:** Next.js 16 (client components, existing report frame), Supabase (one additive migration), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-email-sms-plan-and-trackers-design.md`. Rules: `Agency/Training/CTC Canon/email.md`, `Agency/Company/Processes/email-sms-attribution-sop.md`.

## Depends on plan 1 (`docs/superpowers/plans/2026-10-13-messaging-data-sync-klaviyo.md`): exact outputs consumed

| Output of plan 1 | Where it comes from | Used here for |
|---|---|---|
| `DailyFact.emailRevenue`, `emailOrders`, `emailSent`, and the new `smsRevenue`, `smsOrders`, `smsSent` (filled by `rebuild_messaging_facts`) | plan 1 Task 2 | inferred share, Actual, Last year, Home goal colours |
| `MessageStatRow` and `Repository.getMessageStats(clientId, from, to)`, rows with `kind` (`campaign` / `flow`), `channel`, `parent_id`, `parent_name`, `recipients`, `revenue`, `bounces`, `spam` | plan 1 Task 2 (seed rows too) | flows run rate, flow table and flags, campaign table, RPR, spam and bounce rates |
| `marketing_events` rows with `source 'klaviyo'`, `external_id 'klaviyo:campaign:<id>'`, `type` `email` / `sms`, `segment_size`, future dates for Scheduled campaigns (`notes "Scheduled in Klaviyo"`) | plan 1 Tasks 4 and 7 | Planned (scheduled campaigns) |
| `ExtraSettings.emailRevenueSource`, `smsRevenueSource`, `emailAttrClickDays`, `emailAttrOpenDays`, `smsAttrClickDays` and the "Email & SMS" accordion | plan 1 Tasks 2 and 8 | which channels a client has; the attribution line on the reports; the brand-type select sits in the same accordion |
| `METRICS.smsRevenue` (and the email metrics) | plan 1 Task 6 | `target` functions for Home goal colours |

Tasks 1 to 4 can be built in demo mode before plan 1 is live (seed data has email and SMS); Tasks 5 to 7 need plan 1's `getMessageStats` and events; Task 8 needs the pilot client synced.

## Global Constraints

- The email share is **never assumed** (no 20% or 22% default): it is inferred from the client's own data, same month last year, else the trailing 90 days; with neither, the field stays empty and the strategist types it. The Canon median 22% (range 5 to 65%) and the brand-type ranges appear only in a reference panel.
- Brand-type ranges (Canon): high-velocity DTC 20 to 35%, high-AOV 10 to 20%, home and decor 15 to 25%, fashion 20 to 30%, food and bev 25 to 40%.
- Attribution basis shown on both trackers: "<emailAttrClickDays>-day click, <emailAttrOpenDays>-day open, set in Klaviyo" (Apex standard 3-day click, 0-day open; SMS 3-day click).
- Allocation, not extra revenue: total order revenue of a plan is unchanged by these lines.
- Migration: the spec's `0012_email_sms_plan.sql` number is taken (0012 creative ad data, 0013 subscriptions, then plan 1's messaging migration). Use **the next free number at build time**, after plan 1's. Additive; applied only after the strategist's go.
- Nothing is sent to a client; gap actions are suggestions on screen only.
- Never name Statlas in the UI; its Email Plan method (daily average × days) is replicated, not its layout or wording.
- `AGENTS.md`: any task touching a route or page reads the matching guide in `node_modules/next/dist/docs/01-app` first (Task 6 says so). Tests live in `lib/**/*.test.ts`; components are checked by type check, lint, build and a demo-mode browser check.

## Review Focus

1. A client with less than a year of email history, or a month last year with zero email revenue: Inferred falls back to the trailing 90 days, and with no data shows "–" rather than 0%. Tested in Task 2.
2. A plan month with no inputs, or planned order revenue of 0: the email and SMS targets are 0 and nothing divides by zero; daily targets always sum exactly to the month target (rounding absorbed by the last day). Tested in Task 2.
3. A client with no SMS (source `none`): the SMS line, tile goal and tracker say "No SMS source chosen" and never show a red gap. Tested in Task 5.
4. A scheduled campaign whose audience is unknown, or no sent campaign in the last 12 months (no RPR): Planned counts it as 0 and the card says how many scheduled campaigns had no estimate. Tested in Task 5.
5. Early month (day 1, no actuals yet) and the last day of the month: Projected equals scheduled plus flows run rate on day 1 and equals Actual after the month ends. Tested in Task 5.

---

### Task 1: Plan targets carry email and SMS (migration, types, mapping, Home goals)

**Files:**
- Create: `supabase/migrations/00NN_email_sms_plan.sql`
- Modify: `lib/types.ts` (`PlanTargetDay.emailRevenue?`, `smsRevenue?`; `ExtraSettings.emailBenchmarkType`, `tier1Flows`), `lib/defaults.ts`, `lib/metrics.ts` (`PlanTotals`, `aggregatePlan`, `METRICS.emailRevenue.target`, `METRICS.smsRevenue.target`), `lib/repository/supabase.ts` (save and read `email_revenue`, `sms_revenue` next to `cost_of_delivery`), `lib/planning/types.ts` (`PlanMonthInputs.emailPct?: number | null`, `smsPct?: number | null`)
- Test: `lib/metrics.test.ts`, `lib/defaults.test.ts`

**Interfaces:**
- Produces columns `plan_targets.email_revenue numeric`, `plan_targets.sms_revenue numeric` (nullable). Inputs live in the existing `plan_months.inputs` jsonb (`emailPct`, `smsPct`, 0 to 100).
- Produces `PlanTotals.emailRevenue: number | null`, `smsRevenue: number | null` (null when no row carries them, like `grossSales`); `METRICS.emailRevenue.target = (p) => p.emailRevenue`, same for SMS.
- Produces `ExtraSettings.emailBenchmarkType: "" | "high_velocity" | "high_aov" | "home_decor" | "fashion" | "food_bev"` (default `""`) and `tier1Flows: string[]` (default `[]`, ids from Task 7).
- **Spec note:** the spec mentions "the lock flags the other lines use". No Details line has its own lock: locking is per month (`PlanMonth.locked`). The two new lines follow the month lock, nothing more.

- [ ] **Step 1: Write failing tests:** `aggregatePlan` sums `emailRevenue` over rows that have it and returns null when none do; `METRICS.emailRevenue.target` returns that sum; defaults have `emailBenchmarkType ""` and `tier1Flows []`.
- [ ] **Step 2: Run** `npx vitest run lib/metrics.test.ts lib/defaults.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** types, defaults, aggregation, target functions, repository mapping and the migration. Do not apply it.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`. Expected: PASS.

### Task 2: Share inference, month target and daily spread

**Files:** Create `lib/planning/email-sms.ts`, `lib/planning/email-sms.test.ts`.

**Interfaces:**
- Consumes: `DailyFact`, `aggregate`, `orderRevenue`, `sourceRange` (`lib/planning/history.ts`), `lib/dates.ts`.
- Produces:
  - `type MessagingChannel = "email" | "sms"`.
  - `shareOf(facts: DailyFact[], channel: MessagingChannel): number | null`: channel revenue ÷ order revenue × 100, rounded to 2 decimals; null when there are no facts, order revenue is 0, or channel revenue is 0 over the whole range.
  - `inferShare(month: string, facts: DailyFact[], today: string, channel: MessagingChannel): { pct: number | null; basis: "last_year" | "trailing_90" | null }`: same month last year first; else the 90 days ending the day before `today`; else nulls.
  - `monthTarget(plannedOrderRevenue: number, pct: number | null | undefined): number` (0 when pct is null).
  - `spreadByRevenue(target: number, dayOrderRevenue: number[]): number[]`: in proportion to each day's planned order revenue (so event days carry their lift); equal split when all are 0; rounded to cents with the remainder on the last day so the sum equals `target` exactly.

- [ ] **Step 1: Write failing tests:** last year's month with order revenue 100,000 and email 22,000 gives `{ pct: 22, basis: "last_year" }`; the same month with no email revenue last year but 15% over the trailing 90 days gives `{ pct: 15, basis: "trailing_90" }`; no facts gives nulls; `monthTarget(200000, 22) === 44000`, `monthTarget(200000, null) === 0`; `spreadByRevenue(1000, [1, 1, 2])` is `[250, 250, 500]`; `spreadByRevenue(100, [1, 1, 1])` sums to exactly 100; all-zero days split evenly.
- [ ] **Step 2: Run** `npx vitest run lib/planning/email-sms.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.

### Task 3: Daily email and SMS targets in `generateMonth` and history fills

**Files:** Modify `lib/planning/generate.ts`, `lib/planning/history.ts` (`inputsFromFacts` also returns `emailPct` and `smsPct` from `shareOf`), `lib/planning/roundtrip.test.ts` or a new `lib/planning/generate.test.ts` case.

**Interfaces:**
- Consumes: Task 2.
- Produces: every `PlanTargetDay` from `generateMonth` carries `emailRevenue = spreadByRevenue(monthTarget(Σ orderRevenue, inputs.emailPct), dayOrderRevenue)[i]` and the same for SMS, only when the pct is set (otherwise the fields are absent, so `PlanTotals` stays null). `GenerateOptions` is unchanged; stretch plans (`lib/planning/stretch-plan.ts`) inherit the pct from their inputs.

- [ ] **Step 1: Write failing tests:** a month with `emailPct 25` and order revenue 120,000 generates daily rows whose `emailRevenue` sums to 30,000 and whose highest-revenue day has the highest email target; a month without `emailPct` has no `emailRevenue` on any row; total order revenue is identical with and without the pct (allocation, not extra); `inputsFromFacts` on facts with 20% email returns `emailPct 20`.
- [ ] **Step 2: Run** `npx vitest run lib/planning`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS (existing plan tests unchanged).

### Task 4: Details lines, reference panel and Input columns

**Files:** Modify `components/planning/DetailsStep.tsx`, `components/planning/InputStep.tsx`, `components/settings/EditStoreDialog.tsx` (brand-type select in the "Email & SMS" accordion from plan 1).

**Interfaces:**
- Two new `LineDef` entries after `returning`: `{ id: "email", label: "Email revenue", unit: "pct", ... }` and `{ id: "sms", label: "SMS revenue", unit: "pct", ... }`, `get`/`set` on `emailPct` / `smsPct`, `actual` reading `inputsFromFacts(...).emailPct` (Task 3). `LineDef` gains an optional `infer?: (month: string) => number | null`; for the two lines it calls `inferShare` so "Same month last year" falls back to the trailing 90 days (the other lines keep today's behaviour). Plan, Inferred, Last year, vs last year, Actual, "use", Actualize all YTD and Extrapolate all work through the existing `RateLine`.
- Help text: "Share of planned order revenue that email (SMS) is expected to bring, taken from this client's own history. It slices the planned total; it does not add to it."
- Under the table for these two lines, a reference panel: client's own share last 12 months, Canon median 22% (range 5 to 65%), and the brand-type range when `emailBenchmarkType` is set, with "Reference only. It never sets the target."
- Remove the footer line "Email, SMS and organic revenue lines are not planned yet..." and replace with "Organic revenue is not planned: it is what remains."
- `InputStep`: daily rows and CSV gain Email target and SMS target columns.

- [ ] **Step 1: Verify** `npx tsc --noEmit`, `npx eslint .`, `npm run build`.
- [ ] **Step 2: Browser check (demo mode):** open a plan, Details, choose Email revenue: Inferred shows the seed client's share; "use" sets it; Save plan; Input shows the email column summing to share × order revenue for the month; Home in plan mode colours Email Revenue.

### Task 5: Tracker logic: projection, gap, flows, gap actions

**Files:** Create `lib/reports/email-tracker.ts`, `lib/reports/email-tracker.test.ts`.

**Interfaces:**
- Consumes: `MessageStatRow`, `MarketingEvent`, `DailyFact`, `PlanTargetDay` (plan 1 and Task 1).
- Produces:
  - `campaignRpr(rows: MessageStatRow[], channel, asOf: string): number | null`: median over campaigns (grouped by `parent_id`) sent in the 12 months before `asOf` of revenue ÷ recipients; null with no campaign.
  - `flowsRunRate(rows, channel, asOf: string, daysRemaining: number): number`: average daily flow revenue over the 28 days ending `asOf` × `daysRemaining`.
  - `scheduledPlanned(events: MarketingEvent[], channel, asOf: string, monthEnd: string, rpr: number | null): { amount: number; count: number; withoutEstimate: number }`: events with `source "klaviyo"`, type = channel, date after `asOf` and up to `monthEnd`; amount = Σ `segmentSize` × rpr.
  - `trackerSummary(input: { month: string; asOf: string; channel; facts: DailyFact[]; targets: PlanTargetDay[]; stats: MessageStatRow[]; events: MarketingEvent[] }): { target: number | null; actual: number; planned: number; projected: number; gap: number | null; daily: { date: string; target: number; actual: number | null; projected: number }[] }`: Actual = Σ facts channel revenue to `asOf`; Projected = Actual + Planned + flows run rate; Gap = Projected − Target (null without a plan); `daily` is cumulative.
  - `flowTable(rows, channel, month, asOf): { flowId: string; name: string; revenue: number; rpr: number | null; medianRpr: number | null; flagged: boolean }[]`: this month's revenue and RPR per flow against `medianRpr` = the median of its weekly RPR (revenue ÷ recipients per calendar week with sends) over the 180 days before the month; `flagged` when RPR is more than 30% below its median (Canon's 30% rule applied to the client's own baseline).
  - `campaignTable(rows, events, channel, month): { id: string; name: string; date: string; status: "sent" | "scheduled"; audience: number | null; revenue: number | null; rpr: number | null }[]`.
  - `gapActions(gap: number, rpr: number | null, avgAudience: number | null): { extraRevenue: number; extraSends: number | null; extraCampaigns: number | null } | null` (null when gap ≥ 0).
  - `deliverability(rows, channel, from, to): { spamRate: number | null; bounceRate: number | null; spamLevel: "ok" | "caution" | "danger" | "enforcement" }` with Canon bands: under 0.10% ok, 0.10 to 0.20 caution, 0.20 to 0.30 danger, over 0.30 enforcement.

- [ ] **Step 1: Write failing tests** on a fixture month (30 days, `asOf` day 10): Actual 10,000, flows 300 a day over the last 28 days and 20 days left → run rate 6,000, two scheduled campaigns of 20,000 and 10,000 recipients at RPR 0.10 → Planned 3,000, Projected 19,000, Target 25,000 → Gap −6,000; `gapActions(-6000, 0.10, 15000)` is `{ extraRevenue: 6000, extraSends: 60000, extraCampaigns: 4 }`; a flow at RPR 0.69 against median 1.00 is flagged, at 0.70 it is not; a scheduled event with `segmentSize null` adds 0 and counts in `withoutEstimate`; `asOf` = day 1 with no facts gives Projected = Planned + run rate; `asOf` after month end gives Projected = Actual; no plan gives `target null`, `gap null`; spam 0.15% is `caution`; with no SMS rows every SMS number is 0 and `gapActions` is not called.
- [ ] **Step 2: Run** `npx vitest run lib/reports/email-tracker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.

### Task 6: Email Trackers and SMS Trackers reports

**Files:**
- Create: `components/reports/MessagingTrackerReport.tsx`
- Modify: `components/reports/ReportRouter.tsx` (cases `email-tracker`, `sms-tracker`), `lib/reports/registry.ts` (both `ready`; description "Email target, actual, planned, projected and gap" / SMS likewise), `lib/reports/registry.test.ts`, `lib/reports/home-links.ts` (+ test: `smsRevenue` and `emailRevenue` now link to their trackers), `lib/repository/types.ts` only if plan 1 did not already add `getMessageStats`

**Interfaces:**
- Consumes: Task 5, `useDashboardData` (plan targets of the selected plan), `getRepository().getMessageStats`, `listEvents`.
- The report: month picker (default this month), cards Target, Actual, Planned (scheduled campaigns), Projected, Gap; a cumulative chart (target, actual, projected by day) using the existing chart component; Flows table with the flag; Campaigns table (sent and scheduled); Gap actions box when the gap is negative ("To close the gap: about <extraRevenue> more, about <extraSends> more sends at this client's revenue per recipient, about <extraCampaigns> average campaigns.") next to spam and bounce rates with the band; the attribution line; "No SMS source chosen: set it in Store Settings, Edit, Email & SMS" when `smsRevenueSource` is `none`; "No plan with email targets yet: add the Email revenue line in the plan's Details step" when target is null.
- Read the page guide in `node_modules/next/dist/docs/01-app` before touching `ReportRouter` (it is rendered by `app/reporting/[slug]/page.tsx`).
- **Not built:** the "header of Email Metrics" the spec mentions; the Email Metrics report itself is not built (registry status `waiting`) and neither spec plans it. Flagged for the strategist.

- [ ] **Step 1: Write failing tests:** `getReport("email-tracker").status === "ready"`, same for `sms-tracker`; `homeReportHref("emailRevenue")` stays null (it maps to `email-metrics`, still waiting) and `homeReportHref("smsRevenue") === "/reporting/sms-tracker"`.
- [ ] **Step 2: Run** `npx vitest run lib/reports`. Expected: FAIL.
- [ ] **Step 3: Implement** the component and registry changes.
- [ ] **Step 4: Run** tests, `npx tsc --noEmit`, `npx eslint .`, `npm run build`; demo-mode check that both reports render with seed data and every number on the cards matches the Task 5 functions.

### Task 7: Tier 1 flow checklist

**Files:** Modify `lib/reports/email-tracker.ts` (+ test), `components/reports/MessagingTrackerReport.tsx`.

**Interfaces:**
- Produces `TIER1_FLOWS: { id: string; label: string }[]` in this order: `welcome` Welcome, `abandoned_checkout` Abandoned checkout, `abandoned_cart` Abandoned cart, `browse` Browse abandonment, `site` Site abandonment, `post_purchase` Post-purchase, `winback` Winback, `sunset` Sunset. Ticked by hand per client on the Email Trackers page and saved in `client_settings.extra.tier1Flows` through `saveSettings`. Flows are not matched by name automatically (spec "verify before build" item 2 is answered with the real flow names in Task 8 before any automatic match is considered).

- [ ] **Step 1: Write a failing test:** `TIER1_FLOWS` has the 8 ids above in order, unique.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement** the list and the checkbox block ("<n> of 8 Tier 1 flows live"). **Step 4: Run** tests, `npx tsc --noEmit`, `npm run build`.

### Task 8: Pilot check and docs

**Files:** Modify `docs/planning-layer.md`, `docs/reports-plan.md`, `docs/changelog.md`, `CLAUDE.md` (one line each).

- [ ] **Step 1: Strategist applies the migration** (with go) after plan 1's.
- [ ] **Step 2: Pilot client:** in its plan, Details, Email revenue: check Inferred against last year's share from Klaviyo; Save plan; Home shows email goal colours; Email Trackers for the current month shows the five numbers; check the scheduled campaigns listed against Klaviyo's calendar and note whether their audience estimate came through (spec "verify before build" item 1).
- [ ] **Step 3:** write in `docs/changelog.md` whether the flow names were clear enough to keep the checklist manual (spec item 2).

---

## Self-review

- **Spec coverage:** Details lines with Plan, Inferred, Last year, vs LY, Actual, use, Actualize, Extrapolate (Task 4); inference from last year then 90 days (Task 2); target and daily spread by planned revenue (Tasks 2, 3); `plan_targets` columns and Home goals (Task 1); reference panel and brand type (Task 4); projection, gap, flows table and 30% flag, campaigns table, gap actions with spam and bounce (Tasks 5, 6); Tier 1 checklist (Task 7); verify-before-build items (Task 8).
- **Deviations on purpose:** no per-line lock flags (none exist, the month lock applies); migration number; Email Metrics header not built (that report does not exist); flow checklist stays manual until real names are seen.
- **Type consistency:** `emailPct`, `smsPct`, `MessagingChannel`, `shareOf`, `inferShare`, `monthTarget`, `spreadByRevenue`, `trackerSummary`, `flowTable`, `campaignTable`, `gapActions`, `deliverability`, `TIER1_FLOWS` are spelled the same in every task; plan 1 names (`MessageStatRow`, `getMessageStats`, `smsRevenue`) match that plan.
- **Proportion:** eight tasks, signatures and assertions only.

**Sizing:** about **4 working days** for Claude (test first, plus one independent review), after plan 1 is built and the pilot client is synced. What could blow it up: Klaviyo not returning an audience for scheduled campaigns (Planned then needs a manual audience field per event); flow messages renamed or split in Klaviyo so a flow's 180-day median is broken; strategists wanting per-campaign-type RPR now (out of scope in the spec). **From the strategist:** the go to apply the migration; the pilot client's plan reviewed in Details (does the inferred share look right); the brand type for each client; which Tier 1 flows are live for the pilot; a decision on whether the Email Metrics report should be built next.

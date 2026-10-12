# Four Reports and Home Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Contribution Margin, Revenue Overview, AOV Histogram and New Vs Returning reports, correct the report registry, and give Home tiles a link to the report behind each metric.

**Architecture:** Pure builders in `lib/reports/` turn `DailyFact` rows into a numeric table (`NumTable`); one shared table component formats and colours it; thin report components add controls and charts. The AOV Histogram runs in two SQL functions so the browser never downloads orders. Home links come from a small map plus the registry status.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (Postgres functions, `rpc`), TypeScript, Vitest (`lib/**/*.test.ts` only).

**Specs:** `docs/superpowers/specs/2026-10-12-four-reports-design.md` and `docs/superpowers/specs/2026-10-11-home-report-links-design.md`

## Global Constraints

- Group By options are the existing `GroupBy` (Daily, Weekly, Bi-Weekly, Monthly, Quarterly, Yearly, Day Of Week), default Daily.
- Heat map: each cell compared with the column's average across rows using `compare`; within ±10% is neutral. Lower-is-better columns (discounts %, refunds %, COGS %, cost %, ad spend %) use direction down; shipping, taxes and share columns never colour.
- Contribution Margin equals `cmParts(...).cm` exactly (the Home CM tile). Contribution Margin report: Product Margin = Net Sales + Shipping - COGS, Variable Revenue Cost = `cmParts.costOfDelivery`.
- Percent bases: Discounts % of gross sales; Refunds %, Product Margin %, Cost %, Ad Spend % and CM % of order revenue; COGS % of gross sales.
- AOV Histogram counts DTC orders with order revenue above zero dated in the range. Dynamic Ranges = ten equal-width buckets between the 2.5th and 97.5th percentile (orders outside are not charted, a footnote gives the count). Complete Range = ten equal-width buckets from the smallest to the largest order. Fixed increments are 10, 25, 50 and 100 from zero, at most 60 regular buckets, with a last open-ended bucket "X+" for everything above. Percentages use all orders in the range as the denominator.
- A zero denominator shows "–", never NaN or Infinity.
- Home link icon shows only when the mapped report is `ready`. Home passes its date range to the report in the URL (`?from=YYYY-MM-DD&to=YYYY-MM-DD`).
- Migration file `supabase/migrations/0010_aov_histogram.sql`; applying it to the live project needs the user's confirmation. The number may shift if another migration lands first.
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/01-app` before writing Next.js code (this plan adds no route handler; it edits client components and a page-level hook).
- Git (repo `CLAUDE.md`): do not commit unless the user asks; each task ends with a checkpoint listing files and a suggested message.
- Tests live in `lib/**/*.test.ts`. Fixture pattern: `factDay` in `lib/reports/plan-pnl.test.ts`; settings from `defaultSettings("c")`.

## Review Focus

1. A range with no days or no orders (new client, future dates): every report shows an empty state or "–", never NaN, Infinity or a crash. Tested in Tasks 3 to 6.
2. A week or month where gross sales, orders or revenue are zero: percentages and AOV show "–". Tested in Tasks 3 to 5.
3. AOV Histogram with a single distinct order value (smallest equals largest) or fewer than ten orders: no divide by zero, one bucket. Verified in Task 1 queries and tested in Task 6.
4. A client without migration 0010, or demo data: the AOV report shows a clear message instead of an error. Tested in Task 6.
5. A Home link with an invalid, reversed or missing range in the URL: the report falls back to the current month. Tested in Task 9.

---

## File structure

- Create `supabase/migrations/0010_aov_histogram.sql`
- Create `lib/reports/table-model.ts` (+ `.test.ts`): `ColumnDef`, `NumRow`, `NumTable`, `columnTones`.
- Create `lib/reports/contribution-margin.ts`, `revenue-overview.ts`, `new-vs-returning.ts`, `aov.ts` (+ tests).
- Modify `lib/repository/types.ts`, `supabase.ts`, `seed.ts`: `getAovHistogram`.
- Create `components/reports/MetricsTable.tsx`, `FactsReport.tsx`, `ContributionMarginReport.tsx`, `RevenueOverviewReport.tsx`, `NewVsReturningReport.tsx`, `AovHistogramReport.tsx`.
- Modify `lib/reports/registry.ts`, `components/reports/ReportRouter.tsx`, `components/reports/ReportLibrary.tsx`; create `lib/reports/registry.test.ts`.
- Create `lib/reports/home-links.ts` (+ test); modify `components/MetricTile.tsx`, `components/Dashboard.tsx`, `components/reports/ReportFrame.tsx` (`useReportRange`).
- Modify `docs/reports-plan.md`, `docs/changelog.md`, `CLAUDE.md` (one line).

---

### Task 1: Migration 0010 (AOV functions)

**Files:**
- Create: `supabase/migrations/0010_aov_histogram.sql`

**Interfaces:**
- Produces (both `stable`, security invoker so row-level security applies, `grant execute ... to authenticated`):
  - `aov_stats(p_client uuid, p_from date, p_to date) returns table (orders bigint, revenue numeric, mean numeric, median numeric, mode numeric)`
  - `aov_histogram(p_client uuid, p_from date, p_to date, p_mode text, p_step numeric) returns table (bucket int, low numeric, high numeric, orders bigint, revenue numeric, excluded bigint)`; `p_mode` is `'dynamic'`, `'complete'` or `'step'`; `high` is null for the open-ended last bucket; `excluded` is the same value on every row.
- Orders counted: `orders` rows with `client_id = p_client and is_dtc and order_revenue > 0 and order_date between p_from and p_to`, value `order_revenue`.

- [ ] **Step 1: Write the verification queries first** (the test for SQL, run with `execute_sql` against project `ccejjijwrdnzljizzwsw`, using `(select id from clients order by created_at limit 1)` as the client and the last full month with orders): `select * from aov_stats(...)` returns one row with `orders > 0` and `abs(mean * orders - revenue) < 0.01`; for `'dynamic'` and `'complete'`, `sum(orders) + max(excluded) = (select orders from aov_stats(...))`, ten rows, and `complete` has `excluded = 0`; for `'step'` with step 25, `excluded = 0`, at most 61 rows, the last row has `high is null`, and `sum(orders)` equals the stats count. Degenerate range: a one-day range with a single order returns one bucket.
- [ ] **Step 2: Run them.** Expected: FAIL with "function aov_stats does not exist".
- [ ] **Step 3: Write the migration.** `dynamic`: low = `percentile_cont(0.025)`, high = `percentile_cont(0.975)`, width = (high - low) / 10, bucket = `least(10, floor((x - low) / width) + 1)` for `low <= x <= high`, others excluded; `complete`: same with min and max and nothing excluded; when width is zero return one bucket `[low, high]` holding all counted orders. `step`: regular buckets = `least(ceil(percentile_cont(0.99) / step), 60)`, bucket = `least(floor(x / step) + 1, regular + 1)`, bucket `regular + 1` is open-ended (`low = regular * step`, `high = null`). `mode` in `aov_stats` is the most frequent exact order value (ties: the lowest). Buckets with no orders are still returned so the chart has no gaps. Additive only.
- [ ] **Step 4: Ask the user to confirm applying it to the live project** (production data). On a yes, apply with `apply_migration` (name `aov_histogram`).
- [ ] **Step 5: Re-run the Step 1 queries.** Expected: all pass.
- [ ] **Step 6: Checkpoint.** Files: the migration. Message: "Add AOV stats and histogram functions (migration 0010)".

---

### Task 2: Table model and heat-map tones

**Files:**
- Create: `lib/reports/table-model.ts`
- Test: `lib/reports/table-model.test.ts`

**Interfaces:**
- Produces: `interface ColumnDef { key: string; label: string; group?: string; format: Format; direction: Direction | "none" }`; `interface NumRow { key: string; label: string; v: Record<string, number | null> }`; `interface NumTable { columns: ColumnDef[]; rows: NumRow[]; total: NumRow }`; `columnTones(values: (number | null)[], direction: Direction | "none"): Tone[]` (types `Format` from `@/lib/format`, `Direction`, `Tone`, `compare` from `@/lib/metrics`).

- [ ] **Step 1: Write the failing tests:** `columnTones([100, 100, 100, 200], "up")` is `["bad", "bad", "bad", "good"]` (mean 125); the same with `"down"` is `["good", "good", "good", "bad"]`; `columnTones([100, 105, 95], "up")` is all `"neutral"` (within ±10% of the mean); `null` entries are `"neutral"` and ignored in the mean; `"none"` gives all `"neutral"`; `columnTones([], "up")` is `[]`; a mean of zero gives all `"neutral"`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/table-model.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `columnTones` with `compare(value, mean, direction).tone` and the types above in `lib/reports/table-model.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: both. Message: "Add numeric report table model and heat-map tones".

---

### Task 3: Contribution Margin builder

**Files:**
- Create: `lib/reports/contribution-margin.ts`
- Test: `lib/reports/contribution-margin.test.ts`

**Interfaces:**
- Consumes: `NumTable`, `ColumnDef` (Task 2); `groupDates`, `GroupBy` from `./grouping`; `aggregate`, `cmParts`, `orderRevenue` from `@/lib/metrics`; `DailyFact`, `ClientSettings` from `@/lib/types`.
- Produces: `CM_COLUMNS: ColumnDef[]` and `buildCmTable(facts: DailyFact[], settings: ClientSettings, by: GroupBy): NumTable`. Column keys in order: `grossSales`, `discounts`, `discountsPct`, `shipping`, `taxes`, `orderRevenue`, `taxesOut`, `refunds`, `refundsPct`, `cogs`, `cogsPct`, `productMargin`, `productMarginPct`, `variableCost`, `costPct`, `adSpend`, `adSpendPct`, `cm`, `cmPct`. Groups: Revenue (first six), Product (next seven), Costs (next four), Result (last two). Row label is the bucket label from `groupDates`; the total row has key `"total"`, label `"Total"`.

- [ ] **Step 1: Write the failing tests.** Fixture day (`date`, `grossSales: 1000, discounts: 100, netSales: 860, shippingCollected: 50, tax: 180, newOrderRevenue: 800, returningOrderRevenue: 330, newOrders: 8, returningOrders: 3, refunds: 40, cogs: 250, cogsUnmappedSales: 0`, `channels.meta_acquisition.spend: 200`, other facts zero) and settings `{ ...defaultSettings("c"), otherVariablePct: 5, deliveryCostPerOrder: 1, cogsFlatRate: false, cogsFallbackPct: 0 }`. For one daily bucket, expect (`toBeCloseTo`): `orderRevenue` 1130, `taxesOut` 180, `refunds` 40, `cogs` 250, `productMargin` 660, `variableCost` 56.5, `adSpend` 200, `cm` 403.5, and `discountsPct` 0.10, `refundsPct` 40/1130, `cogsPct` 0.25, `productMarginPct` 660/1130, `costPct` 0.05, `adSpendPct` 200/1130, `cmPct` 403.5/1130. Also: the total row `cm` equals `cmParts(aggregate(facts), settings).cm` for seven days grouped weekly; a weekly bucket of seven identical days is seven times the daily figures; a day with zero gross sales and zero order revenue has every percentage `null`; empty facts return no rows and a total row whose percentages are `null`; the column keys and groups match the list above.
- [ ] **Step 2: Run** `npx vitest run lib/reports/contribution-margin.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `CM_COLUMNS` and `buildCmTable`: per bucket, aggregate its days with `aggregate`, take `cmParts`, and compute `productMargin` as `netSales + shipping - cogs` (this keeps CM identical to Home when order revenue and the Shopify identity differ by rounding). Directions: up for gross sales, order revenue, product margin, product margin %, cm, cm %; down for the five percentage-of-cost columns; none for shipping and taxes and the deduction columns.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: both. Message: "Add Contribution Margin report builder".

---

### Task 4: Revenue Overview builder

**Files:**
- Create: `lib/reports/revenue-overview.ts`
- Test: `lib/reports/revenue-overview.test.ts`

**Interfaces:**
- Consumes: as Task 3.
- Produces: `REVENUE_COLUMNS: ColumnDef[]` and `buildRevenueOverview(facts: DailyFact[], by: GroupBy): NumTable`. Keys in order: `orders`, `grossSales`, `discounts` (negative), `discountedSales`, `returns` (negative), `netSales`, `shipping`, `tax`, `totalSales`, `orderRevenue`.

- [ ] **Step 1: Write the failing tests** with the Task 3 day: `orders` 11, `grossSales` 1000, `discounts` -100, `discountedSales` 900, `returns` -40, `netSales` 860, `shipping` 50, `tax` 180, `totalSales` 1090, `orderRevenue` 1130. Identities on a two-day, weekly-grouped fixture: `discountedSales + returns` equals `netSales`; `netSales + shipping + tax` equals `totalSales`; the total row `orderRevenue` equals `orderRevenue(aggregate(facts))`. Empty facts: no rows, total row values `0`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/revenue-overview.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** using `aggregate` per bucket; `netSales` from the stored total; directions up for all money columns, none for shipping and tax.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: both. Message: "Add Revenue Overview report builder".

---

### Task 5: New Vs Returning builder

**Files:**
- Create: `lib/reports/new-vs-returning.ts`
- Test: `lib/reports/new-vs-returning.test.ts`

**Interfaces:**
- Consumes: as Task 3.
- Produces: `NVR_COLUMNS: ColumnDef[]` and `buildNewVsReturning(facts: DailyFact[], by: GroupBy): NumTable`. Keys in order: `newOrders`, `newRevenue`, `newRevenueChange`, `newAov`, `retOrders`, `retRevenue`, `retRevenueChange`, `retAov`, `totalOrders`, `totalRevenue`, `totalRevenueChange`, `totalAov`, `pctFirstTime`, `pctReturning`. `*Change` is the revenue change against the previous row (`null` on the first row and on the total row).

- [ ] **Step 1: Write the failing tests** with the Task 3 day: `newOrders` 8, `newRevenue` 800, `newAov` 100, `retOrders` 3, `retRevenue` 330, `retAov` 110, `totalOrders` 11, `totalRevenue` 1130, `totalAov` 1130/11, `pctFirstTime` 8/11, `pctReturning` 3/11. A second day with `newOrderRevenue: 880` gives `newRevenueChange` 0.10 on row two and `null` on row one; the total row sums orders and revenue, AOVs are revenue over orders, changes are `null`; a bucket with zero orders has AOVs and shares `null` and the next row's change against a zero previous is `null`; `pctFirstTime + pctReturning` is 1 for every bucket with orders.
- [ ] **Step 2: Run** `npx vitest run lib/reports/new-vs-returning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Directions up for orders, revenue, changes and AOV; none for the two shares.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: both. Message: "Add New Vs Returning report builder".

---

### Task 6: AOV logic and repository method

**Files:**
- Create: `lib/reports/aov.ts`
- Test: `lib/reports/aov.test.ts`
- Modify: `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`

**Interfaces:**
- Produces from `lib/reports/aov.ts`: `type AovMode = "dynamic" | "complete" | "step"`; `const AOV_STEPS = [10, 25, 50, 100]`; `interface AovStats { orders: number; revenue: number; mean: number | null; median: number | null; mode: number | null }`; `interface AovBucket { bucket: number; low: number; high: number | null; orders: number; revenue: number }`; `interface AovData { stats: AovStats; buckets: AovBucket[]; excluded: number }`; `mapAovRows(statsRow: Record<string, unknown> | undefined, bucketRows: Record<string, unknown>[]): AovData`; `interface AovRow { nth: string; range: string; orders: number; ordersPct: number | null; revenue: number; revenuePct: number | null }`; `buildAovRows(data: AovData, mode: AovMode, currency: Currency): { rows: AovRow[]; footnote: string | null }`.
- Produces on `Repository`: `getAovHistogram(clientId: string, from: string, to: string, mode: AovMode, step: number): Promise<AovData | null>` (null when the functions do not exist yet or in demo data).

- [ ] **Step 1: Write the failing tests** in `lib/reports/aov.test.ts`: `mapAovRows` converts numeric strings to numbers, reads `excluded` from the first bucket row, and returns empty buckets and zero stats for no rows and an undefined stats row; `buildAovRows` for a ten-bucket mode labels rows `"10%"` to `"100%"`, for `"step"` labels `"#1"`, `"#2"`, formats a range as `"£27.70 to £39.70"` (currency `GBP`) and an open-ended bucket as `"£100.00+"`; percentages use `stats.orders` and `stats.revenue` as denominators (750 of 4,065 orders is 0.1845); with `excluded: 204` the footnote is `"204 orders outside the charted range are not shown."` and with `0` it is `null`; zero total orders gives `null` percentages; a single bucket (one distinct value) renders one row.
- [ ] **Step 2: Run** `npx vitest run lib/reports/aov.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/reports/aov.ts`** with the signatures above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add the repository method.** In `lib/repository/supabase.ts` call `this.db.rpc("aov_stats", { p_client, p_from, p_to })` and `this.db.rpc("aov_histogram", { p_client, p_from, p_to, p_mode, p_step })`, return `null` when the error matches `aov_stats|aov_histogram|PGRST202|42883` (same pattern as `getFirstProducts`), otherwise throw; map with `mapAovRows`. In `seed.ts` return `null`. Add the method to the `Repository` interface.
- [ ] **Step 6: Verify.** `npx tsc --noEmit` and `npm test`: no errors, all pass.
- [ ] **Step 7: Checkpoint.** Files: the three modified and the two new. Message: "Add AOV histogram data layer".

---

### Task 7: Report components

**Files:**
- Create: `components/reports/MetricsTable.tsx`, `FactsReport.tsx`, `ContributionMarginReport.tsx`, `RevenueOverviewReport.tsx`, `NewVsReturningReport.tsx`, `AovHistogramReport.tsx`

**Interfaces:**
- Consumes: Tasks 2 to 6; `ReportFrame`, `useReportRange`, `Loading`, `Empty`, `selectClass` from `./ReportFrame`; `ReportTable` from `./ReportTable`; `DailyChart` from `@/components/DailyChart`; `GROUP_LABELS`, `GroupBy` from `@/lib/reports/grouping`; `formatValue` from `@/lib/format`; `getRepository`, `useApp`.
- Produces: `MetricsTable(props: { table: NumTable; currency: Currency; firstLabel: string; filename: string })`; `FactsReport(props: { slug: string; caption: string; build: (facts: DailyFact[], settings: ClientSettings, by: GroupBy) => NumTable; firstLabel: string; chart?: (table: NumTable, currency: Currency) => ReactNode })`; the four report components take no props.

No component test infrastructure exists, so this task is verified by type check, lint, build and a seed-mode smoke test.

- [ ] **Step 1: Implement `MetricsTable`.** Turn a `NumTable` into `ReportTable` rows: cell text from `formatValue(value, column.format, currency)` ("–" for null), tone from `columnTones` per column over the body rows (the total row neutral), `filename` for the CSV.
- [ ] **Step 2: Implement `FactsReport`.** Range from `useReportRange`, facts from `repo.getFacts(client.id, from, to)` (cancel on change, show `Loading`), Group By `<select>` over `GROUP_LABELS` (default `daily`), caption plus `Channels: <settings.dtcChannels joined>` under the frame, optional chart above the table, then `MetricsTable`; an empty range shows `Empty` ("No data in this range.").
- [ ] **Step 3: Implement the three wrappers** with `build` set to `buildCmTable`, `buildRevenueOverview`, `buildNewVsReturning`. Captions: "Contribution margin analysis (refunds are shown on the day they were refunded)"; "Portrays revenue, refunds and number of orders"; "Orders by new vs retained customers (new = first paid order of the customer)". Revenue Overview passes a `chart` that renders `DailyChart` with one line series (Order Revenue) and `labels` set to the bucket labels.
- [ ] **Step 4: Implement `AovHistogramReport`.** Controls: Group By select with Dynamic Ranges, $10, $25, $50, $100 Increments (currency symbol of the client) and Complete Range; data from `repo.getAovHistogram`; `null` shows `Empty` ("AOV Histogram needs order data. It is not available in demo data or before the database update."); otherwise a `DailyChart` bar series of order counts with `labels` from the range texts, three cards (Mean, Median, Mode in `currency2`), and a `ReportTable` with columns AOV Range, Order Count, %, Order Revenue, % and `buildAovRows` rows, plus the footnote.
- [ ] **Step 5: Verify.** `npx tsc --noEmit`, `npm run lint` (0 errors) and `npm run build` succeed.
- [ ] **Step 6: Checkpoint.** Files: the six components. Message: "Add the four report pages".

---

### Task 8: Registry statuses, router and library badge

**Files:**
- Modify: `lib/reports/registry.ts`, `components/reports/ReportRouter.tsx`, `components/reports/ReportLibrary.tsx`
- Test: `lib/reports/registry.test.ts`

**Interfaces:**
- Produces: `ReportStatus = "ready" | "waiting" | "planned"`; three new `REPORTS` entries; `ReportRouter` cases for `contribution-margin`, `revenue-overview`, `new-vs-returning`, `aov-histogram`.

- [ ] **Step 1: Write the failing tests** in `lib/reports/registry.test.ts`: slugs are unique; every report with status `ready` has a `case "<slug>":` line in `components/reports/ReportRouter.tsx` (read the file with `fs`); `contribution-margin`, `revenue-overview`, `new-vs-returning` and `aov-histogram` are `ready`; `facebook-tracker`, `google-tracker`, `total-net-customer`, `variable-costs`, `calendar`, `ltv-dashboard`, `revenue-over-time` and `net-active-customers` are `planned`; `email-metrics` stays `waiting`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/registry.test.ts`. Expected: FAIL (statuses and missing slugs).
- [ ] **Step 3: Implement.** Add `planned`; set the statuses above (the existing `ready` on `mer`, `pnl`, `ads` and `first-product` stays); add entries `contribution-margin` (categories Recommended, Costs, Revenue; title "Contribution Margin"), `revenue-overview` (Revenue; "Revenue Overview"), `aov-histogram` (Conversion; "AOV Histogram"); map the four cases in `ReportRouter`; in `ReportLibrary` show a "Coming soon" pill for `planned`, styled like the "Waiting for data" pill.
- [ ] **Step 4: Run** the same command and `npm test`. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: the three modified and the test. Message: "Correct report statuses and register the four reports".

---

### Task 9: Home report links

**Files:**
- Create: `lib/reports/home-links.ts`
- Test: `lib/reports/home-links.test.ts`
- Modify: `components/MetricTile.tsx`, `components/Dashboard.tsx`, `components/reports/ReportFrame.tsx`

**Interfaces:**
- Consumes: `getReport` from `./registry`; `Range` from `@/lib/dates`.
- Produces: `HOME_REPORT_LINKS: Record<string, string>` (metric key to report slug); `homeReportHref(metricKey: string, range?: Range): string | null`; `parseRangeParams(from: string | null, to: string | null): Range | null`; `MetricTile` prop `reportHref?: string | null`; `useReportRange()` unchanged signature, now starting from `?from&to` when valid.
- Mapping: `cm` to `contribution-margin`; `orderRevenue` to `revenue-overview`; `adSpend` to `ads`; `mer` to `mer`; `aov` to `aov-histogram`; `orders` to `new-vs-returning`; `emailRevenue`, `emailOrders`, `emailCampaignRevenue`, `emailFlowRevenue`, `emailRevPer1k` to `email-metrics`.

- [ ] **Step 1: Write the failing tests** in `lib/reports/home-links.test.ts`: every slug in `HOME_REPORT_LINKS` exists in the registry; `homeReportHref("cm")`, `("orderRevenue")`, `("adSpend")`, `("mer")`, `("aov")`, `("orders")` return `/reporting/<slug>`; `homeReportHref("emailRevenue")` is `null` (report not ready); an unmapped key is `null`; with a range the href ends `?from=2026-09-01&to=2026-09-30`; `parseRangeParams("2026-09-01", "2026-09-30")` returns the range; reversed dates, a bad format (`"2026-9-1"`), a missing value and `null` all return `null`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/home-links.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/reports/home-links.ts`.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Wire the UI.** `MetricTile` renders, when `reportHref` is set, a `next/link` icon (a small inline link glyph, accessible label `Open the <label> report`) to the left of the "i" button; `Dashboard`'s `tile()` passes `reportHref={homeReportHref(def.key, data.range)}`; `useReportRange` reads `useSearchParams()` and, when `parseRangeParams` returns a range, uses it as the initial range (the report pages are dynamic, so no Suspense boundary change is needed).
- [ ] **Step 6: Verify.** `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build`, `npm test` all pass. Smoke test: start the seed-mode dev server (`.claude/launch.json` config `dashboard-seed`) and request `/reporting/contribution-margin`, `/reporting/revenue-overview`, `/reporting/new-vs-returning` and `/reporting/aov-histogram`; each returns HTTP 200.
- [ ] **Step 7: Checkpoint.** Files: the new module and test, the three modified components. Message: "Link Home tiles to their reports".

---

### Task 10: Docs and live check

**Files:**
- Modify: `docs/reports-plan.md` (status table), `docs/changelog.md` (dated entry), `CLAUDE.md` (one line under Status)

- [ ] **Step 1: Run the full checks.** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`: no errors.
- [ ] **Step 2: Update the docs.** In `docs/reports-plan.md` mark the four reports built and the other eight `ready`-but-unbuilt reports as planned; changelog entry for 2026-10-12 listing the four reports, the corrected statuses and the Home links (with the range carried in the URL); one `CLAUDE.md` line.
- [ ] **Step 3: Hand the live check to the user.** After deploy: open each of the four reports for a real client and range; Contribution Margin total equals the Home CM tile for the same range; Revenue Overview Order Revenue total equals the Home Order Revenue tile; Ad Spend, MER, CM, Order Revenue, AOV and Orders tiles each show a link icon and open the right report on the Home date range; the AOV Histogram mean times orders equals order revenue.
- [ ] **Step 4: Checkpoint.** Files: the three docs. Message: "Document the four reports and Home links".

---

## Self-review

- **Spec coverage:** four reports and shared behaviour (Tasks 2 to 7); registry fix (Task 8); Home links, icon rule and range carry-over (Task 9); AOV functions and bucket rules (Tasks 1 and 6); consistency checks (Tasks 3 to 5 tests, Task 10 live check); docs (Task 10). Not in scope items are not planned.
- **Deviations from the specs, on purpose:** the Home link mapping lives in `home-links.ts` instead of a `report` field on `MetricDef` (same behavior, keeps `lib/metrics.ts` free of report knowledge); the Home links spec's "planned" entries for the three missing reports are replaced by the real reports; the range reaches the report through URL parameters because `useReportRange` holds local state and does not share Home's picker; Product Margin is computed from `cmParts` so CM equals Home exactly.
- **Type consistency:** `NumTable`, `ColumnDef`, `NumRow`, `GroupBy`, `AovData` and the function names are spelled the same in every task that uses them.
- **Proportion:** logic with decisions is given by signatures and test assertions; no function body is written out.

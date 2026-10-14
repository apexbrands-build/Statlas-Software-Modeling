# Creative Demand, stage 2: Creative Score and Creative Demand model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth model in the plan editor's Models tab, "Creative Demand", that shows the account's Creative Score (five metrics, 0 to 100), and for each plan month how many new Meta ads are needed (evergreen and moments, images and videos) from the plan's Meta spend and the marketing calendar, with a twelve-button month menu, a year table (target, launched this year and last year, spend and efficiency) and a month view of actuals; numbers are saved, regenerated and locked per plan month.

**Architecture:** All arithmetic lives in pure modules under `lib/creative/` (score, metrics, demand, moments, format split, plan storage), tested on fixtures. The browser never downloads `meta_ad_daily`: four read-only SQL functions (run as the caller, so row-level security applies) return one row per ad, per month or per day, and the repository maps them. The screen stores its numbers in `plan_months.inputs.creative` (an optional field the generator, Summary and stretch plans ignore) and its settings in `plan_models` with a new kind `creative`.

**Tech Stack:** Next.js 16 client components, Supabase (Postgres functions, RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-creative-demand-design.md` (sections Creative Score, Demand model, Screen, Tests). Method: `Agency/Training/CTC Canon/creative-strategy.md`. Layout reference: `docs/creative-demand-reference/creative-demand-model-slide.png` (method only; our own layout and wording).

**Depends on stage 1** (`docs/superpowers/plans/2026-10-12-creative-ad-data.md`), which must be built, migrated and backfilled first. This plan consumes from it: the tables `meta_ads` (`client_id, ad_id, name, campaign_id, campaign_name, adset_id, created_at, format, is_catalog, status`) and `meta_ad_daily` (`client_id, ad_id, date, spend, impressions, clicks, purchases, revenue`, index `(client_id, date)`), the `format` values `video | image | carousel | other`, and `is_catalog` (from the `catalogKeywords` setting). Stage 1 deliberately left moment tagging to this stage: it is computed here at read time, nothing is stored.

## Global Constraints

- The app is **Apex Analytics**; no Statlas name, wording or layout on screen or in copy. Insights text is our own deterministic sentences built from the numbers, not AI.
- Formula (Canon): **new ads = max(0, ceil((target spend - current spend x carry rate) / expected spend per new ad))**.
- Target spend = the plan month's Meta spend (acquisition and non-acquisition) minus the catalog share. Catalog ads (`is_catalog`) are left out of every creative number (score, carry, spend per ad, launches, split).
- Carry rate: median of the last 3 complete months with data, clamped 0.5 to 1.1; default 0.725 (Canon 70 to 75%) under 3 months; editable per month.
- Expected spend per new ad: mean first-30-day spend of ads launched in the last 6 months; default 295 (Canon 192 to 397 midpoint) under 3 months of data; values outside 192 to 397 are flagged, not changed; editable per month.
- Moments share = distinct calendar-moment days in the month / days in the month, events of type `email` and `sms` excluded, capped at 30%; editable. Moment ad (actuals) = launched within 14 days before a moment or inside it.
- Format split: over the last 12 months, 50% each format's share of winner spend (winner = spend above the account mean per ad) + 50% current production mix; 50/50 when either format has under 20 ads. Carousel and other count as images. Split applied to evergreen and moments separately; the remainder goes to the larger share (tie: video).
- Score bands (provisional, **recalibrated 2026-10-14 to the dots on the strategist's reference slide**; the slide's account scored zero-revenue 37% = 90, concentration 31% = 41, ROAS degradation -12% = 18, spend degradation -34% = 80, evergreen share 33% = 76, an overall 56 where an equal-weight mean of those five dots gives 61, so the slide's weights are unknown and the plan keeps equal weights). Linear between anchors, clamped outside. Anchors (value as a fraction, score): zero-revenue (lower is better) [0.25, 100], [0.37, 90], [0.70, 0]; concentration (lower is better) [0.15, 100], [0.42, 0]; ROAS degradation [-0.15, 0], [-0.12, 18], [0, 80], [0.10, 100]; spend degradation [-1.0, 0], [-0.34, 80], [0, 90], [0.20, 100]; evergreen share [0, 0], [0.33, 76], [0.50, 100]. **Improvements are graded, not flat:** no change in ROAS after a launch scores 80 and +10% scores 100; no decay in spend scores 90 and +20% a week scores 100 (the strategist: the more impact, the more it should score). The screen says "provisional" until the portfolio switch (Task 9).
- Zero-revenue rate = ads that spent in the window with zero attributed revenue / ads that spent. Ads with no spend are "undelivered", shown apart.
- Spend and efficiency columns use campaign-level facts (`history.facts`, the source of truth); launch counts and score use ad-level data and say "ad-level".
- No route or page file changes (the screen sits in the existing plan editor). If a task ends up touching a route, read the matching guide in `node_modules/next/dist/docs/01-app` first (`AGENTS.md`).
- Migration number: the next free one at build time (expected 0014 after 0012 stage 1 and 0013 subscriptions); additive, functions only; applied to the live database only after the strategist's go.
- `plan_models.kind` has no check constraint (`0007_cohorts_and_models.sql`, `kind text not null`), so the new kind `creative` needs no migration.

## Review Focus

1. **Account with no ad history** (Meta just connected, or stage 1 not migrated): the score shows "No ad history" instead of 0, demand uses Canon defaults labelled "no account history", split 50/50 "too few ads"; the screen never throws when the repository returns null. Tests in Tasks 2, 3, 4 and 6.
2. **Month with no ads launched:** launched counts 0, progress bars 0 of needed, month view says "No ads launched this month"; carry rate skips a month whose previous month had no spend instead of dividing by zero. Tests in Tasks 3 and 5.
3. **Plan with no Meta spend** (no inputs, `platformPct.meta` 0, or all platform shares 0): needed is 0 with the reason "No Meta spend planned", never NaN or negative; months without inputs are skipped by Save and Regenerate. Tests in Tasks 3 and 5.
4. **Ad with zero spend:** counted as undelivered, not in the zero-revenue denominator or the top-5 concentration, but included (as 0) in the mean spend per new ad and in the format ad count. Tests in Tasks 2, 3 and 4.
5. **Large account:** a client with thousands of ads returns one row per ad (not per ad and day), paged 1,000 at a time; a missing SQL function (stage 1 or this migration not applied) returns null, not an error. Tests in Task 6; timing in the live check (Task 9).

---

### Task 1: Score bands, percentile switch and overall score

**Files:** Create `lib/creative/score.ts`, `lib/creative/score.test.ts`.

**Interfaces:**
- Produces `type MetricKey = "zeroRevenue" | "concentration" | "roasDegradation" | "spendDegradation" | "evergreenShare"`; `METRIC_KEYS: MetricKey[]`; `BANDS: Record<MetricKey, [value: number, score: number][]>` (fractions, e.g. `zeroRevenue: [[0.3, 100], [0.7, 0]]`); `DIRECTION: Record<MetricKey, "lower" | "higher" | "closerToZero">`; `PERCENTILE_MIN_CLIENTS = 10`.
- `bandScore(key: MetricKey, value: number | null): number | null`
- `percentileScore(value: number, portfolio: number[], direction: "lower" | "higher" | "closerToZero"): number` (0 to 100, share of portfolio values this one beats, ties count half).
- `creativeScore(metrics: Record<MetricKey, number | null>, portfolio?: Partial<Record<MetricKey, number[]>> | null): { score: number | null; parts: Record<MetricKey, number | null>; mode: "provisional" | "percentile" }`: equal-weight mean of non-null parts, rounded; `mode` is `percentile` only when every metric has at least 10 portfolio values.
- `scoreLabel(score: number): "Poor" | "Average" | "Great"` (under 50 Poor, the Canon's "needs more ads"; 50 to 74 Average; 75 and up Great).

- [ ] **Step 1: Write failing tests:** `bandScore("zeroRevenue", 0.37)` is 90, `(…, 0.25)` and `(…, 0.2)` 100, `(…, 0.7)` and `(…, 0.9)` 0, `(…, 0.5)` 55; `bandScore("concentration", 0.31)` 41, `(…, 0.15)` 100, `(…, 0.42)` and `(…, 0.5)` 0; `bandScore("roasDegradation", -0.12)` 18, `(…, -0.15)` and `(…, -0.3)` 0, `(…, 0)` 80, `(…, 0.05)` 90, `(…, 0.1)` and `(…, 0.4)` 100; `bandScore("spendDegradation", -0.34)` 80, `(…, -1)` 0, `(…, -0.67)` 40, `(…, 0)` 90, `(…, 0.2)` and `(…, 0.5)` 100; `bandScore("evergreenShare", 0.33)` 76, `(…, 0.5)` and `(…, 0.8)` 100, `(…, 0)` 0; `bandScore(k, null)` null. **The reference slide's five metrics give parts [90, 41, 18, 80, 76]** (a test pins this) and `creativeScore` returns 61 for them (the slide shows 56; documented, not forced). `percentileScore(0.2, [0.1,0.3,0.5,0.7], "lower")` 75; `"higher"` mirrors it; `"closerToZero"` ranks by absolute value. `creativeScore` with one null metric averages the other four; all null gives `score: null`; a portfolio with 9 values per metric stays `provisional`, with 10 becomes `percentile`. `scoreLabel(49)` Poor, `(50)` Average, `(75)` Great.
- [ ] **Step 2: Run** `npx vitest run lib/creative/score.test.ts`: FAIL (module missing).
- [ ] **Step 3: Implement** (piecewise-linear interpolation over the sorted anchors, clamped at the ends).
- [ ] **Step 4: Run:** PASS. **Step 5: Commit** `feat(creative): score bands and percentile switch`.

### Task 2: The five metrics

**Files:** Create `lib/creative/types.ts`, `lib/creative/metrics.ts`, `lib/creative/metrics.test.ts`, `lib/creative/fixtures.ts` (shared fixture ad sets used by Tasks 2 to 5).

**Interfaces:**
- Produces in `types.ts`: `AdFormat = "video" | "image" | "carousel" | "other"`; `LaunchedAd { adId: string; name: string; format: AdFormat; isCatalog: boolean; launchDate: string; spend7: number; spend30: number; revenue30: number; spendTotal: number; revenueTotal: number }`; `ScoreAd { adId: string; launchDate: string; spend30: number; revenue30: number; weeks: [number, number, number, number] }` (oldest week first, last week ends on `asOf`); `CreativeDay { date: string; spend: number; revenue: number; catalogSpend: number; launched: Record<AdFormat, number> }`; `MonthAgg { month: string; spend: number; catalogSpend: number; carriedSpend: number; launched: Record<AdFormat, number> }` (`carriedSpend` = non-catalog spend in the month on ads launched before its first day); `CreativeHistory { asOf: string; months: MonthAgg[]; ads: LaunchedAd[]; days: CreativeDay[]; scoreAds: ScoreAd[] }`.
- `zeroRevenueRate(ads: ScoreAd[]): number | null`, `undeliveredCount(ads: ScoreAd[]): number`, `adConcentration(ads: ScoreAd[]): number | null` (top 5 spend / spend), `evergreenShare(ads: ScoreAd[], asOf: string): number | null` (spenders launched more than 30 days before `asOf` / spenders), `spendDegradation(ads: ScoreAd[]): number | null` (sum over the 3 week pairs of (next - prev) for ads with spend in both weeks / sum of prev), `roasDegradation(days: CreativeDay[], ads: LaunchedAd[], asOf: string): number | null` (batches = launch days of non-catalog ads between `asOf - 89` and `asOf - 7`; per batch ROAS of days d..d+6 vs d-7..d-1 minus 1 from `days`; weighted by the batch's summed `spend7`; batches with no spend before or zero weight are skipped).
- `scoreMetrics(h: CreativeHistory): Record<MetricKey, number | null>` (uses `scoreAds`, `days`, `ads`; catalog ads are already excluded by the SQL in Task 6).

- [ ] **Step 1: Write failing tests** on `fixtures.ts` (10 ads, asOf `2026-09-30`): 3 spenders with zero revenue of 8 spenders and 2 zero-spend ads gives `zeroRevenueRate` 0.375 and `undeliveredCount` 2; top-5 share on a known spend list; evergreen share counts an ad launched 2026-08-31 (30 days) as new and 2026-08-30 as evergreen; spend degradation for weeks `[100,80,60,60]` on one ad and an ad live only in week 4 (ignored) is (-20-20+0)/240; ROAS degradation with one batch on 2026-09-10 (ROAS 3.0 before, 2.4 after) is -0.2, and a second batch weighted 3x as much at -0.1 gives -0.125; no batches gives null; an empty history makes every metric null.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS. **Step 5: Commit** `feat(creative): five score metrics`.

### Task 3: Demand arithmetic

**Files:** Create `lib/creative/demand.ts`, `lib/creative/demand.test.ts`.

**Interfaces:**
- Consumes `MonthAgg`, `LaunchedAd` (Task 2); `PlanMonthInputs` (`lib/planning/types.ts`).
- Produces constants `DEFAULT_CARRY = 0.725`, `CARRY_MIN = 0.5`, `CARRY_MAX = 1.1`, `DEFAULT_SPEND_PER_AD = 295`, `SPEND_PER_AD_RANGE = [192, 397]`, `MIN_MONTHS = 3`.
- `monthsWithData(months: MonthAgg[]): number`
- `carryRate(months: MonthAgg[], openMonth: string): { value: number; source: "account" | "defaults"; samples: number[] }` (complete months before `openMonth`; rate = `carriedSpend` / previous month's non-catalog spend; months whose previous month had no non-catalog spend are skipped).
- `spendPerNewAd(ads: LaunchedAd[], asOf: string, monthsOfData: number): { value: number; source: "account" | "defaults"; count: number; outsideRange: boolean }` (non-catalog ads launched between `asOf - 30 - 182` and `asOf - 30`, so every ad has its full 30 days; zero-spend ads count).
- `metaSpendOf(inputs: PlanMonthInputs | null): number` (`spend x platformPct.meta / sum of platformPct`, 0 when no inputs or the sum is 0).
- `catalogShare(months: MonthAgg[], openMonth: string): number` (last 3 complete months, catalog / total, 0 when none).
- `currentSpend(month: string, a: { months: MonthAgg[]; openMonth: string; last30NonCatalog: number; planNonCatalog: Record<string, number> }): { value: number; source: "actual" | "last30" | "plan" }`: previous month complete with data → its actual non-catalog spend; previous month is the open month → latest 30 days; previous month in the future → the plan's non-catalog Meta target for it (chain; see Self-review).
- `neededAds(target: number, current: number, carry: number, perAd: number): { needed: number; covered: boolean }`.

- [ ] **Step 1: Write failing tests:** carry from three months with rates 0.6, 0.8, 0.7 is 0.7 `account`; rates 0.3, 0.4, 0.45 clamp to 0.5; 1.4 values clamp to 1.1; two months of data give 0.725 `defaults`; a month after a zero-spend month is skipped. Spend per ad: ads with first-30 spend 0, 100, 500 give mean 200 (the zero ad counts); an ad launched 20 days before `asOf` is excluded; 2 months of data give 295 `defaults`; 150 sets `outsideRange`. `metaSpendOf` with spend 100,000 and `{meta: 60, google: 40}` is 60,000; null inputs, `{}` and `{google: 100}` give 0. `neededAds(88000, 50000, 0.7, 300)` is `{needed: 177, covered: false}`; `(30000, 50000, 0.7, 300)` is `{needed: 0, covered: true}`; target 0 gives 0. `currentSpend` returns each of the three sources on a fixture.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS. **Step 5: Commit** `feat(creative): demand arithmetic`.

### Task 4: Moments and format split

**Files:** Create `lib/creative/moments.ts`, `lib/creative/format.ts`, `lib/creative/moments.test.ts`, `lib/creative/format.test.ts`.

**Interfaces:**
- Consumes `MarketingEvent`, `eventDays` (`lib/planning/events.ts`; note the field is `type`, the spec says "category").
- Produces `MOMENT_EXCLUDED_TYPES = ["email", "sms"]`, `MOMENTS_CAP = 0.3`, `DEFAULT_LEAD_DAYS = 14`; `isMoment(e: MarketingEvent): boolean`; `momentsShare(month: string, events: MarketingEvent[], cap?: number): { share: number; days: number; capped: boolean }`; `isMomentAd(launchDate: string, events: MarketingEvent[], leadDays?: number): boolean`.
- Produces `FormatCount { video: number; image: number }`; `formatGroup(f: AdFormat): "video" | "image"`; `formatEvidence(ads: LaunchedAd[], asOf: string): Record<"video" | "image", { count: number; spend: number; revenue: number; roas: number | null; winners: number; winnerSpend: number }>` (non-catalog ads launched in the 365 days to `asOf`, `spendTotal`, winner = `spendTotal` above the mean over both formats); `videoShare(ev): { share: number; reason: "evidence" | "few_ads" }`; `splitFormats(n: number, videoShare: number): FormatCount`.

- [ ] **Step 1: Write failing tests:** November 2026 with Black Friday 11-27 to 11-30 and a Promotion 11-28 to 12-02 is 4 days, share 4/30 (overlap counted once, December days ignored); an event 11-01 to 11-20 gives 0.3 `capped`; an Email and an SMS event add nothing; no events gives 0. `isMomentAd("2026-11-13", [BF 11-27])` true (14 days before), `"2026-11-12"` false, a launch on 11-29 true. `formatGroup("carousel")` image. `videoShare`: 25 videos holding 60% of winner spend and 25 images gives 0.55 `evidence`; 19 videos gives 0.5 `few_ads`; no ads gives 0.5. `splitFormats(10, 0.5)` 5/5; `(5, 0.5)` 3 video / 2 image; `(7, 0.3)` 2 / 5; `(0, 0.6)` 0 / 0. A zero-spend ad counts in `count`, never in `winners`.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS. **Step 5: Commit** `feat(creative): moments share and format split`.

### Task 5: Plan storage, Regenerate, year table and insights

**Files:** Create `lib/creative/plan.ts`, `lib/creative/plan.test.ts`. Modify `lib/planning/types.ts` (`PlanMonthInputs.creative?: CreativeMonth`, type imported from `lib/creative/plan.ts` as a type-only import) and `lib/planning/models.ts` (`ModelKind` gains `"creative"`; `CreativeSettings { leadDays: number; momentRule: "calendar" }`, `DEFAULT_CREATIVE: CreativeSettings = { leadDays: 14, momentRule: "calendar" }`).

**Interfaces:**
- Produces `CreativeOverrides { carryRate?: number; spendPerAd?: number; momentsShare?: number; needed?: number }`; `CreativeMonth { needed: number; evergreen: number; moments: number; split: { evergreen: FormatCount; moments: FormatCount }; basis: { targetSpend: number; currentSpend: number; carryRate: number; spendPerAd: number; momentsShare: number; videoShare: number; source: "account" | "defaults"; reason: "ok" | "covered" | "no_meta_spend" }; overrides: CreativeOverrides; locked: boolean; computedAt: string }`.
- `computeCreativeMonth(a: { month: string; inputs: PlanMonthInputs | null; history: CreativeHistory | null; events: MarketingEvent[]; planNonCatalog: Record<string, number>; overrides?: CreativeOverrides; now: string }): CreativeMonth | null` (null when `inputs` is null; a null history uses every Canon default).
- `regenerateCreative(months: PlanMonth[], compute: (m: PlanMonth, overrides: CreativeOverrides) => CreativeMonth | null): Record<string, CreativeMonth>` (skips months where `PlanMonth.locked` or `inputs.creative.locked`; passes each month's saved `overrides` back in).
- `lockAll(months: PlanMonth[], locked: boolean): Record<string, CreativeMonth>`; `isStale(c: CreativeMonth, targetSpend: number): boolean` (more than 1% apart, e.g. a stretch plan copied from the baseline or a spend edit after Save); `keepCreative(prev: PlanMonthInputs | null, next: PlanMonthInputs | null): PlanMonthInputs | null` (a Fill from last year or recent keeps the month's creative block).
- `launchProgress(ads: LaunchedAd[], events: MarketingEvent[], month: string, leadDays: number): { moments: FormatCount; evergreen: FormatCount }`.
- `yearTable(a: { year: number; months: PlanMonth[]; history: CreativeHistory | null; facts: DailyFact[]; settings: ClientSettings; lastData: string }): { rows: YearRow[]; total: YearRow }` with `YearRow { month: string; target: number | null; launchedThisYear: number; launchedLastYear: number; metaSpendLastYear: number; amerLastYear: number | null; roasLastYear: number | null; spendThisYear: number; spendIsActual: boolean; amerThisYear: number | null }` (Meta spend = `channels.meta_acquisition` + `meta_returning`; aMER via `METRICS.amer.value(aggregate(monthFacts), settings)` from `lib/metrics.ts`; elapsed months show actuals, the rest the plan's Meta spend).
- `creativeInsights(score: ReturnType<typeof creativeScore>, metrics: Record<MetricKey, number | null>, month: CreativeMonth | null): string[]` (two to five short sentences, the weakest and strongest metric, "below 50: the account needs more new ads", the covered or no-spend reason).

- [ ] **Step 1: Write failing tests:** `computeCreativeMonth` with the Task 3 numbers gives needed 177, moments `round(177 x share)`, evergreen the rest, splits summing to each part; with `overrides.needed = 40` the parts follow 40; with `platformPct` without Meta gives needed 0 and reason `no_meta_spend`; with a null history gives `source: "defaults"`. `regenerateCreative` leaves a `PlanMonth.locked` month and a `creative.locked` month exactly as saved, keeps an unlocked month's `overrides.carryRate` and recomputes the rest, skips months with null inputs. `isStale` true at 2% off. `keepCreative` carries `creative` onto new inputs and returns null for null. `launchProgress` counts a moment video and an evergreen carousel (as image) and ignores catalog ads. `yearTable` totals equal the sum of its rows, and a month with no launches shows 0, not null. `generateMonth` (`lib/planning/generate.ts`) returns identical rows for inputs with and without a `creative` block, and `planFigures` (`lib/planning/summary.ts`) gives the same figures both ways. `creativeInsights` for score 40 includes the "needs more new ads" sentence.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run lib/creative lib/planning` and `npx tsc --noEmit`: PASS. **Step 5: Commit** `feat(creative): plan storage, regenerate, year table`.

### Task 6: SQL functions and repository

**Files:** Create `supabase/migrations/00NN_creative_demand.sql`, `lib/creative/rows.ts`, `lib/creative/rows.test.ts`, `lib/creative/demo.ts`, `lib/creative/demo.test.ts`. Modify `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`.

**Interfaces:**
- SQL (all `language sql stable`, run as the caller like `aov_stats` in `0010_aov_histogram.sql`, catalog ads excluded unless a column says catalog, launch date = `(coalesce(created_at, first spend day in meta_ad_daily) at time zone clients.timezone)::date` (stage 1 stores a minimal row with `created_at` null for an ad Meta could not describe, and the sync now asks for archived and deleted ads too, but some old ads may still come back empty), `grant execute … to authenticated`):
  - `creative_ads(p_client uuid, p_from date, p_to date)` → one row per ad launched in the range: `ad_id, name, format, is_catalog, launch_date, spend_7d, spend_30d, revenue_30d, spend_total, revenue_total` (catalog ads included and flagged here so the month list can show them greyed).
  - `creative_months(p_client uuid, p_from date, p_to date)` → per month: `month, spend, catalog_spend, carried_spend, launched_video, launched_image, launched_carousel, launched_other`.
  - `creative_days(p_client uuid, p_from date, p_to date)` → per day: `date, spend, revenue, catalog_spend, launched_video, launched_image, launched_carousel, launched_other`.
  - `creative_score_ads(p_client uuid, p_to date)` → per non-catalog ad that spent in `p_to - 29 .. p_to` or launched in it: `ad_id, launch_date, spend_30, revenue_30, w1, w2, w3, w4` (four 7-day weeks ending `p_to`).
- `rows.ts`: `mapLaunchedAd(r)`, `mapMonthAgg(r)`, `mapCreativeDay(r)`, `mapScoreAd(r)` (numeric strings to numbers, null to 0).
- `Repository.getCreativeHistory(clientId: string, asOf: string, fromMonth: string): Promise<CreativeHistory | null>` (months from `fromMonth` (Jan 1 of the plan year minus one) to `asOf`; ads launched in the 365 days to `asOf`; days `asOf - 96` to `asOf`; score ads at `asOf`); `Repository.getCreativeMonth(clientId: string, month: string): Promise<{ ads: LaunchedAd[]; days: CreativeDay[] } | null>`. Both return null when a function or table is missing (same regex pattern as `getAovHistogram`), and page `creative_ads` with the existing `fetchAll` (1,000 rows a page).
- `demo.ts`: `demoCreativeHistory(clientId: string, asOf: string): CreativeHistory` and `demoCreativeMonth(clientId, month)`, deterministic (seeded by client id), both formats, a few zero-spend and catalog ads, used by the seed repository.

- [ ] **Step 1: Write failing tests:** each mapper turns `{spend_7d: "12.50", revenue_30d: null}` into `12.5` and `0` and keeps `launch_date` as `YYYY-MM-DD`; `demoCreativeHistory` returns the same object twice for the same client, has 20+ ads of each format group and at least one zero-spend ad, and `scoreMetrics` on it gives five non-null metrics.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement** mappers, demo data, the migration and both repository implementations. The browser only ever receives these aggregates; `meta_ad_daily` rows are never selected from the client.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`: PASS. **Step 5: Commit** `feat(creative): ad-level read functions and repository`.

### Task 7: Model screen, top row and month menu

**Files:** Create `components/planning/models/CreativeModel.tsx`, `components/planning/models/CreativeScoreCard.tsx`. Modify `components/planning/models/ModelsStep.tsx` (View `"creative"`, sidebar entry "Creative Demand Model", a fourth Card on Info, grid `lg:grid-cols-2 xl:grid-cols-4`), `components/planning/models/icons.tsx` (a `CreativeIllustration`), `components/planning/PlanEditor.tsx` (`fill` wraps its result in `keepCreative`). No route or page file changes.

**Interfaces:**
- Consumes everything from Tasks 1 to 6; `PlanCtx` (`months`, `editInputs`, `events`, `history`, `settings`, `plan`), `ModelCtx.saveModel("creative", settings, results, note)`.
- Screen state: `history: CreativeHistory | null | "loading"`, `sel: string` (month key), `settings: CreativeSettings` (loaded with `getPlanModel(plan.id, "creative")`).

- [ ] **Step 1: Build the top row:** Creative Score card (overall score, Poor / Average / Great scale, the five metrics with value and 0 to 100 marker, "provisional" tag, undelivered count, "No ad history" state); Target card (selected month, Moments and Evergreen bars "launched / needed" with images and videos, a ring "total new ads needed", the basis line: target spend, current spend x carry, spend per ad, with the source and the Canon range flag, and inline fields for the four overrides); insights text from `creativeInsights`.
- [ ] **Step 2: Buttons:** Save (writes `computeCreativeMonth` results through `editInputs` for every unlocked month with inputs, saves `CreativeSettings` and a score snapshot with `saveModel`, then says "Press Save plan to keep it", like the New Customer model); Regenerate Plan (`regenerateCreative`); Lock Plan / Unlock (`lockAll`). Months with null inputs show "Plan this month first"; stale months show a "Spend changed, regenerate" chip.
- [ ] **Step 3: Month menu:** twelve buttons Jan to Dec in one row (wrapping on phones), the selected one highlighted, each with a small dot when the month has a saved creative block; clicking loads that month everywhere.
- [ ] **Step 4: Verify:** `npx tsc --noEmit`, `npx eslint .`, `npm run build`; in demo mode (`NEXT_PUBLIC_DATA_MODE=seed`, Supabase env vars blank) open a plan, Models, Creative Demand: score and ring render, Save then Save plan keeps the numbers after a reload of the plan, Lock Plan then Regenerate changes nothing, a month with Meta at 0% shows "No Meta spend planned". **Step 5: Commit** `feat(creative): creative demand model screen`.

### Task 8: Year table and month view

**Files:** Create `components/planning/models/CreativeYearTable.tsx`, `components/planning/models/CreativeMonthView.tsx`. Modify `CreativeModel.tsx`.

**Interfaces:** Consumes `yearTable`, `launchProgress`, `Repository.getCreativeMonth`, `LineChart` and `Legend` from `components/planning/models/charts.tsx`.

- [ ] **Step 1: Year table** (below the month menu): one row per month with target ads, launched this year, launched last year, Meta spend last year, aMER and Meta ROAS last year, this year's spend (actual for elapsed months, target otherwise, marked) and actual aMER; a total row; clicking a row selects the month.
- [ ] **Step 2: Month view** (opens above the table for the selected month): ads launched by day as small stacked bars by format; daily Meta spend and aMER (`LineChart`, from `history.facts`) with launch days marked; the batch's spend in its first 7 and 30 days (sum of `spend7` / `spend30` per launch day); the list of launches (name, format, launch date, first-30-day spend and ROAS, catalog ads greyed). Empty states: "No ads launched this month", "No ad-level data yet". For the open month the progress bars use launches so far.
- [ ] **Step 3: Verify** as in Task 7 Step 4, plus: a month in the future shows the target and no actuals; a phone-width window keeps the table scrollable inside its card. **Step 4: Commit** `feat(creative): year table and month view`.

### Task 9: Docs, live check and (later) the portfolio switch

**Files:** Modify `docs/planning-layer.md`, `docs/reports-plan.md`, `docs/changelog.md`, `CLAUDE.md` (status line).

- [ ] **Step 1: Docs:** the model, its formula and defaults, where numbers are stored, "provisional" bands.
- [ ] **Step 2: Live check after the migration is applied (strategist's go):** on one Meta client, compare one month's `sum(spend)` from `creative_months` (spend) with `select sum(spend) from meta_ad_daily where client_id = … and date between …` (must match exactly: the month table ties to `meta_ad_daily`), and with campaign-level `ad_spend_daily` for Meta (small gap expected); note how long the four calls take for the biggest client.
- [ ] **Step 3 (separate small change, only when 10 clients have 90 days of ad data):** a table `creative_score_snapshots(client_id, as_of, days_of_data, metrics jsonb)` written on Save, and a security-definer function returning only the metric values (no client ids) of clients with 90+ days; the screen passes them to `creativeScore` as `portfolio`, which already switches mode (Task 1). Not built now.

---

## Self-review

- **Spec coverage:** score (Tasks 1, 2), demand (3), moments and split (4), storage, Save, Regenerate, Lock, year table, insights (5, 7, 8), data access without downloading ad-days (6), month view (8), percentile switch (1 now, data in 9 later). Not in scope per the spec: previews, tags, briefs, catalog planning, Best Creatives (stage 3).
- **Spec vs code, flagged:** (1) the spec says "third model"; there are already three (New, Returning, Event), so this is the fourth. (2) The spec says "months with `status = locked`"; `PlanMonth.status` is `in_progress | final` and locking is the boolean `PlanMonth.locked`, which this plan uses (and `editInputs` already ignores locked months). (3) The spec says event "category"; the field is `type` (`email`, `sms`). (4) The spec's first bands did not reproduce the reference slide (zero-revenue 37% gave 82, the slide shows 90; spend degradation -34% gave 43, the slide shows 80); the strategist approved recalibrating to the slide's dots on 2026-10-14, so the bands in Global Constraints replace the spec's. (5) Stage 1 deferred moment tagging; here it is computed at read time.
- **Choices the spec leaves open (strategist can change):** current spend for future months chains to the plan's previous month (the spec's "last full month" only fits the next month); catalog ads are left out of the score as well as the demand (confirmed 2026-10-14); improvements in ROAS or spend score higher the bigger they are (confirmed 2026-10-14); current spend for future months is the previous month's plan or recent spend (confirmed); the 7-day after-window starts on the launch day; tie in the split goes to video; launch counts exclude catalog ads.
- **Type consistency:** `LaunchedAd`, `ScoreAd`, `CreativeDay`, `MonthAgg`, `CreativeHistory`, `CreativeMonth`, `CreativeOverrides`, `FormatCount`, `MetricKey` are defined once (Tasks 2, 4, 5) and used with the same names.
- **Stretch plans and Summary:** `stretchPlanMonths` copies inputs (including `creative`) from the baseline; the stale chip shows when the stretch's Meta spend differs, and Regenerate fixes it. `generateMonth` and Summary never read `creative` (tested in Task 5).

**Sizing:** about 6 working days for Claude, test first, plus one independent review (Tasks 1 to 4: 2 days, Task 5: 1, Task 6: 1, Tasks 7 and 8: 1.5, docs and live check: 0.5). **Ship first:** the Creative Score alone (Tasks 1, 2, the `creative_score_ads` and `creative_days` functions from Task 6, and the score card of Task 7 inside the new model view) in about 2.5 days; the demand ring, year table and month view follow. **What could blow it up:** stage 1 volumes (a slow `creative_ads` over 12 months for the biggest account would need a materialised monthly table), Meta `created_time` not matching first delivery (ads created long before they run would look like evergreen), and demo data not matching real shapes. **From the strategist:** stage 1 built and backfilled 13 months; the go for the migration. The open choices were confirmed on 2026-10-14.

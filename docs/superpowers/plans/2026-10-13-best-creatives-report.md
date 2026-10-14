# Creative stage 3: Best Creatives report and scaling-winner flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new report `/reporting/best-creatives` lists a client's Meta ads for the picked date range (name, format, launch date, days live, spend, revenue, ROAS, purchases, CPA, CTR, CPM, estimated CM, share of spend, week-over-week trend), colours every number against the account's own average for the period, filters by format, campaign, catalog and live status, loads 50 ads at a time, and flags a **scaling winner** (spend up X% week over week with ROAS above the account average) and a **fading** ad (ROAS dropping on a former winner), with thresholds the strategist can edit per client.

**Architecture:** All maths lives in pure, tested functions in `lib/creative/best-creatives.ts` (metrics, benchmark, windows, flags) and `lib/creative/aggregate.ts` (a TypeScript reference of the server aggregation, used by demo mode and as the executable spec of the SQL). The database does the heavy lifting: two read-only SQL functions aggregate `meta_ad_daily` per ad and per format on the server (sorted, filtered, `limit`/`offset`), so the browser never downloads ad-day rows. The page is a client component like `PaidMediaReport`, reading through new `Repository` methods; when the tables or functions are missing it says so instead of failing.

**Tech Stack:** Next.js 16 client component, Supabase Postgres SQL functions (`language sql stable`, run as the caller so row-level security applies), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-creative-demand-design.md` (section "Creative intelligence (stage 3, own plan later)"), `docs/future-vision.md` (section "Creative intelligence layer": ad list on demand, metric chips Spend / CM / Revenue / ROAS, store averages for the period as benchmark, campaign-name and ad-title toggles, the week-over-week winner flag, depth closer to Motion or Atria). The spec says stage 3 is "specified when stage 2 is live"; this plan stands in for that spec and needs the strategist's yes on the decisions marked **Decision** below. Depends on stage 1 (`docs/superpowers/plans/2026-10-12-creative-ad-data.md`, migration 0012) being built, applied and backfilled. It does not depend on stage 2 (Creative Score, demand model).

## Global Constraints

- Our own design: never copy Statlas's layout, wording or code. Nothing about Statlas's Best Creatives is recorded in `docs/statlas-findings.md` or `docs/statlas-docs/` (the report was never opened), so the method comes only from the future-vision notes. Report title "Best Creatives" (approved name), description our own: "Your Meta ads ranked against the account's own average, with the ads that are scaling right now".
- Columns read from stage 1, and nothing else: `meta_ads(client_id, ad_id, name, campaign_name, created_at, format, is_catalog, status)` and `meta_ad_daily(client_id, ad_id, date, spend, impressions, clicks, purchases, revenue)`. `campaign_id`, `adset_id` and `updated_at` are not read.
- Read-only: the SQL functions only `select`; no new tables. Migration `NNNN_best_creatives.sql` takes the next free number at build time (stage 1 uses 0012, the subscriptions plan 0013, so expect 0014); applied to the live project only after the strategist's go.
- Revenue and purchases are Meta-reported (platform, not incremental). The attribution window is the one stage 1 applied when the rows were synced (Store Settings `fbAttrClick` / `fbAttrView`, default 7-day click via `metaWindows`); the screen states it.
- **Decision (CM):** CM per ad is not knowable from Meta. Shown as **"Est. CM"** = ad revenue x store margin before ads - ad spend, where store margin before ads = (CM + ad spend) / order revenue of the same date range from `cmParts` and `orderRevenue` in `lib/metrics.ts`. The column header carries an "i" text with that formula; when the store had no order revenue in the range the column shows "–".
- **Decision (benchmark):** the benchmark is the whole Meta account for the period, ignoring the filters (so a filtered list is still compared with the account): ratios are account ratios (ROAS = total revenue / total spend, CPA, CTR, CPM), amounts are the per-ad average over ads that spent (spend, revenue, purchases, Est. CM). Share of spend has no colour.
- Colours use `compare()` from `lib/metrics.ts`: within 10% of the benchmark is neutral grey, both directions; spend, revenue, purchases, ROAS, CTR, Est. CM are higher-is-better (spend included, as everywhere in the app); CPA and CPM lower-is-better.
- **Decision (week over week):** two rolling 7-day windows ending on the anchor = the earlier of the range end and the last day with ad data: current = anchor-6 to anchor, previous = anchor-13 to anchor-7. Rolling, not calendar weeks, so the flag always uses the freshest complete days; the windows may start before the range.
- **Decision (flag defaults, editable per client in `ExtraSettings`):** scaling winner = previous-window spend > 0, current-window spend at least `creativeScaleMinSpend` (default 250, account currency), current spend >= previous x (1 + `creativeScaleSpendUpPct`/100) (default 50), and current-window ad ROAS >= the account's current-window ROAS. Fading = previous-window spend >= `creativeScaleMinSpend`, previous-window ad ROAS >= the account's previous-window ROAS, and current-window ROAS <= previous x (1 - `creativeFatigueRoasDropPct`/100) (default 30). An ad whose launch date falls in the current window is "New", never scaling or fading. The 10% neutral band does not apply to flags.
- Currency: amounts are stored in the Meta ad account's currency and shown with the client's currency, exactly like Paid Media Overview; the ad account's currency is not stored anywhere today (`integrations` has no currency column), so a mismatch cannot be detected. Out of scope; listed under Sizing.
- `AGENTS.md`: before Task 5 read `node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/index.md` and the dynamic-route page in `node_modules/next/dist/docs/01-app/03-api-reference` (the page goes through the existing `app/reporting/[slug]/page.tsx`, which is not changed).
- Tests only in `lib/**/*.test.ts`; components are checked by type check, lint, build and a browser check in demo mode (`NEXT_PUBLIC_DATA_MODE=seed`, Supabase env vars blanked).

## Review Focus

1. A client with Meta connected but no ad-level rows yet (stage 1 not backfilled, or migration not applied): the page says "No ad-level data yet: it arrives with the next Meta sync or a history load" (or "Ad-level reporting is not set up on this database yet" when the functions are missing) and never shows a broken table or zeros. Tested in Task 4 (`mapCreativeError` and null returns) and Task 2 (`wowWindows(…, null)`).
2. Thousands of ads over a 13-month range: only one page (50) of rows plus the format totals cross the wire; "Load more" appends the next 50 without repeats or gaps under a stable sort; `limit` is clamped to 1-200. Tested in Task 3 (2,500-ad fixture) and timed in Task 6's live check.
3. An ad paused mid-range: it keeps its range totals, shows its last spend day, days live stop at the last spend, trend shows "Stopped", it is never flagged. Tested in Tasks 2 and 3.
4. An ad launched this week, an ad with zero purchases, a day with spend but zero impressions: "New" and no flag; CPA "–" (not 0 or infinity); ROAS 0.00 when spend > 0 and revenue 0; CTR/CPM "–" without impressions. Tested in Task 1 and Task 2.
5. Thresholds typed as blank, negative or text in Store Settings: the defaults apply, the flag never fires on everything or crashes. Tested in Task 2 (`flagRules`).

---

### Task 1: Ad metrics, store margin and benchmark

**Files:** Create `lib/creative/best-creatives.ts`, `lib/creative/best-creatives.test.ts`.

**Interfaces:**
- Produces types: `AdFormat = "video" | "image" | "carousel" | "other"`; `Window2 = { spend: number; revenue: number }`; `AdAgg { adId: string; name: string; campaignName: string | null; format: AdFormat; isCatalog: boolean; status: string | null; launched: string | null; firstSpend: string; lastSpend: string; activeDays: number; spend: number; revenue: number; purchases: number; impressions: number; clicks: number; cur: Window2; prev: Window2 }`; `FormatTotals { format: AdFormat; ads: number; spend: number; revenue: number; purchases: number; impressions: number; clicks: number; cur: Window2; prev: Window2 }`; `CreativeTotals = Omit<FormatTotals, "format">` (`ads` = ads that spent).
- `sumFormats(rows: FormatTotals[]): CreativeTotals`.
- `storeMargin(t: Totals, s: ClientSettings): number | null` = `(cmParts(t, s).cm + cmParts(t, s).adSpend) / orderRevenue(t)`, null when order revenue is 0.
- `type CreativeMetric = "spend" | "revenue" | "roas" | "purchases" | "cpa" | "ctr" | "cpm" | "estCm" | "share"`; `CREATIVE_METRICS: Record<CreativeMetric, { label: string; format: Format; direction: Direction | "none" }>` (share: "none"; cpa, cpm: "down"; the rest "up").
- `adMetrics(a: AdAgg, t: CreativeTotals, margin: number | null): Record<CreativeMetric, number | null>`.
- `benchmark(t: CreativeTotals, margin: number | null): Record<CreativeMetric, number | null>`.
- `metricTone(m: CreativeMetric, v: number | null, bench: Record<CreativeMetric, number | null>): Tone` (wraps `compare`).

- [ ] **Step 1: Write failing tests** (`describe("adMetrics")`, `describe("benchmark")`, `describe("storeMargin")`):
  - ad spend 200, revenue 600, purchases 4, impressions 10,000, clicks 150, account spend 1,000, margin 0.5: roas 3, cpa 50, ctr 0.015, cpm 20, estCm 100 (600 x 0.5 - 200), share 0.2.
  - purchases 0: cpa null; revenue 0 with spend 200: roas 0; spend 0: roas null, cpa null, share 0; impressions 0: ctr null, cpm null; margin null: estCm null.
  - benchmark of totals {ads 4, spend 1,000, revenue 2,500, purchases 25, impressions 50,000, clicks 500}, margin 0.4: roas 2.5, cpa 40, ctr 0.01, cpm 20, spend 250, revenue 625, purchases 6.25, estCm (2,500 x 0.4 - 1,000) / 4 = 0, share null; totals with `ads` 0 give every value null.
  - `metricTone("spend", 270, bench with spend 250)` neutral (8%); `("spend", 300, …)` good; `("cpa", 50, bench cpa 40)` bad; `("share", …)` neutral.
  - `storeMargin`: a `Totals` built with `emptyTotals()` plus net sales 800, shipping 100, order revenue 1,000, COGS 300, Meta spend 200, `otherVariablePct` 10 gives (800 + 100 - 300 - 90) / 1,000 = 0.51 (ad spend added back); order revenue 0 gives null.
  - `sumFormats` of a video row and an image row adds every field including `cur` and `prev`.
- [ ] **Step 2: Run** `npx vitest run lib/creative/best-creatives.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the functions above; division through `div` from `lib/metrics.ts`.
- [ ] **Step 4: Run** the test and `npx tsc --noEmit`. Expected: PASS, no errors.
- [ ] **Step 5: Commit** `feat(creative): ad metrics, store margin and account benchmark`.

### Task 2: Week-over-week windows, flags and their settings

**Files:** Modify `lib/creative/best-creatives.ts`, `lib/creative/best-creatives.test.ts`, `lib/types.ts` (`ExtraSettings`), `lib/defaults.ts` (`defaultExtra`).

**Interfaces:**
- Consumes `AdAgg`, `CreativeTotals` (Task 1); `addDays`, `diffDays`, `min` from `lib/dates.ts`.
- Produces `WowWindows { cur: Range; prev: Range }`; `wowWindows(rangeTo: string, lastAdDate: string | null): WowWindows | null`.
- `ExtraSettings.creativeScaleSpendUpPct: number` (50), `creativeScaleMinSpend: number` (250), `creativeFatigueRoasDropPct: number` (30); `FlagRules { spendUpPct: number; minSpend: number; roasDropPct: number }`; `flagRules(extra: ExtraSettings): FlagRules`.
- `type CreativeFlag = "scaling" | "fading" | "new" | null`; `creativeFlag(a: AdAgg, t: CreativeTotals, rules: FlagRules, w: WowWindows | null): CreativeFlag`.
- `wowChange(a: AdAgg): number | null` (current vs previous spend; null when previous is 0); `daysLive(a: AdAgg): number` = `diffDays(launched ?? firstSpend, lastSpend) + 1`; `trendLabel(a: AdAgg, w: WowWindows | null): string` ("New", "Stopped", "+64%", "–").
- `attributionCaption(extra: ExtraSettings): string` (e.g. "Meta-reported, 7-day click"; "7-day click + 1-day view"), from `metaWindows` in `lib/sync/meta-windows.ts`.

- [ ] **Step 1: Write failing tests:**
  - `wowWindows("2026-10-31", "2026-10-12")` gives cur 2026-10-06 to 2026-10-12, prev 2026-09-29 to 2026-10-05; `wowWindows("2026-10-10", "2026-10-12")` anchors on 2026-10-10; `wowWindows("2026-10-31", null)` is null.
  - account cur {spend 5,000, revenue 10,000} (ROAS 2), prev {4,000, 8,000}, rules defaults: ad prev 300, cur 500 at ROAS 2.4 is "scaling" (up 67%); cur 440 (up 47%) is null; cur ROAS 1.9 is null; prev 100, cur 200 (below 250) is null; prev 0, cur 900, launched before the window is null (no base week); launched 2026-10-08 with cur 900 is "new"; paused ad (cur 0, prev 600, last spend 2026-10-04) is null and `trendLabel` "Stopped".
  - fading: prev {600, revenue 1,500} (ROAS 2.5, above account 2), cur ROAS 1.6 (down 36%) is "fading"; cur ROAS 1.9 (down 24%) is null; prev ROAS 1.8 (below account) dropping to 1.0 is null; `w` null gives null for every ad.
  - `flagRules` of defaults gives {50, 250, 30}; `creativeScaleSpendUpPct` -5, NaN, `""` (stored as text) fall back to 50; `creativeScaleMinSpend` 0 is kept (0 means "no minimum").
  - `daysLive`: launched 2026-09-01, last spend 2026-09-10 gives 10; launched null, first spend 2026-09-05, last spend 2026-09-05 gives 1. `wowChange` prev 0 gives null; prev 200, cur 300 gives 0.5.
  - `defaultExtra()` has the three new defaults.
  - `attributionCaption` with `fbAttrClick` "7 Day", `fbAttrView` "Disabled" gives "Meta-reported, 7-day click".
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.** `flagRules` coerces with `Number()` and keeps a value only when finite and >= 0 (spendUpPct also > 0).
- [ ] **Step 4: Run** the test file and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(creative): week-over-week windows, scaling and fading flags`.

### Task 3: Query model and the TypeScript reference aggregation

**Files:** Create `lib/creative/aggregate.ts`, `lib/creative/aggregate.test.ts`.

**Interfaces:**
- Consumes Task 1 and 2 types.
- Produces `AdDayRow { adId: string; date: string; spend: number; impressions: number; clicks: number; purchases: number; revenue: number }`; `AdInfo { adId: string; name: string; campaignName: string | null; format: AdFormat; isCatalog: boolean; status: string | null; launched: string | null }`.
- `type CreativeSort = "spend" | "revenue" | "roas" | "purchases" | "estCm" | "gain"` ("gain" = current minus previous window spend).
- `CreativeQuery { from: string; to: string; windows: WowWindows | null; format: AdFormat | "all"; campaign: string; catalog: "all" | "exclude" | "only"; live: "all" | "live" | "not_live"; sort: CreativeSort; margin: number | null; limit: number; offset: number }`; `normalizeQuery(q: CreativeQuery): CreativeQuery` (limit clamped 1-200, offset >= 0 and whole, campaign trimmed, sort "estCm" with null margin becomes "spend").
- `CreativePage { rows: AdAgg[]; total: number }`.
- `aggregateAds(days: AdDayRow[], ads: AdInfo[], q: CreativeQuery): CreativePage` and `aggregateFormats(days: AdDayRow[], ads: AdInfo[], from: string, to: string, w: WowWindows | null): FormatTotals[]`. These are the spec of the SQL in Task 4: same filters, same order, same tie-break.
- Rules both must follow: an ad is listed when it has spend > 0 in [from, to]; `cur`/`prev` are summed over the windows' dates even outside the range; live = `status = 'ACTIVE'` (Meta effective status at the last sync; null counts as not live); campaign filter = case-insensitive "contains" on campaign name; an ad-day with no `AdInfo` gets name = ad id, format "other", not catalog, status null; order = sort value descending with nulls last, then spend descending, then `adId` ascending.

- [ ] **Step 1: Write failing tests:**
  - filters: format "video" keeps only video; catalog "exclude"/"only"; live "live" keeps ACTIVE only, "not_live" keeps PAUSED and null; campaign "spring" matches "SPRING-DPA".
  - paging: a fixture of 2,500 ads (generated in the test) with sort spend, limit 50: offsets 0, 50, …, 2,450 together return every ad exactly once in order, `total` 2,500 on every page; two ads with equal spend come out in `adId` order on every call.
  - an ad with spend before and after the range only is not listed; an ad that spent 1-10 Sep and nothing after (paused) in range 1-30 Sep has `lastSpend` 2026-09-10 and `activeDays` 10.
  - `cur` and `prev` for a 3-day range include days of the windows before `from`.
  - sort "roas" puts a zero-revenue ad above nothing but ads with null ROAS (none listed have spend 0), sort "gain" ranks by cur minus prev.
  - `aggregateFormats` sums per format over the range and ignores the query filters; an orphan ad-day goes to "other".
  - `normalizeQuery`: limit 5,000 becomes 200, 0 becomes 1, offset -3 becomes 0, sort "estCm" with margin null becomes "spend".
- [ ] **Step 2: Run** `npx vitest run lib/creative/aggregate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with one pass building a `Map<adId, AdAgg>`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(creative): query model and reference aggregation`.

### Task 4: SQL functions and repository methods

**Files:** Create `supabase/migrations/NNNN_best_creatives.sql`, `lib/creative/map-rows.ts`, `lib/creative/map-rows.test.ts`. Modify `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`.

**Interfaces:**
- SQL (header comment in our own words, read-only, `language sql stable set search_path to 'public'`, `grant execute … to authenticated`, like `0010_aov_histogram.sql`):
  - `creative_ads_report(p_client uuid, p_from date, p_to date, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date, p_format text, p_campaign text, p_catalog text, p_live text, p_sort text, p_margin numeric, p_limit int, p_offset int)` returns `(ad_id, name, campaign_name, format, is_catalog, status, launched date, first_spend date, last_spend date, active_days int, spend, revenue, purchases, impressions, clicks, cur_spend, cur_revenue, prev_spend, prev_revenue numeric, total_count bigint)`; `launched` = `created_at::date`; `total_count` = `count(*) over ()`; one scan of `meta_ad_daily` between `least(p_from, p_prev_from)` and `greatest(p_to, p_cur_to)` using the `(client_id, date)` index, `left join meta_ads`, `p_limit` clamped to 1-200 in SQL too; an unknown `p_sort` raises an exception; null window dates give zero `cur_`/`prev_` values.
  - `creative_format_totals(p_client uuid, p_from date, p_to date, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date)` returns one row per format: `(format, ads bigint, spend, revenue, purchases, impressions, clicks, cur_spend, cur_revenue, prev_spend, prev_revenue)`.
- Mapping (pure, tested): `mapAdRow(r: Record<string, unknown>): AdAgg`, `mapFormatRow(r): FormatTotals`, `isMissingFunction(err: { code?: string; message?: string }): boolean` (true for `PGRST202`, `PGRST205`, `42883`, `42P01` or a message naming `creative_ads_report`, `creative_format_totals`, `meta_ad_daily`, `meta_ads`).
- `Repository` additions:
  - `getLastAdDate(clientId: string): Promise<string | null | undefined>`: last `meta_ad_daily.date` for the client; null = no ad data yet; undefined = table missing.
  - `getCreativeAds(clientId: string, q: CreativeQuery): Promise<CreativePage | null>` (null = functions missing).
  - `getCreativeFormats(clientId: string, from: string, to: string, w: WowWindows | null): Promise<FormatTotals[] | null>`.
- Seed: `SeedRepository` makes about 120 fictional ads per client (stable names such as "UGC hook 07", mixed formats, a few catalog, a few paused mid-range, two launched in the last 5 days, one scaling, one fading) from the existing `noise()` helper and answers the three methods through `aggregateAds` / `aggregateFormats`.

- [ ] **Step 1: Write failing tests** in `map-rows.test.ts`: `mapAdRow` turns numeric strings ("12.50") into numbers, null `campaign_name` stays null, a row with null `format` becomes "other", `cur_spend`/`prev_spend` land in `cur`/`prev`; `mapFormatRow` likewise; `isMissingFunction` true for `{ code: "PGRST202" }` and for `{ message: "relation \"meta_ad_daily\" does not exist" }`, false for `{ code: "57014", message: "canceling statement due to statement timeout" }` (a timeout is a real error the page shows).
- [ ] **Step 2: Run** `npx vitest run lib/creative/map-rows.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the mapping, the migration, the Supabase methods (each RPC error: `isMissingFunction` returns null/undefined, any other error throws with its message) and the seed methods.
- [ ] **Step 4: Run** `npx vitest run lib/creative` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: SQL check against the spec (after the strategist applies the migration, on one client with ad data):** for one month, `sum(spend)` over all pages of `creative_ads_report` (sort spend, limit 200, paging until `total_count`) equals `sum(spend)` of `meta_ad_daily` for that client and month and equals the sum of `creative_format_totals.spend`; the first 50 rows by spend match `select ad_id, sum(spend) … group by ad_id order by 2 desc, ad_id limit 50`. Record the run time of a 13-month call.
- [ ] **Step 6: Commit** `feat(creative): server-side ad aggregation and repository methods`.

### Task 5: The report page

Read first: `node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/index.md` (and the `[slug]` dynamic route reference) per `AGENTS.md`.

**Files:** Create `components/reports/BestCreativesReport.tsx`. Modify `lib/reports/registry.ts`, `lib/reports/registry.test.ts`, `components/reports/ReportRouter.tsx`.

**Interfaces:** Consumes everything above; `ReportFrame`, `useReportRange`, `Empty`, `Loading`, `selectClass` from `components/reports/ReportFrame.tsx`; `ReportTable`, `Cell`, `Column`, `Row` from `components/reports/ReportTable.tsx`; `formatValue`, `formatDiff` from `lib/format.ts`; `aggregate` from `lib/metrics.ts` over `repo.getFacts` for the range (for `storeMargin`).
- Registry entry: `{ slug: "best-creatives", title: "Best Creatives", description: "Your Meta ads ranked against the account's own average, with the ads that are scaling right now", categories: ["Recommended", "Visitor"], status: "ready" }`, placed after `ads`.

- [ ] **Step 1: Write failing tests** in `registry.test.ts`: `getReport("best-creatives")?.status` is "ready" (the existing "router has a page" test then fails until the router case exists). Run: FAIL.
- [ ] **Step 2: Implement the page** (our layout, no Statlas wording):
  - Loading order: `getLastAdDate`; undefined shows "Ad-level reporting is not set up on this database yet."; null shows "No ad-level data yet: it arrives with the next Meta sync or a history load (Store Settings, Meta)."; otherwise `wowWindows(range.to, last)`, then `getCreativeFormats`, `getFacts` and the first `getCreativeAds` page in parallel. A range with no ad spend shows "No Meta ad spend in this range."
  - Header strip: the account benchmark (spend, revenue, ROAS, CPA, Est. CM for the period, ads that spent), one small card per format (ads, share of spend, ROAS vs the account, coloured with `metricTone`), and "Scaling now": ads flagged "scaling" from a separate `getCreativeAds` call with sort "gain", limit 200 (caption: "checked among the 200 ads that gained the most spend in the last 7 days"). Window dates shown ("Last 7 days: 6-12 Oct vs 29 Sep-5 Oct").
  - Controls: metric chips (toggle buttons) for Spend, Revenue, ROAS, Purchases, CPA, CTR, CPM, Est. CM, Share of spend; default on: Spend, Est. CM, Revenue, ROAS; at least one stays on. "Rank by" select (Spend, Revenue, ROAS, Purchases, Est. CM, Spend gain). Filters: Format, Catalog (All / Exclude catalog / Only catalog), Status (All / Live / Not live), Campaign contains (text, applied on Enter or blur). Toggles: "Campaign name" column (default on) and "Full ad names" (default off: names truncated to one line with a title tooltip).
  - Table rows (one per ad): ad name (label), then optional Campaign, Format, Launched, Days live, Last spend, the chosen metric columns coloured with `metricTone` against the benchmark, and Trend (`trendLabel` plus a badge "Scaling", "Fading" or "New"). A benchmark row ("Account average") is the table's `total` row.
  - "Load more" fetches the next 50 with the same query (offset + 50) and appends; any change of range, filter or rank resets to the first page. "Showing 50 of 2,431 ads".
  - Captions: attribution (`attributionCaption`), "Est. CM = ad revenue x store margin before ads (51% in this range) - spend", "Benchmark: all Meta ads in the period; filters do not change it", "Amounts in the ad account's currency".
- [ ] **Step 3: Add** `case "best-creatives": return <BestCreativesReport />;` to `ReportRouter.tsx`. Run `npx vitest run lib/reports` and `npx tsc --noEmit`: PASS.
- [ ] **Step 4: Verify** `npx eslint .` and `npm run build` clean; then in demo mode (`NEXT_PUBLIC_DATA_MODE=seed`, Supabase env vars blanked, `npm run dev`) open `/reporting/best-creatives`: the library shows the card; chips add and remove columns; Load more goes 50, 100, 120 and then hides; the scaling, fading and new seed ads carry their badges; Format "video" narrows the list but the benchmark row stays the same; a range last year with no seed ads shows the empty message; phone width has no page-level horizontal scroll (the table scrolls inside its frame).
- [ ] **Step 5: Commit** `feat(reports): Best Creatives report`.

### Task 6: Settings fields, Home pointer, docs and live check

**Files:** Modify `components/settings/EditStoreDialog.tsx`, `lib/reports/home-links.ts`, `lib/reports/home-links.test.ts`, `docs/reports-plan.md`, `docs/changelog.md`, `CLAUDE.md`.

**Interfaces:** Consumes the three `ExtraSettings` fields (Task 2). `HOME_REPORT_LINKS` gains `"meta.iroas": "best-creatives"` and `"meta_acquisition.iroas": "best-creatives"` (the Meta ROAS/iROAS tile keys from `channelMetricDefs` in `lib/metrics.ts`; the Meta spend tile keeps no link so Paid Media stays the spend report). Cheap: the link icon already exists on `MetricTile`.

- [ ] **Step 1: Write failing tests** in `home-links.test.ts`: `homeReportHref("meta.iroas")` is "/reporting/best-creatives"; `homeReportHref("meta_returning.iroas")` stays null. Run: FAIL.
- [ ] **Step 2: Implement** the links; in the Edit dialog's Meta accordion, next to stage 1's "Ad creative" catalog keywords line, three number inputs: "Scaling winner: spend up at least (%)" 50, "… and spent at least (last 7 days)" 250, "Fading: ROAS down at least (%)" 30, with the line "Used by the Best Creatives report". Docs: the report row in `docs/reports-plan.md` (Built, our design, how Est. CM and the flags work), a dated `docs/changelog.md` entry, one line in `CLAUDE.md` Reports.
- [ ] **Step 3: Verify** `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`: all clean.
- [ ] **Step 4: Live check (after the strategist applies the migration, on the client with the most Meta ads):** open the report for the last 30 days and for 13 months; note the load time of each (Supabase's statement timeout for signed-in users is a few seconds; if the 13-month call is slow, the fix is a weekly rollup, a separate plan); compare the account benchmark spend with Paid Media Overview's Meta spend for the same range (expect within a small percentage, the stage 1 note on ad-level vs campaign-level totals); open one flagged ad in Meta Ads Manager (read-only) and confirm its last-7-days spend and ROAS.
- [ ] **Step 5: Commit** `feat(creative): flag settings, Home link, docs`.

---

## Self-review

- **Spec coverage:** ad list on demand (paged RPC), metric chips with Spend / CM (as Est. CM) / Revenue / ROAS on by default, store average for the period as benchmark, campaign-name and ad-title toggles, the scaling-winner flag with editable thresholds, the optional fading signal, filters (format, campaign, catalog, live), top-N plus Load more, Home pointer: Tasks 1-6. Depth beyond a basic list: format cards, "Scaling now" strip, CTR and CPM. Not included (spec "Not in scope" or later): creative previews, hook and angle tags, the Creative Score (stage 2).
- **Deviations on purpose:** "store average" is read as the Meta account average (the report only knows Meta ads); the flag compares the ad's last 7 days with the account's last 7 days rather than with the period average, so a long range does not hide a recent change; "Scaling now" checks the 200 biggest spend gainers instead of every ad, to keep the flag rule in TypeScript only.
- **Type consistency:** `AdAgg`, `FormatTotals`, `CreativeTotals`, `WowWindows`, `FlagRules`, `CreativeFlag`, `CreativeQuery`, `CreativeSort`, `CreativePage`, `AdDayRow`, `AdInfo`, `storeMargin`, `adMetrics`, `benchmark`, `metricTone`, `wowWindows`, `flagRules`, `creativeFlag`, `aggregateAds`, `aggregateFormats`, `normalizeQuery`, `mapAdRow`, `mapFormatRow`, `isMissingFunction`, `getLastAdDate`, `getCreativeAds`, `getCreativeFormats` are spelled the same in every task.
- **Review Focus:** each of the five lines has its test in the named task; the timing part of line 2 can only be measured live (Task 6, Step 4).
- **Proportion:** six tasks, signatures and assertions only; the one algorithm the signatures leave open (filter, order and tie-break rules of the aggregation) is fixed in Task 3.

**Sizing:** about 4.5 working days for Claude (pure logic 1, reference aggregation 0.5, SQL and repository 1, page 1.25, settings, Home link and docs 0.25, one independent review 0.5). What could blow it up: stage 1 not live or not backfilled (nothing to show on real clients; demo mode still works); the 13-month aggregation exceeding Supabase's statement timeout on large accounts (needs a weekly ad rollup table, about 1 more day); ad accounts in a currency other than the store's (needs the account currency stored at connect, a small separate change). From the strategist: yes or change on the four **Decision** lines (Est. CM formula, account-wide benchmark, rolling 7-day windows, flag defaults 50% / 250 / 30%); the go to apply the migration; and the go-ahead for this phase.

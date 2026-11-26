# Slice 1: channel depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amazon and TikTok Shop channels hold their own metrics, loaded from the platforms' files by a merging import, and their Home page shows them against the forecast.

**Architecture:** A metric catalog per platform drives storage (`channel_sales.metrics` jsonb), import (header aliases, file kinds) and display (stored and derived metrics). Rows are merged by one database function. The channel page reads raw channel rows already loaded by `useOmni`.

**Tech Stack:** Next.js 16, React 19, TypeScript, vitest, Supabase (Postgres, RLS).

**Spec:** `docs/superpowers/specs/2026-11-26-slice1-channel-depth-design.md` (details) and `docs/superpowers/specs/2026-11-26-operating-system-blueprint.md` (section 2 and 3).

## Global Constraints
- Work on `development`; stage named files only; never switch branches.
- Never write a client's or employer's name other than Apex in the repo.
- A store with no other channel, and a retail or "other" channel, must look and compute exactly as before.
- Every number on the page is a reported number; modelled ones stay labelled.
- Migrations are additive and tried in a rolled-back transaction before being applied.
- Plain words in every label and message; no jargon.

## Review Focus
- A file that holds only ads columns must not zero the day's revenue, orders or units (and the reverse).
- Loading the same file twice must give the same numbers as loading it once.
- A period's ratio (ACOS, conversion, Buy Box %) is the ratio of the period's sums, never the average of daily ratios.
- A day with no value for a metric must not count as zero in an average or "latest" metric.
- A channel saved before this change (no `platform`, no `metrics`) still loads, shows and imports.

---

### Task 1: Platform and metric catalog
**Files:** Create `lib/omni/metrics.ts`, `lib/omni/metrics.test.ts`. Modify `lib/types.ts` (`OtherChannel.platform?: "amazon" | "tiktok_shop" | "retail" | "other"`).

**Interfaces (produces):**
```ts
export type Platform = "amazon" | "tiktok_shop" | "retail" | "other";
export function platformOf(c: { key: string; label: string; kind: "marketplace" | "retail"; platform?: Platform }): Platform;
export type Unit = "currency" | "number" | "percent" | "ratio";
export type Better = "up" | "down" | null;
export interface MetricDef { key: string; label: string; unit: Unit; group: string; agg: "sum" | "avg" | "last"; better: Better; aliases: string[]; whole?: boolean; hint?: string }
export interface Totals { revenue: number; orders: number; units: number; adSpend: number; m: Record<string, number> }
export interface DerivedDef { key: string; label: string; unit: Unit; group: string; better: Better; calc: (t: Totals) => number | null; hint?: string }
export interface PlatformCatalog { coreLabels: { revenue: string; orders: string; units: string; adSpend: string }; coreAliases: { revenue: string[]; orders: string[]; units: string[]; adSpend: string[] }; stored: MetricDef[]; derived: DerivedDef[]; adParts: { spend: string[]; sales: string[] } | null }
export const CATALOG: Record<Platform, PlatformCatalog>;
export function metricInfo(platform: Platform, key: string): { label: string; unit: Unit; better: Better; group: string; hint?: string } | null;
export function metricValue(platform: Platform, key: string, t: Totals): number | null;
```
Stored keys. Amazon: `sessions, page_views, buy_box_views, units_refunded, refunds, ad_sales, ad_orders, ad_clicks, ad_impressions, sp_spend, sp_sales, sb_spend, sb_sales, sd_spend, sd_sales, ntb_orders, ntb_sales, sns_sales, sns_units, active_subscriptions (last), referral_fees, fulfilment_fees, promo_cost`; `adParts = { spend: [sp_spend, sb_spend, sd_spend], sales: [sp_sales, sb_sales, sd_sales] }`. TikTok Shop: `buyers, visitors, page_views, add_to_carts, refunds, live_gmv, video_gmv, card_gmv, affiliate_gmv, seller_gmv, creators_with_sales (avg), videos_posted, lives_held, samples_shipped, affiliate_commission, ads_gmv, ads_orders, referral_fees, shipping_cost, seller_discounts`. Retail and other: none.
Derived keys. Amazon: `tacos` (adSpend/revenue, down), `acos` (adSpend/ad_sales, down), `ad_roas`, `organic_sales` (revenue − ad_sales), `ad_share`, `conversion` (units/sessions), `buy_box_pct` (buy_box_views/page_views), `aov` (revenue/orders), `asp` (revenue/units), `cpc`, `ctr`, `refund_rate` (units_refunded/units), `sns_share`, `ntb_share` (ntb_sales/(sb_sales+sd_sales)), `sp_acos, sb_acos, sd_acos`. TikTok Shop: `aov, conversion` (orders/visitors), `refund_rate` (refunds/revenue), `net_gmv`, `affiliate_share`, `commission_rate`, `ads_roi` (ads_gmv/adSpend), `ads_cost_share` (adSpend/revenue, down), `cost_per_order` (adSpend/ads_orders, down). A ratio with a zero or missing denominator is null.

- [ ] **Step 1:** Write `lib/omni/metrics.test.ts`: `platformOf` (explicit platform wins; "Amazon US" → amazon; "TikTok Shop" → tiktok_shop; kind retail → retail; else other); Amazon `tacos` = 0.1 and `acos` = 0.25 for revenue 1000, adSpend 100, ad_sales 400; `organic_sales` 600; `conversion` null with sessions 0; `buy_box_pct` = 0.98 from buy_box_views 980 / page_views 1000; TikTok `ads_roi` 5 for ads_gmv 500 / adSpend 100; every stored and derived key is unique per platform; every alias is lower case and unique within a platform; `metricInfo("amazon", "revenue")` returns the core label "Ordered product sales".
- [ ] **Step 2:** Run `npx vitest run lib/omni/metrics.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `lib/omni/metrics.ts` and the `platform` field.
- [ ] **Step 4:** Run the test. Expected: PASS. Run `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5:** Commit `feat(omni): platform and metric catalog for Amazon and TikTok Shop`.

### Task 2: Totals and series from channel rows
**Files:** Create `lib/omni/channel-metrics.ts`, `lib/omni/channel-metrics.test.ts`. Modify `lib/omni/types.ts` (`ChannelSale.metrics?: Record<string, number>`, `periodDays?: number`).

**Interfaces:** Consumes Task 1. Produces:
```ts
export function withRollups(platform: Platform, s: ChannelSale): ChannelSale; // adSpend and metrics.ad_sales become the sum of the ad parts when any part is present
export interface PeriodTotals extends Totals { days: number; lastData: string | null }
export function totalsOf(platform: Platform, sales: ChannelSale[], channel: string, from: string, to: string): PeriodTotals;
export type Grain = "day" | "week" | "month";
export function seriesOf(platform: Platform, sales: ChannelSale[], channel: string, from: string, to: string, grain: Grain): { keys: string[]; rows: PeriodTotals[] };
```
`sum` metrics add up; `avg` = mean over the days that carry the metric; `last` = the value on the latest day that carries it. Weeks start on Monday and are keyed by their first day; months by `YYYY-MM`. Rows of several retailers on a day add together.

- [ ] **Step 1:** Tests: rollup replaces `adSpend` 0 with sp+sb+sd spend and sets `ad_sales`; a row with no parts is unchanged; `totalsOf` sums core and `sum` metrics over the range only; `avg` ignores days without the metric; `last` takes the latest day; other channels' rows are ignored; `seriesOf` week keys start on Monday and totals of the series equal `totalsOf`; `days` counts days with a row.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests and `tsc`. Expected: PASS, clean.
- [ ] **Step 5:** Commit `feat(omni): period totals and series for channel metrics`.

### Task 3: File kinds and the merging import parser
**Files:** Modify `lib/omni/import.ts`; create `lib/omni/import-kinds.ts`, `lib/omni/import-kinds.test.ts`. `parseChannelCsv` keeps its behaviour (existing tests stay green).

**Interfaces:** Consumes Task 1. Produces:
```ts
export interface ChannelSaleInput { date: string; channel: string; retailer: string; revenue: number | null; orders: number | null; units: number | null; adSpend: number | null; metrics: Record<string, number>; source: "import" }
export interface FileKind { id: string; label: string; platform: Platform; sumRows: boolean; targets: Record<string, string>; needs: string[] }
export function fileKinds(platform: Platform): FileKind[]; // always ends with the generic kind
export function detectKind(headers: string[], platform: Platform): string;
export interface ColumnRead { header: string; target: string | null }
export interface FileImport { kind: string; rows: ChannelSaleInput[]; errors: { line: number; message: string }[]; from: string | null; to: string | null; columns: ColumnRead[]; totals: Record<string, number> }
export function parseChannelFile(text: string, channel: string, opts: { platform: Platform; kind?: string; dateFormat?: DateFormat; numberFormat?: NumberFormat; mapping?: Record<string, string | null> }): FileImport;
```
Targets are `date`, `retailer`, `revenue`, `orders`, `units`, `adSpend`, or a stored metric key, or the transient `buy_box_pct` (converted with the row's page views to `buy_box_views`; dropped when the row has no page views). Kinds: Amazon `amazon_sales_traffic` (not summed), `amazon_ads_sp`, `amazon_ads_sb`, `amazon_ads_sd` (summed; spend and sales go to the ad type's keys, clicks, impressions and orders to the shared ad keys); TikTok Shop `tiktok_overview` (not summed), `tiktok_ads` (summed), `tiktok_affiliate` (not summed); every platform `generic` (core aliases plus every stored metric's aliases). A value may end in `%`. A core field with no column is `null` in every row. `mapping` overrides or adds header → target (`null` = do not use).

- [ ] **Step 1:** Tests: an Amazon business-report file (headers "Date,Ordered Product Sales,Units Ordered,Total Order Items,Sessions - Total,Page Views - Total,Featured Offer (Buy Box) Percentage,Unit Session Percentage,Units Refunded") is detected as `amazon_sales_traffic`, gives revenue, units, orders, `sessions`, `page_views`, `buy_box_views` = page views × %, `units_refunded`, and `adSpend: null`; an SP ads file with two campaigns on one day is detected as `amazon_ads_sp`, sums to one row with `sp_spend`, `sp_sales`, `ad_clicks`, `ad_impressions`, `ad_orders`, and `revenue: null`; a duplicate day in a non-summed kind is an error; "12.5%" reads as 12.5; `mapping` sends an unknown header to `affiliate_gmv`; an unknown header is listed with `target: null`; the generic kind reads `date,revenue,orders,units,ad spend` exactly as `parseChannelCsv` does; a file without a date column reports it.
- [ ] **Step 2:** Run `npx vitest run lib/omni/import-kinds.test.ts lib/omni/import.test.ts`. Expected: new file FAIL, old file PASS.
- [ ] **Step 3:** Implement, sharing `splitLine`, `readDate`, `readNumber` (export them from `import.ts`).
- [ ] **Step 4:** Run both test files and `tsc`. Expected: PASS, clean.
- [ ] **Step 5:** Commit `feat(omni): recognise the platforms' files and read them as partial rows`.

### Task 4: Storage and repository merge
**Files:** Create `supabase/migrations/0022_channel_metrics.sql`. Modify `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`; create `lib/repository/channel-merge.ts`, `lib/repository/channel-merge.test.ts`.

**Interfaces:** Consumes Task 3 `ChannelSaleInput`. Produces:
```ts
// lib/repository/channel-merge.ts (pure, used by the seed store and by tests)
export function mergeRows(existing: ChannelSale[], channel: string, rows: ChannelSaleInput[]): ChannelSale[];
// Repository
mergeChannelSales(clientId: string, channel: string, rows: ChannelSaleInput[]): Promise<void>;
```
Migration: `alter table public.channel_sales add column if not exists metrics jsonb not null default '{}'::jsonb, add column if not exists period_days integer not null default 1;` and `create or replace function public.channel_sales_merge(p_client uuid, p_channel text, p_rows jsonb) returns integer language sql security invoker` that inserts one row per element (`date`, `retailer`, `revenue`, `orders`, `units`, `ad_spend`, `metrics`, `source`) and on conflict sets each core column to the given value when it is not null, `metrics = channel_sales.metrics || excluded.metrics`, `source`, `updated_at = now()`. Grant execute to `authenticated`. `saveChannelSales` (full rows) calls the same function; the delete-then-insert path is removed. `getChannelSales` returns `metrics` (numbers only) and `periodDays`.

- [ ] **Step 1:** Tests for `mergeRows`: a partial row keeps the other core fields of an existing day; metrics merge key by key; a new day with null core fields gets zeros; another retailer's row on the same day is untouched; merging the same rows twice equals merging once.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `mergeRows`, the repository methods (Supabase: `rpc("channel_sales_merge")` in chunks of 500; a missing function reports "the database is not ready (migration 0022)"), the seed store, and write the migration file.
- [ ] **Step 4:** Run the whole suite `npx vitest run` and `tsc`. Expected: all PASS, clean.
- [ ] **Step 5:** Commit `feat(omni): merge channel rows in one statement and store channel metrics`.

### Task 5: Demo data with every metric
**Files:** Modify `lib/repository/seed.ts` (`demoChannelSale`), `supabase/demo/sample_store.sql`; test in `lib/repository/seed.test.ts` (or the existing seed test file).

- [ ] **Step 1:** Test: the demo client's Amazon row for a day carries `sp_spend + sb_spend + sd_spend` equal to its `adSpend` (within a cent), `ad_sales` below revenue, `sessions` above units; its TikTok Shop row carries `affiliate_gmv + seller_gmv` equal to revenue (within a cent) and `live_gmv + video_gmv + card_gmv` equal to revenue.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement in the seed; add a "Channel metrics" block to the SQL script that sets `metrics` on the sample store's Amazon and TikTok Shop rows with the same shares (deterministic noise, an `update ... set metrics = metrics || ...`).
- [ ] **Step 4:** Run the suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(omni): demo channels carry every metric`.

### Task 6: Import screen and platform in settings
**Files:** Modify `components/settings/ChannelImport.tsx`, `components/settings/HaloSettings.tsx`; create `lib/omni/import-map.ts`, `lib/omni/import-map.test.ts` (browser memory of hand mappings: `readMap(clientId, channel, kind)`, `writeMap(...)`, safe when storage is missing).

- [ ] **Step 1:** Tests for `import-map` (round trip; missing or broken storage returns `{}`).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Import screen: "This file is" select (detected kind preselected), the column list with a select per column (core fields, the platform's stored metrics, "Do not use"), the preview (days, range, totals of what will be saved), "Save" calling `mergeChannelSales`. Settings: presets set `platform`; a "Platform" select per channel.
- [ ] **Step 4:** Run the suite, `tsc`, `npx eslint` on the changed files. Expected: PASS, clean.
- [ ] **Step 5:** Commit `feat(omni): load the platforms' own files from Store Settings`.

### Task 7: Channel page
**Files:** Create `components/ChannelPage.tsx`, `lib/omni/channel-page.ts`, `lib/omni/channel-page.test.ts`. Modify `lib/omni/use-omni.ts` (expose the loaded rows; load back to the same days last year), `components/OmniHome.tsx` (Amazon and TikTok Shop channels render `ChannelPage`).

**Interfaces:**
```ts
// lib/omni/channel-page.ts
export interface Headline { key: string; label: string; value: number | null; unit: Unit; better: Better; ref: number | null; refWord: "forecast" | "planned" | "last year" | null; hint?: string }
export interface ChannelPageData { platform: Platform; headlines: Headline[]; blocks: { title: string; note?: string; rows: { key: string; label: string; value: number | null; unit: Unit; prev: number | null; better: Better; hint?: string }[] }[]; tables: { title: string; note?: string; columns: string[]; rows: { label: string; cells: (number | null)[]; units: Unit[] }[] }[] }
export function channelPage(input: { platform: Platform; view: ChannelView; now: PeriodTotals; prev: PeriodTotals | null }): ChannelPageData;
export function toCsv(platform: Platform, keys: string[], series: { keys: string[]; rows: PeriodTotals[] }): string;
```
- [ ] **Step 1:** Tests: Amazon headlines are sales (ref = forecast to date when the view has one, else last year's sales), ad spend (ref = planned), total ACOS, ACOS, contribution, orders; the ad-type table has three rows whose spend adds up to the ad spend; a metric with no data anywhere is left out of its block; TikTok Shop's source table has Affiliate and Seller; `toCsv` has a header row and one line per period.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the data function, the page (tiles, blocks, tables, chart with metric picker, grain table with CSV export) and the hook change.
- [ ] **Step 4:** Run the suite, `tsc`, eslint on changed files. Check the page on demo data in the browser (local seed mode).
- [ ] **Step 5:** Commit `feat(omni): Amazon and TikTok Shop pages`.

### Task 8: Docs
**Files:** Modify `docs/changelog.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-11-26-operating-system-blueprint.md` (status line of slice 1).
- [ ] **Step 1:** Write the entries. Commit `docs: channel depth (slice 1)`.

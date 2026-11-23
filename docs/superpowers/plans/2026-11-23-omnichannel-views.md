# Omnichannel Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the sales of the other channels, track each against its own forecast every day, show the whole business on Home, and forecast Amazon and TikTok Shop with the New Customer model's regression.

**Architecture:** One table (`channel_sales`) behind two repository methods, fed by a CSV import first. Pure functions in `lib/omni/` turn sales, plan lines and settings into daily forecasts, a channel view, a whole-business view and a channel model. Home gets a "View" selector that swaps the page body; the own-site body is untouched.

**Tech Stack:** Next.js 16, React 19, TypeScript, vitest, Supabase. One additive migration (0021), applied only on the strategist's word (given 2026-11-23).

**Spec:** `docs/superpowers/specs/2026-11-23-omnichannel-views-design.md`. Builds on `2026-11-20-halo-layer-design.md`.

## Global Constraints
- The own-site Home shows exactly the same numbers as before; a client with no other channels sees no new control.
- Work on `development`; one commit per finished task; named files only.
- Other channels show reported numbers; the cascade is one column marked as modelled.
- The channel model is `fitNewCustomerModel` unchanged: weekday adjustment, spend-bucket outlier filter (Scott's rule, ±1σ), Black Friday week dropped, revenue line, guardrail gamma 1, monthly seasonality index, 60 usable days minimum. R² labels: Good ≥ 0.5, Fair ≥ 0.25, Low below.
- Weekday pattern for spreading a month: needs 56 days of sales in the last 12 months, else even.
- Migration 0021 is additive, checked in a rolled-back transaction before it is applied.
- UI copy: plain sentences; the reference tool is never named.

## Review Focus
1. A CSV with a byte-order mark, CRLF line ends, quoted fields with commas, or a semicolon delimiter still imports.
2. A day with sales for several retailers: the channel's day is their sum everywhere (views, model, weekday pattern).
3. A range that spans two months, one with a forecast and one without: the forecast covers only the month that has one and the view says so.
4. `channel_sales` missing on the live database (migration not applied): every screen works and says no data, nothing throws.
5. A channel with sales but zero ad spend: no ROAS, no model, contribution = revenue x margin.

---

### Task 1: Sales rows and the CSV import parser
**Files:** Create `lib/omni/types.ts`, `lib/omni/import.ts`; Test `lib/omni/import.test.ts`.
```ts
export interface ChannelSale { date: string; channel: string; retailer: string; revenue: number; orders: number; units: number; adSpend: number; source: "import" | "shopify" | "connector" | "demo" }
export type DateFormat = "ymd" | "mdy" | "dmy";
export interface ImportResult { rows: ChannelSale[]; errors: { line: number; message: string }[]; from: string | null; to: string | null; revenue: number; adSpend: number }
export function parseChannelCsv(text: string, channel: string, dateFormat?: DateFormat): ImportResult; // default "ymd"
```
Header names, any case: date; revenue | sales | net sales | gmv; orders; units; ad spend | ad_spend | spend; retailer | store. Delimiter comma, semicolon or tab (from the header line). Numbers may carry a currency sign, spaces and thousands commas. Errors: missing date or revenue column (line 1), unreadable date, unreadable or negative number, a second row for the same day and retailer.
- [ ] Tests: a plain file gives rows, range and totals; BOM + CRLF + quoted "1,234.50" + semicolons import (Review Focus 1); `mdy` reads 3/4/2027 as 2027-03-04 and `dmy` as 2027-04-03; each error case reports its line and the good rows still load; an empty file reports "no rows".
- [ ] RED, implement, GREEN, `npx tsc --noEmit`, commit `feat(omni): channel sales rows and CSV import parser`.

### Task 2: Daily forecast per channel
**Files:** Modify `lib/planning/types.ts` (`OtherLine.adSpend?: number | null`), `lib/planning/other-channels.ts` (`OtherMonthLine.adSpend`); Create `lib/omni/forecast.ts`; Test `lib/omni/forecast.test.ts`.
```ts
export function dailyTotals(sales: ChannelSale[], channel: string): Map<string, { revenue: number; orders: number; units: number; adSpend: number }>; // sums retailers
export function weekdayShares(days: Map<string, { revenue: number }>, asOf: string): number[] | null; // 7 weights averaging 1, index 0 = Sunday; null under 56 days in the last 12 months; Black Friday week left out
export function spreadMonth(total: number, month: string, shares: number[] | null): Map<string, number>; // days add up to total exactly
export interface MonthLine { forecast: number | null; created: number; capped: boolean; adSpend: number; halo: number }
export function monthLines(months: PlanMonth[], settings: ClientSettings, curve: Curve | null): Record<string, Record<string, MonthLine>>; // "YYYY-MM" -> channel key
export function needsCurve(months: PlanMonth[]): boolean; // true when any line types an assumed ad spend
export function dailyForecast(lines: Record<string, Record<string, MonthLine>>, channel: string, from: string, to: string, shares: number[] | null): Map<string, number>; // only days of months that have a forecast
```
- [ ] Tests: two retailers on one day are summed (Review Focus 2); 56 days gives weights that average 1 and 55 gives null; `spreadMonth(31000, "2027-01-01", null)` is 1000 a day and with weights still sums to 31000; a range across a month with a forecast and one without returns only the first month's days (Review Focus 3); `needsCurve` is false with no assumed spend.
- [ ] RED, implement, GREEN, commit `feat(omni): daily forecast per channel`.

### Task 3: Channel view and whole-business view
**Files:** Create `lib/omni/views.ts`; Test `lib/omni/views.test.ts`.
```ts
export interface ChannelViewInput { channel: OtherChannel; days: Map<string, { revenue: number; orders: number; units: number; adSpend: number }>; forecast: Map<string, number>; lines: Record<string, MonthLine>; from: string; to: string }
export interface ChannelView { key: string; label: string; hasData: boolean; lastData: string | null; revenue: number; orders: number; units: number; adSpend: number; roas: number | null; contribution: number; forecastToDate: number | null; forecastFull: number | null; pctToForecast: number | null; projected: number | null; createdByAds: number | null; dates: string[]; actual: (number | null)[]; plan: (number | null)[] }
export function channelView(i: ChannelViewInput): ChannelView;
export interface SiteNumbers { revenue: number; spend: number; cm: number; plan: { revenue: number; spend: number; cm: number } | null; amer: number | null; blendedAmer: number | null }
export interface BusinessView { revenue: number; spend: number; mer: number | null; contribution: number; plan: { revenue: number; spend: number; mer: number | null; contribution: number } | null; rows: { key: string; label: string; actual: number; forecast: number | null; pct: number | null; share: number | null; createdByAds: number | null }[] }
export function businessView(site: SiteNumbers, channels: ChannelView[], plannedAdSpend: number, plannedContribution: number | null): BusinessView;
```
Forecast to date covers only days up to the channel's last day with sales in the range. Contribution = revenue x (1 − costPct/100) − ad spend. Created by ads = for each month, actual revenue x (created ÷ forecast), null with no halo. Projected = actual + forecast of the remaining days.
- [ ] Tests: totals, ROAS, contribution and % to forecast on a hand-worked month; no sales gives `hasData` false with the forecast kept; zero ad spend gives `roas` null (Review Focus 5); the business total equals the site plus every channel for actual and forecast; a channel with no forecast leaves the business plan revenue as the sum of the others.
- [ ] RED, implement, GREEN, commit `feat(omni): channel view and whole-business view`.

### Task 4: Channel model
**Files:** Create `lib/omni/model.ts`; Test `lib/omni/model.test.ts`.
```ts
export interface ChannelModel { fit: FitResult; dow: number[]; seasonal: { index: number[]; days: number[]; years: number }; trust: "Good" | "Fair" | "Low"; daysUsed: number; removed: { bfcm: number; outlier: number } }
export function fitChannelModel(days: Map<string, { revenue: number; adSpend: number }>, asOf: string): ChannelModel | null; // null under 60 usable days with spend and revenue
export function modelRevenue(m: ChannelModel, monthlyAdSpend: number, month: string): number;
export function trustOf(r2: number): "Good" | "Fair" | "Low";
```
`fitNewCustomerModel(points, dow, { kind: "revenue", guard: 1, outliers: "bucket" })` with `points = {date, spend: adSpend, newRevenue: revenue}`; `dow` = (weekday share − 1) x 100, zeros when there is no pattern; `monthlyAmerIndex(fit.used, fit.curve)`.
- [ ] Tests: 200 synthetic days on `revenue = 2000 + 1.8 x spend` return a ≈ 2000, b ≈ 1.8, trust Good, and `modelRevenue` at 30,000 a month in a 30-day month ≈ 114,000; 59 days return null; days with zero ad spend are ignored and a channel with none returns null (Review Focus 5); `trustOf` 0.5 / 0.25 / 0.1.
- [ ] RED, implement, GREEN, commit `feat(omni): channel model on the New Customer regression`.

### Task 5: Repository, demo data and migration
**Files:** Modify `lib/repository/types.ts`, `lib/repository/seed.ts`, `lib/repository/supabase.ts`; Create `supabase/migrations/0021_channel_sales.sql`; Test `lib/repository/channel-sales.test.ts`.
```ts
getChannelSales(clientId: string, from: string, to: string): Promise<ChannelSale[] | null>; // null = the table is not there yet
saveChannelSales(clientId: string, channel: string, rows: ChannelSale[]): Promise<void>; // replaces that channel's rows on the days present in `rows`
```
Seed: imported rows live in memory; for a demo client whose settings list other channels, days with nothing imported are generated from the client's own daily revenue (deterministic). One demo client ships with Amazon, TikTok Shop and Retail and a Meta-on-Amazon halo of 0.2 marked Benchmark. Supabase: a missing table returns null on read (Review Focus 4) and a clear message on save. Migration: table, primary key (client_id, date, sales_channel, retailer), row-level security with read, insert, update and delete policies on `has_client_access(client_id)`.
- [ ] Tests (seed): generated days are stable between calls; a save replaces only the days in the file; an import wins over generated days.
- [ ] RED, implement, GREEN, full suite, commit `feat(omni): channel sales storage, demo data and migration 0021`.

### Task 6: Import screen
**Files:** Create `components/settings/ChannelImport.tsx`; Modify `components/settings/HaloSettings.tsx`, `components/settings/EditStoreDialog.tsx`.
Each channel card gets "Import sales": pick a file and a date format, see rows, range, totals and the lines that could not be read, then "Save". Says so when the table is not there yet.
- [ ] Build, verify on demo data in the browser, `tsc`, lint, commit `feat(omni): import sales of another channel from a file`.

### Task 7: Channel ad spend in the plan and the channel models screen
**Files:** Modify `components/planning/OtherChannelsLine.tsx`, `components/planning/models/ModelsStep.tsx`; Create `components/planning/models/ChannelModels.tsx`.
Details gets a "Channel ad spend (planned)" row. Models gets "Other Channels Model": per channel the fit (chart, R² and trust, days used and removed, seasonality, revenue at no spend, return per extra dollar) and "Fill the plan from this model", which writes each open month's forecast from its planned channel ad spend and saves the own-site spend of the fit window as the assumed ad spend.
- [ ] Build, verify in the browser, `tsc`, lint, suite, commit `feat(omni): channel models and planned channel ad spend`.

### Task 8: Home views
**Files:** Create `lib/omni/use-omni.ts`, `components/OmniHome.tsx`; Modify `components/Dashboard.tsx`.
"View" select in the Home controls, shown only when the client has other channels, remembered per client. Own site renders today's body. A channel or "Whole business" renders `OmniHome` (spec section 4).
- [ ] Build, verify in the browser that the own-site view is unchanged and the other views match the numbers of Tasks 2 to 4, `tsc`, lint, suite, commit `feat(omni): Home views for each sales channel and the whole business`.

### Task 9: Shopify channels that feed a channel
**Files:** Modify migration 0021 (function `channel_sales_from_orders`), `lib/repository/*`, `components/settings/HaloSettings.tsx`.
A channel lists the Shopify sales channels that feed it; "Pull from Shopify" rolls their orders up by day into `channel_sales` (source `shopify`).
- [ ] Build, check the function against `orders` in a rolled-back transaction, commit `feat(omni): pull a channel's sales from synced Shopify orders`.

### Task 10: Docs, migration, release to development
- [ ] Changelog, planning notes, CLAUDE.md status line; apply migration 0021 (checked in a rolled-back transaction first); commit `docs: omnichannel views`.

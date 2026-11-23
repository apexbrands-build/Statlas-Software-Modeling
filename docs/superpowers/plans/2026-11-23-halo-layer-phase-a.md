# Halo Layer (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a plan set its acquisition budget and ROAS targets on what ads return across every sales channel, and give Amazon, TikTok Shop and retail a line in the plan.

**Architecture:** Halo factors are typed per ad channel and per other sales channel and stored in `client_settings.extra.halo`. Pure functions in `lib/planning/halo.ts` and `lib/planning/other-channels.ts` turn them into a blended aMER, total factors, halo revenue and plan lines. The existing New Customer model, ROAS targets and Details step call those functions; with nothing typed every result equals today's.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching routing or server code), React 19, TypeScript, vitest, Supabase. No migration in this phase.

**Spec:** `docs/superpowers/specs/2026-11-20-halo-layer-design.md` (v2).

## Global Constraints
- With no halo typed, every existing number and all 852 existing tests stay unchanged.
- Work on `development` only. One commit per finished task, named files only (never `git add docs` or `-A`).
- Factors are typed, never estimated in the app.
- Storage: `client_settings.extra.halo` (settings), `plan_models` kind `new_customer` (the switch), `plan_months.inputs.other` (plan lines). No migration.
- Warning thresholds: 30% spend distance, 183 days of age.
- Default value basis is `"com"`.
- User-facing copy: plain sentences, no jargon; the tool this app is modelled on is never named in the UI.

## Review Focus
1. A halo cell on a channel that has no entry in `multipliers`: its .com factor counts as 1, so the total factor is 1 + halo. (Task 1)
2. A plan month whose platform split is empty or sums to 0: the .com weight is 1 and blended aMER equals aMER, never `NaN`. (Task 1)
3. A sales channel deleted while cells or plan lines still carry its key: orphans are ignored in every calculation. (Tasks 1 and 4)
4. Empty, negative or non-numeric typed values (halo value, cost %, AOV 0, doors 0): treated as 0, with no division by zero. (Tasks 1, 3 and 4)
5. A channel whose total factor is 0: it is left out of the weight and gets no ROAS target. (Tasks 1 and 2)

---

### Task 1: Halo settings types and math

**Files:**
- Modify: `lib/types.ts` (add the types below; `ExtraSettings.halo?: HaloSettings`)
- Create: `lib/planning/halo.ts`
- Test: `lib/planning/halo.test.ts`

**Interfaces (produced):**
```ts
// lib/types.ts
export type HaloSource = "benchmark" | "own_test" | "assumption";
export interface HaloCell { value: number; source: HaloSource; measuredOn?: string; measuredSpend?: number; note?: string; onShelf?: boolean }
export interface RetailerRow { retailer: string; launchMonth: string /* YYYY-MM */; doors: number; unitsPerStoreWeek: number; shelfPrice: number; pipelineUnits?: number }
export interface OtherChannel { key: string; label: string; kind: "marketplace" | "retail"; costPct: number; aov: number; ltv60?: number; ltv90?: number; ltv365?: number; netPct?: number; shopifyChannels?: string[]; retailers?: RetailerRow[] }
export interface HaloSettings { channels: OtherChannel[]; cells: Partial<Record<ChannelKey, Record<string, HaloCell>>> }

// lib/planning/halo.ts
export function haloSettingsOf(settings: ClientSettings): HaloSettings;            // {channels: [], cells: {}} when absent or malformed
export function cellValue(cell: HaloCell | undefined, channel: OtherChannel): number; // >= 0; onShelf retail cells x netPct/100
export function haloOf(k: ChannelKey, settings: ClientSettings): Record<string, number>; // per existing sales channel key, zeros left out
export function totalFactor(k: ChannelKey, settings: ClientSettings): number;      // (multipliers[k] ?? 1) + sum of haloOf
export function channelSpendShares(inputs: Pick<PlanMonthInputs, "platformPct" | "altPct">): Partial<Record<ChannelKey, number>>; // of total spend, sums to 1
export function acquisitionShares(inputs: Pick<PlanMonthInputs, "platformPct" | "altPct">, settings: ClientSettings): Partial<Record<ChannelKey, number>>; // of aMER spend, sums to 1
export interface HaloMix { w: number; share: Record<string, number>; modelled: boolean; benchmark: boolean }
export function haloMix(shares: Partial<Record<ChannelKey, number>>, settings: ClientSettings): HaloMix;
export function blendedAmer(amer: number, mix: HaloMix): number;                    // amer / mix.w
export function haloRevenue(newRevenue: number, mix: HaloMix): Record<string, number>;
```
`acquisitionShares` follows `amerSpend`: main channels always count; `google_brand` counts unless `excludeBrandFromAmer`; other alt channels count unless `excludeMetaReturningFromAmer`. `haloMix.modelled` is true when any share is above 0; `benchmark` is true when any cell behind a non-zero share is not `own_test`.

- [ ] **Step 1: Write the failing tests** in `lib/planning/halo.test.ts`. Fixture: `multipliers {meta_acquisition: 1.2, google_nonbrand: 0.6}`, one channel `amazon` (marketplace, costPct 65, aov 30), cell `meta_acquisition.amazon = {value: 0.2, source: "benchmark"}`.
  - `totalFactor("meta_acquisition")` is `1.4`; `totalFactor("google_nonbrand")` is `0.6`; `totalFactor("tiktok")` (no multiplier, no cell) is `1`.
  - `haloMix({meta_acquisition: 0.8, google_nonbrand: 0.2})`: `w` ≈ `0.885714`, `share.amazon` ≈ `0.129032`, `modelled` true, `benchmark` true.
  - `blendedAmer(1.5, mix)` ≈ `1.693548`; `haloRevenue(150, mix).amazon` ≈ `19.3548`.
  - No halo typed: `w` is `1`, `share` is `{}`, `modelled` false.
  - `acquisitionShares({platformPct: {meta: 80, google: 20}, altPct: {meta: 10, google: 25}})` with both excludes on: `meta_acquisition` ≈ `0.827586`, `google_nonbrand` ≈ `0.172414`, nothing else. With both off: `0.72`, `meta_returning 0.08`, `google_nonbrand 0.15`, `google_brand 0.05`.
  - Retail cell on shelf: channel `{kind: "retail", netPct: 50}`, cell `{value: 0.3, onShelf: true}` gives `cellValue` `0.15`.
  - Review Focus 1: a cell on `tiktok` with no multiplier gives `totalFactor("tiktok")` `1.2` for value `0.2`.
  - Review Focus 2: `acquisitionShares({platformPct: {}, altPct: {}})` is `{}` and `haloMix({})` has `w` `1`.
  - Review Focus 3: a cell under key `gone` (no such channel) is ignored by `haloOf` and `totalFactor`.
  - Review Focus 4: cell values `-1`, `NaN` and `undefined` count as `0`.
  - Review Focus 5: a channel with factor `0` and no halo is skipped in `w` (shares `{a: 0.5, b: 0.5}` with `a` factor 0 give the same `share` as `b` alone).
- [ ] **Step 2: Run** `npx vitest run lib/planning/halo.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the types and functions.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npx tsc --noEmit`: exit 0.
- [ ] **Step 5: Commit** `feat(halo): settings types and blended aMER math` with `lib/types.ts lib/planning/halo.ts lib/planning/halo.test.ts`.

### Task 2: ROAS targets on the total factor

**Files:**
- Modify: `lib/planning/roas.ts`, `components/planning/RoasLine.tsx`, `components/planning/SpendStep.tsx`
- Test: `lib/planning/roas.test.ts` (add cases)

**Interfaces:**
- Consumes: `acquisitionShares`, `haloMix`, `blendedAmer`, `totalFactor` from Task 1.
- Produces:
```ts
export interface RoasBasis { amer: number; factorOf: (k: ChannelKey) => number; modelled: boolean; benchmark: boolean }
export function roasBasis(inputs: PlanMonthInputs | null, settings: ClientSettings): RoasBasis; // amer = blended aMER; with no halo: inputs.amer and multipliers[k] ?? 1
export function roasTarget(inputs: PlanMonthInputs | null, channel: ChannelKey, factor: number, amer?: number): { value: number | null; manual: boolean }; // amer defaults to inputs.amer
```
`planRoasTargets` computes `roasBasis` per month. `RoasLine` and `SpendStep` pass `basis.factorOf(k)` and `basis.amer`; the Factor column shows the total factor, with the .com factor in the title when they differ.

- [ ] **Step 1: Write the failing tests.** Month inputs `amer 1.5`, `platformPct {meta: 80, google: 20}`, `altPct {}`; settings as the Task 1 fixture.
  - `planRoasTargets` gives `meta_acquisition` ≈ `1.2097` and `google_nonbrand` ≈ `2.8226`.
  - Same month with `extra.halo` removed: `1.25` and `2.5`.
  - A typed `roas.meta_acquisition = 2` still wins.
  - One channel only (`platformPct {meta: 100}`) with the halo: `meta_acquisition` is `1.25`, the same as without it.
  - Review Focus 5: a channel with total factor `0` has no entry.
- [ ] **Step 2: Run** `npx vitest run lib/planning/roas.test.ts lib/plan-roas.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** `roasBasis`, the optional `amer` argument and the `planRoasTargets` change; update the two components.
- [ ] **Step 4: Run** the same command plus `npx tsc --noEmit`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat(halo): ROAS targets from the blended aMER and total factor`.

### Task 3: New Customer model on the blended basis

**Files:**
- Modify: `lib/planning/new-customer.ts`, `lib/planning/models.ts`
- Test: `lib/planning/new-customer.test.ts` (add cases)

**Interfaces (produced):**
```ts
export type ValueBasis = "com" | "blended";
export interface HaloInput { share: Record<string, number>; value: Record<string, { costPct: number; aov: number; ltv60: number; ltv90: number; ltv365: number }> }
export function haloInput(mix: HaloMix, settings: ClientSettings): HaloInput | undefined; // in lib/planning/halo.ts; undefined when not modelled
// SpendPoint gains: haloRevenue, haloByChannel, blendedAmer, blendedCm, blendedLtv60Cm, blendedLtv90Cm, blendedLtv365Cm, blendedOrders, blendedCac
export function evaluateSpend(curve, s, monthlySpend, days, seasonIdx?, halo?: HaloInput): SpendPoint;
export function buildSpendTable(curve, s, days, maxSpend, step, seasonIdx?, markerMax?, opts?: { halo?: HaloInput; basis?: ValueBasis }): SpendTable;
// NewCustomerSettings gains: valueBasis?: ValueBasis
```
Without `halo`, `haloRevenue` is 0 and every blended field equals its .com field. Blended CM = CM + Σ halo revenue × (1 − costPct/100). Blended N-day CM = N-day CM + Σ halo revenue × ltvN × (1 − costPct/100). Blended orders = orders + Σ halo revenue ÷ aov (channels with aov 0 add none). On basis `"blended"` the markers use the blended fields, and the revenue marker maximises new revenue + halo revenue where blended CM ≥ 0.

- [ ] **Step 1: Write the failing tests.**
  - Curve `{kind: "revenue", a: 0, b: 2, r2: 1}`, settings `newCostPct 40, returningCostPct 40, aov 50`, multipliers 1, spend `30000`, days `30`, halo `share {amazon: 0.1}`, `value {amazon: {costPct: 65, aov: 30, ltv60: 1, ltv90: 1, ltv365: 1.5}}`: `haloRevenue` `6000`, `blendedAmer` `2.2`, `blendedCm` `8100`, `blendedOrders` `1400`, `blendedCac` ≈ `21.4286`, `blendedLtv365Cm` `9150`.
  - Same call without `halo`: `haloRevenue` `0`, `blendedCm` equals `cm`, `blendedAmer` equals `amer`.
  - Curve `{kind: "linear", a: 3, b: -0.001, r2: 1}`, same settings, table to `40000` by `1000`, days `30`: `optimalSpend(table, "cm")` is `20000` on the default basis and `21000` with the halo on basis `"blended"`.
  - Review Focus 4: a value entry with `aov 0` adds no orders and does not divide by zero.
- [ ] **Step 2: Run** `npx vitest run lib/planning/new-customer.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then the whole suite `npm test` and `npx tsc --noEmit`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(halo): blended value basis in the New Customer model`.

### Task 4: Other-channel plan lines, retail frame, retention line, guardrails

**Files:**
- Modify: `lib/planning/types.ts` (`PlanMonthInputs.other?: Record<string, OtherLine>`)
- Create: `lib/planning/other-channels.ts`
- Test: `lib/planning/other-channels.test.ts`

**Interfaces (produced):**
```ts
// lib/planning/types.ts
export interface OtherLine { revenue?: number | null; assumedSpend?: number | null }

// lib/planning/other-channels.ts
export function weeksIn(month: string): number;                                            // days in the month / 7
export function retailFrame(rows: RetailerRow[], netPct: number, month: string): { sellThrough: number; netRevenue: number; doors: number; weeks: number };
export function spendRatio(curve: Curve | null, plannedDaily: number, assumedDaily: number | null): number; // null -> 1; 0 -> 0; curve revenue ratio; no curve -> assumed / planned
export function otherForecast(typed: number, haloPlanned: number, ratio: number): number; // typed + haloPlanned x (1 - ratio)
export function capHalo(halo: number, forecast: number | null): { value: number; capped: boolean };
export function adCreatedUnitsPerStoreWeek(haloRevenue: number, netPrice: number, doors: number, weeks: number): number | null;
export function adCreatedReturning(inputs: PlanMonthInputs, settings: ClientSettings, recentFacts: DailyFact[]): { revenue: number; byChannel: Partial<Record<ChannelKey, number>> };
export type HaloWarningKind = "benchmark" | "old" | "range";
export function haloWarnings(settings: ClientSettings, spendByChannel: Partial<Record<ChannelKey, number>>, today: string): { channel: ChannelKey; salesChannel: string; kind: HaloWarningKind }[];
```
A retailer row counts from its launch month on; the pipeline fill is added in the launch month only. `adCreatedReturning` = planned spend of each retention channel × its platform ROAS in `recentFacts` × its .com factor; channels with no recent spend add nothing.

- [ ] **Step 1: Write the failing tests.**
  - `retailFrame` with one row `{retailer: "Target", launchMonth: "2027-03", doors: 1000, unitsPerStoreWeek: 2, shelfPrice: 30, pipelineUnits: 12000}` and `netPct 50`: month `2027-04-01` gives `sellThrough` ≈ `257142.86`, `netRevenue` ≈ `128571.43`; `2027-03-01` gives `netRevenue` ≈ `312857.14`; `2027-02-01` gives `0`.
  - `spendRatio({kind: "revenue", a: 1000, b: 1.5, r2: 1}, 1000, 500)` is `0.7`; with `assumed null` it is `1`; with `0` it is `0`; with no curve and `500` it is `0.5`.
  - `otherForecast(100000, 20000, 1)` is `100000`; ratio `0` gives `120000`; ratio `0.8` gives `104000`.
  - `capHalo(30000, 20000)` is `{value: 20000, capped: true}`; `capHalo(30000, null)` is `{value: 30000, capped: false}`.
  - `adCreatedUnitsPerStoreWeek(64285.71, 15, 1000, 30 / 7)` ≈ `1`; doors `0` gives `null`.
  - `adCreatedReturning`: spend `100000`, `platformPct {meta: 100}`, `altPct {meta: 10}`, facts where `meta_returning` spent `1000` for `3000` platform revenue, factor `0.6`: revenue `18000`.
  - `haloWarnings` on `2026-11-23`: a benchmark cell returns `benchmark`; `measuredOn "2026-04-01"` returns `old`; `measuredSpend 100000` with planned `140000` returns `range`, with planned `120000` it does not.
  - Review Focus 3: a plan line under a key with no channel is not returned by any helper that lists channels.
- [ ] **Step 2: Run** `npx vitest run lib/planning/other-channels.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `npx tsc --noEmit`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat(halo): other-channel plan lines, retail frame and guardrails`.

### Task 5: Settings screen

**Files:**
- Create: `components/settings/HaloSettings.tsx`
- Modify: `components/settings/EditStoreDialog.tsx` (mount one accordion after "Incrementality (iROAS)")

**Interfaces:**
- Consumes: the Task 1 types and `haloSettingsOf`.
- Produces: `export function HaloSettings({ value, multipliers, onChange }: { value: HaloSettings; multipliers: Partial<Record<ChannelKey, number>>; onChange: (next: HaloSettings) => void })`.

The accordion "Other sales channels and halo" has three parts, built with the dialog's own `Field`, `NumberInput`, `Select`, `Check` pieces:
1. Channels: add Amazon, TikTok Shop, Retail or a custom name; per channel the fields in spec section 2; delete removes the channel and its cells.
2. Halo cells: one row per ad channel that has a factor, one cell per other sales channel (value, source, measured on, monthly spend when measured, note; "measured on shelf sales" on retail cells).
3. Retailer rows on retail channels (spec section 7).

- [ ] **Step 1:** Build the component and mount it; `set("extra", {...d.extra, halo: next})` saves it.
- [ ] **Step 2: Verify** in the browser on demo data (`NEXT_PUBLIC_DATA_MODE=seed npm run dev`): add Amazon, type a Meta cell of 0.2, save, reopen: the values are still there. `npx tsc --noEmit` and `npm run lint` are clean.
- [ ] **Step 3: Commit** `feat(halo): other sales channels and halo cells in Store Settings`.

### Task 6: New Customer model screen

**Files:**
- Modify: `components/planning/models/NewCustomerModel.tsx`

- Consumes: `haloMix`, `haloInput`, `acquisitionShares` (Task 1), the new `evaluateSpend` and `buildSpendTable` arguments (Task 3).

- [ ] **Step 1:** Add the "Value basis" select (`.com only` / `Blended (with halo)`) beside the curve settings, shown only when the client has halo cells; store it in `valueBasis`.
- [ ] **Step 2:** Pass the month's halo input to `buildSpendTable` and `evaluateSpend`. Month shares come from the plan month's split, else from the last 90 days of actual spend.
- [ ] **Step 3:** When halo cells exist, add columns to the spend table (Halo revenue, Blended aMER, Blended CM) and to the month table (Blended aMER); highlight markers on the chosen basis; show a "modelled" note with a Benchmark badge when `mix.benchmark`.
- [ ] **Step 4: Verify** in the browser: with the Task 5 cell, switching to Blended moves Max CM to a higher spend and a lower aMER; with no cells the screen is unchanged. `npx tsc --noEmit`, `npm run lint`, `npm test`.
- [ ] **Step 5: Commit** `feat(halo): blended basis on the New Customer model screen`.

### Task 7: "Other sales channels" line in Details

**Files:**
- Create: `components/planning/OtherChannelsLine.tsx`
- Modify: `components/planning/DetailsStep.tsx` (one `LINES` entry, id `other`, placed before `roas`; render the component for it)

- Consumes: Tasks 1, 3 and 4; `fitPlanModel` from `lib/planning/plan-fit.ts`; `getRepository().getPlanModel(plan.id, "new_customer")`.

One table, months across. Per other sales channel: the typed revenue (retail shows the frame's value as a placeholder until typed), the assumed ad spend, the forecast, and "of which created by ads" (capped, with the warning). Below: blended aMER, ad-created returning revenue, the retail sanity figure, and the guardrail warnings as short sentences.

- [ ] **Step 1:** Build the component and add the line.
- [ ] **Step 2: Verify** in the browser: type an Amazon line and an assumed spend below the plan's; the forecast rises; empty assumed spend returns the typed number; with no other channels the line shows one sentence pointing to Store Settings. `npx tsc --noEmit`, `npm run lint`, `npm test`.
- [ ] **Step 3: Commit** `feat(halo): other sales channels line in the plan's Details`.

### Task 8: Docs

**Files:**
- Modify: `docs/changelog.md`, `docs/planning-layer.md`, `CLAUDE.md` (one status paragraph)

- [ ] **Step 1:** Record what was built, where it lives and what phase B adds.
- [ ] **Step 2: Commit** `docs: halo layer phase A` together with the spec and this plan.

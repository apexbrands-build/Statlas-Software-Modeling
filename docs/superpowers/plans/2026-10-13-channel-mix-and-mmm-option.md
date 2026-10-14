# Channel mix and the "Use Marketing Mix Model" option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the two disabled Spend step buttons ("Use Marketing Mix Model", "See MMM data") into working features powered by a first-version **mix analysis**: from the client's own monthly history, suggest a share of spend per platform with an honest confidence label, let the strategist apply it to one month or every unlocked month, and show the evidence behind it.

**Architecture:** All logic is pure and tested in `lib/planning/channel-mix.ts` (monthly points, quadratic fit, suggestion, confidence, normalisation, ROAS targets) and `lib/planning/alloc.ts` (applying shares to a month while keeping locks). The analysis reuses the saved New Customer model fit (`fitPlanModel`, `curveAmer`, `seasonIndex` in `lib/planning/plan-fit.ts`) for the "expected" revenue. One client hook (`useChannelMix`) feeds three screens: a new **Channel mix** sub-tab in Models (charts and min/max settings, saved in `plan_models` with kind `channel_mix`), the **Apply** dialog and the **See data** panel on the Spend step.

**Tech Stack:** Next.js 16 client components, Supabase `plan_models` (no new table), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-channel-mix-design.md`. Reference (method only): `Statlas Original UX/Forecasting and Calendar Layer/Spend and MMM/` (README and screenshots 01 to 06).

## What "channel mix" is, and the decision on the MMM

**Channel mix is not the full Marketing Mix Model.** It is a lighter first version: one point per month from the client's history (x = a platform's share of spend, y = how far that month's new-customer revenue beat the New Customer model), a smooth curve through the points, and the share where the curve peaks, with a label saying how much to trust it. The full MMM (what the reference tool runs: Meta's open-source Robyn, weekly data, adstock and saturation curves, R-squared and normalised RMSE, saturation-point budget allocation, marginal ROAS tables, decomposition charts, re-run by data scientists) is a later, much bigger build (section "Later" at the end).

**Decision: keep the split. Build the mix analysis now, the full MMM later.** Reasons, all checked in the repo:
1. **Data.** `daily_channel_facts` (0001) only allows five channels (`google_nonbrand, google_brand, meta_acquisition, meta_returning, pinterest`) and only the Meta and Google syncs write it. Most clients have two channels whose share moves a few points a year. A real MMM on that returns wide, unstable answers; the mix analysis at least says "Unclear" honestly.
2. **Compute.** Robyn is R plus Python (Nevergrad), thousands of model fits per run, 10 to 60 minutes per client. That cannot run in a Vercel function; it needs a separate worker, which the app does not have.
3. **Calibration.** The Bridge chain (p.28) is "incrementality tests calibrate the MMM". The agency has default factors (`lib/defaults.ts` `DEFAULT_MULTIPLIERS`), not test results per client. An uncalibrated MMM looks precise and is not.
4. **Cost and timing.** The mix analysis is about 4.5 days and reuses the New Customer model; the full MMM is 15 to 25 days plus a worker and per-run review.

The buttons keep the strategist's labels, but every screen says "first version: mix analysis from monthly history". **Strategist decision wanted:** relabel the first button "Use channel mix" until the full MMM exists (recommended, more honest), or keep "Use Marketing Mix Model".

## Global Constraints

- The software is **Apex Analytics**. Never name Statlas on any screen. Reproduce the method only: our own layout, wording and charts (no pie chart copy, no "Apply Strong MMM Model" button text, no "Model Outputs" file list).
- `AGENTS.md`: this plan touches client components only (no route or page files). If a task ends up editing anything under `app/`, read the matching guide in `node_modules/next/dist/docs/01-app` first.
- Thresholds from the spec, as named constants in `channel-mix.ts`: `MIN_MONTHS = 12`, `RECOMMENDED_MONTHS = 18`, `MIN_RANGE_PTS = 10` (percentage points), `EDGE_PTS = 5` (the suggestion never leaves the observed range plus 5 points), `MIN_R2 = 0.2` (below it: no meaningful fit).
- Strength labels (ours): **Strong** = at least 24 months, range at least 20 points, R² at least 0.5; **Moderate** = at least 18 months, range at least 15, R² at least 0.3; **Weak** = usable but below that; **Unclear** = fewer than 12 months, range under 10 points, or R² under 0.2. Overall strength = the weakest label among channels with an average share of at least 5%.
- When a channel is Unclear the suggestion is its **average share over the last 12 months used** (the spec's "keep last year's share"), never an invented number.
- Shares are % of **total** spend per plan platform (main plus alt channel, e.g. Google non-brand plus Brand), the same unit as `PlanMonthInputs.platformPct`. The spec says "share of acquisition spend"; total spend is used on purpose so Apply writes exactly what the sliders show, and brand / non-acquisition split stays in `altPct` untouched.
- "Expected" revenue for a month = `acqSpend × curveAmer(curve, acqSpend / daysWithData) × seasonIndex(fit, month)`, with `acqSpend` from `amerSpend` (client settings decide whether brand and non-acquisition count). Seasonality is applied so a strong season does not masquerade as a good mix.
- Default analysis settings: last 36 complete months, November excluded (BFCM days are dropped from the New Customer fit, so November actuals would look inflated), the running month excluded, a month needs at least 25 days with data and spend above 0.
- No migration: `plan_models.kind` is plain `text` with no check constraint (0007 lines 29 to 38; no later migration touches it). Only the TypeScript `ModelKind` union changes.
- Incrementality defaults added (spec "incrementality overlay"): `youtube: 0.75`, `tiktok: 0.3`, `snapchat: 0.3` in `DEFAULT_MULTIPLIERS`. Google Brand stays 0.3 (confirmed decision; the Bridge's 0.25 only on the strategist's say-so). ROAS target per platform = month aMER target / factor of its main channel (missing factor = 1).
- Read-only against every platform; no client messaging.

## Review Focus

1. **A client with a single channel** (all spend on Meta): no mix to analyse; the result says "Only one channel with spend", the suggestion is 100% for it, Apply is disabled with that reason, nothing crashes on a zero-width range. Tested in Task 2 (`analyseChannels` single-channel case) and Task 4.
2. **Short history** (8 months, or 14 months of which 3 are November or the running month): every channel Unclear, suggestion = last-12-month average, overall strength Unclear; the Apply dialog says why and still allows applying the averages. Tested in Tasks 1 and 2.
3. **A month locked in the plan** (`PlanMonth.locked`) or a **locked platform** (`lockedPlatforms`): Apply to all months skips locked months and lists them; inside a month, locked platforms keep their share and the rest share what is left. Tested in Task 3.
4. **Shares that do not add to 100** (an old plan at 97%, a blank month at 0%, min/max bounds that cannot be met, locked shares above 100): the written split always adds to exactly 100.00 when feasible; impossible bounds are reported, not silently broken. Tested in Tasks 2 and 3.
5. **A platform the plan uses but with no history** (TikTok planned at 5% for a launch, no spend in `daily_channel_facts`): it is excluded from the analysis and **keeps its current plan share** on Apply, instead of being zeroed. Tested in Tasks 2 and 3.

---

### Task 1: Monthly points

**Files:** Create `lib/planning/channel-mix.ts`, `lib/planning/channel-mix.test.ts`.

**Interfaces:**
- Consumes: `DailyFact`, `ClientSettings` (`lib/types.ts`); `aggregate`, `amerSpend` (`lib/metrics.ts`); `curveAmer`, `Curve` (`lib/planning/new-customer.ts`); `PLAN_PLATFORMS` (`lib/planning/types.ts`); test data from `lib/planning/stretch-fixtures.ts` (`factsFrom`, `settings`, `truth`) with channel spend overwritten per month.
- Produces:
  - `interface MixPoint { month: string; days: number; totalSpend: number; acqSpend: number; sharePct: Record<string, number>; actualNew: number; expectedNew: number; beatPct: number }` (`sharePct` keyed by plan platform key, 0 to 100; `beatPct` = (actual / expected - 1) × 100).
  - `interface MixOptions { lastData: string; lookbackMonths: number; excludeNovember: boolean }`.
  - `monthlyMixPoints(facts: DailyFact[], settings: ClientSettings, curve: Curve, seasonIdx: (month: string) => number, opts: MixOptions): MixPoint[]` sorted by month.
  - `platformSpend(channels: DailyFact["channels"], key: string): number` (main plus alt channel of the plan platform).

- [ ] **Step 1: Write failing tests:** 30 months of facts with Meta 70% / Google 30% give 30 points minus Novembers minus the running month, each `sharePct.meta ≈ 70` and `google ≈ 30` (2 decimals), sum of `sharePct` = 100; a month with 20 days of data is dropped; a month with zero total spend is dropped; `lookbackMonths: 12` keeps only the last 12 complete months; with facts generated from `truth` and `curve = truth`, seasonIdx 1, `beatPct` stays within ±6 (fixture noise); multiplying one month's new revenue by 1.2 makes its `beatPct` about +20; with `excludeBrandFromAmer: true`, Google brand spend is in `sharePct.google` but not in `acqSpend`; `excludeNovember: false` keeps Novembers.
- [ ] **Step 2: Run** `npx vitest run lib/planning/channel-mix.test.ts`: FAIL (module missing).
- [ ] **Step 3: Implement** both functions; group by `date.slice(0, 7)`, aggregate with `aggregate`, expected as in Global Constraints.
- [ ] **Step 4: Run:** PASS.

### Task 2: Fit, suggestion, confidence, normalisation

**Files:** Modify `lib/planning/channel-mix.ts`, `lib/planning/channel-mix.test.ts`.

**Interfaces:**
- Consumes: `MixPoint` (Task 1).
- Produces:
  - `type MixConfidence = "strong" | "moderate" | "weak" | "unclear"`.
  - `type UnclearReason = "few_months" | "narrow_range" | "no_fit" | "only_channel"`.
  - `interface QuadFit { c0: number; c1: number; c2: number; r2: number; nrmse: number }` (`nrmse` = RMSE / (max y - min y) × 100).
  - `fitQuadratic(xs: number[], ys: number[]): QuadFit | null` (null under 3 points or zero x variance; normal equations, no library).
  - `interface ChannelMix { key: string; label: string; months: number; observed: { min: number; max: number }; avgShare: number; fit: QuadFit | null; suggested: number; confidence: MixConfidence; reason: UnclearReason | null; points: { month: string; x: number; y: number }[] }`.
  - `analyseChannels(points: MixPoint[]): ChannelMix[]` (one entry per plan platform with spend in at least one point; zero-spend platforms are absent).
  - `normaliseShares(raw: Record<string, number>, bounds: Record<string, { min: number; max: number }>): { shares: Record<string, number>; conflict: boolean }`.
  - `overallStrength(channels: ChannelMix[]): MixConfidence`.
  - `roasTargets(amer: number, keys: string[], multipliers: ClientSettings["multipliers"]): Record<string, number | null>` (null when `amer` is 0).

Suggestion rule (the tests do not fully fix it): with `c2 < 0` take the vertex `-c1 / (2·c2)`; otherwise the better of the two ends; then clamp to `[max(0, min - EDGE_PTS), min(100, max + EDGE_PTS)]` and round to 0.5. An end-point suggestion (no interior peak) is capped at Weak. Normalisation: clamp each share to its bounds, then repeatedly scale the unclamped ones to fill 100 until stable (at most 10 rounds); `conflict` when the mins add above 100 or the maxes below 100 (then shares are the clamped values scaled to 100).

- [ ] **Step 1: Write failing tests** (synthetic `MixPoint[]`, two platforms, Google = 100 - Meta):
  - **Known peak:** 24 months, Meta share 55 to 90, `beatPct = 10 - 0.05·(x - 75)²` plus ±1 noise: Meta `suggested` within 3 points of 75, confidence Strong or Moderate.
  - **Flat:** same shares, `beatPct` = noise only: Meta confidence Unclear, reason `no_fit`, `suggested` = `avgShare` of the last 12 points.
  - **Fewer than 12 months:** 11 points with a clear peak: Unclear, `few_months`.
  - **Narrow range:** shares 78 to 84: Unclear, `narrow_range`.
  - **Edge:** points rising across 40 to 60: `suggested` ≤ 65 and confidence not above Weak.
  - **Zero-spend channel excluded:** a TikTok key at 0 in every point does not appear in `analyseChannels`.
  - **Single channel:** Meta 100 in every point: one entry, `suggested` 100, reason `only_channel`, no exception.
  - **Normalisation:** `{meta: 70, google: 20}` gives 77.78 / 22.22, sum 100.00; bounds `google.min 25` gives google 25, meta 75; bounds mins 60 + 60 gives `conflict: true` and a sum of 100.
  - `overallStrength`: a Strong 80% channel plus an Unclear 3% channel gives Strong; Strong plus Unclear 20% gives Unclear.
  - `roasTargets(3, ["meta","google","tiktok"], {meta_acquisition: 1.2, google_nonbrand: 0.75})` gives meta 2.5, google 4, tiktok 3.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

### Task 3: Applying shares to plan months

**Files:** Modify `lib/planning/alloc.ts`, `lib/planning/alloc.test.ts`.

**Interfaces:**
- Consumes: `PlanMonth`, `PlanMonthInputs` (`lib/planning/types.ts`).
- Produces:
  - `applyShares(inputs: Pick<PlanMonthInputs, "platformPct" | "lockedPlatforms">, shares: Record<string, number>, keys: string[]): Record<string, number>`: fixed = locked platforms plus platforms absent from `shares`, keeping their current values (fixed total capped at 100); the others get `shares[k] / Σ shares × (100 - fixed)`, rounded to 2 decimals with the rounding remainder on the largest; equal split when their suggested shares are all 0; unchanged input when every platform is fixed.
  - `applySharesToMonths(months: PlanMonth[], target: string | "all", shares: Record<string, number>, keys: string[]): { updates: Record<string, Record<string, number>>; skippedLocked: string[]; skippedEmpty: string[] }` (empty = `inputs === null`).

- [ ] **Step 1: Write failing tests:** shares `{meta: 66, google: 34}` on `{meta: 90, google: 10}` gives 66 / 34; with `lockedPlatforms: ["google"]` at 10, meta gets 90 and google stays 10; with tiktok at 5 and absent from shares, tiktok stays 5 and meta / google share 95 in 66:34 (62.7 / 32.3); an old split adding to 97 and a blank `{}` both give a result adding to exactly 100.00; locked shares adding to 120 leave unlocked platforms at 0 and nothing negative; `applySharesToMonths` over 12 months with March locked and May empty returns 10 updates, `skippedLocked: ["2026-03-01"]`, `skippedEmpty: ["2026-05-01"]`; target `"2026-03-01"` (locked) returns no update and lists it.
- [ ] **Step 2: Run** `npx vitest run lib/planning/alloc.test.ts`: FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

### Task 4: Settings, saved model and the one-call analysis

**Files:** Modify `lib/planning/models.ts` (`ModelKind`, new types and defaults), `lib/planning/channel-mix.ts`, `lib/planning/channel-mix.test.ts`, `lib/defaults.ts`, `lib/defaults.test.ts` (create if missing).

**Interfaces:**
- Consumes: Tasks 1 and 2; `fitPlanModel`, `seasonIndex` (`lib/planning/plan-fit.ts`); `NewCustomerSettings`, `DEFAULT_NEW_CUSTOMER` (`models.ts`).
- Produces:
  - `type ModelKind = "new_customer" | "returning" | "event" | "channel_mix"`.
  - `interface ChannelMixSettings { lookbackMonths: number; excludeNovember: boolean; bounds: Record<string, { min: number; max: number }> }` and `DEFAULT_CHANNEL_MIX: ChannelMixSettings = { lookbackMonths: 36, excludeNovember: true, bounds: {} }` (missing bound = 0 to 100).
  - `interface ChannelMixResult { status: "ok" | "no_model" | "no_channel_data"; from: string | null; to: string | null; monthsUsed: number; channels: ChannelMix[]; shares: Record<string, number>; strength: MixConfidence; conflict: boolean; onlyChannel: boolean }`.
  - `buildChannelMix(input: { facts: DailyFact[]; settings: ClientSettings; dow: number[]; newSettings: NewCustomerSettings | null; mix: ChannelMixSettings; lastData: string }): ChannelMixResult` (no saved New Customer model: fit with `DEFAULT_NEW_CUSTOMER`; fit null: `no_model`).
  - `type ChannelMixResults = { computedAt: string; from: string | null; to: string | null; monthsUsed: number; strength: MixConfidence; shares: Record<string, number> }` (what is stored in `plan_models.results`, so a later look can see what was suggested).
  - `DEFAULT_MULTIPLIERS` gains `youtube: 0.75, tiktok: 0.3, snapchat: 0.3`.

- [ ] **Step 1: Write failing tests:** `buildChannelMix` on `factsFrom("2023-07-01", "2026-06-30")` with Meta / Google spend varied by month around a 75% peak returns `status: "ok"`, `monthsUsed` 33 (36 minus three Novembers), shares adding to 100 and Meta within 3 points of 75; with 200 days of facts it returns `no_model` or every channel Unclear (whichever the fit gives, asserted explicitly); facts with no channel spend return `no_channel_data`; a Meta-only client returns `onlyChannel: true`; bounds `{google: {min: 30, max: 100}}` give google ≥ 30. `defaultSettings("c").multipliers.tiktok === 0.3`, `.youtube === 0.75`, `.google_brand === 0.3`.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** No migration (see Global Constraints); `lib/repository/seed.ts` already stores any kind in its `modelStore` map, so demo mode works unchanged.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`: PASS.

### Task 5: Channel mix sub-tab in Models

**Files:** Create `components/planning/models/useChannelMix.ts`, `components/planning/models/ChannelMixModel.tsx`, `components/planning/models/ChannelMixCharts.tsx`. Modify `components/planning/models/ModelsStep.tsx` (`View` union, `SIDE`, an info `Card`, the `view === "channel_mix"` branch).

**Interfaces:**
- Consumes: `buildChannelMix`, `DEFAULT_CHANNEL_MIX`, `roasTargets`; `PlanCtx` (`components/planning/ctx.ts`); `ScatterCurve`, `Legend`, `LineChart` (`components/planning/models/charts.tsx`); `Modal`, `btn`, `btnPrimary`, `NumField` (`components/planning/ui.tsx`); `getRepository().getPlanModel / savePlanModel`.
- Produces: `useChannelMix(ctx: PlanCtx): { result: ChannelMixResult | null; mix: ChannelMixSettings; setMix: (m: ChannelMixSettings) => void; save: () => Promise<string | null>; loading: boolean }` (loads the saved `new_customer` and `channel_mix` models for the **baseline** plan, the same rule as `SummaryStep.tsx` line 84, and runs `buildChannelMix` in `useMemo` over `ctx.history.facts`, `ctx.settings`, `ctx.seasonality.dow`); `ChannelMixCharts({ result, currency })`: one scatter per channel (x = share, y = % beating the model, the fitted curve, a marker at the suggestion and one at the 12-month average) plus a monthly share timeline.

**Why in Models and not on the Spend step:** the Models tab is where the other fitted models live, it already has the whole history loaded and a save flow per model kind; the settings (lookback, November, min / max per channel) are model settings that apply to every month. The Spend step stays the editing surface: its two buttons open a short dialog and a read-only panel that use the same hook.

- [ ] **Step 1: Build the screen:** header with data range, months used and overall strength; per channel a card with the scatter, suggested share, 12-month average, observed range, R² and the reason in plain words when Unclear ("Only 9 usable months: at least 12 are needed", "Share moved only 6 points: too little variation to learn from", "No pattern between share and results"); a table of suggested shares normalised to 100 with editable min / max per channel and a "Bounds cannot all be met" note on `conflict`; lookback (12, 24, 36, all) and "Leave out November" controls; Save (writes `channel_mix` settings and `ChannelMixResults`). A fixed footnote: "First version: a mix analysis from monthly history. It shows which shares went with better months, not proof of cause. The full Marketing Mix Model comes later."
- [ ] **Step 2: Verify:** `npx tsc --noEmit`, `npx eslint components/planning lib/planning`, `npm run build`; browser check in demo mode (`NEXT_PUBLIC_DATA_MODE=seed`, Supabase env vars blank): the tab renders for the seed client, no console errors, and (expected) the seed's near-fixed mix shows Unclear "too little variation" rather than a made-up suggestion.

### Task 6: Wire the Spend step buttons (Apply dialog and See data panel)

**Files:** Create `components/planning/ChannelMixDialogs.tsx`. Modify `components/planning/SpendStep.tsx`.

**Interfaces:**
- Consumes: `useChannelMix` and `ChannelMixCharts` (Task 5); `applyShares`, `applySharesToMonths` (Task 3); `roasTargets` (Task 2); `PLAN_PLATFORMS`; `ctx.editInputs`, `ctx.months`.
- Produces: `ApplyMixDialog({ ctx, month, mixState, onClose, onDone })` and `MixDataPanel({ ctx, month, mixState, onClose })`.

**What the builder must find first:** in `SpendStep.tsx`, the platform allocation `<section>` (its `<h3>` reads "Platform allocation", around line 102 today) and next to it two disabled buttons labelled "Use Marketing Mix Model" and "See MMM data" (added by today's change). Grep for both labels. **If they are not there** (they were absent when this plan was written on 2026-10-13), add them in that section's header row, styled with `btn`. Remove `disabled` and attach the dialogs; disable only when `history.loading`, `!inputs`, `m.locked`, or `result.status !== "ok"`, with a `title` giving the reason.

- [ ] **Step 1: Apply dialog** (our wording): strength label with one sentence built from the result ("Based on 27 months; Meta's share ranged 58 to 88%; the curve explains 41% of the month-to-month differences"), the suggested split per platform next to the current one, platforms with no history listed as "kept at current share", Unclear channels marked "last 12 months' average"; scope choice "This month" / "All unlocked months"; Cancel and Apply. Apply calls `applySharesToMonths`, then `ctx.editInputs(month, i => ({ ...i, platformPct }))` per update, and reports "Applied to N months; skipped (locked): Mar, Jul". Single-channel client: Apply disabled with "Only one channel has spend, so there is no mix to choose". Nothing is saved until the strategist presses the plan's Save, as with every other edit.
- [ ] **Step 2: See data panel** (`Modal` with `wide`), three views of our own: **Summary** (data range, monthly data, revenue definition "new-customer order revenue", whether brand and non-acquisition count in the expected revenue per client settings, months used, strength, average R² and normalised RMSE of the channel fits, suggested split as a horizontal bar); **Allocation** (table per platform: 12-month average, suggested, min, max, observed range, ROAS target at this month's aMER = aMER / factor, factor used); **Charts** (`ChannelMixCharts`). A line at the bottom: "Saturation points, marginal returns by spend level and revenue decomposition come with the full Marketing Mix Model (not built yet)."
- [ ] **Step 3: Verify:** `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npm test`; demo-mode browser check: open Spend, lock one month in Overview, open "Use Marketing Mix Model", apply to all months: the locked month is listed as skipped and unchanged, a locked platform keeps its share, every applied month's shares add to 100 (no red "add to" warning under the sliders), Undo / leave without saving restores the draft.

### Task 7: Docs

**Files:** Modify `docs/planning-layer.md` (Channel mix section: method, thresholds, honest limits, where the buttons are), `docs/changelog.md`, `CLAUDE.md` (Status: channel mix built, `channel_mix` model kind, no migration), the spec's status line.

- [ ] **Step 1: Write** the docs; state the TikTok / YouTube / Snapchat default factors that were added.
- [ ] **Step 2: Verify** `npm test`, `npx tsc --noEmit`, `npm run build` once more.

---

## Later: the full Marketing Mix Model (separate plan, not in this build)

**What it adds:** weekly regression of revenue on each channel's spend with **adstock** (carry-over of spend into later weeks) and **saturation** (diminishing returns per channel), trend, season, holidays and promotions; fit quality (R², normalised RMSE, decomposition distance); a budget allocator that finds the split at each channel's saturation point; marginal ROAS tables (extra revenue for the next dollar at several spend levels); decomposition charts (how much of each week came from each channel, base, season, promotions).

**Prerequisites:**
1. **Data:** weekly channel-level spend and revenue for **at least two years** (104+ weeks), with real variation in each channel's spend. Today: only Meta and Google write `daily_channel_facts`, and its `channel` check constraint allows five channels, so TikTok, YouTube, Snapchat, Bing, AppLovin need connectors and a migration widening the constraint. Context variables: the marketing calendar (built), email / SMS sends (Klaviyo sync, planned), organic.
2. **Compute outside Vercel:** a worker that runs R / Python (Robyn, or Google's Meridian / PyMC-Marketing), e.g. a container job triggered by `sync_jobs`, writing results to a new `mmm_runs` table (inputs, parameters, metrics, response curves, allocation, chart data as JSON). Vercel functions time out long before a run finishes.
3. **Incrementality calibration:** at least one lift or geo-holdout test per main channel per client (Meta Conversion Lift, Google geo test), or the agency's factors used as priors with a clear "uncalibrated" label.
4. **Review:** someone checks each run (plausible adstock, no channel with negative effect) before the strategist applies it.

**Effort:** 15 to 25 working days for Claude (worker and deployment 4 to 6, data pipeline and weekly export 3 to 4, model runs and storage 3 to 5, screens replacing the first-version panels 3 to 5, calibration inputs 2 to 3), plus hosting cost for the worker and the missing connectors, which are their own plans. A middle path, a light MMM written in TypeScript (geometric adstock, Hill saturation, ridge regression, grid search, run in the browser), is 6 to 10 days but less trustworthy than Robyn and still limited by the same data.

**Recommendation:** ship the mix analysis now. After it runs on real clients, count how many have 104+ weeks with at least two channels whose share moved 10+ points. If that is about ten clients or more, write the full MMM plan (Robyn on a worker, calibrated with the agency's factors as priors); otherwise wait for the TikTok / YouTube connectors and the first lift tests.

---

## Self-review

- **Spec coverage:** monthly points (Task 1), curve fit, suggestion, confidence and Unclear rules (Task 2), normalisation with min / max (Tasks 2 and 4), Models sub-tab (Task 5), "use as starting point" on the Spend step via the Apply dialog for one month or the year (Tasks 3 and 6), incrementality overlay and missing default factors (Tasks 2 and 4), honest limits (Tasks 5 and 6 copy). The spec's Spending Power scatter for tiny channels (method step 4) is left out: optional in the spec, add it to the full MMM plan.
- **Deviations on purpose:** shares are of total spend, not acquisition spend (matches `platformPct`); expected revenue includes the New Customer model's seasonal index; November excluded by default; platforms without history keep their current share. Each is stated in Global Constraints.
- **Verified in the repo:** `PLAN_PLATFORMS`, `platformPct`, `altPct`, `lockedPlatforms`, `rebalance`, `ModelKind`, `getPlanModel` / `savePlanModel`, `fitPlanModel`, `seasonIndex`, `curveAmer`, `evaluateSpend` (not needed: it needs full `ModelSettings`, `curveAmer` is enough), `amerSpend`, `DEFAULT_MULTIPLIERS`, `Modal`, `ScatterCurve`, `factsFrom`. Not found: the two disabled buttons in `SpendStep.tsx` (Task 6 says what to do), a `kind` check on `plan_models` (so no migration), any pdftotext tool (Bridge pages taken from the spec's quotes).
- **Type consistency:** `MixPoint`, `ChannelMix`, `QuadFit`, `MixConfidence`, `ChannelMixResult`, `ChannelMixSettings`, `ChannelMixResults`, `applyShares`, `applySharesToMonths`, `buildChannelMix`, `useChannelMix` are spelled the same in every task.
- **Proportion:** seven tasks, signatures and assertions only; one algorithm note (suggestion and normalisation rules) where the tests leave a choice.

**Sizing:** about 4.5 working days for Claude (Tasks 1 to 4: 2 days test first; Tasks 5 and 6: 2 days; docs and one independent review: 0.5). What could blow it up: real clients' mixes barely move, so most channels show Unclear (the feature then mostly shows averages: by design, but disappointing); the saved New Customer model missing or unfit for some clients. From the strategist: the button label decision, approval of the strength thresholds and the November default, and one real client with 18+ months of Meta and Google spend to check against. Full MMM later: 15 to 25 days plus a worker, connectors and calibration tests.

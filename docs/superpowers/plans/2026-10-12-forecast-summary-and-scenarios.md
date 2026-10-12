# Forecast Summary and Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Summary tab in the plan editor (month by metric against last year, with EBITDA and a stretch-against-model column), a stretch scenario generated from the baseline and one goal number, a baseline vs stretch comparison, and a Baseline | Stretch selector on Home.

**Architecture:** Pure, tested modules in `lib/planning/` (`scenarios`, `summary`, `plan-fit`, `stretch`) do the arithmetic. The stretch is a second `plan_versions` row (`scenario = 'target'`) written through the existing `createPlan` and `savePlanMonths`, so the full editor, the Plan P&L and Home read it unchanged. UI is one new tab component plus small edits to Home and the plan list.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (migration, repository), TypeScript, Vitest (`lib/**/*.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-10-12-forecast-summary-design.md`

## Global Constraints

- Scenarios are `baseline` and `target` (shown as "Baseline / Most likely" and "Stretch / Would like"). The baseline is the client's default plan for the year; at most one `target` plan per client and year (database unique index).
- Summary rows, in order: Spend, aMER, New revenue, Returning revenue, Total order revenue, Contribution margin, Operating expenses, EBITDA. For each month: plan value, last year's actual for the same month, YoY %, MoM %, and share of the year (spend and the three revenue rows). Year total column.
- Operating expenses = the month's plan SG&A (`PlanMonthInputs.fixedCosts`), falling back to `ClientSettings.monthlyFixedCosts`; EBITDA = contribution margin - operating expenses. Last year's operating expenses use `monthlyFixedCosts`.
- aMER = new revenue / acquisition spend, where acquisition spend leaves out brand search and retention spend according to the client settings (the same rule as `amerSpend`). Spend (the row) is total ad spend.
- Above model % = plan aMER / the aMER the New Customer model gives at the month's acquisition spend (model line with no "% over model" and with the month's seasonality index) - 1. A month is flagged "stretch" when Above model % is greater than that month's `overModelPct`.
- Stretch goal is one of: `newRevenueGrowth` (% against last year's new revenue), `totalRevenueGrowth` (% against last year's total order revenue), `totalRevenue` (an amount), with optional `cmFloor` and `amerFloor`. Month shape = the baseline's share of the year's new revenue. Spend is solved on the New Customer model. Returning revenue comes from the Returning model fed with the stretch's new revenue. Rates, SG&A and the platform split are copied from the baseline. Total revenue goals are solved by bisection (at most 40 iterations, tolerance 0.5% of the goal). Locked months are kept on Regenerate.
- Flags per stretch month: `beyond_history` (monthly acquisition spend above the model's trusted spend, 30 times the daily 95th-percentile spend `curve.guard.s0`; if there is no guard, never flagged), `cm_negative`, `cm_below_floor`, `amer_below_floor`, `unreachable` (the solver cannot reach the month's target below 10 times the highest spend in history; the month keeps that capped spend and is flagged, never silently).
- Home selector: "Plan: Baseline | Stretch", only when the range's year has a stretch plan; Baseline is the default; the choice is remembered per client in `localStorage` (every access wrapped in try/catch); a stored value for a year without a stretch is ignored.
- Migration file `supabase/migrations/0011_plan_scenarios.sql` (the number may shift if another migration lands first); applying it to the live project needs the user's confirmation.
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/01-app` before writing Next.js code (this plan edits client components only).
- Git: commit only when the user asks; each task ends with a checkpoint listing files and a suggested message.
- Tests live in `lib/**/*.test.ts`. Fixtures: `factDay` in `lib/reports/plan-pnl.test.ts`, `inputs` and `gen` helpers in `lib/planning/generate.test.ts`.

## Review Focus

1. A baseline with no saved New Customer or Returning model, or too little history to fit: Create stretch is disabled with a plain message, no crash and no half-written plan. Tested in Task 6.
2. A goal at or below the baseline: still produces a stretch and says it is not above the baseline. Tested in Task 5.
3. A goal the model cannot reach: months are flagged `unreachable` or `beyond_history` and reported, never silently capped. Tested in Task 5.
4. A year with no last-year data, or a zero last-year value: YoY shows "–", never NaN or Infinity. Tested in Task 3.
5. Home when the stretch is deleted, the year has none, or `localStorage` holds a stale or blocked value: selector hidden, Baseline used, no error. Tested in Tasks 2 and 8.
6. Regenerate with locked months: locked months keep their inputs. Tested in Task 5.

---

## File structure

- Create `supabase/migrations/0011_plan_scenarios.sql`
- Modify `lib/types.ts` (`PlanVersion`), `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`
- Create `lib/planning/scenarios.ts` (+ test): pick a plan by scenario, remembered Home choice.
- Create `lib/planning/summary.ts` (+ test): monthly figures and the YoY/MoM/share grid.
- Create `lib/planning/plan-fit.ts` (+ test): the model fit and above-model.
- Create `lib/planning/stretch.ts` (+ test): goal, spend solver, stretch months, flags, plan months.
- Create `components/planning/stretch-actions.ts` (create and regenerate a stretch plan), `components/planning/SummaryStep.tsx`; modify `components/planning/PlanEditor.tsx`, `PlanList.tsx`, `PlanSettingsDialog.tsx`.
- Modify `lib/dashboard-data.ts`, `components/Dashboard.tsx` (Home selector).
- Modify `docs/changelog.md`, `docs/planning-layer.md`, `CLAUDE.md` (one line).

---

### Task 1: Scenario fields on plan versions

**Files:**
- Create: `supabase/migrations/0011_plan_scenarios.sql`
- Modify: `lib/types.ts`, `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`

**Interfaces:**
- Produces in `lib/types.ts`: `type PlanScenario = "baseline" | "target"`; `interface StretchGoal { metric: "newRevenueGrowth" | "totalRevenueGrowth" | "totalRevenue"; value: number; cmFloor?: number; amerFloor?: number }`; `PlanVersion` gains `scenario: PlanScenario`, `baseId: string | null`, `goal: StretchGoal | null`.
- Produces on `Repository`: `createPlan(clientId, input: { name: string; year: number; description?: string; scenario?: PlanScenario; baseId?: string; goal?: StretchGoal })` (a `target` plan is never the default); `updatePlan` also saves `goal`.

- [ ] **Step 1: Write the migration.** `plan_versions` gets `scenario text not null default 'baseline' check (scenario in ('baseline','target'))`, `base_plan_id uuid null references plan_versions(id) on delete set null`, `goal jsonb null`, and `create unique index plan_versions_one_target on plan_versions (client_id, year) where scenario = 'target'`. Additive only.
- [ ] **Step 2: Extend the types and the repository.** `toPlan` in `supabase.ts` maps the three columns (missing column or null gives `baseline`, `null`, `null`); `createPlan` writes them and sets `is_default` false for a target plan; `updatePlan` writes `goal`. The seed repository holds the same fields in memory. `lib/types.ts` changes compile everywhere `PlanVersion` is built.
- [ ] **Step 3: Verify.** `npx tsc --noEmit` and `npm test`: no errors, all pass.
- [ ] **Step 4: Ask the user to confirm applying the migration to the live project** (production data); on a yes apply with `apply_migration` (name `plan_scenarios`) and verify with `select column_name from information_schema.columns where table_name = 'plan_versions' and column_name in ('scenario','base_plan_id','goal')` (3 rows).
- [ ] **Step 5: Checkpoint.** Files: migration, types, three repository files. Message: "Add scenario fields to plan versions (migration 0011)".

---

### Task 2: Pick a plan by scenario

**Files:**
- Create: `lib/planning/scenarios.ts`
- Test: `lib/planning/scenarios.test.ts`

**Interfaces:**
- Produces: `pickPlan(plans: PlanVersion[], year: number, scenario: PlanScenario): PlanVersion | undefined` (baseline = the default plan for the year, falling back to any default, then the first plan, exactly as `useDashboardData` does today; target = the `target` plan of the year, else the baseline); `stretchOf(plans: PlanVersion[], year: number): PlanVersion | undefined`; `readScenarioChoice(clientId: string, storage?: Pick<Storage, "getItem">): PlanScenario`; `writeScenarioChoice(clientId: string, scenario: PlanScenario, storage?: Pick<Storage, "setItem">): void` (key `apex.scenario.<clientId>`; default `baseline`; every access in try/catch).

- [ ] **Step 1: Write the failing tests:** with plans `[A default 2026 baseline, B 2026 baseline non-default, C 2026 target, D default 2025 baseline]`: `pickPlan(plans, 2026, "baseline")` is A; `pickPlan(plans, 2026, "target")` is C; for 2025 `pickPlan(plans, 2025, "target")` is D (no stretch, falls back); for 2027 `pickPlan(plans, 2027, "baseline")` is the default of any year (D or A as today's fallback); `stretchOf(plans, 2026)` is C and `stretchOf(plans, 2025)` is undefined; `readScenarioChoice` returns `baseline` for missing, unknown or throwing storage and `target` when stored; `writeScenarioChoice` with a throwing storage does not throw.
- [ ] **Step 2: Run** `npx vitest run lib/planning/scenarios.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the four functions in `lib/planning/scenarios.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: both. Message: "Add plan scenario picking".

---

### Task 3: Summary figures and grid

**Files:**
- Create: `lib/planning/summary.ts`
- Test: `lib/planning/summary.test.ts`

**Interfaces:**
- Consumes: `PlanTargetDay`, `DailyFact`, `ClientSettings` (`lib/types`); `PlanMonth` (`./types`); `aggregate`, `cmParts`, `amerSpend`, `totalSpend`, `orderRevenue` (`../metrics`); `RETENTION_CHANNELS` (`../channels`).
- Produces: `interface MonthFigures { month: string; spend: number; acqSpend: number; amer: number | null; newRevenue: number; returningRevenue: number; totalRevenue: number; cm: number; opex: number; ebitda: number }`; `planFigures(rows: PlanTargetDay[], months: PlanMonth[], year: number, s: ClientSettings): MonthFigures[]` (twelve entries, January first); `actualFigures(facts: DailyFact[], year: number, s: ClientSettings): MonthFigures[]`; `type SummaryKey = "spend" | "amer" | "newRevenue" | "returningRevenue" | "totalRevenue" | "cm" | "opex" | "ebitda"`; `interface SummaryRow { key: SummaryKey; label: string; format: "currency0" | "ratio2"; months: { value: number | null; lastYear: number | null; yoy: number | null; mom: number | null; share: number | null }[]; total: { value: number | null; lastYear: number | null; yoy: number | null } }`; `buildSummaryGrid(current: MonthFigures[], lastYear: MonthFigures[]): SummaryRow[]` (rows in the order of the constraint; `share` only for spend, newRevenue, returningRevenue, totalRevenue).

- [ ] **Step 1: Write the failing tests** (a plan year of daily rows built with `generateMonth` for two months plus blank months, and a `factDay` year of actuals): `planFigures` sums rows per month (`spend`, `newRevenue`, `returningRevenue`, `totalRevenue = new + returning`, `cm` equal to the sum of the rows' `cm`), `opex` is the month's `fixedCosts` when set and `settings.monthlyFixedCosts` otherwise, `ebitda = cm - opex`; acquisition spend leaves out `google_brand` and every `*_returning` channel only when the matching setting is on, so `amer = newRevenue / acqSpend` changes with the setting while `spend` does not; `actualFigures` agrees with `cmParts(aggregate(monthFacts), s).cm` and `amerSpend`; `buildSummaryGrid`: YoY is `value / lastYear - 1`, `null` when last year is 0 or missing; MoM for January compares with last year's December, otherwise with the previous month, `null` when the previous value is 0; shares of a row sum to 1 over months with data and are `null` when the year total is 0; the total column sums flows and recomputes aMER as total new revenue over total acquisition spend; a month with no plan shows `null` values, not zero.
- [ ] **Step 2: Run** `npx vitest run lib/planning/summary.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the functions. `acqSpend` for a plan day uses `spendByChannel` with the same exclusions as `amerSpend`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: both. Message: "Add forecast summary figures and grid".

---

### Task 4: Fit and above-model

**Files:**
- Create: `lib/planning/plan-fit.ts`
- Test: `lib/planning/plan-fit.test.ts`
- Modify: `components/planning/models/NewCustomerModel.tsx` (use `fitPlanModel` for its main fit)

**Interfaces:**
- Consumes: `fitNewCustomerModel`, `curveAmer`, `Curve`, `FitResult`, `monthlyAmerIndex`, `DayPoint` (`./new-customer`); `BEYOND_GAMMA`, `NewCustomerSettings` (`./models`); `amerSpend`, `aggregate` (`../metrics`).
- Produces: `fitPlanModel(facts: DailyFact[], settings: ClientSettings, dow: number[], s: Pick<NewCustomerSettings, "fitKind" | "beyondHistory" | "actualizeFrom" | "recentWeight">): FitResult | null` (builds the day points exactly as the model screen does and fits with `kind: s.fitKind`, `recent` from `actualizeFrom` and `recentWeight`, `guard: BEYOND_GAMMA[s.beyondHistory ?? "standard"]`); `seasonIndex(fit: FitResult, month: string): number` (monthly index of `monthlyAmerIndex(fit.used, fit.curve)`, 1 when none); `aboveModelPct(planAmer: number | null, monthlyAcqSpend: number, days: number, curve: Curve, seasonIdx: number): number | null` (plan aMER over `curveAmer(curve, monthlyAcqSpend / days) * seasonIdx`, minus 1, as a percentage; null when either is zero or missing); `isStretchMonth(aboveModel: number | null, overModelPct: number): boolean`.

- [ ] **Step 1: Write the failing tests:** on a synthetic history (reuse the `synthetic` generator pattern in `lib/planning/new-customer.test.ts`) `fitPlanModel(...)` returns the same curve as calling `fitNewCustomerModel` directly with the same options; `aboveModelPct` is `0` when the plan aMER equals the model value, `+10` when 10% above, `null` for zero spend or a null aMER; `isStretchMonth(12, 11.8)` is true, `isStretchMonth(11.8, 11.8)` false, `isStretchMonth(null, 5)` false; `seasonIndex` returns 1 for a fit with no seasonal data.
- [ ] **Step 2: Run** `npx vitest run lib/planning/plan-fit.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `lib/planning/plan-fit.ts`, then change the model screen's `points` and `fitWith(null/recent)` to call `fitPlanModel` so the two cannot drift (behavior unchanged).
- [ ] **Step 4: Run** `npx vitest run lib/planning` and `npx tsc --noEmit`. Expected: PASS, no errors.
- [ ] **Step 5: Checkpoint.** Files: new module, test, `NewCustomerModel.tsx`. Message: "Share the New Customer fit and add above-model".

---

### Task 5: Stretch solver

**Files:**
- Create: `lib/planning/stretch.ts`
- Test: `lib/planning/stretch.test.ts`

**Interfaces:**
- Consumes: `evaluateSpend`, `Curve`, `ModelSettings` (`./new-customer`); `MonthFigures` (`./summary`); `PlanMonth`, `PlanMonthInputs` (`./types`); `acqShare` (`./models`); `StretchGoal`, `ClientSettings` (`../types`).
- Produces: `spendForRevenue(curve: Curve, s: ModelSettings, targetRevenue: number, days: number, seasonIdx: number, maxMonthlySpend: number): { spend: number; reached: boolean }` (bisection on `evaluateSpend(...).newRevenue`, monotone in spend; `reached` false when even `maxMonthlySpend` falls short, then `spend` is `maxMonthlySpend`); `type StretchFlag = "beyond_history" | "cm_negative" | "cm_below_floor" | "amer_below_floor" | "unreachable"`; `interface StretchMonthInput { month: string; days: number; locked: boolean; seasonIdx: number; model: ModelSettings; baselineNewRevenue: number }`; `interface StretchMonth { month: string; newRevenue: number; acqSpend: number; amer: number; returningRevenue: number; flags: StretchFlag[] }`; `interface StretchRequest { goal: StretchGoal; months: StretchMonthInput[]; lastYearNewRevenue: number; lastYearTotalRevenue: number; curve: Curve; maxMonthlySpend: number; returningFor: (newByMonth: Record<string, number>) => Record<string, number>; cmFor: (m: { month: string; newRevenue: number; returningRevenue: number; acqSpend: number }) => number }`; `buildStretch(req: StretchRequest): { months: StretchMonth[]; reachable: boolean; aboveBaseline: boolean; annualNewRevenue: number; message: string }`; `stretchPlanMonths(base: PlanMonth[], stretch: StretchMonth[], settings: ClientSettings): PlanMonth[]` (copies each base month's inputs and, for unlocked months with a stretch result, sets `spend = round(acqSpend / acqShare(inputs, settings))`, `amer = round(amer, 3)`, `returningRevenue`, `returningModel` and `returningOverride: null`; locked months are copied unchanged; status `in_progress`).

- [ ] **Step 1: Write the failing tests** (a linear revenue curve `{ kind: "revenue", a: 0, b: 2, r2: 1 }` so revenue = 2 x spend and aMER 2, a `ModelSettings` with zero over-model, 30-day months): `spendForRevenue` returns spend 50,000 for a 100,000 target, `reached: false` with the cap as spend when the target is above `2 x maxMonthlySpend`; `buildStretch` with `newRevenueGrowth: 20` and a 12-month baseline whose new revenue shares follow `[1,1,1,1,1,1,1,1,1,1,2,3]/15`: the annual new revenue is `lastYearNewRevenue x 1.2`, each month's `newRevenue` equals that annual figure times its baseline share, and `acqSpend` is half the month's new revenue on the linear curve; with `totalRevenueGrowth` and a `returningFor` that returns 0.5 x the month's new revenue, the solved total over the year is within 0.5% of the goal and the bisection stops in at most 40 iterations; a goal at or below the baseline gives `aboveBaseline: false` and a message saying so; a target above what the cap allows gives `reachable: false` and `unreachable` flags on the affected months and never changes their spend beyond the cap; `cm_negative` and `cm_below_floor` come from `cmFor`, `amer_below_floor` from `amerFloor`; `beyond_history` is set only when the curve has `guard.s0` and the month's acquisition spend is above `30 x s0`; `stretchPlanMonths` keeps a locked month byte for byte, writes the rounded spend divided by `acqShare`, and sets `returningOverride` to null.
- [ ] **Step 2: Run** `npx vitest run lib/planning/stretch.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the module. Month shape uses `baselineNewRevenue` shares; locked months are excluded from the solve and keep their baseline numbers inside the annual sums.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: both. Message: "Add the stretch scenario solver".

---

### Task 6: Create and regenerate a stretch plan

**Files:**
- Create: `components/planning/stretch-actions.ts`
- Modify: `lib/planning/scenarios.ts` (small pure helper `stretchName`)
- Test: `lib/planning/scenarios.test.ts` (add)

**Interfaces:**
- Consumes: Tasks 1 to 5; `getRepository()`; `generateMonth` (`@/lib/planning/generate`); `forecastReturning`, `ReturningInput` (`@/lib/planning/returning`); `PlanCtx` (`./ctx`).
- Produces in `stretch-actions.ts`: `type StretchPreflight = { ok: true; fit: FitResult; ret: ReturningInput; newSettings: NewCustomerSettings } | { ok: false; reason: string }`; `loadStretchInputs(ctx: PlanCtx): Promise<StretchPreflight>` (reads the baseline's saved `new_customer` and `returning` models and the cohort data; every missing piece gives a plain `reason`: "Save the New Customer Model first", "Build the cohorts and save the Returning Model first", "Not enough history to fit the model"); `createStretch(ctx: PlanCtx, goal: StretchGoal): Promise<{ plan: PlanVersion; message: string }>` (creates the `target` plan named by `stretchName`, saves its twelve months and daily rows with the baseline's seasonality and `ctx.eventMults`, saves the goal, logs "Created stretch scenario"); `regenerateStretch(ctx: PlanCtx, stretch: PlanVersion): Promise<{ message: string }>` (same, for the unlocked months of the existing stretch from its stored goal). In `scenarios.ts`: `stretchName(baselineName: string): string` returns `"<name> (stretch)"` and does not stack the suffix.

- [ ] **Step 1: Write the failing test** for `stretchName("2026 Plan")` is `"2026 Plan (stretch)"` and `stretchName("2026 Plan (stretch)")` is unchanged.
- [ ] **Step 2: Run** `npx vitest run lib/planning/scenarios.test.ts`. Expected: FAIL on `stretchName`.
- [ ] **Step 3: Implement `stretchName`**, then `stretch-actions.ts`. Preflight failures return before anything is written; `createStretch` creates the plan row last, after every month is built, and deletes it if saving the months fails (no half-written plan). The module has no unit test of its own because it only wires tested pure functions to the repository; it is verified in Task 9.
- [ ] **Step 4: Run** `npx vitest run lib/planning/scenarios.test.ts` and `npx tsc --noEmit`. Expected: PASS, no errors.
- [ ] **Step 5: Checkpoint.** Files: `stretch-actions.ts`, `scenarios.ts`, its test. Message: "Create and regenerate stretch plans".

---

### Task 7: Summary tab

**Files:**
- Create: `components/planning/SummaryStep.tsx`
- Modify: `components/planning/PlanEditor.tsx` (new step), `components/planning/PlanList.tsx` (scenario badge), `components/planning/PlanSettingsDialog.tsx` (stretch plans cannot be made default)

**Interfaces:**
- Consumes: Tasks 1 to 6; `PlanCtx`; `ReportTable`-style grid helpers are not reused (the grid is its own table).
- Produces: `SummaryStep(props: { ctx: PlanCtx }): JSX.Element`.

No component test infrastructure exists, so this task is verified by type check, lint, build and a seed-mode visual check.

- [ ] **Step 1: Add the step.** In `PlanEditor.tsx` insert `{ id: "summary", label: "Summary" }` right after the Overview step and render `<SummaryStep ctx={ctx} />` for it.
- [ ] **Step 2: Implement `SummaryStep`.** Top bar: scenario switcher **Baseline | Stretch | Compare** (Stretch and Compare disabled with a hint when the year has no stretch), basis toggle **Plan | Forecast** (Forecast = actuals for months that ended on or before the last data day, plan after), and, when viewing the baseline without a stretch, a **Create stretch** form: goal type select (New revenue growth %, Total revenue growth %, Total revenue amount), value, optional CM floor and aMER floor, a button that calls `loadStretchInputs` first and shows its `reason` instead of the form when not ok. Grid: rows and columns from `buildSummaryGrid` (plan figures from `planFigures`, last year from `actualFigures` over the previous year's facts in `ctx.history`), a year total column, and under it the line "aMER here is new revenue over acquisition spend (brand search and retention spend left out per Store Settings), not over all spend". Above-model row and the "stretch" flag come from `fitPlanModel`, `seasonIndex`, `aboveModelPct` and `isStretchMonth`, using the baseline's saved `new_customer` settings (`overModelPct` per month); without a saved model the row is hidden with a note. For a stretch plan the flags from `buildStretch` are shown as small tags per month, with a summary line stating whether the goal is reachable inside the trusted range and where it breaks, and a **Regenerate** button (`regenerateStretch`). **Compare** shows baseline and stretch side by side by month for spend, new revenue, returning revenue, CM and Above model %, the gap, and for elapsed months the actuals against both. Loading the other plan's rows and months uses `repo.getPlanTargets` and `repo.getPlanMonths` on demand.
- [ ] **Step 3: Plan list and settings.** `PlanList` shows a "Stretch" pill on `target` plans next to "Default"; `PlanSettingsDialog` hides "Make default" for a target plan and says so.
- [ ] **Step 4: Verify.** `npx tsc --noEmit`, `npm run lint` (0 errors) and `npm run build` succeed; start the seed-mode dev server (`dashboard-seed`), create a demo plan, open the Summary tab and confirm the grid renders with no console errors.
- [ ] **Step 5: Checkpoint.** Files: the new component and three modified. Message: "Add the plan Summary tab with stretch creation and comparison".

---

### Task 8: Home scenario selector

**Files:**
- Modify: `lib/dashboard-data.ts`, `components/Dashboard.tsx`

**Interfaces:**
- Consumes: `pickPlan`, `stretchOf`, `readScenarioChoice`, `writeScenarioChoice` (Task 2).
- Produces: `useDashboardData(client, settings, range, customCompare, scenario?: PlanScenario)`; `DashData` gains `hasStretch: boolean` and `planScenario: PlanScenario`; a **Plan: Baseline | Stretch** select next to Compare in `Dashboard.tsx`.

- [ ] **Step 1: Wire the hook.** Replace the plan choice in `useDashboardData` with `pickPlan(plans, year, scenario ?? "baseline")`, include `scenario` in the effect key, and return `hasStretch = Boolean(stretchOf(plans, year))` and the scenario actually used (baseline when the year has no stretch).
- [ ] **Step 2: Add the selector.** In `Dashboard.tsx` keep the choice in state initialised with `readScenarioChoice(client.id)` after mount (no server/client mismatch), write it with `writeScenarioChoice` on change, render the select only when `data.hasStretch`, and label the plan line and plan compare text with the scenario ("Stretch plan" vs the plan's own name).
- [ ] **Step 3: Verify.** `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`; in the seed-mode dev server create a plan, create a stretch (Task 9 flow) and confirm the selector appears and switching changes the plan figures; with no stretch the selector is absent.
- [ ] **Step 4: Checkpoint.** Files: both. Message: "Add the Baseline | Stretch selector to Home".

---

### Task 9: Docs and live check

**Files:**
- Modify: `docs/changelog.md`, `docs/planning-layer.md`, `CLAUDE.md`

- [ ] **Step 1: Run the full checks.** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`: no errors.
- [ ] **Step 2: Update the docs:** changelog entry; a "Scenarios and Summary" section in `docs/planning-layer.md` (baseline vs target, how the stretch is generated, the flags, the Home selector); one `CLAUDE.md` line.
- [ ] **Step 3: Hand the live check to the user** after deploy and migration 0011: open a real client's baseline plan, Summary tab: CM and EBITDA per month equal the Plan P&L for the same year; Create stretch with +20% new revenue growth shows the stretch plan in the list with a Stretch pill; Compare shows the gap by month; Home shows the selector and Stretch changes the goal values and plan line; deleting the stretch plan removes the selector.
- [ ] **Step 4: Checkpoint.** Files: the three docs. Message: "Document scenarios and the Summary tab".

---

## Self-review

- **Spec coverage:** Summary grid and EBITDA (Task 3, 7); above-model and stretch flag (Tasks 4, 7); stretch from one goal with shape, solved spend, returning from the model, copied rates, flags, iteration for total goals, Regenerate keeping locked months (Tasks 5, 6); Compare (Task 7); scenario fields and one target per year (Task 1); Home selector (Tasks 2, 8); data and tests as specified; plan P&L equality (Task 3 test, Task 9 live check). Not-in-scope items are not planned.
- **Deviations from the spec on purpose:** `unreachable` is added as a flag so a goal the model cannot reach is reported rather than capped silently; `beyond_history` uses 30 times the daily 95th-percentile spend as the monthly trusted spend because the guardrail is defined on daily spend; the stretch plan has no saved models of its own (opening it in the editor shows the defaults until the strategist saves them).
- **Type consistency:** `MonthFigures`, `StretchGoal`, `StretchMonth`, `PlanScenario` and the function names are spelled the same in every task that uses them.
- **Proportion:** logic with decisions is given by signatures and test assertions; no function body is written out.

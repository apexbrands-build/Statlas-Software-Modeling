# Forecast summary and scenarios (baseline and stretch)

Date: 2026-10-12 (revised the same day after the strategist's direction). Status: draft for the strategist's review. Source: the Notepad workbook (`Agency/Training/Copy of 2_Mikokos _ Notepad 2026.xlsx`, tabs `frcst`, `frcst_yr`, `statlas_sync`, `assump`), `docs/scenarios-and-diagnostic.md`, and the planning layer in `docs/planning-layer.md`.

## Goal
Replace the spreadsheet tabs the strategist uses to judge a plan with views inside the plan editor. Nothing is typed into a spreadsheet: the baseline is the forecast the models produce, the stretch scenario is generated from the baseline and the client's goal, and both are shown month by month against last year.

## Decision (strategist, 2026-10-12)
The two scenarios are **baseline** (most likely to occur) and **stretch** (what the client wants, such as their exact goals), laid out by the seasonality of the model. They must come pre-filled from the forecast, not be input by hand, and they live in a separate view tied directly to the forecast's outputs.

## What the Notepad does (read from the workbook)
- **`frcst_yr` (top-down):** per year a spend growth % and a new revenue growth % are typed (2026: +140% and +85%), giving an implied aMER (1.74 against 2.26, a 23% efficiency drop); returning revenue comes from the cohort tab; CM = total revenue x (1 - cost of delivery %) - spend - refunds - taxes; months get typed shares of the year.
- **`frcst` (month by metric):** per month, spend, aMER, new revenue, returning revenue, total order revenue, cost of delivery, contribution profit, operating expenses and EBITDA, each with YoY %, MoM % and % of the year.
- **`statlas_sync` (two scenarios):** "Most Likely" and "Would Like", each month with spend, aMER, cost of delivery %, first-order AOV, 1-year LTV, an "Abv Model %" adjuster, a fixed channel split, returning revenue, discount, shipping and tax %.
- **`assump`:** cost of delivery, discount, refund (new and returning), shipping, tax % and new and returning AOV per month from history. The Details step already infers most of these; separate new and returning refund rates are not planned yet.

## Where it lives (recommendation)
A new **Summary** tab in the plan editor, right after Overview, with a scenario switcher at the top: **Baseline | Stretch | Compare**. Reasons: the baseline is the plan the editor already opens; the stretch is a second plan version of the same year, so it can also be opened in the full editor and edited; Home gets a scenario selector (section 5) and otherwise keeps tracking the default plan. The plan list shows each version's scenario badge.

## Design

### 1. Summary grid (any scenario)
One grid for the selected plan version and year, with a year total:
- Rows: Spend, aMER, New revenue, Returning revenue, Total order revenue, Contribution margin, Operating expenses, EBITDA.
- For each: the plan value, last year's actual for the same month, YoY %, MoM %, share of the year (spend and revenues).
- Basis toggle as in the P&L report: **Plan** (all months) or **Forecast** (actuals up to the last data day, plan after).
- Operating expenses are the plan's SG&A input; EBITDA = contribution margin - operating expenses, the same lines as the Plan P&L. The grid reuses the Plan P&L builders (`lib/reports/plan-pnl.ts`, `lib/reports/pnl.ts`) so it equals `/reporting/pnl` for the same basis.
- aMER uses the app's definition (acquisition spend only), not the Notepad's new revenue over all spend; a note under the grid says so.

### 2. Stretch against the model
For each month, **Above model %** = the plan's aMER against the aMER the saved New Customer model gives at that month's planned spend, minus 1: the Notepad's "Abv Model %" adjuster, computed instead of typed. Shown next to spend YoY % and aMER YoY %. A month is flagged "stretch" when it is above the plan's "% over model" setting (default: the 90th percentile of days against the line). It shows where the plan asks for much more spend without matching efficiency. Without a saved New Customer model the column is hidden with a note.

### 3. Stretch scenario, generated from the forecast
The only thing the strategist enters is the **goal**, as one of: new revenue growth % against last year, total revenue growth % against last year, or a total revenue amount (the client's exact goal), with an optional contribution margin floor and aMER floor. **Create stretch** then builds a second plan version (`scenario = target`, linked to its baseline) with everything else pre-filled from the baseline's outputs:
- **Monthly shape:** each month's share of the year's new revenue is the baseline's, so the model's seasonality (monthly spending power index, weekday pattern, calendar events) carries over.
- **Spend:** for each month, the spend the New Customer model needs to produce that month's target new revenue (the inverse of the curve, including the guardrail beyond observed history). The resulting aMER and CM are shown, not typed.
- **Returning revenue:** from the Returning model, fed with the stretch's new revenue (future cohorts), so it moves with the goal.
- **Everything else** (discount, shipping, tax, refund, COGS and variable cost rates, SG&A, platform split) is copied from the baseline and stays editable in the full editor.
- **Total revenue goals** are solved by iteration, because returning revenue depends on new revenue.
- **Flags** on each month: required spend beyond the range the model trusts, CM below the floor or below zero, aMER below its floor. A summary line says whether the goal is reachable inside the model's trusted range and where it breaks.
- **Regenerate** rebuilds the unlocked months from the current baseline and goal when the baseline changes; locked months are kept. Daily rows come from the usual generation, so events apply.

### 4. Compare
Baseline and stretch side by side by month (spend, new revenue, returning revenue, CM, Above model %), the gap between them, and for elapsed months the actuals against both, so it is visible where the business is short of the stretch.

### 5. Home scenario switcher (added 2026-10-12, strategist's request)
Home shows a **Plan: Baseline | Stretch** selector next to the date picker whenever the range's year has a stretch scenario (hidden otherwise). The choice changes what Home compares against: the plan targets behind the tiles' goal values, the red and green, the trend chart's plan line, and the Plan compare mode all read the selected scenario's plan. Baseline is the default, and the selection is remembered per client in the browser only. In the tile "i" trend view the plan line is labelled with the scenario. Reports that compare against the plan (Marketing Efficiency, P&L P and F) keep using the baseline unless given the same selector later. In code this extends `useDashboardData`, which today picks the default plan whose year matches the range, to take a scenario and pick the plan with that scenario for the year (falling back to the default plan).

## Data
Migration (number assigned at implementation): `plan_versions` gets `scenario text not null default 'baseline' check (scenario in ('baseline','target'))`, `base_plan_id uuid null references plan_versions(id) on delete set null` and `goal jsonb null`. One baseline and one target per client and year. Pure logic in `lib/planning/summary.ts` (YoY, MoM, shares, above-model) and `lib/planning/stretch.ts` (goal, shape, solve, flags), with tests.

## Tests
YoY and MoM with a missing last year ("–"); shares sum to 100%; above-model is zero when the plan sits on the model line; the stretch's monthly new revenue sums to the goal and follows the baseline's shares; solved spend reproduces the target new revenue on the model; a total revenue goal converges; an unreachable goal is flagged, not silently capped; locked months survive Regenerate; Summary CM and EBITDA equal the Plan P&L for the same year; Home picks the stretch plan's targets when Stretch is selected, falls back to the default plan when the year has no stretch, and hides the selector then.

## Not in scope
Channel allocation (`2026-10-12-channel-mix-design.md`), a scenario selector inside the P&L and Marketing Efficiency reports, MMM, per-channel scenarios, opex cost centers.

## Done when
For a client with a baseline plan, the Summary tab shows the grid with the stretch column, Create stretch builds the stretch version from a goal alone, Compare shows the gap, Home can be switched between Baseline and Stretch, and the numbers equal the Plan P&L.

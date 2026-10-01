# Planning layer (plans, targets, Plan P&L)

Where: `/planning` (plans list) and `/planning/<planId>` (editor). Phases A and B built 2026-10-01. Later phases at the bottom.

## How it works
A **plan** is one version for one client and year. One plan per client and year is the **Default**; Home and the reports compare against it (`useDashboardData` picks the default plan whose year matches the range). The strategist types **monthly inputs**; a deterministic function (`lib/planning/generate.ts`) turns them into **daily rows** in `plan_targets`, which Home and the reports already read. No statistics in A and B.

Monthly inputs (`plan_months.inputs`, jsonb, type `PlanMonthInputs`): spend, aMER, returning revenue, platform % split, brand / non-acquisition % per platform, rates (discount, shipping, tax, refund, COGS, other variable costs, new and returning AOV), fixed costs (SG&A, only in the Plan P&L), optional fixed daily values.

Daily generation per month:
- Weekday weight = 1 + that weekday's offset x strength. Spend and returning revenue are spread over the days by these weights; a day with a fixed value keeps it and the other days absorb the difference.
- New revenue = acquisition spend x aMER (aMER keeps the dashboard definition: brand and Meta returning excluded when the client settings say so), so aMER is constant on free days (same as Statlas).
- Order revenue = new + returning. With b = gross - discounts: shipping = s*b, tax = t*b, refunds = r*b, order revenue = b*(1+s+t). Net sales = b - refunds.
- **CM = Net Sales + Shipping - COGS - Ad spend - Cost of delivery** (COGS = % of net sales, cost of delivery = % of net sales + shipping plus per-order cost). Identical to `cmParts`; a test fills a month from actuals and checks it reproduces the real CM within 1%.
- Platform split: fixed per month. Google alt = Brand, other platforms alt = non-acquisition (`*_returning` channels).

## Weekday pattern (from Shopify)
`dowFromHistory` (`lib/planning/history.ts`): last 12 months of order revenue, per weekday drop Black Friday week and days more than 2 standard deviations from that weekday's mean, average, offset = weekday average / mean of the 7 averages - 1 (offsets sum to ~0). Needs 8 weeks of data. Stored on the plan (`seasonality`), editable with sliders, "Recalculate", "Flat". Verified against Statlas: its offsets also sum to zero.

## Filling a month
"From last year" (same month, optional growth % on spend and returning), "From last 3 months", "From actuals", "Blank". Copies spend split, aMER, rates, AOVs and fixed costs from real data (`inputsFromFacts`). "Actualize elapsed months" fills every elapsed month from actuals. Locked months are never changed.

## Editor steps
1 Monthly plan (year grid) - 2 Spend & days (month detail, platform sliders with locks, weekday pattern, daily table with fixed days) - 3 Returning revenue (per month vs last year; this is the override column until the cohort model exists) - 4 Daily input (final rows, CSV) - 5 Plan P&L (draft). Nothing changes until **Save plan**. Plan settings (gear on the card): name, description, make default, lock and status (in progress / final) per month, change log, delete.

## Plan P&L and Forecast
`lib/reports/plan-pnl.ts`: plan days are converted to actual-shaped days so `buildPnl` renders actual, plan and forecast with the same lines. `/reporting/pnl` Compare to: **A** actual, **P** plan (all months), **F** actuals up to the last data day plus plan for the rest. Plan columns use the plan's own COGS and cost of delivery; SG&A comes from the plan (client setting for elapsed months in F). Paid vs Organic and the ad-performance blocks are not planned (hidden / replaced in P and F).

## Data
Migration `0004_planning_layer` (applied): `plan_versions` (+year, description, seasonality, updated_at/by, one default per client+year), `plan_targets` (+tax, cogs, cost_of_delivery), `plan_months`, `plan_changes`, plus insert/update/delete RLS policies (`has_client_access`) so the browser can save. Repository: `createPlan`, `updatePlan`, `deletePlan`, `setDefaultPlan`, `getPlanMonths`, `savePlanMonths` (replaces the month's daily rows), `getPlanChanges`. Seed mode keeps plans in memory only.

## Not built yet (next phases, ask before starting)
- C: returning revenue from cohorts (docs/forecasting-context.md method) filling step 3.
- D: aMER-vs-spend model (port of Jack-7xyz/aMER_ModelV2) suggesting spend/aMER, Max CM / Max Revenue points.
- E: per-campaign daily targets and iROAS for the Facebook/Google trackers.
- Later: event-effect model, marketing calendar from Klaviyo/SMS, MMM, email/SMS/organic lines.
- Known gaps: saving writes month inputs and daily rows in separate calls (not one transaction); live-Supabase save is untested because it needs a login (RLS policies are in place); plan decimals show without thousands separators in the input boxes.

# Forecasting context (from the growth strategist, 2026-09-29)

Owner's own words, condensed. Use this as the source of intent when the forecasting layer is built. **Current priority is the visualization dashboard, not forecasting.**

## Purpose of the forecast

- Not to predict exactly. It is **baseline guidance** for daily execution and a **shared source of truth** between the agency's growth operators and the client. Both look at the same expectations.
- Client conversation it supports: "You want to grow X% YoY. Here's what a statistical model says is likely on the current trend. Here's the spend needed to change that."
- The **spend / aMER forecast is adjustable on purpose**. The strategist can "break the model" by changing strategy (creative, funnel, spend power) and set a *modelled bet* on how much a brand should spend against its business objectives.
- It also translates incrementality benchmarks into how channel-level performance should correlate with aMER and MER.
- Variable costs should be in the forecast so the bottom line (contribution margin) is realistic. Infer discounts, shipping, taxes and returns from Shopify, using **year-over-year** comparisons (Q4 usually has bigger discounts). Statlas shows YoY for every metric; the dashboard needs YoY too.
- Optional: SG&A/opex lines in the plan (Statlas supports this in the last planning step).

## Who built what in Statlas

- **New-revenue model** (aMER/CAC vs spend regression): built by a data-science team. Apex doesn't know how it was uploaded to Statlas. Apex will not hire data scientists.
- **Returning-revenue forecast**: Apex's strategist has a **git repository** with a spend/AOV/ATR regression and the cohort method below. It was done manually in a spreadsheet, now to be code. Location/details to be shared when we get to forecasting. Repo is **not** yet in this project.
- Apex does **not** understand Monte Carlo/OLS internals; explain modelling choices simply and keep them inspectable.

## Returning-revenue method (their manual process, to be automated)

1. Pull cohort data by **acquisition month** from the Statlas report *Revenue Over Time (Advanced)* (`/reporting/legacy?report=RevenueOverTimeAdvanced`; filterable, "Group By: Margin By Customer", columns: Acquisition Month, New Customers, Weighted CAC, COGS+COD, First-Order Margin, then revenue by period since first order).
2. Define a **pre-cohort** and a **post-cohort**:
   - **Post-cohort (recent, e.g. last 4 years of a 10-year business):** keep each monthly cohort separate with its actual maturity curve (incremental revenue lift % by month since acquisition).
   - **Pre-cohort (older years):** sum all old cohorts into one lump of revenue over time. Decay past ~1 year is near 0.001%, so old cohorts add little statistically.
3. Expected returning revenue = for each cohort, the **average of all cohorts' incremental lift %** at each month of age × that cohort's first-order revenue, summed across cohorts (recent actual cohorts plus modelled future cohorts).
4. **Stabilise the baseline**: remove spike days in daily returning revenue that were driven by marketing-calendar events before fitting, so the baseline isn't distorted. (Events are then modelled separately by the event-effect layer.)

## Other revenue sources (later, "more advanced")

Email, SMS and organic revenue lines exist in the planning Details step. The strategist usually leaves these blank and only forecasts totals. Worth building later, not now.

## Build order

1. **Visualization dashboard** (home tiles, "i" trend charts, YoY comparison, store/cost settings). This is what the agency needs now, as its own operating data tool (not Triple Whale).
2. Plan targets (manual/CSV) → red/green.
3. Forecasting layer, reusing the strategist's git repo where possible.

## Observed in the Revenue Over Time report (partial)

The page loaded with only the current month's cohort (2,110 new customers, weighted CAC £58.12, COGS+COD 28.6%, first-order margin -£9.67) because the date range was 9/1–9/28. I did not widen the range, so the period columns and cohort curves are **not observed**. Controls seen: Back, Group By dropdown, export/link/refresh icons, Parameters button.

## Reference: aMER_ModelV2 (new-revenue forecast, user's repo)

`github.com/Jack-7xyz/aMER_ModelV2`: lightweight C pipeline (make/gcc, `config.yaml`). Input: `daily_raw.csv` [date, spend, aMER] (max 1000 rows) and `dowe_raw.csv` [day of week, discounted sales] for day-of-week multipliers. It applies day-of-week adjustment, filters outliers (IQR or z-score, Scott's-rule bucketing), then fits two linear regressions: **adjusted aMER vs spend** (slope, intercept, R²) and **revenue vs spend** (intercept = implied revenue at $0 spend, i.e. "true" organic). Output: plot data + HTML report. To port later into the app as a service, keeping the same inputs.

## Marketing calendar / events (future feature)

- Past events: infer from Klaviyo campaign sends (about 2 years, no fixed window) and SMS sends (Postscript, Omnisend, etc.). Statlas currently needs a manual marketing-calendar sheet per client.
- Future events: a register where the team records every initiative (promos, launches, new creatives, new funnels, tests). Even small actions are logged because they change the business trajectory. It will need to become an SOP; not every client will comply.
- Feeds the event-effect model. Schema table `marketing_events` is already in the migration draft.

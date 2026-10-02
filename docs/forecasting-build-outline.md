# Forecasting layer: build outline (draft for approval, 2026-10-02)

Status: **proposal, nothing below is built yet** unless marked "built". Follows the Statlas editor order (screenshots in `Statlas Original UX/Forecasting and Calendar Layer/`): **Models (New Customer, Returning Customer, Event) → Spend → Details → Input → P&L.** Sources of intent: `docs/forecasting-context.md`, `docs/planning-layer.md`, Jack's repo `aMER model V2 - Jack` (reviewed 2026-10-02).

Principles
- Models only describe the client's own history (the baseline). The strategist then places a bet on top (spend, % over model, overrides).
- Use **all history since store inception** by default. Minimum for a good forecast is 2 years (needed for monthly seasonality); fewer years still run but show a "low history" warning.
- Every number a model produces can be overridden by hand, and locked months are never touched.
- One data source for everything: `daily_facts` (the same daily spend, new revenue and aMER the Marketing Efficiency report reads).

---

## 1. New Customer Model (spend vs aMER)

### 1.1 Method (changed to follow Jack's code, `src/main.c`)
Jack's pipeline actually fits **revenue vs spend** (not aMER vs spend), and derives aMER from it:
1. Per day: `adjusted aMER = aMER × weekday multiplier` (weekday pattern from revenue share, already built in `lib/planning/history.ts`).
2. Outlier filter (Jack's actual code): split days into spend buckets (Scott's rule, 5-20 buckets), keep only days whose adjusted aMER is within ±1σ of their bucket's mean. We also keep BFCM-week removal and event-day removal (Event model). IQR stays as an option.
3. Linear OLS: `adjusted revenue (= spend × adjusted aMER) = slope × daily spend + intercept`. R² is measured on revenue.
4. Model aMER at any daily spend D: `aMER(D) = (slope × D + intercept) / D`. The **intercept is the implied revenue at $0 spend** (organic/"true baseline"), shown on the page. The slope is the marginal return of each extra $.
5. Our power-curve ("flattening") option stays as an alternative; "best fit" compares R² on the same basis.

### 1.2 Spend table and max points
Monthly spend = daily × days in the month (Jack uses a flat 30; we use real days). Per row: spend, aMER, CAC, incremental aMER/CAC, orders, new revenue, CM, 60-day and 1-year revenue and CM.
Marker rows:
- **Max CM** (first-order payback)
- **Max 60-day CM**
- **Max 1-year CM** (replaces Statlas's "Lifetime")
- **Max Revenue at break-even** (new): the highest new revenue where CM ≥ 0 (Jack's "Max nRev B/E"). Replaces the current unconstrained "Max Revenue".
- Optional minimum CM limits (Statlas feature, already built) still constrain the CM markers.
- Rows beyond the highest spend seen in history are marked "extrapolated".
Cost % applied to revenue = last 30 days by default (COGS, delivery, returns, tax); LTV multipliers from our cohorts (Jack hardcodes 30% / 100%).

### 1.3 The curve chart (what you see on the page)
Scatter of aMER vs monthly spend with the fitted line, as in Statlas. Point colours:
- grey: all historical days used in the fit
- **orange: the same month last year** (and optionally two years ago)
- **light blue: the current month so far**
- dropped days shown faint (outliers, BFCM, event days) with a toggle
- the **selected spend** point, and **Max CM / Max 60-day / Max 1-year / Max revenue B/E** markers on the line
- "% over model" line (dashed) above the fitted line
Hover shows date, spend, aMER, adjusted aMER.

### 1.4 Seasonality of spending power (monthly)
Jack's repo only does **weekday** adjustment; it has no monthly seasonality, so this part is ours:
- The curve is fitted on weekday-adjusted, event-cleaned days, so it describes "normal" efficiency.
- A **monthly seasonal index** per calendar month = average of (actual adjusted aMER ÷ fitted aMER) over past years for that month (needs ≥ 2 years; shrunk toward 1.0 with few years). It scales the curve up or down in each plan month, so Q4 or a slow summer changes what a given spend returns.
- The spend table and Max markers are therefore **per month** (each month has its own table, as now), and the page shows the index with the years behind it.
- BFCM is handled as an event (section 3), not folded into November's index.

### 1.5 Data feed and "Create forecast" button
- Input data: per day `spend counted toward aMER` and `new revenue` from `daily_facts` for the **whole history** (today the planning history loader only loads from last year; it will be extended to inception, in chunks).
- Button **"Create forecast"**: for every unlocked plan month it sets spend and aMER from the model, using a starting rule the strategist picks. **Default: Max CM.** Others: *last year + growth %*, *Max 60-day CM*, *Max 1-year CM*, *Max revenue B/E* (a more aggressive growth scenario). The result is written into the plan months (existing "Save Model" path), and Save plan generates the daily targets.
- **Actualize** (built): recent days count ×N so a curve that moved is picked up; before/after preview.
- **Backtest** (new): refit using only data up to a past date, predict the following months, compare to actuals, show the error. This is the "forecast the past" check.

---

## 2. Returning Customer Model (cohorts)

Built and committed. Revisions agreed:
- Cohorts by acquisition month **since store inception** (all stored orders, migration 0007 `rebuild_cohorts`, still to be applied).
- Lift curve per cohort age (30-day periods): average of the latest N cohorts (default: all post-cohort years), pre-history customers as one decaying lump, as in `docs/forecasting-context.md`.
- **Future cohorts**: the New Customer model's new revenue (plan months) is fed in as the first-order revenue of cohorts not yet acquired, multiplied by the same lift curve. Changing spend in section 1 therefore changes the returning forecast.
- **Event-day cleaning**: spike days from marketing events are removed before fitting, so baseline is stable (needs section 3).
- **Button "Create forecast"**: fills `returningRevenue` of every unlocked month. Details has a per-month **Override** that beats the model until cleared.
- **Actualize** (built): calibration factor from the last N months.
- **Backtest** (new): predict past months from older cohorts only and show the error.
- Calendar-month index from past years applies to returning revenue too (as built).

---

## 3. Event Effect Model + Marketing Calendar (not built)

### 3.1 What Statlas does (from the screenshots in `Event Effect Model/`)
- Events are typed per day in the Calendar (Email, SMS, Product Launch, Promotion, Influencer, PR, Seasonal, VIP Drop, holidays, Clearance, Sitewide, Gift with Purchase, Free Shipping, Restock, Black Friday, Cyber Monday...), with name, audience, segment size, promo, product, end date. Past events must be typed by hand.
- Event Effect Model page: a **category table** (N, 90% CI low/high, weighted average, median, "Recommended", Impact on aMER), a **Future Events** table and a **Past Events** table.
- Mechanics (reverse-engineered from the numbers): on an event day, `Expected Returning Revenue = New Revenue Goal × Expected Ratio`, where the ratio is returning ÷ new revenue for that event category. A second dropdown ("Normal (0 sd)", from -2.5 to +2.5 sd in 0.25 steps) shifts the expectation for aMER and for retention by standard deviations. Nothing is said about spend.
- Weaknesses we fix: spend is not modelled although event days run hotter; only the ratio and aMER are modelled, not returning-revenue lift; the sd dropdown is not something a person can judge, so most strategists leave it at 0 and the model is not connected to planning; the calendar is a separate section from the plan.

### 3.2 Our design

**One calendar, inside the plan.** The marketing calendar is a tab of the plan editor (month grid, day cells with event chips), not a separate silo. The same events also show as chips in the Spend daily table and on the Current vs Last Year chart. A standalone `/calendar` page only exists as a read view of the same data. Adding or editing an event takes two clicks from any day: type, name, end date, optional promo/discount %, product, audience, segment size.

**Getting history in fast (so the model has events to learn from)**
1. **CSV / pasted-sheet import** of the marketing calendar: template to download (date, end date, type, name, promo, product, audience, segment size), column mapping, preview, then import. Works for both past events and a planned future calendar.
2. **Suggest events from the data**: days where revenue, spend or new customers are far above their weekday baseline and no event is registered are listed ("Oct 8-10, revenue +62%, unlabelled"); one click labels them.
3. Later: Klaviyo / SMS (Postscript, Omnisend) sends fill past email and SMS events automatically.

**Event categories** grouped by how they behave, so each category gets enough events to learn from: Offers (promotion, sitewide, clearance, free shipping, gift with purchase), Launches (product launch, restock, VIP drop), Holidays and seasonal (Mother's Day, Halloween, Christmas...), Comms only (email, SMS, influencer, PR), BFCM and Cyber Week. Users can still type the finer type; it rolls up into the group.

**What we measure per past event day** (all against the baseline the New and Returning models predict for that weekday and spend, with event days excluded from those fits):
- **Spend lift**: actual spend ÷ the usual spend for that weekday (event days run hotter).
- **New revenue lift** and **aMER lift**: measured against the curve *at that day's actual spend*, so the lift is net of diminishing returns (no double counting of the extra spend).
- **Returning revenue lift**: actual ÷ expected returning revenue (also kept: the returning ÷ new ratio Statlas shows).
- **After-event dip** (days +1 to +3): pull-forward effect.

**Category table** (plain words next to every column): N events; **median** (the middle result); **average**; **range** (the 5th to 95th percentile: "in 9 out of 10 events the result fell between these two"); **Recommended** = a conservative figure (lower quartile), pulled toward the all-events average when N is small (`(n × own + 5 × all) / (n + 5)`), so one lucky event does not drive a forecast. Shown for spend, new revenue, aMER and returning revenue. Low-N categories are flagged.

**What the strategist does for a future event (replaces the sd dropdown)**
- One simple choice per event: **Conservative / Typical / Strong** = lower quartile / median / upper quartile of that category's own past results. Default Typical; BFCM defaults to its own history.
- A **side calculator** in the event panel: the comparable past events of the same category (default last 5, tick/untick) with their spend, new, returning and aMER results, and the average they give. "Use this" fills the lifts. Optional manual % override on each of the four numbers.
- The panel shows what it will do to the month before saving: extra spend, extra new and returning revenue, CM.

**How it changes the plan (hotter days, compressed others)**
1. The month's total spend is fixed by the New Customer model (the strategist's bet).
2. Event days get weight = weekday weight × category spend lift; non-event days are scaled down so the **monthly total spend stays the same**. Locked/fixed days are respected.
3. Daily new revenue = spend × curve aMER (monthly index applied) × event aMER lift.
4. Daily returning revenue = baseline returning (weekday spread) × event returning lift, with the optional dip on the following days.
5. When events overlap on a day, the strongest offer/launch/holiday event sets the lift, and comms-only events add on top only if their own history says so (no blind multiplying). Shown as a note on the day.
6. Everything is live: events change the Spend daily table, Input and P&L immediately. No separate "Save Event Model & Apply to Daily Figures" step (an "Include events" toggle compares with and without).
7. Event revenue is shown as its own layer (baseline vs event uplift).
8. Applies to returning revenue too (confirmed). Email, SMS and organic lines get the same treatment later if they are filled.

Data: table `marketing_events` (date, end date, type, group, name, promo, product, audience, segment size, source manual/csv/klaviyo/suggested, notes) and `event_effects` (per category stats, recomputed on demand). Migration to be written when building.

---

## 4. Spend step (locks the monthly targets, day by day)

Layout follows the Statlas Spend screen. Top bar: month picker, view selector, **Actualize this month**, **Actualize all months**, Save.

Per month, top to bottom:
1. **Monthly targets summary**: total spend (from the New Customer model or typed), new revenue, returning revenue, event revenue, total order revenue, aMER, MER, CM, each with last year and variance. A **Lock month** toggle freezes it.
2. **Platform allocation**: sliders with lock for Meta, Google, Pinterest, TikTok, Bing, YouTube, etc. (only platforms the client uses), donut chart, "starting point" selector (last year, last 3 months, last month). Built; keep.
3. **Brand / non-acquisition allocation**: Google brand %, Meta/Pinterest returning %, so aMER-counted spend is right. Chart of brand and non-acq % over the month. Built; keep.
4. **Seasonality**: weekday pattern from Shopify with per-day sliders and an overall strength slider (built), plus chart **Current vs Last Year** by day.
5. **Daily targets table (the lock-in)**: one row per day of the month: weekday, spend total and per platform, new revenue, returning revenue, event revenue, total order revenue, aMER, CM. Spend per day = monthly spend spread by weekday weights. Editing a day pins it (fixed) and the other days absorb the difference. **Save plan** writes these rows to `plan_targets`, which Home and the reports read for green/red.
6. Optional later: "Use Marketing Mix Model" and MMM data (Statlas buttons), not now.

---

## 5. Details step (infers the other lines)

Dropdown of lines, one monthly table each (Jan-Dec) with columns: **inferred value, last year, override (with lock)**, a total row, and a right-hand panel **Modeling Tools: Actualize All YTD**, **Extrapolate based on Date Range or Year over Year, % increase/decrease, Apply** (as in the Statlas Organic Revenue screen).
Lines:
- **Discounts, Shipping, Taxes** (% of gross sales / order revenue)
- **New-customer returns and Returning-customer returns** (% of the respective revenue)
- **COGS** (% of net sales; Point6-type clients use the flat rate from Edit)
- **Variable costs / cost of delivery** (% of net sales + shipping, plus per-order cost)
- **SG&A** (cost centers as rows: name, method, value, per-month inputs; "Add row"; only used in the Plan P&L)
- **Email revenue, SMS revenue, Organic revenue** (optional, blank by default; strategists usually forecast totals only)
- **ROAS** by platform (from incrementality settings)
Inference rule (default): **same month last year** from Shopify actuals (YoY, so Q4 discounts are right), falling back to the trailing 90 days when the client has no last-year data for that month. Source selector per line: last year, last 3 months, YTD, date range, manual. Event months can use the matching event's last-year values.

---

## 6. Input and P&L

- **Input**: the final daily grid with every line (spend, per platform, new, returning, event, other revenue, discounts, shipping, taxes, returns, COGS, variable costs, CM), editable per cell, CSV import/export. Built in part (`InputStep`); extended with the new lines.
- **P&L**: Plan and Forecast (actuals up to the last data day + plan) in `/reporting/pnl`, built; gets the new lines (returns split, SG&A cost centers, event revenue).
- Home and reports keep reading `plan_targets`.

---

## Build order (each step committed on its own)
1. Apply migration 0007 (user, in Supabase SQL editor); extend history loading to inception.
2. New Customer model → Jack's method, B/E marker, colour-coded curve chart, monthly seasonality, Create forecast, backtest, tests that reproduce Jack's slope/intercept on a sample file.
3. Returning model: Create forecast button, backtest, event cleaning hook.
4. Calendar + Event model.
5. Restructure editor to Models, Spend, Details, Input, P&L; Spend daily table.
6. Details lines and tools.

## Decisions (user, 2026-10-02)
- Events affect returning revenue as well as new revenue.
- Max Revenue = **break-even version, same as Jack's code** (CM >= 0 on the first order: `CM0 >= 0`).
- "Create forecast" defaults to **Max CM**; "last year + growth %" is one click away (growth % input). The strategist can pick a more aggressive point (60-day CM, 1-year CM, revenue at break-even).
- No sample CSVs exist: the port is verified by compiling Jack's C code and running it on generated daily and weekday files, then comparing slope, intercept and table rows with our TypeScript.

## Open questions
1. Overlapping events on one day: strongest event wins, comms-only add on top only if history supports it (proposed). OK?
2. Event categories grouped as Offers / Launches / Holidays and seasonal / Comms only / BFCM and Cyber Week (proposed). OK?

# Halo layer: blended aMER, whole-business ROAS targets and other sales channels

Date: 2026-11-20, revised 2026-11-23 (v2). Status: build approved by João on 2026-11-23. Sources: CTC's "Omni System" episode (2026-11-19), the CTC Canon notes on measurement and forecasting, the omnichannel cascade plan (kept outside this repo), and the planning layer as it stands today.

Changes in v2, all asked for by João: retention ads in the grid, the retail piece, data intake, a section on what happens to reporting, and the build order.

## Goal
Let the plan set the acquisition budget on what ads return to the whole business, not to .com alone. .com aMER stays the number tracked every day. Other sales channels (Amazon, TikTok Shop, retail) get a place in the plan, so their forecasts and actuals can be fed in.

## Why
Ads create demand that is bought on .com, on Amazon, on TikTok Shop and in stores. The model counts only the .com part today. So it stops spending too early, and it holds every ad channel to the same .com bar even when one channel sends far more buyers elsewhere. First use: a brand that sells on its own site, on Amazon, on TikTok Shop and in retail.

## How the app works today
- **Factor per ad channel.** `ClientSettings.multipliers` (column `client_settings.multipliers`), edited in Store Settings > Edit > "Incrementality (iROAS)". Platform-reported revenue × factor = incremental .com revenue.
- **ROAS target.** `suggestedRoas(amer, factor)` in `lib/planning/roas.ts`: the month's aMER ÷ the channel's factor. Retention channels get no target.
- **Budget.** `evaluateSpend` and `buildSpendTable` in `lib/planning/new-customer.ts`: spend → aMER → new revenue → CM and 60/90/365-day CM, with the "Max" markers. The chosen month saves `spend` and `amer` into `PlanMonthInputs`.
- **Other sales channels.** Shopify orders on a non-DTC channel are stored (`orders.sales_channel`, `is_dtc = false`) but left out of `daily_facts` and the cohorts. Amazon and retail sales outside Shopify are not in the app.

## Approaches
| | Approach | Trade-off |
|---|---|---|
| A (picked) | Extend the factor settings into a grid (ad channel × sales channel) and run the existing model and ROAS targets on it | Small, reuses what exists, no connectors needed to start. The factors are typed, so their quality depends on the tests behind them |
| B | Full multi-channel forecast: Amazon and TikTok Shop connectors, their own models, a halo regression inside the app | Complete, but months of work, blocked on data access, and a web app is the wrong place to estimate factors |
| C | Keep the app .com-only; adjust aMER targets by hand from a spreadsheet | No build, but targets drift from the model, nothing is traceable, and no screen can show the blended view |

A is designed so the pieces of B attach later.

## Design

### 1. Concepts
- **Sales channel:** where the order is bought. `.com` is the DTC channels. The others (Amazon, TikTok Shop, Retail, or a custom one) are defined per client.
- **Driver:** what creates demand. The drivers are the app's ad channels: the acquisition channels, and the retention channels (ads aimed at existing and churned customers). Drivers that live on another sales channel (Amazon Ads, GMV Max, creators) come later; the data shape already allows them.
- **Halo factor:** incremental revenue on another sales channel per $1 of revenue the ad platform reports. It has the same unit as today's factor, so the two add up: **total factor = .com factor + the channel's halo factors**.

This is a grid, not a loop: drivers in the rows, sales channels in the columns. "TikTok Shop moves Amazon" is the creator-video row, Amazon column.

### 2. Settings
- **Other sales channels** (Store Settings > Edit > Channels). Each has:
  - a name and a kind (marketplace or retail);
  - a variable cost % (to get its margin) and an AOV;
  - optional 60/90/365-day repeat multipliers (default 1, meaning no repeat value is counted);
  - for retail, the brand's net revenue as a % of the shelf price;
  - optionally, the Shopify sales channels that feed it.
- **Halo cells** (Store Settings > Edit > Incrementality). Each ad channel row opens to one cell per other sales channel. A cell holds:
  - the value;
  - the source: Benchmark, Own test or Assumption;
  - the date it was measured;
  - the channel's monthly spend when it was measured;
  - a note.
- A retail cell can be marked "measured on shelf sales". The app then converts it to net revenue with the channel's net %.
- The app never estimates a factor. Factors come from geo tests (for example through Haus) or a media mix model run outside, and are typed in.

### 3. The math (new file `lib/planning/halo.ts`, pure functions)
For a month, take each acquisition channel's share of aMER spend `s_c`, its .com factor `IF_c` and its total factor `F_c`. The shares follow the same rule as `amerSpend`: brand and returning spend are in or out per the client's settings.
- .com weight: `W = Σ s_c × IF_c ÷ F_c`
- Blended aMER: `amer ÷ W`
- Halo share of sales channel k: `(Σ s_c × halo_c,k ÷ F_c) ÷ W`
- Halo revenue on k: .com new revenue × halo share of k
- ROAS target of channel c: `blended aMER ÷ F_c`

With no halo typed, `W = 1` and every number equals today's.

Worked example (also the test fixture). Meta has 80% of spend, .com factor 1.2 and Amazon halo 0.2. Google non-brand has 20%, factor 0.6 and no halo. The month's aMER is 1.5.
- `W = 0.8 × 1.2/1.4 + 0.2 × 0.6/0.6 = 0.8857`, so blended aMER is 1.694 and Amazon's halo share is 12.9%.
- On $100 of spend: .com new revenue is $150.00 and Amazon halo revenue is $19.35.

| Channel | ROAS target today | ROAS target with halo |
|---|---|---|
| Meta | 1.25 | 1.21 |
| Google non-brand | 2.50 | 2.82 |

At the same .com aMER, the channel with a halo gets a lower bar and the channel without one gets a higher bar.

**Retention channels.** They stay out of the blended aMER, because aMER is an acquisition measure. Their part is small but real:
- Ad-created returning revenue = planned retention spend × the channel's platform ROAS over the last 90 days × its factor (0.6 by default for Meta returning).
- Details shows it as a read-only line under returning revenue. A halo typed on a retention channel is shown on a second line ("created by retention ads on other channels") and never enters the blended aMER, even when the client counts retention spend in aMER.
- The Returning model's forecast is not changed. Its cohort curve already contains past retention ads at their past level; the line shows how much of returning revenue depends on ads when that spend is raised or cut.

### 4. New Customer model
- `evaluateSpend` takes an optional halo input and adds to each row: halo revenue per sales channel, blended aMER, blended CM, blended 60/90/365-day CM, blended orders and blended CAC.
  - Blended CM = CM + halo revenue × that channel's margin.
  - Orders on another channel = halo revenue ÷ that channel's AOV.
- A model-wide switch, **Value basis: .com only | Blended**, stored in `NewCustomerSettings`. On Blended, the same "Max" markers are picked on the blended columns. The default is .com only, so nothing changes for existing clients.
- The halo share uses the plan month's platform split. With no plan yet, it uses the last 90 days' actual split.
- The month still saves `spend` and the .com `amer` read off the curve. On the blended basis the best spend is higher, so the .com aMER target is lower. That is the whole effect: the halo moves the target, not the metric.

### 5. ROAS targets
`planRoasTargets` computes the blended aMER and total factors per month and calls `suggestedRoas(blendedAmer, totalFactor)`. Typed targets still win. Details, Spend and Home show the result as they do today. A month the halo does not change (no platform split yet, or no halo on the channels it spends on) keeps the plain aMER and the plain factors.

### 6. Other-channel lines in the plan
- Per month, one typed revenue line per other sales channel (`PlanMonthInputs.other`). Examples: the CFO's retail forecast, the Amazon team's forecast.
- Each line has an optional **assumed ad spend**: the acquisition spend that forecast was built on. The channel's forecast then moves with the plan:
  `forecast = typed line + halo at the planned spend − halo at the assumed spend`
  - Left empty, the assumed spend equals the planned spend, so the forecast equals the typed line and the halo is only a transfer of credit.
  - Set to 0, the typed line is the base without ads, and the forecast is base + halo.
- Either way the ad-created part is counted once. Details shows, read-only: blended aMER, halo revenue per channel, and "of which created by ads" under each line.

### 7. Retail piece
Retail is one of the other sales channels, with a simple frame of its own so it can be planned before any data arrives.
- **Retailer rows** (in the retail channel's settings). Each row has: retailer, launch month, doors, units per store per week, shelf price, and first-order units (pipeline fill, counted once in the launch month). An expansion is a new row.
- **Monthly frame:**
  - Sell-through = doors × units per store per week × weeks in the month × shelf price.
  - Net revenue = sell-through × net % + pipeline fill in the launch month.
- The frame fills the retail line of the plan until a typed number (the CFO's) replaces it.
- **Sanity check:** ad-created units per store per week = retail halo revenue ÷ net price ÷ doors ÷ weeks. If the halo implies more units than the stores sell, the factor is too high. It shows next to the retail line.
- The retail halo cells start empty. Until a test fills them, the retail line is not moved by ad spend.
- The sanity check uses the full halo, not the capped one, so an overshooting factor stays visible. A retailer row needs a launch month to count.

### 8. Guardrails
- **Cap.** Halo revenue credited to a channel cannot exceed that channel's forecast: the typed number wins over the factor. The credit on the line is cut to fit and shown in red, and the forecast never goes below zero. The blended aMER and the ROAS targets keep the full factor, also in red, until the factor is lowered: a typed forecast line never changes a ROAS target on its own. With no line there is no cap, and the cell says so.
- **Grid rows.** The grid lists every ad channel with a factor, plus any channel that still carries a halo, so a cell never works unseen after its factor is deleted.
- **Outside the tested range.** Warn when a channel's planned monthly spend is more than 30% away from the spend at which its halo was measured.
- **Old.** Warn when a cell was measured more than 6 months ago.
- **Label.** Every blended number is marked as modelled, with a Benchmark badge when any cell behind it is a benchmark or an assumption.

### 9. Data intake (phase B)
- One table, `channel_sales`: one row per client, day, sales channel and retailer, with revenue, orders or units, ad spend and the source of the row.
- Feeds, in the order they get built:
  1. File import (CSV, for example an export of the client's master spreadsheet).
  2. Shopify orders on non-DTC channels, rolled up from `orders`.
  3. Native connectors: Amazon (sales and ads) and TikTok Shop (orders, GMV Max spend).
  4. Alternative to 3: one reader on the client's data warehouse, when a tool such as Saras Analytics already lands every channel there.
- The migration is additive. It is written with the phase and applied only when João asks.

### 10. What happens to reporting
- Each sales channel keeps its own forecast and is tracked on reported numbers: forecast, actual and % to forecast.
- The cascade acts earlier, when the plan is made. It sets the spend and each channel's targets. Home and the daily reports stay as they are, apart from the targets they show.
- One new report in phase B, **Omnichannel**: revenue by sales channel against forecast, total business revenue, spend and contribution, the blended aMER, and a switch from the reported view to the cascaded view (created by ads, by channel). It also carries the weekly check of total contribution against spend.

## Limits of the model (shown in the help text)
- A factor is a slope measured at one spend level, in one season, with the capture channels in a given state (in stock, priced, ranked). It holds near that point only. The spend curve carries the diminishing returns; the factor does not.
- Second-round effects (a halo of a halo) are not modelled. They are small, and a geo test already includes the ones that close within its window.
- Factors are averages. They say nothing about a single day.

## Build order
- **A (now):** the grid, the math, ROAS targets, the model's blended basis, other-channel lines with assumed spend, the retail frame, the retention line, the guardrails. No migration: settings live in `client_settings.extra`, the switch in `plan_models` (kind `new_customer`), the lines in the plan month's inputs.
- **B (next):** `channel_sales`, the file import, the Shopify non-DTC rollup, the Omnichannel report.
- **C (when access exists):** native connectors or the warehouse reader, drivers that live on other sales channels, models per channel, a log of tests.

## Tests
- No halo typed: every existing test still passes and targets are unchanged.
- The worked example returns 0.8857, 1.694, 12.9%, 1.21 and 2.82.
- A single channel with a halo keeps the same ROAS target at the same aMER.
- Blended CM uses each channel's own margin; orders use each channel's own AOV.
- On the blended basis with a positive halo, the Max CM spend is at or above the .com one.
- Assumed spend: empty returns the typed line; 0 returns typed + halo; a lower assumed spend raises the forecast.
- Retail frame: one retailer row returns the hand-worked month, the pipeline fill appears once, and "measured on shelf sales" converts with the net %.
- The cap triggers when halo revenue exceeds the forecast; each warning fires at its threshold.

## Not in scope
Estimating factors, geo test design, any change to the Returning or Event models, any change to aMER on Home, and connectors before access exists.

## Calls I made (correct any)
1. Factors are typed, never estimated in the app.
2. Storage in `extra` for phase A, so no migration.
3. One model-wide switch, default .com only.
4. Channels with no halo (Google Brand, non-brand) get a higher ROAS target on the blended basis.
5. One cost % per other channel for first and repeat orders; repeat multipliers default to 1.
6. Warning thresholds: 30% spend distance, 6 months of age.
7. The assumed-spend field decides whether a typed line already includes the ads' effect.
8. Retailer rows live in settings, not in the plan, because doors and velocity are facts about distribution.
9. The retention line is information only; the Returning model is untouched.

## Done when
- A client with halo cells typed sees the grid in settings.
- The model shows blended columns and picks its markers on the chosen basis.
- ROAS targets in Details, Spend and Home match the worked example.
- A retail line can be produced from retailer rows or typed, and moves with spend once a retail halo is typed.
- With nothing typed, the app behaves exactly as it does today.

# Statlas findings (read-only exploration)

Explored 2026-09-29 in the signed-in Chrome, on the **D.Louise Jewellery** store (GBP, Europe/London). Nothing was changed or saved in Statlas. Everything below was observed; anything not observed is in "What I could not see". Client numbers are quoted only to verify formulas.

## 1. Structure and navigation

Left sidebar, three groups:

| Group | Item | Route | Purpose |
|---|---|---|---|
| DATA | Home | `/profits` | Home dashboard: contribution margin, headline metrics, sales/spend chart, channel performance |
| DATA | Reporting | `/reports` | Report library: tabs Report List / Saved Reports / History; category chips Recommended, Visitor, Conversion, LTV, Costs, Revenue, All; search box; star to favourite |
| PLANNING | Calendar | `/calendar` | Per-day calendar of marketing events, emails sent (from Klaviyo), last-year events, holidays by region |
| TOOLS & SETTINGS | MMM | `/mmm-roadmap` | Rendered blank for this store (roadmap/placeholder) |
| TOOLS & SETTINGS | Store Settings | `/settings` | Store definitions, integrations, cost settings |
| bottom | SLA | `/sla` | Rendered blank for this store |
| bottom | Statlas Docs | external | Not opened |

Global chrome: search (Cmd+Shift+S), store switcher (top right), notifications bell, date-range picker (`9/1/2026 – 9/28/2026`), a "Feedback / Bug Tracker" drawer, and a version stamp (`V2026-09-29`).

"PLANNING" is only a section header. The Calendar is the only item under it. `/planning` redirects to `/reports`.

## 2. Home dashboard (`/profits`)

Controls (top bar): refresh icon, period label ("This Month"), currency and timezone (`GBP | GMT+0000 Europe/London`), **Compare:** dropdown (value seen: `2026 | 90th Percentil - Official`), and a kebab menu. Store switcher and date-range sit in the global bar.

Layout, top to bottom:

1. **Contribution Margin** hero tile with the formula as its subtitle: `(Net Sales + Shipping - COGS - Ad Spend - )`. It shows the actual, the target (comparison) value beneath, and the % difference.
2. **Five tiles:** Disc. Sales + Shipping, Ad Spend, MER, AOV, Orders. Each has actual, target, % diff.
3. **Sales & Spend chart** (dropdown to change the chart; "Sales & Spend" selected): daily bars for Sales (dark teal) and Spend (light teal), with dashed lines for Target Sales and Target Spend. Data labels on the sales bars. Actual bars stop at the last day with data; target lines run the whole selected range.
4. **Returning block:** Returning Revenue, Returning Orders, Returning AOV, Repeat Rate.
5. **New block:** New Revenue, New Orders, New AOV, Weighted CAC, aMER.
6. **Paid (incremental) block:** Paid iRevenue, Paid iOrders, Paid AOV, Paid iCAC, ipaMER.
7. **Channel Performance** with a metric dropdown (`iROAS`) and two checkboxes: "Break Out Non-Acquisition" (checked) and "(Meta) New Vs Returning Audiences" (unchecked). Rows of 5 tiles each: Spend, Rev (xMultiplier), AOV, iCPA, iROAS per channel, for: Google (non-brand), Google Brand, FB, Pinterest.
8. **Email:** Email Revenue, Email Orders, Campaign Revenue, Flow Revenue, Revenue/1K Sent.
9. **Organic:** Organic Revenue, Organic Orders, Organic AOV, Organic % of Paid.

Every tile has an **"i"** (info) icon and a link icon.

### Red / green expectation logic
- Each tile's title and value are coloured green or red against the comparison value, and the diff line takes the same colour. Direction is **metric-aware**: e.g. Ad Spend +8.0% is green, FB iCPA "-13.8%" (worse) is red, Disc. Sales -27.5% is red. So the rule is per metric (higher-is-better vs lower-is-better, and for spend probably "more spend than plan is good when efficiency holds"). The exact rule is not documented in the UI; treat as ambiguous (see open questions).
- Tiles with no comparison value show only the actual, in black (e.g. Returning Orders, all Google Brand tiles, Email metrics).
- The comparison value comes from the **Compare** selector. In this store it is a forecast/plan called `2026 | 90th Percentil - Official`, i.e. a plan version, not just prior period.

### Channel multipliers (iROAS)
Revenue tiles show the multiplier in the label. Seen: **Google Rev (x0.75)**, **Google Brand Rev (x0.3)**, **FB Rev (x1.2)**, **Pinterest Rev (x0.3)**. iRevenue = platform-reported revenue × multiplier. The user says the returning-audience multiplier is 0.6 (Meta returning); the "(Meta) New Vs Returning Audiences" checkbox splits FB into these two. I did not toggle it.

### Derived figures I could check from the data
- Google Rev: £48,563 = spend-linked platform revenue × 0.75. Google iROAS = Google Rev / Google Spend = 48,563 / 19,808 = 2.45 ✓.
- FB iROAS = 198,984 / 97,059 = 2.05 ✓. Google Brand iROAS = 26,602 / 5,775 = 4.61 ✓.
- iCPA = spend / (iRevenue / AOV): Google 19,808 / (48,563/83.15) = 33.9 ✓.
- MER = revenue / total ad spend: 224,050 / 122,643 = 1.83 ✓ (numerator is "Disc. Sales + Shipping").
- Orders/AOV: AOV = 224,050 / 2,779 = 80.62 ✓ (so AOV = the same revenue tile / orders).
- Total ad spend (£122,643) = Google 19,808 + Google Brand 5,775 + FB 97,059 = 122,642 ✓ (Pinterest £0 this period).

## 3. Metric hierarchy and contribution margin

Contribution margin is the top tile. Per-day formula, verified against the "i" table for 2026-09-01:

```
CM = Net Sales + Shipping − Refunds − COGS − Spend − Other
   14,593 − 451 − 2,738 − 7,192 − 1,504 = 2,708  (table shows 2,707; rounding)
```

Inputs, by column of the "i" table: **Net Sales + Shipping**, **Refunds**, **COGS**, **Spend** (ad spend, all channels), **Other** (other variable costs, see below), **Contribution Margin**, **Target**.

The Cost Settings page shows a "Current P&L" for the range that confirms the hierarchy and gives rates as % of revenue:

| Line | Note |
|---|---|
| Revenue | Order Revenue (Shopify, includes shipping and tax) |
| − Shipping/Taxes | 16.6% of revenue |
| − Refunds | 8.1% |
| − Avg Weighted COGS | 15.9% |
| − CAC | 46.4% (this is total ad spend) |
| − Other | 8.8% |
| **= Contribution Margin** | 4.3% |

There are **no fixed costs** in this CM. The subtitle has a trailing "- )" hinting at an optional deduction; the settings checkbox "Reduce Contribution Margin by Ad Spend (CAC)" (checked) controls whether ad spend is subtracted.

Observed inconsistency (unresolved): Home CM says £14,854 for 9/1–9/28 while Cost Settings P&L over the same displayed range says £11,425. Home only has actual data through 9/11 (per-day table). The P&L page may use a different revenue basis or refresh time. Not investigated.

## 4. The "i" icon (metric trend modal)

Clicking "i" opens a **modal** (Escape closes). For Contribution Margin and MER I saw:
- Title/tooltip with the definition: CM → "Contribution Margin (Revenue - variable costs) - See store settings"; MER → "Marketing Efficiency Rating = Revenue / Spend".
- Summary block: **Total, Target, Diff, Diff %** (Diff coloured red/green).
- **Line chart**, daily granularity, X axis = dates for the whole selected range, two lines: the metric (teal, ends at the last data day) and **Target** (yellow, continues to the end of the range). Point markers, y-axis can go negative.
- **Daily table** under the chart. CM columns: Date, Net Sales + Shipping, Refunds, COGS, Spend, Other, Contribution Margin, Target. MER columns: Revenue, Spend, MER, Target Rate.
- Future days show only the Target value.
- No prior-period line was visible; the only comparison is the Target line. No zoom/granularity toggle was seen.

I opened only these two; the other tiles' modals were assumed similar but not opened.

## 5. Reporting

Report List (Recommended): Calendar Report (key metrics overlaid with events and goals), Paid Media Overview, Marketing Efficiency Report (MER, profitability), P&L, Email Metrics Report, Total Net Customer (customer growth by cohort activity), Global Creatives, Trend Explorer (benchmarks), Hourly Report, per-platform "Trackers" (Facebook, Google, YouTube, AppLovin, Bing, Pinterest, TikTok, Snapchat, Email/Klaviyo, SMS), Variable Costs Dashboard, Best Creatives, DTC Index (benchmark). The "All" view also lists Revenue Overview (revenue/refunds/orders by month), Top Products (top 100), AOV Histogram, Time Lag Between Orders (distribution of days between orders by the same customer, 0 = no repeat). Not opened: none of the reports. Later phase.

## 6. Connections (Store Settings → Integrations)

Connected for this store: **Shopify** (account = shop handle, 2020-10 → 2026-09-11, 99%), **Facebook** (ad account, 2021-03 → 2026-09-11), **Google Ads** (2021-02 → 2026-09-12), **GA4** (⚠ "No Data Found: please check your settings again", 0%), **GA Classic** (2021-11 → 2024-07, 55%), **Klaviyo** (2021-01 → 2026-09-09), **Pinterest** (2021-07 → 2026-09-29, 100%).

Each row shows Provider, Account, Details (timezone, currency), and a **data-coverage progress bar** with date range and %. Each has an Edit button. An "Add Connection" button exists; I did **not open it**, so the full provider list and each provider's auth type (OAuth / API key / account ID) is **not observed**. The user's list (Meta, Google Ads, AppLovin, TikTok, Shopify, Klaviyo, Northbeam, TikTok Shop) is not confirmed by me. Statlas has "Tracker" reports for Facebook, Google, YouTube, AppLovin, Bing, Pinterest, TikTok, Snapchat, Klaviyo, SMS, which suggests those integrations exist.

Other links on the page: Cost Settings, Manage Email Reports ("Schedule your main dashboard sent to you"), RSGS Maps ("Connect to Sheets. Requires special assistance.", disabled), Add New Store.

## 7. Store settings (Edit dialog)

Header fields: Store Code, Timezone, Currency, Revenue Definition, Channels. In this store Revenue Definition is already **Order Revenue** ("(default) Total Sales without Returns (gross − discounts + shipping + tax)").

The dialog is an accordion. Observed fields:

- **Logo URL**, **Industry** (Jewelry & Accessories), **Currency**, **Time Zone**, **Revenue Definition** (dropdown), **Starting Day of the Week**.
- **Facebook Settings ("Select revenue window")**: Click Window = `1 Day`; View Window = `Disabled`; Click Type = `Unique Outbound Clicks`; checkbox "Exclude FB Onsite Conversions" (for stores with no Onsite/Shop channel). Note: "Dashboards will take up to a day to rerun when making definition changes."
- **Google Settings**: Revenue Timing = `Conversion by Revenue Date`. (Only this one option seen; the options list was not opened.)
- **Pinterest Attribution ("Select revenue window")**: not expanded.
- **Incrementality (iROAS)**: "Used to normalize ROAS among different publishers". **Values not observed** (panel did not render its fields for me). The multipliers seen on the home tiles are the only evidence (x0.75 Google, x0.3 Google Brand, x1.2 FB, x0.3 Pinterest).
- **aMER/CAC Calculation** checkboxes: Exclude Search Brand Spend from aMER; Exclude Social Non-Acquisition Spend from aMER; Don't Separate "Brand" Campaigns from Search (all search = acquisition); Don't Separate Campaigns with "Retention"; Don't Separate "Reactivation"/"Reengagement"; Exclude Test Campaigns (checked, keyword `us11`).
- **P&L / CM Calculation → Contribution Margin Options**: "Reduce Contribution Margin by Ad Spend (CAC)" (checked), "Include Shipping Fees Collected as Profits" (checked, as far as visible); more options below were not read.
- **Define Test Campaigns**: name *starts with / contains / ends with* text (contains `us11` set); "Exclude test campaigns from all ROAS calculations".
- **Channels ("Select channels to include in sales reporting (Shopify)")**: a switch per Shopify sales channel: Online Store, Draft Orders, Shop, Point of Sale, Gorgias, TikTok, Faire: Sell Wholesale, Swap, Facebook & Instagram, Facebook (Online Store and Shop are on for this store). This confirms the DTC-channel selection mechanism.
- **Exclude Order Tags**: exclude Shopify orders with given tags (contents not viewed).
- **Gift Card**: how to handle gift-card orders (options not viewed).
- **Email/Organic Settings**: email and organic definitions for the dashboard (contents not viewed, so the Klaviyo vs GA4 email revenue source choice is **not confirmed**).
- **Customer Churn Calculation**: see §8.
- **Cash Conversion Cycle**: "Enter your DIO, DSO, and DPO values" (values not viewed).
- **TikTok Shop Settings**: "Configure TikTok Shop fee structure and GMV share" (contents not viewed).
- Buttons: Close, Submit (disabled until a change), **Recalculate** (re-runs the dashboards).

### Cost Settings page (`/settings/costs`)
- Date range, **Recalculate**, **Upload COGS CSV**, a "Cost Settings Worksheet" link/icon.
- **Current P&L** table (see §3).
- **Product table**: Product Title, SKU, Revenue, MSRP, Discount %, Avg Price, Cost, % Cost, % COGS, Cost Changes (count), **Source** (`shopify` or `inputted`), Product Margin, Product Margin %. So per-variant COGS is **pulled from Shopify's product cost by default**, and can be overridden by manual input or CSV. Cost Changes counts how many times a cost changed (COGS history is time-versioned).
- Negative product margins are shown (e.g. −19%, −177%), driven by discount % over 100%.
- Where **"Other" variable costs (8.8% of revenue)** are entered was not found in what I read; the worksheet link was not opened.

## 8. Customer churn (in store settings)

Setting "Customer Churn Calculation: Define your customer churn thresholds". A table of the **distribution of days between orders** (new customers over the last 2 years), for this store:

| % of customers who reordered by | Days |
|---|---|
| 10% | 4 |
| 20% | 8 |
| 30% | 15 |
| 40% (default at risk) | 25 |
| 50% (default at risk) | 42 |
| 60% (default at risk) | 68 |
| 70% (default at risk) | 100 |
| 80% (default churned) | 150 |
| 90% (default churned) | 226 |

Two editable fields: **Days Until Customer is At Risk of Churn** (store value 30) and **Days Until Customer is Considered Churn** (store value 140), overriding the defaults (~40% / 80% marks). A note says: "Reporting on this feature is coming soon."

This matches the user's intended definition (churn window = days from order 1 until 80% of new customers have not re-purchased). Note the Statlas default at 80% (150 days) is derived from the *cumulative reorder distribution*, so "80% of customers have reordered within N days" is the reading that fits the table. The user's phrasing ("80% have NOT purchased again") needs to be confirmed, see open questions. How "active / lapsed / reactivated / returning" are labelled in reports was **not observed**.

## 9. Business Planning report

Found at **`/goals`** (not in the sidebar). Observed on 2026-09-29 for the official plan `2026 | 90th Percentil - Official` (last updated Jan 27). Read-only: I opened tabs and steps only; I did not click Calculate, Save Model, Save & Finalize, Save Event Model, Save or Sync to Sheets. (One tab, Returning Customer Model, auto-ran a regression on load and showed "Calculations completed"; I did not save anything.)

### 9.1 Plans list
Year selector (2026). Cards per plan: badges `2026`, `Default`, `Official`, a gear (plan settings, not opened), headline **New Revenue £4.09M, Revenue £7.12M, Spend £1.79M, CM £2.00M**, a **View Plan** button and an audit line ("Updated target details by <user>"). "Add A 2026 Custom Plan" creates a new plan. The **Default** plan is what Home compares against ("Compare:" dropdown).

### 9.2 Plan workflow (step bar)
`Plans → Models → Spend → Details → Input → Plan P&L`. A header shows the plan name and a running headline (Revenue after Models, Spend on Spend, Total CM on Details/Input). Each step has a check box once complete; Plan P&L was "indeterminate".

### 9.3 Models step: three tabs (Info, New Customer, Returning Customer, Event Effect)

Info text: *"Models are the starting point and form the basis for forecasts."*

**A) New Customer Model ("New Revenue Model", aMER / CAC).** "Uses different regression techniques to find the historical relationship between aMER/CAC and spend. These relationships are used to select optimal spend points depending on which KPI your business values most."
- Controls: **Month** picker, **Calculate**, **Save Model**, a **Model** version (`1.0002`, "Dec 01 2025 ACONS LY"), "Display Model Parameters", named model ("Official 2026 aMER Model"), Definition = Order Revenue, checkbox "Apply Current Settings When Selection Changes".
- **2026 Plan table**, one row per month: `Optimize For | Spend | aMER | New Order Revenue | AOV | Contr. Margin | LTV | New Cost % | Returning Cost % | % Over Model`. Example (Sep): Optimize For = `Other` (i.e. manually chosen spend), Spend £120,617, aMER 1.92, New Order Rev £231,359, AOV £83.66, CM £50,589, LTV £105.45, cost % 26/26, over-model 25%. Note "aMER is calculated in this model as **New Order Revenue / TOTAL Spend**". Annual totals: spend £1.79M, aMER 2.29, new revenue £4.09M, AOV £79.19, CM £1.24M, LTV £100.27.
- **Cost settings** (per month): *New Customer Cost %* (26) and *Returning Cost %* (26) with a source dropdown Last 30 Days / Last 6 Months / Last Year. (Cost % is the share of revenue consumed by COGS + variable costs, used to turn revenue into CM.)
- **LTV settings**: *AOV* (source: Last 30 Days / 6 Months / Last Year; 83.66), *Multiplier* (Recommended / 60-Day / 90-Day / 1-Year / Lifetime; value 1.2604), and **LTV** = AOV × multiplier = £105.45.
- **Model Tweaks**: Min Contribution Margin, Min Lifetime CM (both `-999999999`, i.e. off), **% Over Model** (24.5; a haircut/uplift applied to the modelled aMER curve).
- **Recommended Spend** section for the month: *Optimize For* dropdown, manual spend field (120617), aMER (1.92, vs LY 1.63). A **scatter chart** of aMER vs spend with series: Actual, Historical, Selected, Modeled (fitted curve), Last Year; options "Only Show Pts from Same Month", "Show More Data Points in Table", "Chart Total Spend (vs Acquisition Spend)".
- **Spend-point table** for the month: `Spend | aMER | CAC | Inc. aMER | Inc. CAC | Orders | New Order Revenue | Cost % | Contribution Margin | Lifetime Cost % | Lifetime CM`. Rows are spend levels from £40k to £800k, with tags **"Max CM"** (best first-order CM), **"Max Lifetime CM"** (best LTV-adjusted CM) and **"Max Revenue"** (spend where new revenue saturates). This confirms the plan's "contribution-maximising spend points at first-order / lifetime LTV". Marginal ("Inc.") aMER falls below 1.0 at high spend.

**B) Retention Model ("Returning Customers", tab titled "2026 Retention Model (CUSTOM)").** "Uses various forecasting techniques such as ARIMA and OLS to forecast the future retention curve for each cohort. The culmination of these forecasts and a modeled curve for retaining customers from future new business makes up your returning business forecast."
- A **Model** version selector (`20251201`), a **"New Gen AI Forecast"** button (served from `analytics.statlas.io`), and an **OLS regression results** table: dep. variable Y, R² 0.54, 1,643 observations, coefficients for `month_diff`, `const`, `lagged_ltv_lift`, and month-of-year dummies `actual_month_2 … _12`, each with p-values, plus Durbin-Watson / Jarque-Bera / skew / kurtosis diagnostics. So retention is modelled as **cohort-month retention % of first-order revenue**, with a month-of-year effect and a lagged LTV-lift term.
- **Save & Finalize Model Results**, and **"Simulate Next Year New Order Rev"**: "Sync Results from New Customer Model" plus a growth slider (5.91% new-order-rev growth). It compares 2024 / 2025 / 2026 / 2027 new order revenue.
- Chart "Returning Order Rev Actuals V Forecast" (2024–2027 lines).
- **Data Adjustments**: "1. How to Model Daily Numbers" (options: New Business / Flat / Event Model) and "2. Set custom Returning AOV Targets".
- **Annual returning data table** (per month: Orders, Revenue, AOV, for 2024 / 2025 / 2026 (forecast) / 2027 (forecast)).
- **Modeled LTV Lifts:** "Predicted Cohort Retention % of First-Time Order Rev": a **cohort × M1…M12 matrix** (each row a monthly acquisition cohort, values like 9.6%, 3.1%, 2.5%…), with a graph "Actual (Gray) vs Modeled Lifts".

**C) Event Effect Model (BETA).** "Analyzes historical events and applies various models depending on the event type. This affects daily returning revenue, daily new revenue, email revenue, and organic revenue."
- **Save Event Model & Apply to Daily Figures**, checkbox "Automatically sync event model", "Model Application Date".
- **Event-category table**: `Event Category | Type N | 90% CI Low | 90% CI High | Wt. Average | Median | Recommended | Impact on aMER`. Categories seen: All (168 events), High/Low Spend Events, Product Launch, Promotion, Other, PR, VIP Drop, Christmas, Black Friday, Seasonal Event, Cyber Week excl BCFM, Cyber Monday. Values are ratios of *returning revenue actual ÷ expected* (e.g. Promotion wt. avg 134%, recommended 83%) and an "Impact on aMER" (Improvement / Lower).
- **Future Events** table (`New Revenue Goal | Expected Ratio | Expected Returning Revenue | Retention Expectation | Expected Impact on aMER | aMER Expectation`); empty for this plan.
- **Past Events** table (one row per event-day, sourced from the Calendar events): event name, type, date, new revenue, returning revenue, **ratio** (returning ÷ expected), expected returning rev, difference (£ and %), actual aMER, expected aMER, and diff. ~150 event-days from Aug 2024 to Dec 2025.

### 9.4 Spend step
Header shows total plan Spend. Controls: month picker, metric selector (`SPEND`), buttons **Use Marketing Mix Model**, **See MMM Data**, **Actualize This Month / Actualize All Months** (replace plan values with actuals for elapsed months) and **Save**.
- **Ad Platform Allocation**: a slider (and edit-pencil) per platform: Google, YouTube, Bing, Facebook, AppLovin, TikTok, Snapchat, Pinterest, Criteo, Affiliate, Influencer, Connected TV, Other; donut chart. Sep 2026: Google 29.14%, Facebook 70.24%, Pinterest 0.62%. "Starting Point: Select Allocation".
- **Brand Allocation** (Google) and **Non-Acquisition Allocation** (Facebook, Pinterest): sliders (all 0% here) with a "Non-Acq Spend % / Brand Spend %" line chart of history.
- **Seasonality**: *Seasonality Base* (Store), **Day-of-Week Effect** (100%) with per-weekday offsets (Mon +2.66%, Tue −13.07%, Wed −12.30%, Thu −9.54%, Fri +3.52%, Sat +4.17%, Sun +24.55%) and a current-vs-last-year daily chart.
- **Daily table for the month** (Definition selector, copy data). By default: `Month day | Events | New Revenue | aMER | Total Spend |` then per-platform spend. **Ticking "Show CM/Revenue Breakdown"** (a display toggle, corrected after your feedback; I originally missed it) adds **CM, Tot Rev and Returning Rev** columns: `Day | Events | CM | Tot Rev | Returning Rev | New Revenue | aMER | Total Spend | Google | Facebook | Pinterest`. Sep header totals: CM £85,914, Tot Rev £406,311, Returning Rev £174,726, New Revenue £231,585, spend £120,617 (Google £35,148 / Facebook £84,721 / Pinterest £748). So **daily returning revenue and daily CM are planned**. Per-platform spend with lock/edit icons and % of the month (Google, Facebook, Pinterest). Daily New Revenue and Spend rise/fall with the weekday weights (e.g. Sep: Sun £9,680 vs Tue £6,776) and aMER stays constant (1.92) across the month. Row header shows the monthly totals (£231,585 new revenue, £120,617 spend).

### 9.5 Details step
Header "Total CM". A dropdown selects the detail table; the one shown is **Returning Order Revenue**: `Month | Order Revenue | Returning Order Revenue (model) | Last Year | Override`. The **Override** input lets the user replace modelled returning revenue per month; 2026 totals: order revenue £7.12M, returning £3.03M (42.5%; LY 40.7%). Side card "Retention Model: uses various simulation tools such as generative AI to simulate a fitted retention forecast" (Monte Carlo). Buttons: Back, Next, **Save & Go Next**.

### 9.6 Input step
"Currently Not Using These Inputs", **Month** picker, **Edit in Sheets**, **Sync to Sheets**, **Save**, **Show All Columns**, **Round Inputs**. A **daily table for the month** with columns: `Date | Total Revenue | Total Spend | MER | aMER | New Revenue | Returning Revenue | Email Revenue | SMS Revenue | Organic Revenue | Facebook Spend | Facebook NonAcq Spend | Google Ads Spend | Google Ads Brand Spend | Pinterest Spend | Pinterest NonAcq Spend`, with monthly TOTALS, "% of Total Rev" and "% of Total Spend". These daily rows are the **final daily targets**. Verified: September total revenue targets sum to £406,085 and spend to £120,617 (same as the monthly plan). Sept daily revenue shows a weekly repeating pattern (day-of-week weights).

### 9.7 Plan P&L
A monthly P&L for the year (columns Jan…Dec, Plan, 2026 Totals): Gross Sales, Discounts, Shipping, Refunds → **Operating Revenue** (note: "Store settings includes shipping as collected revenue"); COGS, Credit Card Fees, Variable Fees → Total Cost of Delivery; Advertising by group (Search, Social, Other) → Total Advertising Spend; **Contribution Margin** (and % of revenue); SG&A, Total Expenses; **Profit**. Then "4 Quarter Accounting" ratios (COD %, Ad Spend %, Opex %, Profit %) and **Key Performance Metrics**: Order Revenue, New / Returning Order Revenue, Total / New / Returning Orders, AOVs, Repeat Rate, Refund Rate, COGS Rate, MER, aMER, Acquisition Spend, Paid Orders, Weighted CAC, Paid CAC, and Ad Performance blocks per channel (FB, Google, Pinterest: Spend, Revenue, Conversions, AOV, CPA), Organic Revenue, Email Revenue, SMS Revenue. Verified 2026 totals: Order revenue £7,122,546 = new £4,093,744 + returning £3,028,802; CM £1,997,362 (38.45%); CM = Operating Rev − Total Cost of Delivery − Total Advertising Spend = 5,195,337 − 1,410,571 − 1,787,404 = 1,997,362 ✓.

Observed in the Plan P&L KPI block only: Returning Orders shows 0 and Returning AOV £∞, and Repeat Rate is blank. Home's "Returning Orders" tile also showed no target. That is all I saw about returning *orders*; returning **revenue** is planned monthly and daily (see 9.4). I have not checked whether returning orders are planned anywhere else.

### 9.8 How the plan becomes Home's daily targets
1. New Customer Model gives the **monthly** New Order Revenue and Spend (via the aMER-vs-spend curve and the chosen spend point).
2. Retention Model gives **monthly** Returning Order Revenue (overridable in Details).
3. Event Effect adjusts returning/new/email/organic revenue on event days (applied by "Save Event Model & Apply to Daily Figures").
4. Spend step splits monthly spend across platforms and days (platform %, day-of-week weights, seasonality) and derives daily new revenue from spend × aMER.
5. Input step shows the resulting **daily** figures (Total Revenue, Spend, MER, aMER, New/Returning/Email/Organic revenue, per-platform spend). These daily rows are what Home's target lines and the "i" modal Target column display. Not directly observed: that Home reads exactly these rows. I inferred it because the numbers are consistent (Sep plan revenue £406,085 = sum of Input rows, and Home's daily CM targets of £2.5k–£3.6k are in line with Sep plan CM £85,914 / 30 days ≈ £2.9k). I did not verify how Home prorates the targets for the compare tiles.

## What I could not see

- Business Planning (`/goals`): the algorithms behind the models (which regression form, how the aMER-vs-spend curve is fitted, how ARIMA/OLS are combined, how event ratios are computed), the plan gear (settings), "Add A Custom Plan", the Info tab detail, the "Use Marketing Mix Model" and "Actualize" actions, and the Sync-to-Sheets behaviour. Only the outputs and inputs are documented.
- The full **Add Connection** list and each provider's auth type.
- **Incrementality (iROAS)** settings panel: field names and where the multipliers are set (including the 0.6 returning-Meta multiplier).
- The **Compare** dropdown options, the date-range presets, the chart-type dropdown options, and the kebab menu.
- The **(Meta) New vs Returning Audiences** toggle (not clicked).
- "i" modals for metrics other than Contribution Margin and MER.
- Email/Organic Settings (Klaviyo vs GA4), Exclude Order Tags, Gift Card, Cash Conversion Cycle, TikTok Shop, Pinterest Attribution panels.
- Where "Other" variable costs are entered; the Cost Settings Worksheet.
- How Statlas identifies branded vs non-brand Google campaigns and Meta existing-customer audiences (no setting found beyond "Don't Separate Brand Campaigns from Search").
- Home CM (£14,854) vs Cost Settings P&L CM (£11,425) discrepancy.
- MMM and SLA pages (blank), all reports, Statlas Docs.
- Any real-time behaviour: refresh cadence beyond "dashboards rerun up to a day after a definition change".

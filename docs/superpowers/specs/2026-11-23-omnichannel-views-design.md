# Omnichannel views: every sales channel against its forecast, and the whole business

Date: 2026-11-23. Status: built 2026-11-23 (approved by João the same day, with the channel model spelled out in section 3); the daily message and connectors are not built. It follows the halo layer (`2026-11-20-halo-layer-design.md`, phase A released 2026-11-23) and is that spec's phase B, widened by João's request of 2026-11-23.

## Goal
Load the sales of the other channels (Amazon, TikTok Shop, retail), track each one every day against its own forecast, and show the whole business against its expectation. Home gets a view selector for this. After that, a new brand only needs its data connected.

## Why
The app can now plan the other channels, but it cannot see what they sell. Home still shows the store's own site only. A team that runs four sales channels needs one place that says, each morning, what was expected and what happened, per channel and in total.

## What exists today
- Plan lines per other channel and month, and halo factors (phase A).
- Home (`components/Dashboard.tsx`, `lib/dashboard-data.ts`): the own-site dashboard, with range, compare and plan scenario controls.
- Shopify orders on non-DTC channels are stored but not used. Nothing holds Amazon or retail sales.

## Approaches
| | Approach | Trade-off |
|---|---|---|
| A (picked) | One table for every other channel's daily sales, fed by a file import first; Home gets a view selector that swaps the page body | Works on day one with any export; connectors are added later without changing the screens |
| B | Build the Amazon and TikTok Shop connectors first, then the views | Nothing can be shown or tested until API access exists, and retail has no API at all |
| C | A separate "Omnichannel" report page, Home untouched | Least risk to Home, but the daily habit stays on an own-site screen and the other channels become a side page |

## Design

### 1. Data in
- **Table `channel_sales`** (new, additive): one row per client, day, sales channel and retailer, with revenue, orders, units, ad spend and where the row came from.
- **File import** (Store Settings, in "Other sales channels and halo"): a CSV per channel with date, revenue and, when known, orders, units, ad spend and retailer.
  - The user says how the file writes dates and numbers (1,234.56 or 1.234,56). A number that only makes sense the other way is refused, never loaded as a thousandth of what was meant.
  - The screen shows a preview, the columns it read and the ones it did not use, and the rows it cannot read with their line numbers.
  - Saving replaces the days in the file. With a retailer column it replaces them for the retailers in the file only, so one file per retailer can be loaded one after another.
- **Shopify channels:** a channel can name the Shopify sales channels that feed it (for example TikTok Shop orders synced into Shopify). Their orders are then rolled up from what is already synced.
- **Connectors** (Amazon, TikTok Shop) and a warehouse reader (for a brand that already lands its data with a tool such as Saras Analytics) come once access exists. They write to the same table, so the screens do not change.

### 2. A forecast for every day
- Each channel's monthly line (typed, the retail frame, or the channel model below) is spread over the days of the month: by the channel's own weekday pattern once it has 8 weeks of sales, evenly before that.
- Whole-business forecast for a day = the own-site plan + every channel's line for that day.

### 3. Channel model (Amazon, TikTok Shop)
- Once a channel has 60 days of its own ad spend and revenue, the app fits the same regression the New Customer model uses, on that channel's numbers (João, 2026-11-23):
  - each day's return is adjusted for the channel's own weekday pattern;
  - outliers are removed by spend bucket (Scott's rule for the bucket width, days kept within one standard deviation of their bucket);
  - Black Friday week is left out;
  - a straight line of revenue on daily ad spend is fitted, and its R² says how far to trust it (Good from 0.5, Fair from 0.25, Low below);
  - a monthly seasonality index is applied once two years of data exist;
  - past the highest spend the channel has run, returns fade (the same guardrail).
- The plan gets a planned ad spend per channel and month. "Fill the plan from this model" writes the channel's forecast from the curve at that spend.
  - It fills only open months that have no forecast yet. A forecast already in the plan is replaced only when the user ticks the box that says so.
  - A month with no planned ad spend uses the channel's pace: its average daily ad spend over the days with sales in the 90 days up to its own last day. With under 28 such days the month is left empty, and the screen says so.
- The curve is fitted on a period when the own-site ads ran at a certain level, so that level is saved as the line's assumed ad spend. The halo then moves the forecast only for the difference, and nothing is counted twice.
- Until 60 days exist, the forecast is typed. Repeat value stays a typed multiplier: the app has no customer-level data for these channels.

### 4. Home: one selector, three kinds of view
A "View" selector joins the controls at the top of Home. It lists Own site, Whole business, and one entry per other channel. The choice is remembered per client.

```
View: [ Whole business v ]   Range: [ Month to date v ]   Compare: [ Plan v ]

WHOLE BUSINESS
Revenue        Ad spend        MER         Contribution
1,240,000      310,000         4.00        298,000
vs plan +4%    vs plan +2%     plan 3.92   vs plan +6%

Channel        Actual     Forecast    To forecast   Share   Created by ads*
Own site       820,000    800,000     103%          66%
Amazon         290,000    270,000     107%          23%     61,000
TikTok Shop     90,000    100,000      90%           7%     12,000
Retail          40,000     40,000     100%           3%     –
* modelled from the halo factors

aMER (own site) 1.90      Blended aMER (modelled) 2.11
[ daily chart: actual and forecast, whole business ]
```

- **Own site:** today's Home, unchanged. It stays the default.
- **A channel (for example Amazon):** revenue, orders or units, ad spend, ROAS and contribution (revenue × its margin − its ad spend), each against the channel's forecast, with the month's pace and a daily chart of actual against forecast. One line shows how much of it the halo factors credit to the ads.
- **Whole business:** total revenue, ad spend, MER and contribution against plan, the table by channel above, and own-site aMER beside the blended aMER.
- Every number is reported sales. The cascade appears only in the "Created by ads" column and the blended aMER, both marked as modelled.
- A forecast is compared only with the sales of the days it covers. When a range reaches into a month the plan has no line for, those days stay in the totals, are left out of every comparison, and the view says how many there are. The whole-business table shows the day each channel's sales run through.
- A channel with no data loaded yet shows its forecast and a note on how to load sales.

### 5. Daily message
Not in this build. Recommendation for when it is built: one shared post each morning with a line per channel and the whole-business total, because seeing the other channels is the point of the cascade. A team that wants more detail gets its own post later. It reads from these views, so it comes after them.

## Limits
- Other channels have no new-versus-returning split, so they have no aMER, CAC or cohort numbers.
- Contribution for another channel uses its typed variable cost %, not costs per order.
- Retail revenue is whatever the import holds: sell-in from finance or sell-through from a retailer. One channel should hold one kind.

## Data
One migration: table `channel_sales` with the same access rules as the other client tables. It is additive. João approved it and it was applied on 2026-11-23 after a dry run that was rolled back.

## Build order
1. Table, import and demo data.
2. Daily forecast, the channel view and the whole-business view on Home.
3. Channel model and planned channel ad spend.
4. Shopify channel rollup.

## Tests
- Import: a good file loads; a bad date, a negative number and a duplicate day are reported; importing again replaces the same days.
- Daily forecast: the days add up to the month; the weekday pattern is used only with 8 weeks of data.
- Views: the whole business equals the own site plus every channel, for actuals and for forecast; a channel with no data shows its forecast only.
- Channel model: fewer than 60 days gives no model; the suggested line carries the assumed ad spend.
- Own-site Home shows exactly the same numbers as before.

## Not in scope
The daily message, connectors, the warehouse reader, measuring halo factors, and any change to the own-site Home.

## Calls I made (correct any)
1. The view selector swaps the body of Home; the own-site body is not touched.
2. Other channels show reported numbers only; the cascade is one marked column.
3. The file import comes before any connector.
4. The channel model reuses the own-site curve method rather than a new one.
5. The daily message waits for the views.

## Done when
A client with sales imported for Amazon sees, on Home, the Amazon view against its forecast and the whole-business view with every channel in the table, and the own-site view is unchanged.

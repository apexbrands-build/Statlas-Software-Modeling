# Four reports: Contribution Margin, Revenue Overview, AOV Histogram, New Vs Returning

Date: 2026-10-12. Status: draft for the strategist's review. Source: the Statlas screenshots in `Statlas Original UX/Reports/` (layout and columns), our own data and definitions. Completes the Home links spec (`2026-10-11-home-report-links-design.md`): with these four built, every Home tile mapped there shows its link icon.

## Goal
Four reports in the library, each reading data we already store, using the shared report pieces (`ReportFrame`, `ReportTable` with heat map and CSV, `groupDates`, the date picker). Numbers must agree with Home and the existing reports for the same range.

## Shared behaviour
- Controls: date range, **Group By** (the existing `GroupBy`: Daily, Weekly, Bi-Weekly, Monthly, Quarterly, Yearly, Day Of Week; default Daily), CSV download, heat map toggle.
- Rows in date order, one total row at the bottom. Caption lines under the title: what the report shows and "Channels: <the client's DTC channels>" (`settings.dtcChannels`).
- Data: `repo.getFacts` (daily rollups) aggregated per bucket with `aggregate`. The AOV Histogram is the one report that needs order-level data.
- Heat map: each cell is compared with the column's average across the rows using `compare` (within ±10% neutral). Columns where lower is better (discounts %, refunds %, COGS %, cost %, ad spend %) use direction down; shipping and taxes never colour.
- Registry: the four slugs move to `ready` and `ReportRouter` maps them. Currency is the client's currency.

## 1. Contribution Margin (`contribution-margin`)
Title line: "Contribution Margin Analysis (refunds are shown on the day they were refunded)". Column groups, in order:
- **Revenue:** Gross Sales, (Discounts), Discounts % (of gross sales), Shipping, Taxes, Order Revenue.
- **Product:** (Taxes), (Refunds), Refunds % (of order revenue), (COGS), COGS % (of gross sales), Product Margin, Product Margin % (of order revenue).
- **Costs:** (Variable Revenue Cost), Cost % (of order revenue), (Ad Spend), Ad Spend % (of order revenue).
- **Result:** Contribution Margin, Contribution Margin % (of order revenue).
Product Margin = Order Revenue - Taxes - Refunds - COGS (equals Net Sales + Shipping - COGS). Contribution Margin = Product Margin - Variable Revenue Cost - Ad Spend, taken from `cmParts` so it equals the Home CM tile exactly. Variable Revenue Cost is `cmParts.costOfDelivery`. The Statlas TikTok Shop cost column is left out until TikTok Shop is built (`docs/future-vision.md`). The percentages above are what the screenshot's figures reproduce (checked on its rows).

## 2. Revenue Overview (`revenue-overview`)
Caption "Portrays revenue, refunds and number of orders by <group>". A line chart of Order Revenue by bucket above the table. Columns: # of Orders, Gross Sales, Discounts (shown negative), Discounted Sales (gross - discounts), Returns (negative), Net Sales (discounted sales + returns), Shipping, Tax, Total Sales (net sales + shipping + tax), Order Revenue (discounted sales + shipping + tax, refunds not deducted). The screenshot's rows reproduce these identities.

## 3. AOV Histogram (`aov-histogram`)
- **Group By:** Dynamic Ranges, then fixed increments of 10, 25, 50 and 100 (client currency) and Complete Range.
- **Chart:** bars of order count per range. **Cards:** Mean (order revenue / orders), Median, Mode (the most frequent order value, to the cent).
- **Table:** Nth bucket (10%, 20% ... for ten buckets, otherwise the bucket number), AOV Range, Order Count, % of orders, Order Revenue, % of revenue.
- **Orders counted:** DTC orders with order revenue above zero dated in the range, the same filter as the daily rollup.
- **Bucket rules:** Dynamic = ten equal-width buckets between the 2.5th and 97.5th percentile of order value; orders outside are not charted and a footnote gives how many (the screenshot charts 3,861 of 4,065 orders, which is 95%; the rule is verified against that ratio, not documented by Statlas). Fixed increments start at zero with at most 60 regular buckets (up to the 99th percentile) and a last open-ended bucket "X+" holding everything above, so nothing is excluded. The strategist agreed to the dynamic rule (2026-10-12). Complete Range = ten equal-width buckets from the smallest to the largest order. The fixed-increment and Complete Range rules are our choices; Statlas's exact rules are not visible in the screenshot.
- **Where it runs:** in the database, so the browser never downloads orders: migration `0010_aov_histogram.sql` adds `aov_stats(p_client, p_from, p_to)` (count, mean, median, mode) and `aov_histogram(p_client, p_from, p_to, p_mode, p_step)` (bucket, low, high, orders, revenue, plus the number excluded). Both `stable`, readable only for clients the user can access (row-level security applies). The migration number may shift if another migration lands first.

## 4. New Vs Returning Overview (`new-vs-returning`)
Caption "Orders by new vs retained customers (new = first paid order of the customer)". Columns: First Time Orders, New Order Revenue, Revenue % Change (vs the previous row), First Time AOV, Returning Orders, Returning Order Revenue, Revenue % Change, Returning AOV, Total Orders, Total Revenue, Revenue % Change, Total AOV, % First Time (of orders), % Returning (of orders). The total row sums; AOVs are revenue over orders; % Change is blank on the first row and the total row.

## Consistency checks (also tests)
- Contribution Margin report CM for a range equals `cmParts(aggregate(facts), settings).cm`.
- Revenue Overview Order Revenue total equals `orderRevenue(aggregate(facts))` and its orders equal First Time plus Returning.
- New Vs Returning: new + returning = total in every row; % First Time + % Returning = 100%.
- AOV Histogram: bucket order counts + excluded = `aov_stats` order count; mean x orders = order revenue in range; checked on the live database for one reference month after the migration.

## Tests
Pure builders in `lib/reports/` (one per report) with fixtures: bucket aggregation, each column formula, percent-change rules, empty ranges, a single-day range, groups with zero orders (AOV and percentages show "–", never NaN). The histogram SQL is verified by query on the live database (counts, mean, trimming) because the repo has no database tests.

## Not in scope
Statlas's "Parameters" pop-up, report email schedules, the TikTok Shop cost column, per-channel splits inside these reports.

## Done when
All four reports open from the library with real data, their invariants hold, migration 0010 is applied, and the Home tiles for Contribution Margin, Order Revenue, AOV and Orders show their links.

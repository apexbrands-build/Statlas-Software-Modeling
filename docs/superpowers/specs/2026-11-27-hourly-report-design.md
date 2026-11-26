# Hourly report

Date: 2026-11-27. Status: **design for João to approve; nothing built.** One of the three reports he named on 2026-11-27 (Calendar, Hourly, Total Net Customer).

## Goal
On a day that matters (a launch, a sale, Black Friday), see by the hour whether the day is on track, while there is still time to act. Afterwards, read how a day unfolded.

## What the screen has
```
Hourly report      [ Day: today v ]  [ Compare with: Plan v ]  [ ] Cumulative   [ Columns ]  [ Chart ]  Download CSV

So far today: 18,420 of 16,900 expected by 14:00 (+9.0%). At this pace the day ends near 41,300, against a target of 37,900.

Hour    Revenue  Expected  Delta   Orders  Expected  AOV    New revenue  Expected  New orders  New AOV  Returning revenue
00:00   412      380       +8%     6       6         68.7   250          231       4           62.5     162
01:00   ...
13:00   2,310    2,050     +13%    ...
14:00   (hours to come: expected only, dimmed)
...
Day     18,420   16,900    +9.0%   ...
```
- One row per hour of the store's own clock (the same clock the daily numbers use), a "Day" row for the total.
- **Compare with**, one at a time: the plan (default when the day has a target), the same weekday last week, the average of the last four same weekdays, the same day last year.
- **Cumulative** turns every column into a running total, which is the view for "are we ahead or behind right now".
- A chart of the picked column: bars per hour, the comparison as a line.
- Green and red beyond 10% either way, as everywhere else.

## The numbers
- **Hour** = the hour the order was placed, in the store's time zone. Revenue is order revenue (the app's definition), new and returning split by first order.
- **Expected per hour, against the plan** = the day's target x that hour's usual share of a day. The usual share is the store's own: each hour's part of the day's revenue over the last four same weekdays. The reference tool divides the day evenly by 24; an even split makes every night look behind and every evening look ahead, so we use the store's curve.
- **Where the day is heading** = revenue so far ÷ the usual share of the day that has passed.
- **A sale day does not follow a normal day's curve.** When the day sits inside a calendar event, the curve comes from the same event last year when it exists, and the page says which curve it used.

## What it cannot show yet (and why)
- **Ad spend, MER, CAC and ROAS by hour.** Spend is stored by day. Meta and Google both report by hour; each sync would need a change to fetch and keep it. Proposed as the step after this one.
- **Amazon, TikTok Shop and retail by hour.** Those channels are loaded by day.

## What has to be built underneath
1. A database read function that returns a store's orders by hour for a range (revenue, orders, new revenue, new orders), in the store's time zone. One additive migration, tried in a rolled-back run first.
2. **Today's orders.** The scheduled sync stops at the store's yesterday; today's orders are loaded only when someone opens the Shopify store page. For "today" to work, the hourly job also pulls today's orders for each connected store, so the page is at most an hour old. A "last updated" time is shown.
3. The page: the table and chart reuse the Calendar Report's parts (heat, deltas, CSV), as that spec planned.

## Calls made (correct any)
1. Own site only in this version; the other sales channels and spend by hour come after.
2. The expected curve is the store's own (last four same weekdays), not an even split.
3. Today is refreshed by the hourly job, not live to the minute.
4. No hourly targets are stored in the plan: they are derived from the day's target each time.

## Done when
On a store with orders and a plan: yesterday's hours add up to yesterday's numbers on Home; today shows the hours so far against the plan with the day's projection; the same day last year can be put beside it.

# Slice 1: channel depth (Amazon and TikTok Shop)

Date: 2026-11-26. Status: approved as part of the blueprint (`2026-11-26-operating-system-blueprint.md`, João: "the order is good, let's build on it"). This note fixes the details the blueprint left to the builder.

## Goal
An Amazon or TikTok Shop channel holds the numbers its team works from, loaded from the platform's own files, and its page on Home shows them against the forecast.

## What changes
1. **Platform.** A channel has a platform: Amazon, TikTok Shop, Retail or Other. A channel saved before this is recognised from its name.
2. **Metric catalog** (`lib/omni/metrics.ts`). Per platform: the metrics that are stored, and the ones calculated from them, each with a label, a unit, how it adds up over a period and which direction is good.
3. **Storage** (migration 0022, additive). `channel_sales` gains `metrics` (the catalog's stored metrics) and `period_days` (1 = a day; used from slice 5). A database function merges rows into the table in one statement.
4. **Import.** A file is recognised by its columns as one of a few known kinds per platform, or read as a generic file. Columns the app does not recognise can be mapped by hand.
5. **Channel page.** For Amazon and TikTok Shop the Home view of the channel becomes a full page: headline numbers against the forecast, traffic and conversion, where the sales came from, ads, a trend chart with a metric picker, and a table by day, week or month with a CSV export.
6. **Sample store and demo data** carry every metric.

## Calls made (correct any)
1. The four numbers every channel has (revenue, orders, units, ad spend) stay as columns. Everything else is in `metrics`, so a new metric needs no database change.
2. **A file changes only what it holds.** Loading the ads file does not touch sales; loading the sales file does not touch ads. Before, a file replaced the whole day.
3. **Ads files have one row per campaign and day; rows of the same day are added together.** A sales file with two rows for a day is still reported as a mistake.
4. **Amazon's ad spend and ad sales are the sum of the ad types** (Sponsored Products, Brands, Display) once any of them is loaded.
5. **Buy Box % is stored as page views that showed the offer**, so a month's Buy Box % is weighted by traffic and not an average of daily percentages.
6. **Counts that cannot be added up** (active subscriptions, creators with sales) show the latest day or the daily average, and say which.
7. **A column mapped by hand is remembered in the browser that did it.** Saving it for everyone comes with the Channels step (slice 3), which is where a channel's set-up will live.
8. **The page compares with the forecast when the plan has one for the period, and otherwise with the same days last year.**
9. **Organic sales are marked as rough by day** (ad sales are counted in a window after the click).
10. Retail keeps today's view. Its own metrics and the weekly cadence are slice 5.

## Not in this slice
The sidebar change and the scoreboard (slice 2), plan sections and P&L (slice 3), fees read from statements, product-level data, feeds from the platforms' APIs.

## Done when
On the sample store in the live app: the Amazon page shows total ACOS, ACOS, sessions, conversion, Buy Box %, the ad-type split and organic sales; the TikTok Shop page shows GMV by source and by content, affiliates and shop ads; a test file of each kind loads through Store Settings and changes only its own numbers.

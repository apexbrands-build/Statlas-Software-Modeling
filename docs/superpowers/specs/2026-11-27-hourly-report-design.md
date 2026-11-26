# Hourly report

Date: 2026-11-26 (the file name is a day ahead). Status: **revised design for João to approve; nothing built.** One of the three reports he named on 2026-11-26 (Calendar, Hourly, Total Net Customer).

**Revised 2026-11-26 (same day)** after João asked for: the whole-business metrics against targets by hour; every paid channel by hour, down to its types (Meta new and returning, with spend and efficiency); email and SMS against their targets. The reference tool's hourly report was read again in his browser for this (notes in `docs/statlas-findings.md`, "Hourly Report").

## Goal
On a day that matters (a launch, a sale, Black Friday), see by the hour whether the day is on track, while there is still time to act: the business first, then each channel that feeds it. Afterwards, read how a day unfolded.

## What the screen has
One wide grid, the same grammar as the trackers: **hours down the side, blocks of columns across**. No tiles.

```
Hourly report   [ Day: today v ]  [ Compare with: Plan v ]  [ ] Cumulative  [ ROAS | iROAS ]  [ Columns ]  Download CSV
Jump to   Business · Paid total · Meta · Google · Email · SMS

To 14:00: revenue 18,420 of 16,900 expected (+9.0%), heading for 41,300 against a target of 37,900.
Spend 5,210 of 5,400 expected (-3.5%); MER 3.54 against 3.13. Meta new customers is 12% over its spend at ROAS 1.52 against 1.60.

Hour  | Business                                         | Paid total      | Meta total | Meta: new customers        | Meta: returning | Google total | Google: non-brand | Google: brand | Email            | SMS
      | Revenue Orders AOV  New rev New orders New AOV   | Spend Rev ROAS  | ...        | Spend Target Delta Rev ROAS Target | ...     | ...          | ...               | ...           | Revenue  Running | ...
      | Returning rev  Spend  MER  aMER  CAC             |                 |            |                            |                 |              |                   |               | of day target    |
00:00 | 412 of 380 (+8%) ...                             |
...
14:00 | (hours to come: expected only, dimmed)
Day   | 18,420 of 16,900 (+9.0%) ...                     |
```

- One row per hour of the store's own clock, a **Day** row that stays in view. The hour column and the Business block stay in place while the channel blocks scroll sideways.
- Every number is a triple: **actual, target, difference** (green and red beyond 10% either way, as everywhere else).
- **Business block**: Revenue, Orders, AOV, New revenue, New orders, New AOV, Returning revenue, Ad spend, MER, aMER (new revenue ÷ ad spend), CAC (ad spend ÷ new orders).
- **Paid total**, then **one block per connected ad platform** (Meta and Google today), each opening with the platform total and then **one block per type the plan holds spend for**: Meta new customers, Meta returning customers, Google non-brand, Google brand. Per block: spend, spend target, difference, platform revenue, ROAS (or iROAS) and its target. A platform connected later appears with no change to the page.
- **Email** and **SMS**: revenue by hour, the running total against the day's target, each send marked on its hour.
- **Compare with**, one at a time: the plan (default when the day has a target), the same weekday last week, the average of the last four same weekdays, the same day last year.
- **Cumulative** turns every column into a running total (ratios become running ratios). It is the view for "are we ahead or behind right now", and the one to read the ratios in.
- A chart of the picked column: bars per hour, the comparison as a line.
- Campaigns are not listed by hour: that is the tracker's job. Each platform block links to its tracker.

## The numbers
- **Hour** = the hour the order was placed, in the store's time zone. Ad platforms report in the ad account's clock; their hours are moved to the store's clock (an account on a half-hour offset is moved to the nearest hour and the page says so).
- **Expected per hour** = the day's target x that hour's usual share of a day, the share taken from that number's own history: revenue from the store's last four same weekdays, a type's spend from that type's own last four same weekdays. The reference tool divides the day evenly by 24 (seen again on 2026-11-26: the same target on every hour of a day); an even split makes every night look behind and every evening look ahead.
- **Ratios** (MER, aMER, CAC, ROAS) are not spread over the hours: every hour carries the day's target. One hour of a ratio is noisy, mostly at night, so the sentence above the grid always reads them on the running total.
- **Spend target per type** = the plan's daily spend for that type. **ROAS target per type** = the month's aMER ÷ the type's incrementality factor, as in the trackers (typed targets win). With iROAS on: revenue x the type's factor, against target x factor.
- **Same-day platform ROAS reads low.** The platforms credit a purchase to the time of the click, and purchases keep arriving for days (7-day click). Today's ROAS by hour is under its final value, most of all on the latest hours. The page says so beside the ROAS columns; MER, aMER and CAC come from the store's own orders, carry no such lag, and are the first read. "Compare with last week" shows last week's final values, not what they were at this hour.
- **Email and SMS**: the day's target = the plan's share of order revenue for email (and for SMS) x the day's revenue target. There is no expected value per hour: a send decides the hour, so the reading is the running total against the day's target.
- **Where the day is heading** = so far ÷ the usual share of the day that has passed (revenue and spend each on their own curve).
- **A sale day does not follow a normal day's curve.** When the day sits inside a calendar event, the curve comes from the same event last year when it exists, and the page says which curve it used.

## What has to be built, in three steps (each ships on its own)
**Step 1. The business block from orders** (no new data needed).
1. A database read function that returns a store's orders by hour for a range (revenue, orders, new revenue, new orders), in the store's time zone. One additive migration, tried in a rolled-back run first.
2. **Today's orders.** The scheduled sync stops at the store's yesterday; today's orders are loaded only when someone opens the Shopify store page. The hourly job also pulls today's orders for each connected store, so the page is at most an hour old. A "last updated" time is shown. To check first: that the hourly job runs in production (it needs `CRON_SECRET` in Vercel, an open item).
3. The page: the grid and chart reuse the Calendar Report's parts (heat, deltas, CSV).

**Step 2. Paid channels by hour** (spend is stored by day today).
1. A new table of ad spend by hour (store, day, hour, platform, campaign, type, spend, platform revenue, purchases). Additive migration.
2. **Meta**: the hourly breakdown at campaign level. To confirm with one test call: whether Meta returns the new and existing customer split by hour. If it does not, each campaign's hour is split by that campaign's own new and existing share for the day (the daily sync holds it) and the page says the split is the day's.
3. **Google**: the hour segment at campaign level; brand and non-brand by the same name rule as the daily sync.
4. The hourly job pulls today and yesterday for each connected ad account (yesterday again, so late purchases settle). The first run loads 35 days back for the curves.
5. This fills Ad spend, MER, aMER and CAC in the business block, and the platform blocks.

**Step 3. Email and SMS.** The plan already holds their targets (share of order revenue). The actuals do not exist in the app: Klaviyo, Postscript and Omnisend can be connected but nothing is pulled from them. This step is the Klaviyo data pull (revenue credited to email and to SMS by hour, and each campaign's send time), designed in `2026-10-11-messaging-klaviyo-sms-design.md`. It also fills Home's email and SMS tiles, the P&L lines, the Calendar's send markers and the email tracker. Postscript and Omnisend follow. Until then the Email and SMS blocks show the day's target and "no data pulled yet".

## What it still cannot show (and why)
- **Other ad platforms** (TikTok, Pinterest, Bing, Snapchat, AppLovin, YouTube as its own line): no connector yet. The page lists whatever platform has hourly rows.
- **Amazon, TikTok Shop and retail by hour**: those channels are loaded by day.
- **Budget and bid changes**: the app does not hold them.

## Calls made (correct any)
1. Three steps, the business block first: it needs no new data and is live in days, while spend by hour and Klaviyo are each a sync to build.
2. The expected curve is the number's own (last four same weekdays), not an even split.
3. The channel types are the plan's (Meta new and returning; Google non-brand and brand), not the reference tool's ACQ / NonACQ / Awareness: the plan holds no awareness target, and every block needs a target to be read against.
4. Email and SMS get no expected value per hour, only the running total against the day's target.
5. Same-day ROAS is shown as it is, with the note; no estimate of where it will settle.
6. Today is refreshed by the hourly job, not live to the minute.
7. No hourly targets are stored in the plan: they are derived from the day's target each time.
8. Types by hour, not campaigns by hour.

## Done when
On a store with orders, ad accounts and a plan: yesterday's hours add up to yesterday's numbers on Home, for revenue and for each platform's spend; each type's hours add up to the tracker's day; today shows the hours so far against the plan with the day's projection; the same day last year can be put beside it; email and SMS show their day target, and their revenue once the Klaviyo pull exists.

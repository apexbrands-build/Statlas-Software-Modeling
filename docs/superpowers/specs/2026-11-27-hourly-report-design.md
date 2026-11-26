# Hourly report

Date: 2026-11-26 (the file name is a day ahead). Status: **approved by João on 2026-11-26 ("push all of this in development fast"); step 1 is built on `development` (2026-11-26, not released; migration 0023 applied, 0024 waiting for João); steps 2 and 3 are not built.** What was built and what was not checked: `docs/changelog.md`. One of the three reports he named on 2026-11-26 (Calendar, Hourly, Total Net Customer).

**Revised twice on 2026-11-26.** First after João asked for the whole-business metrics against targets by hour, every paid channel down to its types, and email and SMS against their targets (the reference tool's hourly report was read again in his browser for this; notes in `docs/statlas-findings.md`, "Hourly Report"). Then with his corrections: the types are acquisition and retention only; the hourly shape of a Black Friday / Cyber Monday day is last year's; email and SMS do get an expectation per hour; the report is the Calendar report by hour, with the sends and launches on it, so a day that is behind can get a Plan B.

## Goal
On a day that matters (a launch, a sale, Black Friday), see by the hour whether the day is on track, while there is still time to act: the business first, then each channel that feeds it, with what was sent and launched on the same grid. Afterwards, read how a day unfolded.

João's example: returning revenue is behind its target, the planned emails are already out, so a Plan B send with another offer is deployed to close the day's gap. The page has to make that visible in time.

## It is the Calendar report, by hour
The Calendar report (`lib/reports/calendar*.ts`, `components/reports/Calendar*.tsx`) already has the columns, the goals from the plan, the heat, the deltas, the chart and the action markers. The hourly report runs on the same engine: a row is an hour instead of a day, an hour's goal is the day's goal times that hour's share, and the markers sit on the hour they happened.

## What the screen has
One wide grid: **hours down the side, blocks of columns across**. No tiles.

```
Hourly report   [ Day: today v ]  [ Compare with: Plan v ]  [ Shape: last year's Black Friday v ]  [ ] Cumulative  [ Columns ]  Download CSV

To 14:00: revenue 18,420 of 16,900 expected (+9.0%), heading for 41,300 against a target of 37,900.
Returning revenue is 1,150 behind (-14%). Both planned sends are out (09:00 Email "VIP early access", 12:00 SMS "Doors open"): nothing planned is left today, 4,300 to close by midnight.

Hour  | What happened            | Business                                          | Paid total | Meta: acquisition | Meta: retention | Google: non-brand | Google: brand | Email | SMS
      |                          | Revenue Orders AOV  New rev New orders New AOV    | Spend ...  | Spend Rev ROAS    | ...             | ...               | ...           | Rev   | Rev
      |                          | Returning rev  Spend  MER  aMER  CAC              |            |                   |                 |                   |               |       |
09:00 | Email: VIP early access  | 1,940 of 1,610 (+20%) ...
12:00 | SMS: Doors open · Meta: 6 new ads in ACQ | Evergreen
14:00 | (hours to come: expected only, dimmed)
Day   | 18,420 of 16,900 (+9.0%) ...
```

- One row per hour of the store's own clock, a **Day** row that stays in view.
- Every number is a triple: **actual, expected, difference** (green and red beyond 10% either way, as everywhere else).
- **What happened**: the calendar's events, each email and SMS send with its name, and the Meta campaigns that got new ads, on the hour they happened. A send with no time set is listed above the grid with the day's events.
- **Business block**: Revenue, Orders, AOV, New revenue, New orders, New AOV, Returning revenue, Ad spend, MER, aMER (new revenue ÷ ad spend), CAC (ad spend ÷ new orders).
- **Paid total**, then one block per type the plan holds spend for: **Meta acquisition, Meta retention, Google non-brand, Google brand**. Per block: spend, platform revenue, ROAS. There is no awareness spend, so no such block. A platform connected later appears with no change to the page.
- **Email** and **SMS**: revenue by hour against the hour's expectation.
- **Compare with**, one at a time: the plan (default when the day has a target), the same weekday last week, the average of the last four same weekdays, the same day last year.
- **Cumulative** turns every column into a running total (ratios become running ratios). It is the view for "are we ahead or behind right now".
- A chart of the picked columns, with the sends and launches marked on the hour axis, so the lift after a send can be seen against the expected line.
- Campaigns are not listed by hour: that is the tracker's job.

## The numbers
- **Hour** = the hour the order was placed, in the store's time zone. Ad platforms report in the ad account's clock; their hours are moved to the store's clock.
- **Expected per hour** = the day's target x that hour's share of the day (the day's **shape**).
  - **Black Friday / Cyber Monday days: last year's same day**, that is the day at the same distance from Thanksgiving, scaled to today's target. The shape of those days repeats from year to year (João, 2026-11-26).
  - A day inside another calendar event: the same event's day last year, when it exists.
  - Any other day: the average of the store's last four same weekdays.
  - No history to read: an even split, and the page says so. The page always names the shape it used, and the shape can be changed.
  - The reference tool divides every day evenly by 24 (seen again on 2026-11-26), which makes every night look behind and every evening look ahead.
- **Ratios** (AOV, MER, aMER, CAC, ROAS) are not spread over the hours: every hour carries the day's target. One hour of a ratio is noisy, mostly at night, so the sentence above the grid reads them on the running total.
- **Spend per type** = the plan's daily spend for that type x the shape. **ROAS target per type** = the month's aMER ÷ the type's incrementality factor, as in the trackers and the Calendar report.
- **Email and SMS expected per hour** = the plan's share of order revenue for email (and for SMS) x the day's revenue target x the shape. Until the Klaviyo history is pulled the shape is the store's revenue shape for that day; after that it is the channel's own shape of the same reference day.
- **What a send did**: the page reads the three hours from a send against the same three hours' expectation, for the channel and for total revenue ("Email at 09:00: +1,240 against expected over 3 hours"). It is a reading against the shape, not an incrementality test.
- **The Plan B signal**: when returning revenue (or total revenue) is more than 10% behind its expectation so far, the sentence says how many planned sends are still to go today and names them; when none is left it says so and gives the amount to close by midnight. The page does not send anything.
- **Where the day is heading** = so far ÷ the share of the day that has passed.
- **Same-day platform ROAS reads low** (step 2): platforms credit a purchase to the time of the click and purchases keep arriving for days. The page says so; MER, aMER and CAC come from the store's own orders and carry no such lag.

## What has to be built, in three steps (each ships on its own)
**Step 1. The grid, the business block from orders, the expectations of every column, the markers and the Plan B signal** (no new connector).
1. A database read function that returns a store's orders by hour for a range (revenue, orders, new and returning), in the store's time zone. Additive migration 0023.
2. A **send time** on calendar events (optional, the store's clock), so email and SMS sends sit on their hour. Same migration.
3. **Today's orders.** The scheduled sync stops at the store's yesterday; today's orders load only when someone opens the Shopify store page. The hourly job now pulls them for every connected store. Confirmed 2026-11-26: the hourly job runs in production (5 to 6 daily syncs started and finished on each of the last 8 days). It fires at a loose minute inside each hour (00:58, 07:40), so today can be up to about two hours old; the page shows the time of the last order loaded. A partial today must never be read as a finished day by Home or the other reports.
4. The page. Columns with no hourly actuals yet (ad spend and everything built on it, email, SMS) show their expectation per hour and "no hourly data yet" for the actual, and are off by default in Columns.

**Step 2. Paid channels by hour** (spend is stored by day today).
1. A new table of ad spend by hour (store, day, hour, platform, campaign, type, spend, platform revenue, purchases).
2. **Meta**: the hourly breakdown at campaign level. To confirm with one test call: whether Meta returns the new and existing customer split by hour. If not, each campaign's hour is split by that campaign's own share for the day, and the page says the split is the day's.
3. **Google**: the hour segment at campaign level; brand and non-brand by the same name rule as the daily sync.
4. The hourly job pulls today and yesterday for each ad account. The first run loads 13 months back, so last year's BFCM shape exists for spend too.
5. This fills Ad spend, MER, aMER and CAC in the business block, and the platform blocks.

**Step 3. Email and SMS actuals.** The plan holds their targets; the actuals do not exist in the app: Klaviyo, Postscript and Omnisend can be connected but nothing is pulled from them. This step is the Klaviyo data pull (revenue credited to email and to SMS by hour, each campaign's name and send time), designed in `2026-10-11-messaging-klaviyo-sms-design.md`. It also fills Home's email and SMS tiles, the P&L lines, the Calendar's send markers and the email tracker, and the sends then arrive on the hourly grid by themselves. Postscript and Omnisend follow.

## What it still cannot show (and why)
- **Other ad platforms** (TikTok, Pinterest, Bing, Snapchat, AppLovin): no connector yet.
- **Amazon, TikTok Shop and retail by hour**: those channels are loaded by day.
- **Budget and bid changes**: the app does not hold them.

## Calls made (correct any)
1. Three steps, the grid and the business block first: live without a new connector, and what BFCM needs first.
2. Types are the plan's: acquisition and retention on Meta, non-brand and brand on Google.
3. Email and SMS get an expectation per hour on the day's shape (João's correction).
4. A send's effect is read over three hours against the expectation.
5. Same-day ROAS is shown as it is, with the note.
6. No hourly targets are stored in the plan: they are derived from the day's target each time.
7. Types by hour, not campaigns by hour.

## Done when
On a store with orders and a plan: yesterday's hours add up to yesterday's numbers on Home; today shows the hours so far against the plan with the day's projection; a Black Friday opens on last year's Black Friday shape; a send typed in the calendar with a time sits on its hour; a day behind on returning revenue with its sends out says so. Steps 2 and 3: each platform's hours add up to the tracker's day; email and SMS show their revenue by hour.

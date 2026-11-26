# Slice 2: trackers for the paid channels

Date: 2026-11-27. Status: built under João's standing instruction ("continue with the next build", 2026-11-26); the calls below are listed for him to correct. Part of `2026-11-26-operating-system-blueprint.md`; method from `2026-11-26-ctc-operating-model-notes.md`.

## Goal
A media buyer opens the tracker of an ad platform and sees, for the month: what the plan expected each day, what was spent, where the month is heading at the current pace, how much of it each campaign carries, and the return against target.

## Where it comes from
- CTC: "channel tracker per campaign: target, projected and actual spend, projected vs actual ROAS, moments tagged". Every ad dollar has a daily target; each morning actuals are read against it.
- João, 2026-11-26: target, projected and actual spend; projected is re-based on the month's pacing so far; it is then shared out to the running campaigns in proportion to what each has spent, so the buyer sees how much of the planned spend each campaign can carry.
- The reference tool's tracker (notes in `docs/statlas-findings.md`): a day table (moments, target, projected, actual, delta) and, per campaign, projected and actual spend with target and actual iROAS; a "show iROAS" switch; this, last and next month.

## Design
One page per ad platform. Meta and Google are built (the two platforms that sync campaigns today); the others open when their connector exists. They sit in the report library (Meta Tracker, Google Tracker) and behind a new "Trackers" entry in the sidebar, with a switch between platforms on the page. Code: `lib/trackers/spend-tracker.ts` (the numbers), `components/reports/SpendTrackerReport.tsx` (the screen).

```
Meta tracker        [ November 2026 v ]   Campaign shares from the last [ 28 v ] days   [x] Show iROAS

Target for the month   Spent so far        Heading to           ROAS so far      ROAS needed on the days left
120,000                84,200              114,800              1.48             1.71
                       -4% vs 87,700       -4% vs plan          target 1.55      iROAS 1.70 vs 1.78

Day      Moments          Target    Projected   Actual    Delta       | Campaign            Type  Share  Target  Projected  Actual  ROAS  iROAS  Target
1 Sun                     4,100     3,950       3,950     -150        | ACQ | Evergreen     ACQ   61%    ...
...                                                                   | RTN | Evergreen     RTN   12%
27 Fri   Black Friday     9,800     9,400       -         -           | ...
```

- **Target**: the plan's daily spend for the platform's channels (the default plan of that year).
- **Projected**: a past day is its actual. A day still to come is its target times the pace so far (spent so far ÷ target so far). With no plan, the days to come use the average of the last seven days.
- **Campaign share**: the campaign's part of the platform's spend over the last 28 days with data (7, 14 or 28). Its target and projection are the platform's times that share. Picking a campaign shows its own days in the day table.
- **Return**: platform ROAS as synced (7-day click), iROAS (ROAS x the channel's factor), the plan's ROAS target for the campaign's channel, and the ROAS needed on the days left = (planned platform revenue - platform revenue so far) ÷ target spend left.
- **Moments**: the calendar's events on each day.
- **Launches**: for Meta, each day shows how many campaigns got new ads that day (the Calendar Report's launches), and the chart's title counts them for the month.

## Calls made (correct any)
1. The pace is one number for the whole platform (spent so far ÷ target so far), applied to every day left. A campaign that is being scaled this week is not projected faster than the others.
2. Shares come from spend, not from results: a campaign that spent 60% of the last 28 days carries 60% of the plan. It answers "can the account carry the spend", not "where should the spend go".
3. Test campaigns are left out when the store setting says so, as in the Paid Media report.
4. Budget and bid changes are not shown: the app does not hold them.
5. With no plan the page still works on actuals and a run-rate, and says a plan is needed for targets.
6. Google's tracker includes campaigns tagged for returning customers; each campaign is read against its own channel's target (brand, non-brand, returning).

## Not in this slice
The email tracker (needs the Klaviyo sync), Amazon and TikTok Shop trackers (they need the plan's daily targets per channel, slice 3), the business scoreboard (next), changing budgets from the app.

## Done when
On Point6 (real Meta and Google data and a plan) the Meta tracker shows the month's day table with targets, the projection and the campaigns with their shares; picking a campaign shows its days; the numbers add up to the Paid Media report's spend for the same days.

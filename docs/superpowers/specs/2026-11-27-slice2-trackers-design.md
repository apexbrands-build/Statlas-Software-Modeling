# Slice 2: trackers for the paid channels

Date: 2026-11-27 (revised the same day after João's two corrections and an independent review). Status: built on `development`, **not released**: waiting for João's word on the layout. Part of `2026-11-26-operating-system-blueprint.md`; method from `2026-11-26-ctc-operating-model-notes.md`.

## Goal (João, 2026-11-27)
"Take the total number of the forecast for spend and your efficiency targets for the platform. Then allocate in platform across your campaigns and see where you can maybe push more against targets. That's the whole idea for every tracker for every platform." And: non-brand and brand on Google, new and returning on Meta each have their own ROAS target, through their own incrementality factor.

## The page
One page per ad platform (Meta and Google today), Sidebar > Trackers. It is **one wide grid, not a dashboard**: the days of the month down the side, blocks of columns across.

```
Day        | Meta total                              | New customers             | Returning customers       | ACQ | Evergreen          | RTN | Evergreen ...
           | Target Projected Actual Delta ROAS      | Target Projected Actual ROAS | ...                    | Target Projected Actual ROAS
Month      | 275,995 260,869 172,992 -10,031 1.81    | 236,049 224,091 148,603 1.60 | ...
Sun 1      | 7,936   7,697   7,697   -238    1.93    | ...
...
Fri 27     | (days to come: target and projection, dimmed)
Black Friday
```

- The **total** block stays in place while the rest scrolls sideways. After it come the platform's **types** (Meta: new customers, returning customers; Google: non-brand, brand, and their returning versions when used), then every **campaign**. On every day the campaigns add up to the total.
- One sentence above the grid says where the month stands (spent vs target so far, heading to, ROAS vs target, ROAS needed on the days left). No tiles, no chart.
- Green and red compare actual with target (beyond 10% either way), on spend and on ROAS, so a campaign that is above its ROAS target and under its spend is visible at a glance.
- Controls: platform, month, the days the split is read over (7, 14, 28), ROAS or iROAS, leave out test campaigns. CSV of the whole grid.

## The numbers (`lib/trackers/spend-tracker.ts`)
- **Target** = the plan's daily spend, per type (the plan already holds spend per channel: Meta new, Meta returning, Google non-brand, Google brand...).
- **Split to campaigns**: a type's target is shared out to that type's campaigns by their share of its spend over the last 7, 14 or 28 days with data. A brand campaign only carries brand budget. Meta reports one campaign's new-customer and existing-customer spend apart: the tracker shows them as one campaign that carries a part of both types.
- **Projected**: a past day is its actual. A day to come is each type's target times that type's pace so far (its spend so far ÷ its target so far). With no plan: the average of the last seven days. A campaign's projection is what it spent plus its part of the days left.
- **ROAS target per type** = the month's aMER ÷ the type's incrementality factor (the plan's formula, typed targets win). New for the trackers: **returning types get a target too, by the same formula** (the plan's own screens still leave them out).
- **ROAS shown** = platform ROAS (7-day click); with "Show iROAS", revenue x the type's factor, against target x factor. The total's target is what the spend so far should have returned, each part at its own type's target (so it follows the mix really spent, not the planned mix).
- **ROAS needed on the days left** = (platform revenue the plan expects for the month − platform revenue so far) ÷ planned spend of the days left.
- **Planned spend no campaign carries** (for example brand budget with no brand campaign) is its own block at the end, so the grid adds up and the gap shows.
- **Moments**: the calendar's events under the day; for Meta, the days a campaign got new ads (a dot on that campaign's day).
- **Days read as actual**: up to the store's last day with data, or the ad platform's when its sync is up to three days behind (those days are still to come, not days of zero spend).

## Calls made (correct any)
1. Returning campaigns are read against aMER ÷ their factor (for example 2.3 ÷ 0.6 = 3.83 on Meta returning). The plan had no target for them. If returning spend should have its own bar, it needs its own number in the plan.
2. Each type has its own pace. The platform's projection is the sum of its types.
3. Shares come from spend, not from results: they say how the account is carrying the plan today, not where the spend should go. The colours on ROAS say where there is room.
4. Test campaigns are counted by default (the plan's spend holds their budget). Leaving them out says how much was left out.
5. A campaign's target is not a budget set for it: it is its part of the plan at the recent split. The 7-day window follows a change of budgets faster; 28 days is steadier.
6. Budget and bid changes are not shown: the app does not hold them.
7. The page opens on the month of the store's last day with data, and follows the plan Home is set to (baseline or stretch).

## Not in this slice
The email tracker (needs the Klaviyo sync), Amazon and TikTok Shop ad trackers (they need the plan's daily targets per channel, slice 3), the business scoreboard (next), changing budgets from the app, typing a target per campaign.

## Review
An independent review of the first version (tiles, chart, two tables) found two critical problems and five important ones; all are fixed with tests: the ROAS comparison mixed spend with and without a target; a stale picked campaign zeroed the page (the pick is gone with the new layout); the cut-off used the store's last day when the ad sync was late; leaving tests out said nothing; a campaign's projection did not match its own days; Google's target was blended at the planned mix; Meta campaigns appeared twice. The split by type and the grid were written after that review and have not had their own independent read yet: that comes before the release.

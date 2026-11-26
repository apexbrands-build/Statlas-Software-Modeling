# Slice 2: trackers for the paid channels

Date: 2026-11-26 (the file name is a day ahead; revised the same day after João's corrections and an independent review). Status: **released to production** (commit 29ebde9); João approved the layout and the numbers on 2026-11-26 and asked for a better visual organisation of the grid, done the same day. Part of `2026-11-26-operating-system-blueprint.md`; method from `2026-11-26-ctc-operating-model-notes.md`.

## Goal (João, 2026-11-26)
"Take the total number of the forecast for spend and your efficiency targets for the platform. Then allocate in platform across your campaigns and see where you can maybe push more against targets. That's the whole idea for every tracker for every platform." And: non-brand and brand on Google, new and returning on Meta each have their own ROAS target, through their own incrementality factor.

## The page
One page per ad platform (Meta and Google today), Sidebar > Trackers. It is **one wide grid, not a dashboard**: the days of the month down the side, blocks of columns across.

```
Jump to  New customers  [ACQ | Evergreen] [ACQ | Catalog] ...  Returning customers  [RTN | Winback]        [All columns | Actual and ROAS] [Download CSV]

Day        | Meta total                              | > New customers, 4 campaigns                                   | Returning customers, 1 campaign
           | [=====|--] 95%                          | Subtotal [====|--] 95%    | ACQ | Evergreen  37% [====|-] 95%  | RTN | Winback ...
           | Target Projected Actual Delta ROAS      | Target Projected Actual ROAS | Target Projected Actual ROAS  |
November   | 275,995 260,869 172,992 -10,031 1.81    | 236,049 224,091 148,603 1.60 | 101,332 95,979 63,573 1.60    |   (stays in view)
Sun  1     | 7,936   7,697   7,697   -238    1.93    | ...
Mon  2     | (a heavier rule opens each week)
...
Days to come   Projected: each type's target at its pace so far
Fri 27  Black Friday | 26,926  25,450  -  -  -        | ...
```

- The day and the **total** stay in place while the rest scrolls sideways; the header and the **month row** stay in place while the days scroll.
- After the total, the campaigns sit **under the type they mostly spend on** (Meta: new customers, returning customers; Google: non-brand, brand). A group with several campaigns opens with its **subtotal** (the sum of its campaigns) and can be folded down to it. On every day the campaigns add up to their subtotal and the subtotals to the total.
- Every block's header carries a **pace bar**: spend so far against target so far, with a tick at 100%. That row of bars is the page's quick read.
- **Jump to**: the list above the grid names every campaign (green or red when its ROAS is above or below target) and scrolls the grid to it.
- **Columns**: all four per campaign, or actual and ROAS only (twice as many campaigns in view).
- Two sentences above the grid say where the month stands and how each type of spend is doing, whatever campaign carried it. No tiles, no chart.
- Green and red compare actual with target (beyond 10% either way), on spend and on ROAS. Days to come sit under their own rule, dimmed. A dot marks a day a campaign got new ads.
- Controls: platform, month, the days the split is read over (7, 14, 28), ROAS or iROAS, leave out test campaigns. CSV of the whole grid.

## The numbers (`lib/trackers/spend-tracker.ts`)
- **Target** = the plan's daily spend, per type (the plan already holds spend per channel: Meta new, Meta returning, Google non-brand, Google brand...).
- **Split to campaigns**: a type's target is shared out to that type's campaigns by their share of its spend over the last 7, 14 or 28 days with data. A brand campaign only carries brand budget. Meta reports one campaign's new-customer and existing-customer spend apart: the tracker shows them as one campaign that carries a part of both types, and lists it under the type it mostly spends on. A group's subtotal is the sum of its campaigns (so on Meta it holds the returning spend its prospecting campaigns carry); the pure split by type is in the sentence above the grid. When a group is not its type's own spend (a campaign in it carries another type, or another group carries part of this one), its band says the campaigns are grouped "by where most of their spend goes" and the subtotal's target says it is not the type's plan (`TrackerGroup.matchesType`).
- **Projected**: a past day is its actual. A day to come is each type's target times that type's pace so far (its spend so far ÷ its target so far). With no plan: the average of the last seven days. A campaign's projection is what it spent plus its part of the days left.
- **ROAS target per type** = the month's aMER ÷ the type's incrementality factor (the plan's formula, typed targets win). New for the trackers: **returning types get a target too, by the same formula** (the plan's own screens still leave them out).
- **ROAS shown** = platform ROAS (7-day click); with "Show iROAS", revenue x the type's factor, against target x factor. The total's target is what the spend so far should have returned, each part at its own type's target (so it follows the mix really spent, not the planned mix).
- **ROAS needed on the days left** = (platform revenue the plan expects for the month − platform revenue made so far by the types the plan holds spend for) ÷ planned spend of the days left. Revenue of a type the plan holds no spend for (a campaign for returning customers on Google, Meta's reach to existing customers when the plan's Meta spend is all acquisition) is left out: the plan never expected it. When such a type spent, the sentence names the types it is about (`TrackerSummary.planTypes`).
- **Planned spend no campaign carries** (for example brand budget with no brand campaign) is its own block at the end, so the grid adds up and the gap shows.
- **Moments**: the calendar's events under the day; for Meta, the days a campaign got new ads (a dot on that campaign's day).
- **Days read as actual**: up to the store's last day with data, or the ad platform's when its sync is up to three days behind (those days are still to come, not days of zero spend). For a month that is over, the page loads the platform's rows up to three days past it (`trackerLoadTo`), so a quiet month end is read as days of no spend, not as a late sync; those rows change nothing else.

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
An independent review of the first version (tiles, chart, two tables) found two critical problems and five important ones; all are fixed with tests: the ROAS comparison mixed spend with and without a target; a stale picked campaign zeroed the page (the pick is gone with the new layout); the cut-off used the store's last day when the ad sync was late; leaving tests out said nothing; a campaign's projection did not match its own days; Google's target was blended at the planned mix; Meta campaigns appeared twice. The split by type and the grid were written after that review and got their own independent read on 2026-11-26, before the release (production, commit 29ebde9).

**Second review (split by type, groups, grid).** The adding-up held in every case tried (campaigns to subtotals to the total, on target, projection and actual). Fixed, each with a test that failed first:
- Critical: "ROAS needed" and "plan met" counted revenue of types the plan holds no spend for (since returning types got a ROAS target). On a plan of 100 a day to new customers, a campaign at ROAS 1.8 with a fifth of its spend reaching existing customers at 6.0 read "needs 0.72" instead of 3.12.
- Important: a group's subtotal was labelled as the plan's spend for its type when its campaigns also carry another type.
- Important: a month that is over, opened in the first three days of the next, read its quiet last days as a late sync (days "to come" in a finished month) and showed the late-sync note when nothing was waiting.
- Raised from minor, because it is the navigation João asked for: on a wide screen the group's name slid under the pinned total while scrolling. It now stays right of it. Also the by-type sentence no longer says "of a 0 target" for a type the plan holds nothing for.

**Left as they are (minor, for João to call):** a plan with rows for part of a month inflates pace (plans are written by whole months); a campaign with revenue but no spend in the month is not listed, so its revenue is only in the total; a campaign's group can change with the share window when its main type changed over time; a campaign with no targeted spend borrows its main type's target; the "no campaign" block can carry a projection from a type's earlier pace; an error from one failed load stays on screen until the next load ends; the CSV names every subtotal "Subtotal" and does not guard names that start with = + - @; launch dots match campaigns by name; the week rule is always Monday; the platform switch is marked up as tabs. Not judged by the reviewer: the page in a browser (checked by hand on demo data at 1470 px), real plans, the sample store's SQL.

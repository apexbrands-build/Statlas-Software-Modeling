# How CTC operates, and what it means for the operating-system design

Date: 2026-11-26. Status: analysis for João to correct. It is the basis for revising `2026-11-26-operating-system-blueprint.md`, which was written from the platforms' documentation and the code and not from this.

Sources, all already in the workspace: the CTC Canon notes (`Agency/Training/CTC Canon/`: overview, forecasting, email, Meta, measurement, creative, the saved Modeling page), João's notes on what the forecast is for (`docs/forecasting-context.md`), the notes on the reference tool's plan, trackers, calendar and hourly report (`docs/statlas-findings.md`, `docs/statlas-docs/`), the planning Notepad's layout (`Agency/Training/Copy of 2_Mikokos _ Notepad 2026.xlsx`), and the study notes on CTC's omnichannel system (2026-11-19). The saved screenshots are gone from `Statlas Original UX/` and were not found in git, the Trash or Drive; the written notes made from them are what is used.

## How CTC operates
1. **One currency: contribution margin.** Plans, forecasts and actuals are all in contribution margin, so marketing and finance read the same numbers. Outputs are read in this order: contribution margin; then sales, spend, MER and AOV; then customer numbers (cohort value, CAC, retention); then the numbers inside each platform. Every deviation is one of two things: a volume problem or an efficiency problem.
2. **Four steps, always in this order.**
   - *The calendar first.* A 12-month marketing calendar of moments (promotions, launches, cultural dates). Revenue is never linear; peaks are built, not assumed.
   - *The models.* Spending Power (what new-customer revenue a spend buys, with three points to choose from: first-order profit, break-even, lifetime), Retention (what each cohort brings back), Event Effect (how a moment moves the days around it while the month still adds up), Creative Demand (how many new ads the plan needs).
   - *The map.* The models give the month's spend and revenue; costs are layered in to a P&L down to profit; the month is split into channel and campaign targets. Every dollar, day and campaign ladders to the goal: an expectation for every input, every day.
   - *Plot, pivot, profit.* Each morning yesterday is compared with its expectation for revenue, spend, MER, contribution margin, CAC and orders, by channel and by campaign. What is the data showing; so what (volume or efficiency, which input, how much of the month it puts at risk); now what (a specific action today).
3. **The tools of the daily read.** Home against the plan. The calendar report: the day's numbers beside the moments and the goals. A tracker per channel: for each campaign, target, projected and actual spend, target and actual return, with the moments marked on the days. The email plan: the revenue email owns, flows as the floor, scheduled campaigns filling the gap.
4. **Who does what.** One operator owns the map and the morning read. Buyers run to the return targets that come from the incrementality factors. Email owns its share of revenue. Creative production is sized from the plan, per moment.
5. **Governance.** Spending Power is rebuilt as needed, Retention each quarter, Event Effect as needed, Creative Demand each month. Success is landing within about 10% of target and catching a bad input on day two or three. Models are tools: the operator bends them on purpose with a stated bet. When a model and the P&L disagree, the P&L wins.
6. **The omnichannel system (2026-11-19 episode).** The same method with more channels: spending power and retention for TikTok Shop as well as for the own site; Amazon revenue and spend, in total and by product, including how own-site spend moves Amazon; a halo model; an allocation model across sales channels; one P&L per channel and one combined, with daily targets for 35 or more metrics; and two views of it, reported and cascaded, where the cascaded one is the view decisions are made on.

## What the blueprint got right
One forecast feeding daily targets and team pages; a P&L column per channel with a cascaded view; halo factors typed from tests and never estimated in the app; the email plan as the Canon states it; the 10% band.

## What it missed, measured against the above
| CTC's way | The blueprint as written |
|---|---|
| Contribution margin first, then sales, spend, MER, AOV | A scoreboard that leads with revenue |
| The calendar of moments is the backbone of the plan and of every tracker | Moments appear only as "today's actions"; other channels have no moments |
| A morning read that names each gap as volume or efficiency, weighs it against the month, and ends in an action | No such screen; "what we are doing" was a list of calendar items |
| A daily expectation for every input of every channel (the plan's daily table) | A channel's month spread by its weekday pattern: one number a day |
| The same model chain per channel where the data allows (spending power, retention, events) | One regression per channel and a catalog of platform metrics |
| Trackers per campaign: target, projected and actual spend; target and actual return; projected re-based on the month's pace and shared out by each campaign's history | A generic "one tracker layout" |
| Models carry a rebuild cadence and a record of how accurate they were | Not present |

The slice that was started (a catalog of each platform's metrics, and file import) sits at the bottom of CTC's reading order. It is useful plumbing, and it is parked on `development` unreleased.

## What changes in the design
1. Every screen leads with contribution margin and follows CTC's reading order.
2. The calendar covers every channel (an Amazon deal, a TikTok Shop campaign or LIVE, a retail promotion or reset, an email send, a Meta moment). The plan starts from it and every tracker shows it.
3. Each channel gets the plan chain the own site has, as far as its data allows, ending in a daily table of targets per channel. Where a channel cannot split new from returning customers, it uses the total model CTC uses for Amazon, and says so.
4. Trackers follow CTC's layout, per campaign, with moments on the days. The email tracker follows the email plan.
5. A morning read is built as a screen of its own: gaps ranked by what they put at risk in the month's contribution margin, each marked volume or efficiency, each with an action and an owner. The daily message is written from it.
6. Models show when they were last rebuilt, when they are due, and how close they came.
7. The platform metrics (ACOS, sessions, GMV by source) become the detail under each channel, not the starting point.

## Open, for João
Who writes the "now what" for a channel: the operator from the morning read, or the channel's owner on its tracker.

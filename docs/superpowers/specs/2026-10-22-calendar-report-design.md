# Calendar Report (`/reporting/calendar`)

Date: 2026-10-22. Status: design approved by the strategist (visual mock, 2026-10-22); this spec awaits review before the implementation plan. Reference: Statlas Calendar Report, observed read-only (`docs/statlas-findings.md`, "Calendar Report", plus the screenshots in `Statlas Original UX/Reports/Calendar Report/`). We replicate the features and method, never the Statlas UI, copy or code. The approved look is the clickable mock (calendar-report mock, published as a private Artifact).

## Goal
The report the team opens every day. One row per day, each day showing the **marketing actions** that happened (calendar events, Meta campaign launches, email and SMS sends) beside the day's metrics and their plan goals, and a **line chart** above the table that plots any metrics with those actions marked, so the team can see what moved a day's result.

## Decisions (strategist, 2026-10-22)
- v1 is the screen with real data where data exists. Email and SMS markers (with the exact campaign name) go live when the Klaviyo and Postscript syncs exist; the report must need no change then, only a new action source.
- Heat shading follows the Home rule: within 10% of the reference is neutral, beyond that green when better and red when worse (not Statlas's stronger shading).
- Graph items: **no limit** on how many metrics are plotted. Each line is drawn on its own scale (the chart is about shape and timing, not absolute levels); the tooltip shows the real values.
- Marker design as in the mock (envelope = email or SMS, "f" = Meta launch, flag = calendar event; the count under each icon; hover lists the names).
- Graph items and Columns use the same metric list.

## What the screen has
1. **Controls:** Goals (plan version), Presets, Columns, Graph items, Projection checkbox, date range (the shared report range), toolbar toggles HeatMap, Deltas and Chart. Export is not in v1.
2. **Chart** (toggle, on by default): daily line per ticked Graph item; the first item also draws its goal as a dashed line; projected days dashed with a faint shaded band; hover shows a crosshair and a tooltip with every plotted value and the actions of that day with their full names. Action markers sit under the axis, one row per type.
3. **Table:** `Daily`, `Marketing Actions`, then for each column an Actual (Proj.) cell and a Goal cell; a TOTAL row (sums; ratios recomputed from sums; AOV and CAC as in the other reports). Elapsed days show actuals; future days show projected values in grey. HeatMap colours the actual cell against its goal; Deltas puts the gap to goal (% and colour) in the cell corner. Goal columns are tinted. First two columns and the header stay visible while scrolling.
4. **Presets:** All Columns, Basic MER View (Contribution Margin, Revenue, Spend, MER), Social Ads, Search Ads, Email/SMS/Organic, Only Goals, Hide Goals.
5. **Marketing Actions cell:** up to three icons (event, email or SMS, Meta launch) with counts; hover lists the names, grouped by type.

## Metrics (Columns and Graph items)
Contribution Margin, ECommerce Revenue, Total Spend, Marketing Efficiency Rating, Acquisition Revenue, Acquisition Spend, Acquisition MER, Returning Revenue, AOV, CAC, Email Rev, SMS Rev, Organic Rev (each with its Goal where the plan has one), then per-platform blocks as in the reference: Facebook (acquisition, non-acquisition and total: Spend, Revenue, ROAS) and Google (acquisition and brand: Spend, Revenue, ROAS), each with goals when targets exist. These are the same definitions as Home and the other reports (`lib/metrics.ts`, `lib/reports/metric-spec.ts`); no new formula is invented here. Email and SMS columns read 0 until their syncs exist, as they do on Home.

## Where each action comes from
| Marker | Source | State |
|---|---|---|
| Calendar event | `repo.listEvents` (the Calendar page); a multi-day event marks every day it covers | live |
| Meta launch | ads whose Meta creation date falls on the day (`meta_ads`, via the creative read functions), grouped by campaign name; catalog ads left out | live once ad-level data is loaded |
| Email or SMS send | a `MarketingAction` source for Klaviyo and Postscript sends (name = campaign name), added with the messaging sync | later |

All sources produce one shape: `{ date, type: "event" | "email" | "sms" | "meta", name }`. The report only reads that list, so adding a source never touches the report.

## Behaviour and edge cases
- Goals: the report follows the client's default plan for the range (as Home does); the Goals selector lists the client's plan versions, defaults to the default plan, and is hidden when there is only one. No plan: goal columns and the goal line are left out.
- Days with no data inside the range show a dash, never 0.
- Projection unticked: future days are dropped from the table and the chart.
- Ranges over 62 days: the table stays daily (it scrolls); the chart stays daily too, and markers of the same type on one day stack as one icon with a count.
- Links: lists only trackers whose report is ready (none today), so the button is hidden until one exists. The Ads filter is hidden the same way.
- Selections (columns, graph items, toggles) are remembered per browser; nothing is saved to the database. Save is not in v1.
- Phone width: toolbar wraps, the table scrolls sideways inside its own box, the chart scales to the width.

## Structure (units, each testable alone)
- `lib/reports/calendar.ts`: pure. `calendarRows(range, data, specs)` builds the rows (actual, goal, delta, heat tone, projected flag) and the total row; `actionsByDay(sources)` merges action lists; heat and delta use the shared `compare` rule.
- `lib/reports/calendar-specs.ts`: the metric specs for Columns and Graph items (reusing `MetricSpec` and `METRICS`), the presets.
- `lib/reports/calendar-actions.ts`: gathers the actions: events, Meta launches; a registry where Klaviyo and Postscript plug in later.
- `components/reports/CalendarReport.tsx` (screen), `CalendarChart.tsx` (SVG line chart with markers and tooltip), `CalendarTable.tsx`; routed from `ReportRouter` and the registry status moves from `planned` to `ready`.

## Tests
Row building against a fixture of days (actual, goal, projected split, total with recomputed ratios); heat tones and deltas on both directions including the 10% neutral band and a missing goal; presets select exactly the listed columns; action merge and multi-day events; a day with several actions of one type; Meta launches exclude catalog ads; no plan leaves goals out; projection off drops future days.

## Not in v1
Export, Save, the Ads filter (hidden until per-platform filtering exists, rather than shown and inert), Links (hidden, no tracker exists yet), hourly view (the Hourly Report reuses this engine next), Klaviyo and Postscript actions (a later source on the same interface).

## Done when
On a client with a plan and Meta data, the report shows the days of the chosen range with goals, heat and deltas, the chart with any number of ticked items, calendar events and Meta launches marked with their names on hover, and the same screen picks up email and SMS actions as soon as their source exists.

# Beta readiness audit: forecast, calendar, tracking, ROAS targets (2026-10-14)

Beta Wed Oct 21, team roll-out Mon Oct 26. Read-only audit: code read, 396 tests pass, type check clean. Screens were not opened in a browser, and a live Supabase save was not tried (it needs a login).

## (a) Verdict per foundation

**1. Creating the forecast: WORKS (some numbers disagree).**
New Customer and Returning models, Create forecast, Overview, Summary, stretch and Save plan are built and tested (`lib/planning/new-customer.ts`, `returning.ts`, `stretch-plan.ts`, `components/planning/PlanEditor.tsx`). Save plan writes daily rows that Home reads. Problem: aMER is not computed the same way on every screen (see c1).

**2. Calendar adjusts the daily targets: PARTIAL.**
Inside the plan editor it works. Adding an event reshapes the daily rows (`generateMonth(events)` in `lib/planning/generate.ts`), every planned month is marked unsaved, and Save plan writes them. Two problems:
- An event added on the sidebar **Calendar page** (`/calendar`) never reaches the targets. The message says plans "pick it up the next time they are opened", but when the plan opens nothing counts as changed, so the Save plan button reads "Saved" and is greyed out (`needsSave` in `PlanEditor.tsx`). Home keeps the old targets.
- An event type with no **past** events in the calendar has **no effect at all**: every multiplier is 1 (`liftsFor` in `lib/planning/events.ts` returns "none" when nothing has been measured). Most clients have not tagged any past events yet, so typing in BFCM 2026 changes nothing unless the strategist types the lifts by hand in Models > Event.
- By design, events only move revenue between days: the month total stays the same. BFCM does not raise November.

**3. Daily expectation vs realization: PARTIAL.**
These work:
- Home "Compare: Plan" uses only the days that have data, so "This month" gives month to date vs plan (`lib/dashboard-data.ts`).
- The Marketing Efficiency report grouped by day shows Actual / Goal / Goal % for each day (`components/reports/MetricGoalReport.tsx`).
- The P&L report's P and F columns are live (`lib/reports/plan-pnl.ts`).

These are missing or wrong:
- Home opens on **Last year**, not Plan. You must switch it every time.
- There is no "Yesterday" preset (you can click the same day twice in the calendar).
- Home shows no full-month target or month-end pace, only the target to date.
- Channel tiles have a plan target for spend only, not for ROAS or iROAS.
- aMER targets are wrong for clients that leave brand or retention spend out of aMER (c1).
- Actuals only arrive if the daily refresh runs, which needs `CRON_SECRET` in Vercel. That is still listed as open in CLAUDE.md.

**4. Incremental ROAS targets for channel allocation: MISSING (half of it exists).**
- Built: the factors per client and channel (Store Settings > Edit > Incrementality, `components/settings/EditStoreDialog.tsx`), and actual ROAS and iROAS on Home channel tiles and in Paid Media Overview (`lib/metrics.ts` `groupStats`, `lib/reports/paid-media.ts`).
- Not built: "platform ROAS target = aMER target ÷ factor" **does not exist anywhere in the code.** No variable or screen computes it, and nothing compares actual ROAS or iROAS against a target.
- Two docs wrongly say it is built: `docs/future-vision.md` ("(built)") and `docs/superpowers/specs/2026-10-12-channel-mix-design.md` ("already built"). The plan that would build it (`docs/superpowers/plans/2026-10-13-channel-mix-and-mmm-option.md`) was never started; even its extra default factors (YouTube, TikTok, Snapchat) are not in `lib/defaults.ts`.
- The Spend step split is hand-set sliders with no ROAS input, and the MMM buttons are disabled placeholders.

**5. Events change daily rows and Home after Save plan: PARTIAL.** Same as 2. It works end to end when three things are true: the event is added inside the plan editor, the event type has measured history or typed lifts, and you press Save plan. Otherwise nothing changes, and the screen gives no warning.

## (b) Gaps by impact for the beta (Claude working days, tests written first)

| # | Gap | Size | Exact change |
|---|---|---|---|
| 1 | Events from the Calendar page never reach the targets | 1 | On opening a plan, compare the saved daily rows with the ones the editor generates. If they differ, mark those months unsaved and show a banner "Calendar changed: Save plan to update targets". Show the same hint on the Calendar page with a link to the default plan. |
| 2 | Event types with no history have no effect (BFCM risk) | 1 | Default lifts per event group (BFCM, offer, launch, holiday, comms), used when nothing has been measured and labelled "default". Add a warning chip in Calendar and Spend: "no lift applied". Strategist supplies the numbers (Q1). |
| 3 | No ROAS targets | 2 | New pure function: for each month and platform, iROAS target = month aMER; platform ROAS target = aMER ÷ the channel's factor. Show it as a column in the Spend step allocation (spend, factor, iROAS target, platform ROAS target, expected platform revenue). Add it as the plan target on the Home channel ROAS/iROAS tiles and as a Goal column in Paid Media Overview. |
| 4 | aMER target uses total spend; aMER actual uses acquisition spend | 0.5 | Store acquisition spend in the plan totals, built from spend per channel plus the client settings. Use it for the Home aMER target, the MER report's "Acquisition Spend" and "Acquisition MER" goals, and the aMER columns in Spend and Input. |
| 5 | Home is not a daily tracking screen | 1 | Open on Compare = Plan when a plan exists. Add a "Yesterday" preset. Show the month target, target to date and projected month end (actual + remaining plan) on the CM hero and the revenue and spend tiles. |
| 6 | P&L "P" column leaves out ad spend when a month has no platform split | 0.5 | `planDayToFact` puts unsplit spend into an "unassigned" channel, so Plan CM matches Home. Or block saving a month with spend and no split. |
| 7 | Live save never verified with a login; save is not all-or-nothing (old rows are deleted, then new ones inserted) | 0.5 | João logs in and Claude runs one save, reload and Home check on a test client. Keep the transaction fix (needs a migration) for after the beta. |
| 8 | Deleting an incrementality factor does not stick | 0.25 | `lib/repository/supabase.ts` merges the defaults back in on every load. Store a deleted factor explicitly as 1, or stop merging defaults after the first save. |
| 9 | Save allowed before history loads (events and weekday pattern can be dropped) | 0.25 | Disable Save plan while the history is loading. |

Total: about 7 days. Rows 1 to 5 are about 5.5 days.

## (c) Screens that disagree ("not synced")
1. **aMER, three ways.**
   - Overview, Summary and Home actual: new revenue ÷ acquisition spend.
   - Spend daily table, Input tab, Home aMER target, MER report goals: new revenue ÷ total spend.
   - Which ones differ: for any client with "exclude brand" or "exclude retention from aMER" on, a typed aMER of 2.5 shows as about 2.1 in the Spend table. The Home target is too low, so the actual looks green.
2. **Calendar page vs plan.** The same events are stored in both places, but only the editor reshapes the days. Home targets ignore events added from the sidebar page.
3. **Plan CM vs P&L Plan column.** They differ when a month has spend but no platform split: the P&L Plan column drops the ad spend.
4. **Home Stretch vs reports.** Choosing Stretch on Home switches Home only; the reports stay on baseline.
5. **Store Settings vs saved targets.** Changing cost %, per-order cost or the aMER exclusions does not regenerate saved targets until the next Save plan.
6. **Factor settings vs ROAS tiles.** Deleting a default factor reappears after reload, while the screen briefly says it is gone.
7. **Docs vs code.** ROAS target per platform is called "built" in two docs and does not exist.
8. **Plan for the wrong year.** When the range's year has no plan, Home still names an older default plan and shows blank targets (`pickPlan` fallback in `lib/planning/scenarios.ts`).

## (d) Shortest path to a believable beta by Oct 21
- **Thu 15:** gap 4 (aMER, half a day), gap 9, gap 8. Then gap 1, Calendar sync (1 day).
- **Fri 16:** gap 2, default event lifts (needs Q1 answered by Thursday night). Gap 6, P&L spend.
- **Mon 19 to Tue 20:** gap 3, ROAS targets, display only. Spend step column, Home channel tile targets, Paid Media Goal column.
- **Tue 20 (pm):** gap 5, minimal version: open on Plan, Yesterday preset, month target on the CM hero. Gap 7, a live save test with João logged in on one real client with BFCM 2026 in the calendar.
- **Wed 21:** beta on two or three clients. Fix only what breaks.

Cut until after Oct 26:
- automatic allocation and MMM: targets are shown, the strategist still moves the sliders
- per-campaign trackers
- the all-or-nothing save
- the stretch in reports
- regenerating targets when settings change: tell the team to press Save plan after editing Store Settings

Also: fix the two docs that call ROAS targets built.

Team rule for the beta: every client needs a default plan for 2026 with a platform split each month, BFCM and November events typed in the plan's Calendar tab with lifts checked in Models > Event, and Save plan pressed afterwards.

## (e) Questions only the strategist can answer
1. **Default event lifts** when a client has no tagged history: spend, new-revenue aMER and returning multipliers for BFCM, a sitewide offer, a launch, a holiday and an email or SMS blast. Use Canon or agency numbers, or require them typed per client?
2. Should BFCM and big events **add** revenue to the month, or only move it between days, as now? The New Customer model drops BFCM week from its fit, so November may be planned low.
3. **ROAS target formula.**
   - Which aMER: the month's planned aMER, or that day's (event days have a higher one)?
   - For non-acquisition lines (Google Brand, Meta retention), whose revenue is mostly returning, what is the target based on? aMER ÷ factor would set a target for spend that aMER does not count.
   - Should the target show 7-day click platform ROAS only?
4. Should ROAS targets **drive** the Spend split for the beta, for example by warning when a platform's expected ROAS is below target, or only be shown?
5. Which clients turn on "exclude brand / retention from aMER"? That decides how urgent gap 4 is.
6. Is `CRON_SECRET` set in Vercel, and do the beta clients' syncs finish daily? Without it there is no "yesterday".
7. Should Home default to Plan for everyone, or only once a plan is marked final?
8. Which two or three clients are in the Oct 21 beta, and do they each have a 2026 default plan already saved?

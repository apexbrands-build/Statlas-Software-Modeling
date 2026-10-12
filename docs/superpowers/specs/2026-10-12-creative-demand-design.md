# Creative Demand model, Creative Score and ad-level creative data

Date: 2026-10-12. Status: draft for the strategist's review. Depends on the Meta connector, the planning layer (`docs/planning-layer.md`) and the marketing calendar. Source of the method: `Agency/Training/CTC Canon/creative-strategy.md`; layout from the strategist's screenshot (the Statlas creative demand model, 2026-10-12, saved in `docs/creative-demand-reference/`).

## Goal
For each month of a plan, say **how many new ads the account needs**, how many are evergreen and how many are for marketing moments, how many images and how many videos, tied to the plan's Meta spend and the marketing calendar, and show it next to a **Creative Score** that diagnoses the account's creative health. Actuals come from Meta at ad level, so the strategist sees what was launched and what it did.

## Decisions (strategist, 2026-10-12)
- The CLAUDE.md rule "never build Best Creatives" is lifted for our own design: ad-level creative data, this model and a Best Creatives view are in scope (Global Creatives, DTC Index and Trend Explorer stay out). Updated in `CLAUDE.md` and `docs/reports-plan.md`.
- Formula from the Canon: **new ads = (target spend - current spend x carry rate) / expected spend per new ad.**
- The target spend is the plan's Meta spend. The share for moments follows the calendar: the more marketing-calendar days in the month, the larger the moments allocation.
- Targets rest on the account's own history; format advice (video or image) comes from what performed in the account's Meta data.
- The model lives with the other models and shows a month grid with last year and actuals; picking a month shows what actually happened.

## Data: ad level from Meta (new)
- `meta_ads`: `client_id`, `ad_id`, `name`, `campaign_id`, `campaign_name`, `adset_id`, `created_at`, `format` (`video`, `image`, `carousel`, `other`, from the ad creative's type), `is_catalog` (campaign name contains a keyword, default "catalog", "dpa", "daba", editable per client like the brand rule), `status`.
- `meta_ad_daily`: `client_id`, `ad_id`, `date`, `spend`, `impressions`, `clicks`, `purchases`, `revenue`; rows only on days with spend. Primary key `(client_id, ad_id, date)`, indexed by `(client_id, date)`. Attribution follows Store Settings (default 7-day click), as the campaign sync does.
- Sync: a new Meta job kind at `level=ad`, `time_increment=1`, 7-day chunks, same System User token, 13 months of history on connect (YoY needs last year), last 14 days on the daily tick. Ad-level volume (rows per client and Meta's rate limits) is measured in step 1 of the plan before the chunk size is set. Ad names, ids and metrics only; no creative images are stored.
- Moments: an ad is a **moment ad** when its `created_at` falls in the lead window (default 14 days) before a calendar moment or inside it; every other ad is evergreen. The rule is shown on the model screen and can be set to "by name tag" later.

## Creative Score (0 to 100)
Five metrics over the last 30 days unless stated, each turned into 0 to 100 and averaged with equal weight:

| Metric | Definition | Direction |
|---|---|---|
| Zero-revenue rate | ads that spent in the window and produced no purchases / ads that spent | lower is better |
| Ad concentration | share of spend on the top 5 ads | lower is better |
| ROAS degradation | account ROAS in the 7 days after each new batch launch against the 7 days before, spend-weighted, last 90 days. A batch = ads created on the same day | closer to 0 is better |
| Spend degradation | spend-weighted week-over-week change in spend of ads live in both weeks, last 4 weeks (negative = decay) | closer to 0 is better |
| Evergreen share | ads that spent in the window and were created more than 30 days earlier / ads that spent | higher is better |

Reading: below 50 the account needs more ads (Canon). The score is a diagnostic beside the demand number; it does not change the arithmetic.

**Benchmarks, honestly.** The Canon ranks each metric as a percentile against managed stores, and we do not have that table (the strategist's Statlas plan no longer shows it). In two stages:
1. **Provisional bands** until the portfolio has data: each metric maps linearly between two anchors, set from the one Statlas example in the screenshot and the Canon's numbers (74% of ads get any spend, about 1 in 100 ads becomes a whale). Zero-revenue 30% = 100 and 70% = 0; concentration 15% = 100 and 42% = 0; ROAS degradation 0% = 100 and -15% = 0; spend degradation 0% = 100 and -60% = 0; evergreen share 0% = 0, 33% = 76, 50% = 100. The screen labels the score "provisional".
2. **Percentile against our own portfolio:** once at least 10 clients have 90 days of ad-level data, each metric is percentile-ranked across the agency's clients (direction-aware), which is the Canon's method with our stores as the reference set. Bands live in one file (`lib/creative/score.ts`) so the switch is a data change.

To confirm with the strategist: "zero-revenue rate" is read as ads that **spent but returned no revenue**; the strategist remembered it as ads with zero spend. Ads with no delivery at all are shown separately as "undelivered".

## Demand model (per plan month)
- **Target spend** = the plan month's Meta spend (acquisition and returning) minus the catalog share (`is_catalog`). Catalog ads are carved out (Canon: different math).
- **Current spend** = last full month's non-catalog Meta spend (the latest 30 days while the month is open).
- **Carry rate** = spend this month on ads created before the month / total spend last month, from the account's own history, median of the last 3 months with data, clamped to 0.5 to 1.1. Canon passive range 70 to 75% is the default when the account has under 3 months; editable per month.
- **Expected spend per new ad** = mean first-30-day spend of ads launched in the last 6 months with data (mean, because spend is a power law). Canon range 192 to 397 dollars is the default for accounts with under 3 months and a sanity flag outside it. Editable.
- **New ads needed** = max(0, round up of the formula). A month whose carry already covers the target says so.
- **Moments share** = distinct days in the month covered by calendar moments (events with a category other than `email` and `sms`, and their duration) / days in the month, capped at 30% (Canon: non-compounding promo creative at most 30% of the month's production); editable. Moments ads = round(needed x share); evergreen = the rest.
- **Images and videos:** per format, over ads launched in the last 12 months: count, spend, ROAS and the share that reached the winner tier (spend above the account mean). The recommended split is each format's share of winner spend, blended 50/50 with the current production mix, and 50/50 when a format has fewer than 20 ads (the screen says why). Carousel and other count with images. The split is applied to evergreen and to moments separately; the remainder goes to the larger format.
- **Save, Regenerate, Lock** like the Statlas screen: numbers are stored per plan month in the plan (`plan_months.inputs.creative`: needed, evergreen, moments, split, overrides, locked). Regenerate recomputes from the current plan and history and keeps locked months and typed overrides. Months with `status = locked` are locked here too.

## Screen (third model in the plan editor's Models tab)
1. **Top row:** Creative Score card with its five metrics (value and 0 to 100 marker, Poor / Average / Great scale) and a short insights text written from the numbers; Target card with the month picker, Moments and Evergreen progress bars (launched / needed, by images and videos) and the ring "total new ads needed"; Save, Regenerate Plan, Lock Plan.
2. **Month menu:** all twelve months visible as buttons (not a dropdown); clicking one loads that month everywhere on the screen.
3. **Year table (grouped per month):** target ads, ads launched this year, ads launched last year, Meta spend last year, efficiency last year (aMER and ROAS), this year's target spend or actual spend, actual aMER; year total row.
4. **Month view (opens above the table for the picked month):** ads launched by day (count and format), daily Meta spend and aMER with the launch days marked, spend of the batch in its first 7 and 30 days, and a list of the month's launches (name, format, launch date, first-30-day spend and ROAS). For the open month "launched so far" fills the progress bars.
5. Months without ad data say so; the demand number falls back to the Canon defaults and is labelled "no account history".

## Creative intelligence (stage 3, own plan later)
A Best Creatives view from the same tables (ad list, metric chips, store averages as benchmark) and a **scaling-winner flag** (spend up X% week over week with ROAS above the store average). Specified when stage 2 is live.

## Stages
- **1. Ad-level Meta data:** tables, sync, backfill, formats, catalog and moment tags.
- **2. Score and demand model:** pure modules in `lib/creative/`, the model screen, plan storage.
- **3. Creative intelligence.**

## Tests
Every formula on fixtures: carry rate and spend per new ad from a known ad history; needed ads for known target, current spend and carry (including carry above target = 0); moments share from calendar days with the cap and from overlapping events counted once; the format split including the under-20 fallback and the remainder rule; each of the five score metrics on a fixture ad set (including a batch launch for ROAS degradation); band mapping and the percentile switch; month table totals tie to `meta_ad_daily`; Regenerate keeps locked months and overrides.

## Not in scope
Creative images or video previews, tags by hook or angle, producers and contracts, product matrix (Canon steps 4 to 6), automated briefs, catalog ad planning.

## Done when
A client with Meta connected shows a Creative Score from its own ads, a number of new ads per plan month tied to the plan's Meta spend and the calendar, the image and video split with its evidence, the year table with last year and actuals, and the month view; saving, locking and regenerating work; CLAUDE.md and the reports plan carry the new rule.

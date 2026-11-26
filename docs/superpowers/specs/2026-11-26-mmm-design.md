# Media mix model (MMM)

Date: 2026-11-26. Status: **design for João to approve; nothing built.** A new phase of the app (the sidebar's "MMM" entry is still marked "Soon"). His ask that day: an MMM quickly, in-house and "similar to CTC's" if possible, with room to plug in other providers' models.

## Goal
For a brand that sells on several channels (own site, Amazon, TikTok Shop, retail): say what each media channel really brings on each sales channel, and how to split next month's media budget. Platform ROAS cannot: each platform counts its own sales, and none sees what its ads do on Amazon or on the shelf.

## Where it sits (CTC's chain, and the app's)
CTC: "Using MMM, we allocate the monthly media expectation into channel-level, campaign-level daily targets that ladder up to the overall financial goal of the organization." The app already has every other link:

```
plan: the month's media budget (spend and aMER model)
  -> MMM: the split by channel + a factor per media channel and sales channel     <- missing: typed by hand today
  -> ROAS target per type = aMER ÷ factor            (plan, halo grid: built)
  -> a daily target per type                         (plan: built)
  -> the trackers, by campaign                       (built)
```
Today the split is the planner's mix and the factors are typed (benchmarks, tests, assumptions). The halo design's rule was "the app never estimates a factor". This design changes it to: **the app can estimate a factor, and never puts one in use by itself.**

## What CTC says about its own model (public pages, read twice on 2026-11-26)
- First version, 2020-21: "we used Robyn, Meta's open-source MMM package." Its problem: "Meta would claim unreasonable amounts of credit."
- Spring 2022: "We moved from Robyn to a more rigorous Bayesian model", with "built-in priors, better diagnostics, modeled adstocks and diminishing returns". That version "ran in 48 hours, and every small change in a variable could change the answer dramatically."
- Today: "Good priors come from understanding the business holistically, not from a formula." Data: "at least 52 weeks of consistent spend and revenue data across the channels you want to model"; with less, "tighter calibration against known experiments or lift tests".
- Not stated on any page read: the library, weekly or daily, national or by region, how often it is refit. (A local study PDF names a framework and a monthly refit; not verified.)
- CTC also plugs in outside measurement (it has bundled Measured for new clients), and its method ranks channel allocation by test-derived iROAS. So "our model plus outside results plus tests" is CTC's own shape.

## Approaches
1. **Results only.** The app stores a model's results (ours, a provider's, typed), shows them, and lets a person put the factors in use. No engine of our own. Fast; depends on someone else's model.
2. **Results + our own Bayesian model (recommended).** The same results layer, plus a model in CTC's form (carry-over, diminishing returns, priors, calibrated by tests), run as a scheduled job that writes into that layer. The results layer is built first, so approach 1 is the first slice of approach 2.
3. **A light regression inside the app** (ridge, in TypeScript). Runs anywhere, but it is the Robyn-style version CTC left for the reason quoted above, and it gives no intervals. Not proposed.

## The design (approach 2)

### One place for a model's results
A **run** = who made it (in-house, a provider's name, typed), the period, whether tests calibrated it, how well it fits, and for each media channel × sales channel: contribution, incremental ROAS and factor (each with a low and a high), carry-over, and the response curve's parameters. Plus the weekly split of each sales channel's revenue into baseline and each media channel. One additive migration (tables for runs and their numbers); a provider's file or our own job fill the same rows.

### The page (Sidebar > MMM)
```
MMM   [ Run: 24 Nov 2026, in-house v ]   Not calibrated by tests    Fit: backtest error 9%      [ Add a run from a file ]

What drives sales   [ Own site v ]     weekly bars: baseline + each media channel, the line is actual

Factors             (same grid as Store Settings: media channel x sales channel)
                    Own site            Amazon             TikTok Shop        In use today
Meta, new           0.92 (0.71-1.10)    0.21 (0.05-0.38)   0.04 (0-0.11)      1.15 benchmark
Google non-brand    0.58 (0.40-0.77)    0.09 (0-0.20)      -                  0.65 benchmark
...                                                                           [ Put these factors in use ]

Where the next dollar goes   response curve per media channel, today's spend marked, marginal ROAS now
Budget [ next month's plan v ]   current split | split where marginal returns are equal | expected change      [ Use this split ]
```
- **Put these factors in use** writes the chosen cells to Store Settings (the factor and the halo cell, with the run as source, its date and the spend level). A person clicks it; nothing changes on its own. The plan's ROAS targets and the trackers then follow, as they do today.
- **Use this split** writes the month's channel mix in the plan. It comes with the plan's Channels step (a later slice).
- Every number shows its interval and its source. A run with no test behind it wears "Not calibrated by tests". Where an interval is as wide as the prior, the page says the data did not move it.
- Runs from different sources sit side by side, so an outside provider's model can be compared with ours before either is put in use.

### Our own model
- **Weekly, one brand.** Outcome per sales channel: own-site new-customer revenue (what aMER is measured on), Amazon, TikTok Shop, retail when weekly sales exist. Returning-customer revenue waits for email and SMS data.
- **Media channels**: each one with spend history. Each gets carry-over (spend keeps working in later weeks) and diminishing returns.
- **Baseline**: trend, season, the calendar's events, discount depth, and breaks typed as events (a stock-out, a recall).
- **Priors = the factors in use today.** Each cell starts from the factor in Store Settings, wide for a benchmark or an assumption, tight for the brand's own test. This is how the app's knowledge enters, and why a thin history does not produce wild answers.
- **Tests calibrate it.** A lift or geo test goes in as: channel, spend level, change in spend, lift, its error. A small tests table holds them.
- **Engine: PyMC-Marketing** (Python, Apache-2.0, runs on CPU, takes lift tests through `add_lift_test_measurements`). Google's Meridian is the better fit once sales exist by region (it is built for that and wants a GPU): the results layer does not care which one wrote the run. Robyn is not Bayesian and its repository has been quiet since mid-2025.
- **Checks before a run can be put in use**: a backtest on the last weeks held out; a refit with small changes, to see the answer hold (CTC's own failure mode); no channel with an impossible carry-over. A run that fails is kept as failed, with the reason.

### Where it runs
Not inside the app's requests: Vercel functions stop at 300 to 800 seconds. A scheduled Python job reads the weekly table from the database, fits, and writes a run. First home: a GitHub Actions workflow in this repository (weekly, and by hand), with the database key as a repository secret João adds himself. How long a fit takes on real data is not known until the first run; if the runner is too small, the same job moves to Vercel Sandbox or a host with a GPU. A single-store copy of the app runs its own job against its own database.

## Data
| Needed | In the app today |
|---|---|
| Sales per sales channel by week, 1 year at least, 2 to 3 better | Own site by day (new and returning). Amazon, TikTok Shop and retail by file import; no connectors |
| Spend per media channel, same period | Meta and Google only. Amazon ads, TikTok ads, YouTube, creators: not held (Amazon's ads API keeps about 95 days, so history means exports) |
| Promotions, launches, price | The calendar's events and daily discounts. No price history |
| Stock-outs, supply breaks | No: typed as events |
| Doors per retailer per week | Typed doors and velocity only, no history |
| Email and SMS | No sync yet |
| Sales by region (for a model by geography and for geo tests) | No: orders carry no address |
| Test results | Factors and halo cells with source, date and spend; no tests table |

Google's own guidance for a national weekly model: "With two years of weekly data (104 data points), you have four data points per parameter. This sample size is too low to estimate the model reliably." So a national run leans on its priors; tests and regional data are what make it sharper.

## What it cannot claim
- Without a test behind it, a run is a fitted description of how sales moved with spend, not proof of incrementality.
- Channels that scale on the same weeks cannot be told apart by data alone: the prior decides, and the page says so.
- Nothing about spend levels the brand has never run.
- Brand search and retargeting mostly collect demand others created; the model cannot fix that by itself.
- Under 52 weeks of history: no run. The factors stay typed.

## Build order
1. **Results layer**: the tables, the page (runs, what drives sales, factors, response curves), "Add a run from a file", "Put these factors in use". The sample store gets a made-up run so the page shows. Released on its own.
2. **Our model**: the weekly table, the job, priors from Store Settings, the checks. First real run on a store with enough history.
3. **Use this split** into the plan, with the plan's Channels step.
4. **Tests table** and calibration; the model by region when sales by region exist.

## Calls made (correct any)
1. PyMC-Marketing first; Meridian when there are sales by region.
2. A run never changes a factor: a person puts it in use.
3. Outside providers' results come in through the same place, by file or typed, and sit beside ours.
4. Own-site outcome = new-customer revenue.
5. The job runs on GitHub Actions first.
6. Weekly data; refit at most weekly; the page always shows the date of the run in use.

## Open for João
1. Is this order right: results layer first, then our model?
2. Which outside provider is likely? It decides the first import file. Of those looked at, only Recast documents a way to get results out (an API and CSV exports); Prescient, Measured, Haus, WorkMagic and Northbeam's MMM state none.
3. For the first real brand: can 2 to 3 years of weekly sales per channel and spend per media channel be had in the first week? Without them the model has nothing to fit.

## Sources
Read 2026-11-26, the load-bearing quotes by two separate fetches.
- CTC: [How we built the best MMM for DTC](https://commonthreadco.com/blogs/coachs-corner/how-we-built-the-best-mmm-for-dtc) (Aug 5 2026); [Forecasting methodology](https://commonthreadco.com/pages/methodology-forecasting); [Measurement methodology](https://commonthreadco.com/pages/methodology-measurement); [bundling an outside measurement provider](https://commonthreadco.com/blogs/ecommerce-playbook/secret-to-smarter-budget-allocation) (Jul 30 2024).
- Libraries: [PyMC-Marketing lift tests](https://www.pymc-marketing.io/en/stable/notebooks/mmm/mmm_lift_test.html), [repository](https://github.com/pymc-labs/pymc-marketing); Meridian [amount of data needed](https://developers.google.com/meridian/docs/pre-modeling/amount-data-needed), [ROI priors and calibration](https://developers.google.com/meridian/docs/advanced-modeling/roi-priors-and-calibration); [Robyn repository](https://github.com/facebookexperimental/Robyn).
- Where it can run: [Vercel function limits](https://vercel.com/docs/functions/limitations), [Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing), [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits).
- Providers: [Recast export](https://docs.getrecast.com/docs/export-your-data), [Recast Insights API](https://getrecast.com/insights-api-announcement/). Prices: none published for MMM by any provider looked at.
- In this repository: `docs/superpowers/plans/2026-10-13-channel-mix-and-mmm-option.md` (the earlier note on a full MMM), `docs/superpowers/specs/2026-11-20-halo-layer-design.md` (factors and the halo grid), `lib/types.ts` (`HaloCell`).
- Not verified: the named framework and monthly refit in the local study PDF; run times of any library; whether any provider but Recast lets results out by API.

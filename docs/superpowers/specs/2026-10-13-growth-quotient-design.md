# Growth Quotient diagnostic in Apex Analytics

Date: 2026-10-13. Status: **DRAFT, not started.** The method below is verified against a live run of CTC's diagnostic. The replication design incorporates João's answers of 2026-10-13 (window, cohort blending, revenue peaks); the remaining defaults are listed at the end for him to confirm. Building it is a new phase, so it starts only on his go-ahead (`docs/pacha-handoff.md` lists it after the Pacha kickoff). Fits the idea in `docs/scenarios-and-diagnostic.md` section 3.

Sources: João's reference file `~/Consulting Projects/Growth Quotient.md` (section "CTC diagnostic: live walkthrough", 45 numbered screenshots in `~/Consulting Projects/Growth Quotient Screenshots/`) and the PDF export saved next to it. CTC's copy, images, videos and links are theirs: reproduce the **method**, write our own wording and never copy their text or design.

## Goal
Compute the ten Growth Quotient metrics from data the app already holds, ask only for what it cannot infer, score them, and show a one-page report per client. Keep a snapshot each month so the score updates over time. Later, compare each client with our own client database. The score is a **directional read**, not an audit.

## Decisions (João, 2026-10-13)
- It is computed **inside the app**, so it updates as the underlying metrics change.
- **No cap** on the score. A brand scoring far above 130 is simply a strong brand. (CTC's own scoring has none either.)
- The thresholds stay as on slide 7. They match CTC's live report exactly.
- The deck shows the Growth Quotient as a slide only; the in-app version waits for João's go-ahead.
- **Window:** every metric uses a 30-day window with operating expenses pro-rated to 30 days. Directional understanding is enough.
- **Cohort metrics blend completed cohorts.** For the 1-year metrics, use the completed 1-year cohorts and take the average, unless it spiked a lot; if it spiked a lot, prefer recency. The nCAC in the 1-year ratio is blended the same way.
- **Revenue peaks are not tied to holidays.** A peak is a spike in monthly revenue against the months around it: if March is at one level, April spikes and May falls back, April is a peak. The app reads the revenue per month over the year and finds the spikes.

## How CTC's diagnostic works (the method to replicate)

### The form
A Typeform with 20 questions, about 7 minutes. A welcome screen, then name, business name, industry and role (none visibly used in the score; the industry travels to the report page). Then:
- **Baseline answers (Q5 to Q10):** current average first-order revenue; 60-day cohort average first-order revenue; 60-day LTV; 1-year cohort average first-order revenue; 1-year LTV; nCAC. All whole dollars.
- **Then ten metrics, one block each.** Intro screen, the questions, and for computed metrics a result screen ("This number will appear on your final report"). Questions inside the blocks: 30-day total sales, 30-day orders, 30-day cost of delivery (metric 1); last full month's operating costs (2); DIO, DSO, DPO (3); number of distribution channels (7); % organic traffic (8); number of revenue peaks (10). Metrics 4, 5, 6 and 9 need no new question: they are computed from the baseline answers.
- Submit opens the report page. The report reads every value and score from the page address, so the scoring runs inside the form.

### The ten metrics

| # | Metric | Formula (CTC) | Benchmark | Points |
|---|---|---|---|---|
| 1 | Cost of Delivery % | 30-day COD ÷ 30-day sales before refunds. COD = every cost of getting the product to the customer except discounts, refunds and ad spend (includes COGS) | < 30% | 1 per point |
| 2 | Operating expenses % | last full month's overhead that does not scale with sales (rent, payroll, equipment) ÷ the same 30-day sales | < 25% | 1 per point |
| 3 | Cash conversion cycle (days) | DIO + DSO - DPO | < 0 | 0.25 per day |
| 4 | 60-day incremental revenue growth | (60-day LTV - 60-day cohort first-order revenue) ÷ 60-day cohort first-order revenue. Customer value growth, not business growth | ≥ 30% | 1 per point |
| 5 | 1-year incremental revenue growth | same at 365 days | ≥ 100% | 0.25 per point |
| 6 | FOV : nCAC | (first-order revenue - COD - nCAC) ÷ nCAC, with COD = COD % × first-order revenue. First-order profit after delivery and acquisition cost | > 0 | 25 per 1.0 |
| 7 | Distribution channels | self-reported count of sales channels: online store, retail, Amazon, wholesale, international distributors, B2B | ≥ 3 | 5 per channel |
| 8 | Organic traffic % | self-reported share of web traffic from cost-free sources such as organic search and email | ≥ 50% | 1 per point |
| 9 | 1-year LTV : nCAC | (1-year revenue - COD - nCAC) ÷ nCAC, with COD = COD % × 1-year revenue | > 0.5 | 10 per 1.0 |
| 10 | Revenue peaks | months whose revenue exceeds the non-holiday mean monthly revenue by 25% or more (self-reported, with CTC's spreadsheet) | ≥ 4 | 5 per peak |

Points are measured from the benchmark, positive when better, negative when worse; "per point" means per percentage point. Lower is better for 1, 2 and 3. For 6 and 9 the unrounded ratio is used (-0.0928, not -0.09). Our version changes how metric 10 is detected (below); the benchmark and points stay.

### Scoring
**GQ = 130 + the sum of the ten point values.** 130 means every metric sits exactly on its benchmark. There is no cap and no floor in CTC's version, and none in ours.

### The report
- Header: brand, date, Growth Quotient, a download button, and a one-line read of the score.
- Table: metric, your value, benchmark, "Average" (CTC's own comparison column, source not stated), points.
- Key issues: one block per problem metric (an issue, a recommendation, links to CTC resources). The run showed four: cash conversion cycle ≥ 0, FOV : nCAC < 0, organic < 50%, revenue peaks < 4. COD was over benchmark and showed none, so how CTC decides which blocks appear is not fully known.
- Closing: share/download, book a call. The downloadable PDF has 10 pages; page 1 is a cover (brand title, date, Growth Quotient), pages 2 to 10 have not been reviewed.

## Replication design

### Where each input comes from
**Window: 30 days for every metric** (the 30 days ending yesterday; the end date can be changed), operating expenses pro-rated to 30 days. The cohort metrics (4, 5, 9) and the revenue peaks (10) read longer history, as described below. Revenue basis: **Order Revenue** (the app's confirmed definition: gross - discounts + shipping + tax, refunds not deducted), the same thing CTC's form asks for ("sales before refunds").

| # | Metric | Computed from | Still asked |
|---|---|---|---|
| 1 | COD % | The app's cost of delivery over the window: `daily_facts.cogs` + `client_settings.other_variable_pct` × (net sales + shipping) + `delivery_cost_per_order` × orders, ÷ order revenue (`new_order_revenue` + `returning_order_revenue`). Flag stores with unmapped COGS (`cogs_unmapped_sales`) | Nothing |
| 2 | Opex % | Monthly fixed costs (`client_settings.monthly_fixed_costs`, or the plan month's SG&A input) pro-rated to 30 days, ÷ order revenue | Fixed costs, once, if blank |
| 3 | Cash conversion cycle | DIO + DSO - DPO from Store Settings, Cash Conversion Cycle (fields exist in the Edit dialog, "not applied yet") | DIO, DSO, DPO. Blank counts as "not provided" and a data gap, never as 0 |
| 4 | 60-day growth | Blended `rev_60d` ÷ `first_revenue` over the matured cohort months (see "Cohort blend") | Nothing |
| 5 | 1-year growth | Blended `rev_365d` ÷ `first_revenue` over the 365-day-matured cohort months | Nothing |
| 6 | FOV : nCAC | FOV = `new_order_revenue` ÷ `new_orders` in the window; nCAC = the app's weighted CAC over the window (ad spend ÷ new orders, `ad_spend_daily`); COD % from metric 1 | Nothing |
| 7 | Distribution channels | Count of `orders.sales_channel` values with at least 5% of order revenue over 90 days (cut editable), plus channels the app cannot see (Amazon, wholesale, retail, B2B) entered by the strategist | Extra channels |
| 8 | Organic traffic % | Once GA4 is connected (`docs/superpowers/specs/2026-10-11-ga4-email-metrics-design.md`, `ga4_daily`): sessions not in a paid channel group ÷ all sessions, email counted as organic like CTC. Until then entered by hand | The % until GA4 exists |
| 9 | 1-year LTV : nCAC | Blended 1-year LTV and blended nCAC over the same 365-day-matured cohort months (see "Cohort blend"); COD % from metric 1 | Nothing |
| 10 | Revenue peaks | Spikes in monthly order revenue over the last 12 full months (see "Revenue peaks") | Nothing |

Everything the app cannot infer goes in one small table of manual inputs (below), with who typed it and when.

### Cohort blend (metrics 4, 5 and 9)
Instead of one cohort month, blend completed cohorts so a single odd month does not decide the score.
- A cohort month is **matured** for a horizon (60 or 365 days) when its last day plus that horizon is in the past.
- Take the latest **12 matured cohort months** for each horizon (fewer if the store has less history; under 3 is shown as "not enough history", a data gap).
- **Blend by customers, not by averaging ratios:** growth = sum of `rev_H` ÷ sum of `first_revenue`; 1-year LTV = sum of (`first_revenue` + `rev_365d`) ÷ sum of `customers`; nCAC = ad spend in those months ÷ new orders in those months (the app's weighted CAC over the cohort months, so each LTV is paired with what it cost to acquire).
- **Spike rule:** if any chosen month's growth, LTV or nCAC is more than 50% away from the median of the chosen months, the blend has spiked, and the diagnostic uses the **latest 3 matured months** instead (recency first). The report says which rule was used and which month spiked.
- Ad spend history may be shorter than the order history. Use the cohort months that have both; if none do, fall back to the current 30-day nCAC and flag it as a data gap.
- COD % in metrics 6 and 9 stays the current 30-day COD % from metric 1, as in CTC's form.

### Revenue peaks (metric 10, our rule)
- Input: monthly order revenue (`daily_facts`) for the last 12 full months plus the month before, so the first month has a left neighbour.
- A month is a **peak** when it is higher than both neighbouring months and **at least 25% above the average of those two neighbours**. March 100, April 140, May 100: April is a peak. A gentle curve (100, 110, 120, 110, 100) has none.
- No holiday rule: November counts like any other month. When two high months sit together, only the higher one can be a peak.
- The latest full month has no following month yet. It is judged against the previous month alone (higher, and at least 25% above it) and marked **provisional** until the next month closes.
- The count over the 12 months is the metric; benchmark 4 or more, 5 points per peak away from 4.
- Stores with fewer than 13 months of history show "not enough history".
- CTC's own definition (25% above the non-holiday mean) is different, so our count may not always match their tool; the benchmark of 4 is theirs.

### Subscription and multi-store brands
- For subscription brands such as Pacha, LTV for metrics 5 and 9 comes from subscriber cohorts once the Subscriptions work exists (`docs/superpowers/specs/2026-10-12-subscriptions-design.md`), not from repeat-order cohorts.
- For multi-store brands compute the consolidated total first, then each store (`docs/superpowers/specs/2026-10-13-multi-store-group-design.md`). Newer markets with short history show "not enough history" on the cohort metrics and the peaks.

### Data
- `gq_inputs` (new): `client_id`, `key` (for example `dio`, `extra_channels`, `organic_pct`), `value` jsonb, `note`, `updated_by`, `updated_at`. DIO, DSO and DPO may stay in `client_settings.extra` where the dialog already puts them; the diagnostic reads them from there.
- `gq_snapshots` (new): `client_id`, `as_of` date, `window_days`, `metrics` jsonb (value, inputs used and data quality per metric; the cohort months blended and which rule was used; the peak months), `points` jsonb, `score` numeric. One row per client and month, plus on demand. Primary key `(client_id, as_of)`. Row-level security like the other fact tables.
- Metric keys follow CTC's names so the two are easy to compare: `cod`, `opex`, `ccc`, `ltv_percent_60`, `ltv_percent_year`, `fov_ncac`, `distchannel`, `orgtraffic`, `ltv_ncac_year`, `revpeaks`.
- The score is a pure function (metric values in, points and score out). The cohort blend and the peak detector are separate pure functions. All three are unit-tested without the database.

### Screens
- A **Growth Quotient** page per client (also reachable from onboarding): the score, the ten-row table with benchmark and points, data gaps ("DIO not entered", "GA4 not connected"), issue blocks, a history line from the snapshots, and a **12-month revenue chart with the peaks marked**.
- A short **inputs** panel for the few manual values, with the inferred values shown next to them.
- Report for the client: one page, our own wording. Nothing is sent to a client without João's approval. Print or PDF export comes after the page works. No data goes in the page address.
- Issue blocks: one per metric that misses its benchmark, with our own issue and recommendation text that points to our playbooks (Canon / CTC SOP is the agency standard). Text for all ten is written by us.

### Comparison with other clients
CTC's "Average" column cannot be reused (their data, unknown source). Store our own snapshots and, once there are enough clients (proposal: 10), show anonymous percentiles only, as `scenarios-and-diagnostic.md` section 3 already says. Until then show the benchmark only.

## Test cases

### Scoring (golden test from the live run)
Inputs entered in CTC's form (all invented): 30-day sales 250,000; orders 3,846; COD 82,500; operating costs 55,000; DIO 75, DSO 2, DPO 30; first-order revenue 65; nCAC 48; 60-day cohort first-order revenue 58 and LTV 92; 1-year cohort first-order revenue 54 and LTV 140; channels 4; organic 45%; revenue peaks 3.

| Metric | Expected value | Points |
|---|---|---|
| COD % | 33% | -3 |
| Opex % | 22% | +3 |
| Cash conversion cycle | 47 | -11.75 |
| 60-day growth | 58.62% | +28.62 |
| 1-year growth | 159.26% | +14.82 (14.815) |
| FOV : nCAC | -0.09 (-0.0927) | -2.32 |
| Distribution channels | 4 | +5 |
| Organic traffic | 45% | -5 |
| 1-year LTV : nCAC | 0.95 (0.9542) | +4.54 |
| Revenue peaks | 3 | -5 |
| **Growth Quotient** | | **158.91** (130 + 28.91) |

The scoring function, fed these metric values, must reproduce the points and the total within rounding (0.01).

### Revenue peaks
- March 100, April 140, May 100 (with neighbours around them): April is a peak.
- 100, 110, 120, 110, 100: no peak (a gentle curve is not a spike).
- 100, 100, 200, 190, 100: only the 200 month is a peak.
- Latest full month higher than the month before by 25% or more: counted, marked provisional.

### Cohort blend
- Ratios are blended by customers (a 10-customer month cannot outweigh a 500-customer month).
- One cohort month with nCAC 60% above the median triggers the recency rule (latest 3 months); 40% above does not.
- Fewer than 3 matured months returns "not enough history".

## Build order (once approved)
1. Pure functions with the tests above: scoring, cohort blend, peak detector.
2. Inference from existing tables (cohorts, daily facts, ad spend, settings), manual inputs for the rest, data-gap flags.
3. The page, snapshots, history and the revenue chart with peaks.
4. Channel inference and GA4 organic share when the GA4 connector exists.
5. PDF export, then the client database comparison.

## Defaults to confirm when building
These are my choices where João's answer gave the idea but not the number. All are adjustable settings, none changes the formulas.
1. **Spike rule:** more than 50% from the median of the chosen cohort months switches to the latest 3 matured months.
2. **12 cohort months** blended per horizon.
3. **Peak threshold:** at least 25% above the average of the two neighbouring months (the same 25% CTC uses).
4. **Flags:** green when the benchmark is met, red when it is missed. The one-line read in the report at different scores is written by us, at build time.
5. **Weighted CAC** divides all ad spend by all new orders, as the app does today (an open item already in `build-plan.md`: acquisition-only is the alternative).
6. **Distribution channels:** a channel counts at 5% of order revenue over 90 days.

## Not verified about CTC
- Behaviour at extreme values (any floor), by industry (do benchmarks or "Average" change), and which issue blocks exist for COD, Opex and channels.
- The Cash Conversion Cycle and Revenue Peaks spreadsheet calculators, and PDF pages 2 to 10.
- Where the benchmarks come from.

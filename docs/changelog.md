# Changelog (dated build notes)

Newest first. CLAUDE.md keeps only one line per item and points here.

## 2026-10-12: Forecast summary, stretch scenarios and the Home selector
- New **Summary** tab in the plan editor (step 2): the plan by month against last year with EBITDA, year over year, month over month, share of the year and "Above model"; a Baseline | Stretch | Compare view and a Plan | Forecast basis. **Create stretch** builds the "Would like" plan from one goal (new or total revenue growth, or a total amount) on the saved models; **Regenerate** keeps locked months. Home has a **Plan: Baseline | Stretch** selector once the year has a stretch. Details: `docs/planning-layer.md` ("Scenarios and Summary").
- Migration `0011_plan_scenarios` (`plan_versions.scenario`, `base_plan_id`, `goal`, one stretch per client and year): written, **not applied** until confirmed; baselines work without it.
- Shared logic extracted from the New Customer screen into `lib/planning/plan-fit.ts` and `month-model.ts` (behaviour unchanged). 331 tests passing; a fresh review found and fixed unhandled errors on Create stretch, a stale editor after Regenerate, ended months outside the goal, and growth goals with no last year.

## 2026-10-12: Calendar page, specs for subscriptions, creative demand and messaging
- The sidebar Calendar opens its own page again (`/calendar`), sharing `CalendarStep` with the plan editor through `CalendarCtx`. Events are stored per client, so both views read and write the same rows. The LTV multiplier labels in the New Customer model no longer wrap away from their fields.
- New specs: `2026-10-12-subscriptions-design.md` (Loop and Skio connectors, Shopify-only estimate, Subscriptions report, forecast split of returning revenue) and `2026-10-12-creative-demand-design.md` (ad-level Meta data, Creative Score, Creative Demand model). Messaging spec updated (phase 1 is connect and verify; Postscript's public API has no revenue endpoint). Markets spec updated (what `read_markets` does and does not give). Plan written for the forecast summary and scenarios.
- Rule change: Best Creatives is released for our own design (CLAUDE.md, `docs/reports-plan.md`, `docs/statlas-findings.md`). Amazon recorded in `docs/future-vision.md`.

## 2026-10-12: 90-day payback window and retention spend switches
- New Customer (spend and aMER) model: a third payback point next to 60 days and 1 year. "Max 90-day CM" is a spend-table marker, a Create forecast rule and a plan-table column; the 90-day multiplier is "Recommended" from the same 12 mature cohorts rule (90 days after the month ends) or typed by hand, and there is a Min 90-day CM field. No migration: 90-day repeat revenue is the sum of the first three 30-day cohort periods (`rev90d`, computed when cohorts load). Models saved before this have no 90-day values and use an estimate between the 60-day and 1-year multipliers (`interpolate90`) until the strategist sets one.
- Retention spend in aMER: the two Store Settings switches (leave out brand search, leave out retention spend) now also sit above the model's plan table, writing the same client setting so Home, reports and the model agree. The retention switch now removes the returning spend of every platform (`RETENTION_CHANNELS`: Meta, Pinterest, YouTube, Bing, TikTok, Snapchat, AppLovin), not only Meta as before, in `amerSpend`, in plan generation and in `acqShare`. Total spend, MER and the daily spend plan always include all spend. This changes aMER for any client that has returning spend on a platform other than Meta and has the switch on.
- Tests added for the 90-day multiplier, the markers and the retention exclusion across platforms (233 passing).

## 2026-10-12: Four reports and Home report links
- New reports: Contribution Margin (`contribution-margin`, CM equals the Home tile), Revenue Overview (`revenue-overview`, with an Order Revenue chart), New Vs Returning Overview (`new-vs-returning`) and AOV Histogram (`aov-histogram`: Dynamic Ranges, $10/$25/$50/$100 increments, Complete Range; mean, median, mode). Pure builders in `lib/reports/` (`contribution-margin.ts`, `revenue-overview.ts`, `new-vs-returning.ts`, `aov.ts`, shared `bucket.ts` and `table-model.ts`), shared pages `FactsReport` and `MetricsTable`.
- Migration `0010_aov_histogram` (applied): `aov_stats` and `aov_histogram` functions, so the browser never downloads orders. Checked live on one client month: counts tie to the order total, mean x orders equals revenue, dynamic mode excludes about 5% of orders.
- Registry: new `planned` status ("Coming soon"); eight reports that were marked ready but had no page are now `planned`; a test checks every ready report has a page.
- Home: each tile links to its report (Contribution Margin hero, Order Revenue, Ad Spend, MER, AOV, Orders); the link carries Home's date range (`?from=&to=`), which `useReportRange` now reads. Email tiles link to Email Metrics once that report exists.
- Shopify submission files updated for reading the shipping country (Markets): `docs/shopify-submission.md` and `docs/shopify-screencast-script.md`. The live `/privacy` and `/shopify` pages are unchanged on purpose (the app does not read the country yet); the replacement text is staged in `docs/shopify-submission.md` section 9 and a test keeps the pages from claiming it early. Do not submit before Markets is built.
- Plan and specs: `docs/superpowers/plans/2026-10-12-four-reports-and-home-links.md`, `docs/superpowers/specs/2026-10-12-four-reports-design.md`.

## 2026-10-12: Connector foundation
- New connectors now cost one registry entry: `lib/providers.ts` (browser-safe metadata, labels, failure threshold) and `lib/sync/registry.ts` (sync, finalize and verify per provider). Shopify, Meta and Google Ads are wrapped, not rewritten.
- Job runner: pure logic moved to `lib/job-plan.ts` (tested); `lib/jobs.ts` and `/api/jobs/tick` use the registry; at most 10 jobs run at once and a finished job starts the next waiting one; the daily tick also retries connections in `error`; a daily sync that ends in error adds 1 to `integrations.consecutive_failures`, any successful sync or reconnect resets it (7 writes, pinned by `lib/connected-writes.test.ts`), and Store Settings shows "Needs attention" at 2 or more; the connections table falls back to the old columns if migration 0009 is missing (`lib/integrations-query.ts`).
- `POST /api/integrations/connect` for client-key providers (Klaviyo, Postscript, Omnisend) and agency-Google providers (GA4); keys are encrypted into `integration_secrets` (`lib/integration-secrets.ts`) and never returned. Add Connection renders from the registry; the connection dialog has a "Key saved" and Replace field. No provider uses these yet.
- Migration `0009_providers_and_failures` is **applied** to the live project (2026-10-12). Plan and spec: `docs/superpowers/plans/2026-10-12-connector-foundation.md`, `docs/superpowers/specs/2026-10-11-connector-foundation-design.md`.

## 2026-10-02: Statlas docs archive
- Read docs.statlas.io (all pages except Compass) and saved paraphrased notes in `docs/statlas-docs/`, with `gap-analysis.md` listing differences and decisions for the user. 
- Follow-up: Meta click/view attribution windows now applied from Store Settings (default 7-day click, view disabled); `/onboarding` checklist page; refund timing verified. Product by First Product report built (`lib/reports/first-product.ts`, `components/reports/FirstProductReport.tsx`); sync now stores order line items. Migrations `0005_exclude_free_orders` and `0006_order_lines` are written but NOT yet applied to Supabase (see `docs/statlas-docs/gap-analysis.md`).

## 2026-10-02 (evening): Calendar, Event model, Spend/Details/Input restructure
- Calendar tab + Event Effect Model (CSV import, spike suggestions, per-type lifts, strength choice, overrides), plan days reshaped by events with month totals preserved; Spend with last-year charts and event chips; Details dropdown of lines with Actualize YTD / Extrapolate; Input with events and P&L lines; icons on the Models info page; Returning "Create forecast". Migration 0008 written, not applied. Details: `docs/planning-layer.md`.

## 2026-10-02 (later): New Customer model follows Jack's method
- Compiled and ran Jack's C pipeline on generated data; TS port now reproduces its table (test + fixture). Revenue-vs-spend line is the default, bucket ±1σ outliers, Max Revenue at break-even, monthly seasonality index, Create forecast (default Max CM), full history since inception, new chart colours. Outline for the rest: `docs/forecasting-build-outline.md`.

## 2026-10-02: Forecasting models (New Customer, Returning Customer)
- Statlas forecasting screenshots reviewed (25 images, folder `Statlas Original UX/Forecasting and Calendar Layer`); plan: models first, then Calendar + Event model, then restructure the editor to Statlas order (Models, Spend, Details, Input, P&L).
- Built `lib/planning/new-customer.ts`, `returning.ts`, `models.ts` (+ tests, 102 passing), Models tab, Details override column, repository methods, migration 0007 file (NOT applied: the connector call was declined twice, run the SQL manually). Not committed.
- Decisions: linear regression by default; 60-day and 1-year LTV points instead of "lifetime"; AOV and cost % from the last 30 days; actualization in both models; returning forecast includes future cohorts from the plan's new revenue; store all cohort history.

## 2026-10-01: Planning layer (phases A and B)
- `/planning` plans list and editor (monthly grid, spend and days, returning revenue, daily input, Plan P&L), plan settings with month lock/status and change log. Weekday pattern calculated from Shopify. Details: `docs/planning-layer.md`.
- Migration `0004_planning_layer` (applied to Supabase): plan year/description/seasonality, plan_months, plan_changes, extra plan_targets columns (tax, cogs, cost_of_delivery), write policies.
- `/reporting/pnl`: Compare to P (plan) and F (forecast = actuals + plan) are live. `lib/reports/plan-pnl.ts`, shared `PnlTable`.
- Home picks the default plan of the range's year.

## 2026-10-01: Reports, gross sales and discounts
- Reports: library, Marketing Efficiency, P&L, Paid Media Overview built. See `docs/reports-plan.md`.
- Migration `0003_gross_sales_discounts` (applied to Supabase): `daily_facts.gross_sales` and `discounts` (backfilled from `orders`; invariant net_sales = gross - discounts - refunds verified on live data); `rebuild_daily_facts` updated to fill them; `plan_targets` gained optional `gross_sales`, `discounts`, `shipping`, `refunds` so the forecasting layer can plan shipping, refund and discount percentages and a plan-level P&L.
- Types: `DailyFact.grossSales/discounts`, `PlanTargetDay` optional P&L lines, `CampaignDay`, `Repository.getCampaignDays`.
- Commit `6f31626` "New public app" (pushed via the user's GitHub Desktop) contains the Shopify public-app work and the first report/migration work together.

## 2026-10-01: Shopify public app (in progress)
Replaces one-app-per-store. Built: public pages `/shopify` (app URL), `/privacy`, `/support`; HMAC-verified webhooks `/api/shopify/webhooks` (compliance + app/uninstalled); installs recorded in `shopify_installs` (migration 0002, applied) and linked to a client from Store Settings; `shopify.app.toml`; listing assets in `docs/shopify-listing/`. Everything to do/paste for review: `docs/shopify-submission.md`. The new app is named "Apex Analytics"; the old custom app "Apex Data" stays until cutover (then swap SHOPIFY_CLIENT_ID/SECRET in Vercel).

## Before 2026-10-01
See `CLAUDE.md` "Built and working" and git history.

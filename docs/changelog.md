# Changelog (dated build notes)

Newest first. CLAUDE.md keeps only one line per item and points here.

## 2026-10-02: Statlas docs archive
- Read docs.statlas.io (all pages except Compass) and saved paraphrased notes in `docs/statlas-docs/`, with `gap-analysis.md` listing differences and decisions for the user. Docs only, no code changes.

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

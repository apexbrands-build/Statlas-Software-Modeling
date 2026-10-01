# Reports: plan, status and rules

Reporting lives at `/reporting` (library) and `/reporting/<slug>`. The list, categories and status of every report is in `lib/reports/registry.ts`. What Statlas does in each report is in `docs/statlas-findings.md` ("Reports" section). Dated build notes: `docs/changelog.md`.

## Scope (user-approved 2026-10-01)
Build all Recommended reports from Statlas **except** Best Creatives, DTC Index, Trend Explorer and Global Creatives (never build those). Also build four LTV reports the user likes: LTV Dashboard, Revenue Over Time, Net Active Customer Detail, New Vs Returning Overview. Reports whose data source is missing get the page and layout, clearly marked "Waiting for data source".

## Status
| Report | Slug | Status |
|---|---|---|
| Report library | `/reporting` | Built |
| Marketing Efficiency Report | `mer` | Built (Goal columns appear when a plan exists) |
| P&L | `pnl` | Built (#s As: Whole / Thousands / % of revenue; Revenue By: Simplified / New vs Returning / Paid vs Organic; Compare A/P/F: P and F live now, see docs/planning-layer.md) |
| Paid Media Overview | `ads` | Built (columns are our design; Statlas's table never loaded) |
| Facebook / Google Trackers | `facebook-tracker`, `google-tracker` | Paused: needs per-campaign daily targets from the plan layer |
| Total Net Customer, Variable Costs Dashboard, Calendar Report | `total-net-customer`, `variable-costs`, `calendar` | Not built (Calendar needs plan goals and events) |
| LTV Dashboard, Revenue Over Time, Net Active Customer Detail, New Vs Returning | `ltv-dashboard`, `revenue-over-time`, `net-active-customers`, `new-vs-returning` | Not built (need cohort data from customers/orders) |
| Hourly, Email Metrics, Email/SMS Trackers, Pinterest/TikTok/Snapchat/Bing/YouTube/AppLovin Trackers | see registry | Not built: layout only, "waiting for data source" |

## Order of work
1. Forecasting / planning layer (phases A and B built, see `docs/planning-layer.md`; C/D are the statistical models).
2. Then Facebook/Google Trackers, Total Net Customer, Variable Costs, Calendar, LTV reports, and the waiting-for-data pages.

## How reports are built
- Shared pieces: `components/reports/` (`ReportFrame`, `ReportTable` with heat map + CSV, `MetricGoalReport`, `PnlReport`, `PaidMediaReport`, `WaitingForData`, `ReportRouter` maps slug to page) and pure logic with tests in `lib/reports/` (`grouping`, `metric-spec`, `pnl`, `paid-media`).
- Date picker, compare logic and theme tokens are shared with Home. Goals come from `useDashboardData` / `aggregatePlan`; goals count only elapsed days that have data.
- Campaign rows come from `Repository.getCampaignDays` (`ad_spend_daily`). Clicks/impressions are not stored yet.
- Gross sales and discounts are stored in `daily_facts` (net_sales = gross - discounts - refunds); P&L operating revenue = gross - discounts + shipping - refunds.

## Local testing without logging in
`.claude/launch.json` has `dashboard-seed` (port 3112): runs with seed data and no Supabase login.

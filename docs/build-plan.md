# Apex dashboard: build plan

Based on `docs/statlas-findings.md`. No application code has been written.

## 1. Feasibility

**Yes, Claude Code can build this.** Split by difficulty:

| Straightforward | Hard | Defer |
|---|---|---|
| Home dashboard UI (tiles, red/green, chart, "i" modal) | Shopify order/customer sync at scale (bulk operations, backfill, webhooks) | Forecasting engine (spend-to-efficiency regression, contribution-maximising spend points, channel allocation) |
| Metric formulas as pure, unit-tested functions | New vs returning classification (needs full customer history) | Customer churn file and lapsed/reactivated reporting |
| Store settings + cost settings forms | Meta / Google attribution and *new vs returning audience* spend split | Reports section (25+ reports) |
| Design tokens and theming | Google Ads developer-token approval; Meta app review | TikTok Shop, cash conversion cycle, MMM, SLA |
| Supabase auth + row-level security per pod | Plan-to-daily-target model (see §5) | Klaviyo/GA4 email revenue |

## 2. Recommended priority

1. **Phase 1 (beta): Home dashboard + "i" trend charts + Store/Cost Settings**, running on seed data behind a data-access interface.
2. **Phase 1.5:** start API approvals now (lead time, not effort).
3. **Phase 2: Plan vs actual.** Plan targets stored per day; red/green on tiles.
4. **Phase 3:** real Shopify, then Meta and Google data replaces seed.
5. **Later:** forecasting engine, churn file, reports.

Reason: settings + cost inputs are what make contribution margin trustworthy, and the dashboard cannot be judged without them. The forecast can start as *manually entered / uploaded daily targets* (Phase 2), so the home dashboard does not wait on the heavy modelling.

## 3. Phase 1 scope (beta)

Home dashboard, laid out like the functionality observed (own visual design):

- Header: client switcher, date range, compare selector (Plan / prior period), currency.
- Hero tile: Contribution Margin. Tiles: Net Sales + Shipping, Ad Spend, MER, AOV, Orders.
- Sales & Spend daily chart with target lines.
- Blocks: Returning (revenue, orders, AOV, repeat rate), New (revenue, orders, AOV, weighted CAC, aMER), Channel Performance (Google non-brand, Google Brand, Meta, optional Pinterest; spend, iRevenue with visible multiplier, AOV, iCPA, iROAS).
- "i" modal per metric: total / target / diff, daily line chart with target line, daily table.
- Store settings (revenue definition = Order Revenue, DTC channel selection, attribution windows, incrementality multipliers, campaign naming rules, test-campaign exclusions).
- Cost settings: COGS from Shopify product cost (per variant, overridable), "Other variable costs" as % of revenue and/or per-order cost, monthly fixed costs.

**Data approach.** The user said no database is needed yet. Proposal: write the Postgres schema (§6) as SQL migrations and typed models now, and implement a `Repository` interface with a **seed-data implementation** (deterministic generator: ~2 years of daily orders, spend, plan targets for 3 fictional clients). The Supabase implementation is dropped in later without touching the UI. This keeps seed data realistic, not throwaway.

## 4. Metric definitions

All are computed from daily rows; each metric is labelled by source in the UI.

| Metric | Formula | Source | Notes |
|---|---|---|---|
| Order revenue (default, per Statlas "Order Revenue") | gross − discounts + shipping + tax, excluding returns | Shopify | Statlas also shows "Disc. Sales + Shipping" on the tile; confirm which one feeds MER/AOV |
| Net Sales + Shipping | order revenue net of tax | Shopify | **Confirm** |
| Contribution margin (daily) | **(Net Sales + Shipping) − Cost of delivery − Ad spend**. Net Sales = gross − discounts − refunds (no tax); Shipping = charges collected; Cost of delivery = COGS + other variable costs (corrected 2026-10-13; the Store Settings field "Cost of delivery" holds the non-COGS part, math unchanged) | mixed | Final, user-confirmed. Supersedes earlier formulas |
| Fixed costs / opex | Not part of CM. Used only in the P&L / bottom-line profit output built with the plan | | Not on the home dashboard |
| COGS | Σ units × variant unit cost (Shopify cost per item, time-versioned) | Shopify | Manual/CSV override |
| Other variable costs | % of revenue + $/order | settings | e.g. payment fees |
| MER | total revenue / total ad spend | Shopify + platforms | |
| AOV | revenue / orders | Shopify | |
| Orders | count of DTC-channel orders | Shopify | Exclude order tags and gift-card handling per settings |
| New / Returning revenue, orders | by customer's first order date | Shopify | |
| Weighted CAC | ad spend / new orders | mixed | Confirm whether Statlas divides all spend or acquisition spend |
| aMER | new revenue / acquisition ad spend | mixed | Acquisition spend excludes brand search and Meta returning audiences per settings |
| iRevenue (channel) | platform-reported revenue × incrementality multiplier | platform | Multipliers fixed: Google non-brand 0.75, Google Brand 0.3, Meta acquisition 1.2, Meta returning 0.6 (per user) |
| iROAS | iRevenue / spend | | Matches Statlas tiles to 2 decimals |
| iCPA | spend / (iRevenue / AOV) | | Verified on Google tiles |
| Paid iRevenue / ipaMER | Σ channel iRevenue / total spend | | Confirm (Statlas totals don't tie exactly to channel sums) |
| Email revenue | Klaviyo (or GA4) attributed revenue | Klaviyo/GA4 | Later |

**Things to confirm before coding**
1. "Revenue definition = Order Revenue": does it include tax in the MER/AOV numerator? Statlas subtracts "Shipping/Taxes" as a P&L line.
2. Google branded = campaign name contains "branded"; is that case-insensitive, and should "brand" (without "ed") match?
3. Meta returning spend = "existing customers" audience segment in Meta reporting: confirm the breakdown (Meta's `existing_customers` custom-audience flag) is what you want.
4. Multipliers: fixed per client, or per client-editable with these as defaults? They are stored in `cost_settings`, editable, defaults set.
5. Red/green direction per metric (which are higher-is-better).
6. Attribution: 7-day click only for Meta and Google: confirm 1-day view disabled everywhere.

## 5. Forecast → daily targets (design, not built)

Business Planning is at `/goals` and is documented in `statlas-findings.md` §9. Pipeline observed (Plans → Models → Spend → Details → Input → Plan P&L):

1. **New Customer Model:** per month, choose a spend point on a fitted aMER-vs-spend curve (aMER = new order revenue / total spend). Table of candidate spend points with tags Max CM, Max Lifetime CM, Max Revenue. LTV = AOV × multiplier.
2. **Retention Model:** cohort retention matrix (M1…M12 as % of first-order revenue), OLS/ARIMA fit, gives monthly returning revenue; per-month manual override.
3. **Event Effect Model:** historical event days vs expected returning revenue → ratio per event category, applied to daily figures.
4. **Spend step:** monthly spend split by platform % and brand/non-acquisition %, day-of-week weights.
5. **Input step:** final **daily** rows (Total Revenue, Spend, MER, aMER, New / Returning / Email / Organic revenue, per-platform spend). These are the daily targets.
6. **Plan P&L:** monthly P&L including CM.

Our approach, in stages:

- **Phase 2 (soon):** `plan_versions` + `plan_targets(client_id, plan_id, date, metric, value)`. Load targets from CSV or a Sheet-style daily input table (same columns as Statlas's Input step). Home reads targets by `(client_id, selected_plan_id, date)`. Red/green: `status = compare(actual, target, direction(metric))` with a tolerance band.
- **Phase 3:** monthly plan editor (spend, aMER, new revenue, returning revenue per month, platform split, day-of-week weights) that generates the daily rows deterministically (no ML). Plan P&L view.
- **Phase 4 (forecasting service, Python):** (a) aMER-vs-spend regression per client/month with spend points at first-order CM and LTV-adjusted CM; (b) cohort retention model (start with OLS on cohort-month retention with month-of-year dummies; ARIMA later); (c) event-effect ratios by event category using our own calendar of events; (d) channel allocation using the incrementality multipliers. The service writes to the same `plan_targets` table so the dashboard doesn't change.
- Daily plan rows should carry: CM, total revenue, returning revenue, new revenue, aMER, total spend, and spend per platform (as in Statlas's Spend step with "Show CM/Revenue Breakdown"). In the Plan P&L I only saw returning *orders* as 0 and Repeat Rate blank; unconfirmed whether they're planned elsewhere. If not, we can derive them (returning revenue ÷ target returning AOV).

Open: how you want event categories defined (Statlas uses Promotion, Product Launch, PR, VIP Drop, Christmas, Black Friday, Cyber Week, etc.) and where event data comes from (manual calendar, Klaviyo campaigns).

## 6. Data model (Postgres, every table has `client_id`)

- `clients` (id, name, currency, timezone, revenue_definition, pod_id)
- `users`, `pods`, `pod_members`, `client_access`
- `integrations` (client_id, provider, account_id, status, coverage_start/end, encrypted_credentials_ref)
- `customers` (client_id, shopify_customer_id, first_order_date, …)
- `orders` (client_id, order_id, customer_id, created_at, sales_channel, tags, gross, discounts, shipping, tax, refunds, net_revenue, is_first_order, is_dtc)
- `order_items`, `products` / `variants` (cost, cost_source `shopify|inputted`), `variant_cost_history`
- `ad_spend_daily` (client_id, date, platform, campaign_id, campaign_name, category `acquisition|brand|retention|test`, audience_type `new|returning|unknown`, spend, platform_revenue, purchases, clicks, impressions, attribution_window)
- `metrics_daily` (client_id, date, metric, value, source) : materialised, recomputed by jobs
- `cost_settings` (client_id, other_variable_pct, per_order_cost, monthly_fixed_costs, multipliers…, effective_from)
- `store_settings` (attribution windows, DTC channels, excluded tags, test-campaign rules)
- `plan_versions`, `plan_targets`
- `sync_runs` (job log)

Label every metric with its source: Shopify / platform-reported / other (settings). Row-level security: a pod member sees only clients in `client_access`.

## 7. Integrations (build direct, read-only)

| Integration | What's needed | Realistic lead time | Start |
|---|---|---|---|
| Shopify | Custom or partner app, scopes `read_orders`, `read_customers`, `read_products`, `read_inventory` (cost is on inventory item); merchant installs via OAuth. Historic orders older than 60 days need `read_all_orders` (approval) | Custom app installs: same day. `read_all_orders`: days–2 weeks | Now |
| Meta | Developer app, Marketing API standard access (`ads_read`), business verification, app review | 1–4 weeks | Now |
| Google Ads | MCC account, developer token (Basic access needs an application) | 1–3 weeks | Now |
| Klaviyo | Private API key (read scopes) | Immediate | Later |
| GA4 | OAuth via Google Cloud project; sensitive scope verification for production | 1–4 weeks | Later |

Tokens are stored encrypted server-side only (Supabase Vault or app-level encryption). No integration writes to any platform.

## 8. Stack

- Next.js (App Router) on Vercel; Tailwind; charts via a small library (Recharts or similar).
- Supabase: Postgres, Auth, RLS. Migrations in `supabase/migrations`.
- Scheduled pulls: Vercel Cron or Inngest, later.
- Python forecasting service later.
- Theme: `theme/tokens.ts` (+ CSS variables), single file for colours, fonts, logo path. Apex branding applied once assets are supplied.

## 9. Repo plan (beta)

1. `git init`, `.gitignore`, `README`, `.env.example`.
2. Scaffold Next.js app; theme file; seed generator; repository interface; metric library with unit tests; dashboard; "i" modal; settings pages.
3. Push to GitHub (you create/confirm the remote); connect to Vercel: no secrets needed for the seed-data beta.
4. Add Supabase (schema + auth + RLS) once the UI is agreed.

## 10. Steps to code (proposed order)

1. Repo, tooling, theme file.
2. Metric formulas + tests (using Statlas' verified numbers as a reference).
3. Seed data generator (orders, spend, plan targets, cost settings).
4. Dashboard + tiles + red/green.
5. "i" modal.
6. Store + cost settings UI (writes to local store for now).
7. GitHub push, Vercel deploy.

## Decisions confirmed by you (2026-09-29)

- **Revenue definition = Order Revenue** across all clients: gross − discounts + shipping + tax, with returns excluded (Statlas wording: "Total Sales without Returns"). Used for MER, AOV, iROAS and all correlations with platform-reported revenue; refunds are *not* netted on the marketing side. Refunds still appear as a line in the contribution margin P&L.
- **Incrementality multipliers are editable per client** in settings (an "Incrementality (iROAS)" table in Statlas's store edit dialog); no geo-holdout tests by Apex, some clients run tests elsewhere (e.g. Triple Whale). Defaults are the House-based public benchmarks you gave (Meta acquisition 1.2, Meta returning 0.6, Google non-brand 0.75 seen in Statlas, Google Brand 0.3 seen in Statlas).
- **Google brand = campaign name contains "brand"** (case-insensitive, editable per client; "non-brand" names are excluded).
- **Meta returning spend** = spend on the existing/customer-defined audience segment.
- **Seed data first**, Supabase and API connectors afterwards.
- **Contribution margin** = net sales − COGS − other variable costs − ad spend (per your description), COGS pulled from Shopify per-variant cost, other variable costs as % of revenue.

## Open questions

1. Statlas subtracts refunds and shipping/tax as separate lines in CM while MER/AOV use Order Revenue: confirm CM should start from Order Revenue and subtract Refunds, Shipping/Taxes, COGS, Other, Ad spend (as Statlas's Cost Settings P&L does).
2. GitHub org/repo name and Vercel team.
3. Visual identity: I'll look at your Visual Identity folder and propose a theme file (black background, white lettering); tell me which logo file is primary.
4. Event categories and event data source for the future event-effect model.

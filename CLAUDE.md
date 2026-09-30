# Apex Brands: internal analytics dashboard (Statlas-style)

Internal app for Apex Brands (e-commerce growth agency, 30+ clients) that replicates the **features and methodology** of Statlas (statlas.io), with Apex branding. Never copy Statlas's UI, code, copy or logo.

**Read these before working:**
- `docs/statlas-findings.md`: what Statlas does (observed, read-only), incl. planning at `/goals`
- `docs/build-plan.md`: phases, metric formulas, data model, integrations, stack, decisions
- `docs/forecasting-context.md`: the strategist's intent and returning-revenue method

## Status
Phase 1 UI is built (`app/`, `components/`, `lib/`, `theme/`): home dashboard with tiles, "i" trend modals, plan/YoY/previous-period comparison, channel performance with editable incrementality factors, email/organic, and a Store Settings page. Runs on seed data via `lib/repository`. **First functional version has no forecasting/plan targets**: with no plan the dashboard shows store data only (no target lines, no plan comparison; default compare = last year). Plan code stays in the repo behind `ENABLE_SEED_PLANS` in `lib/repository/seed.ts` for Phase 2. Tests: `npm test`. GitHub repo: `datasoftwarebuild` (user imports it into Vercel after the push).

Next: Shopify app and Meta/Google Ads spend connectors (read-only), Supabase; plan targets/forecasting later.

Ideas the user wants later (not built): marketing-event calendar inferred from Klaviyo/SMS sends (past) plus a register for future initiatives and any actions that may shift the business (creatives, funnels, tests); this feeds the event-effect model. The user's `Jack-7xyz/aMER_ModelV2` repo (C pipeline: linear fit of day-of-week-adjusted aMER vs spend and revenue vs spend, IQR/z-score outlier filtering) is the reference for the new-revenue forecast.

## Current priority
Build the **home dashboard** only (tiles, "i" trend modals, YoY comparison, store + cost settings), on realistic **seed data** behind a repository interface. No database and no API integrations yet. Supabase and connectors come later. Forecasting is later.

## Rules
- Read-only in Statlas and in every integration. Never change Statlas settings or click Save/Calculate/Sync there.
- No agent messages a client without human approval.
- Never type credentials anywhere; ask the user.
- If browser tools fail 2–3 times, stop and ask instead of retrying.
- Get the user's go-ahead before starting the next phase (Supabase, connectors, forecasting). Phase 1 UI was approved to build.

## Confirmed decisions
- Revenue definition = **Order Revenue** for all clients (gross − discounts + shipping + tax, returns excluded). Used for MER, AOV, iROAS; refunds are a separate CM line.
- Contribution margin (user-confirmed 2026-09-29, final) = **Net Sales + Shipping − COGS − Ad spend − Cost of delivery**. Net Sales = gross − discounts − refunds (no tax). Shipping = shipping charges collected. Cost of delivery = other variable costs (% of net sales + shipping, plus optional per-order cost). COGS is pulled from Shopify variant cost. **Fixed costs are NOT in CM and not on the home dashboard**; they belong to the P&L output (bottom-line profit) built with the plan later.
- Incrementality (iROAS) multipliers are **editable per client** in settings. Defaults: Meta acquisition 1.2, Meta returning 0.6, Google non-brand 0.75, Google Brand 0.3, Pinterest 0.3.
- Google "branded" = campaign name contains "branded" (case-insensitive). Meta returning = existing-customer audience segment. Attribution: 7-day click only.
- Dashboard must show year-over-year comparison for every metric.
- Red/green: within ±10% of the reference = neutral grey, in both directions. Beyond that: green when better, red when worse. Ad spend counts as higher-is-better (above plan is green, psychology). CAC/iCPA are lower-is-better.
- Plan comparison covers only elapsed days that have data (correct; Statlas showed the full month only because the demo store's API had stopped pulling).
- Stack: Next.js on Vercel, Supabase (Postgres, auth, RLS by pod). GitHub first, then Vercel. Theme in a single tokens file.
- Branding: black background, white lettering. Logos in `/Users/joaoklemcastelobranco/Apex Brands/Visual Identity/` (`basic/color.svg` icon "Λ", `basic 3/black-white.svg` wordmark). Font unknown: use a wide geometric sans as a placeholder.
- Plan targets are stored as daily rows per plan version (CM, total revenue, returning revenue, new revenue, aMER, spend, per-platform spend).

@AGENTS.md

# Apex Brands: internal analytics dashboard (Statlas-style)

Internal app for Apex Brands (e-commerce growth agency, 30+ clients) that replicates the **features and methodology** of Statlas (statlas.io), with Apex branding. Never copy Statlas's UI, code, copy or logo.

**Read these before working:**
- `docs/statlas-findings.md`: what Statlas does (observed, read-only), incl. planning at `/goals`
- `docs/build-plan.md`: phases, metric formulas, data model, integrations, stack, decisions
- `docs/forecasting-context.md`: the strategist's intent and returning-revenue method

## Status
Phase 1 UI is built (`app/`, `components/`, `lib/`, `theme/`): home dashboard with tiles, "i" trend modals, plan/YoY/previous-period comparison, channel performance with editable incrementality factors, email/organic, and a Store Settings page. Runs on seed data via `lib/repository`. Tests: `npm test`. GitHub repo: `datasoftwarebuild` (user imports it into Vercel after the push).

Next: user review of the UI, then Supabase + connectors (Shopify, Meta, Google Ads first), then plan targets/forecasting.

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
- Contribution margin (user-confirmed 2026-09-29) = **Net Sales − Refunds − Shipping costs − COGS − Other variable costs − Ad spend**. Always Net Sales (gross − discounts); taxes are NOT inferred separately. COGS from Shopify variant cost; other variable costs as % of net sales; monthly fixed costs shown separately (CM after fixed costs). Assumption to reconfirm: COGS stays in the formula (the user's latest wording listed only refunds, shipping and ad spend).
- Incrementality (iROAS) multipliers are **editable per client** in settings. Defaults: Meta acquisition 1.2, Meta returning 0.6, Google non-brand 0.75, Google Brand 0.3, Pinterest 0.3.
- Google "branded" = campaign name contains "branded" (case-insensitive). Meta returning = existing-customer audience segment. Attribution: 7-day click only.
- Dashboard must show year-over-year comparison for every metric.
- Stack: Next.js on Vercel, Supabase (Postgres, auth, RLS by pod). GitHub first, then Vercel. Theme in a single tokens file.
- Branding: black background, white lettering. Logos in `/Users/joaoklemcastelobranco/Apex Brands/Visual Identity/` (`basic/color.svg` icon "Λ", `basic 3/black-white.svg` wordmark). Font unknown: use a wide geometric sans as a placeholder.
- Plan targets are stored as daily rows per plan version (CM, total revenue, returning revenue, new revenue, aMER, spend, per-platform spend).

@AGENTS.md

# Apex Brands: internal analytics dashboard (Statlas-style)

Internal app for Apex Brands (e-commerce growth agency, 30+ clients) that replicates the **features and methodology** of Statlas (statlas.io), with Apex branding. Never copy Statlas's UI, code, copy or logo.

**Read these before working:**
- `docs/reports-plan.md`: reports scope, status and build order (also `docs/changelog.md` for dated notes)
- `docs/statlas-docs/`: archive of the official Statlas docs (metrics, settings, reports, data, tools) + `gap-analysis.md` with open decisions
- `docs/statlas-findings.md`: what Statlas does (observed, read-only), incl. planning at `/goals`
- `docs/build-plan.md`: phases, metric formulas, data model, integrations, stack, decisions
- `docs/forecasting-context.md`: the strategist's intent and returning-revenue method
- `docs/planning-layer.md`: plans, daily targets, Plan P&L (built 2026-10-01), next phases
- `docs/pacha-handoff.md` and `docs/superpowers/specs/2026-10-13-multi-store-group-design.md`: the Pacha pitch (what the deck promises), the multi-store build, and the checklist for a clean copy of the repo (2026-10-13)

## Status (updated 2026-10-01)
Live at https://apex-data-beta.vercel.app (Vercel, auto-deploys from GitHub `apexbrands-build/Statlas-Software-Modeling`, branch main; the user pushes with GitHub Desktop, Claude cannot push). Supabase project `ccejjijwrdnzljizzwsw` (Apex Brands org, us-east-1) holds the real schema (see `supabase/migrations/0001_init.sql`, applied incrementally via the Supabase connector).

Built and working:
- **Auth:** Supabase email/password, sign-up restricted to @apexbrands.io, `admin@apexbrands.io` is admin. `proxy.ts` protects every page. Sessions last a year.
- **Dashboard (Home):** CM hero, tiles, trend chart (daily up to 62 days, monthly beyond), returning/new/paid blocks, channel performance with ROAS/iROAS selector, email/organic, YoY / previous / custom-period compare, calendar date picker (Days, Weeks, Months, Last X months, Quarters, Years incl. YTD, BFCM 2025-2020). "i" windows are monthly (YYYYMM) with metric-specific tables. No plan/targets in v1 (`ENABLE_SEED_PLANS=false`).
- **Store Settings** mirrors the reference tool: header card, integrations table, Add Connection, Cost Settings, pop-up Edit with accordions (many options saved but "not applied yet"). Brand icons from simple-icons.
- **Connectors (read-only):** Shopify (OAuth via custom-distribution app "Apex Data", one app per store, orders/refunds/costs, DB rollups `rebuild_daily_facts` + `recompute_first_orders`), Meta (System User token, spend + purchases, existing-customer split via `user_segment_key` breakdown, no name rules), Google Ads (agency OAuth refresh token in `agency_secrets`, MCC login-customer-id, no developer token needed, brand rule = name contains "brand" except NB/non-brand tags).
- **Background jobs:** `sync_jobs` queue, chunked history loads that keep running server-side (each chunk its own task, auto-split on timeout), daily cron `/api/jobs/tick` (needs `CRON_SECRET`).
- Tests: `npm test` (50). Local dev: `.env.local` (gitignored) has the Supabase URL and publishable key.

Vercel env vars and setup steps: `docs/connector-setup.md` (never put values in the repo).

**Shopify public app (in progress):** replaces one-app-per-store; the new app is "Apex Analytics" (old custom app "Apex Data" stays until cutover). Details and review checklist: `docs/shopify-submission.md`, `docs/changelog.md`.

**Gross sales and discounts (2026-10-01, migration 0003, applied):** `daily_facts` stores `gross_sales` and `discounts` (net_sales = gross - discounts - refunds); `plan_targets` has optional `gross_sales`, `discounts`, `shipping`, `refunds` so the forecasting layer can plan shipping/refund/discount % and a plan-level P&L.

**Reports (user-approved scope and order):** library `/reporting`, Marketing Efficiency, P&L and Paid Media Overview are built; the rest waits for the plan layer. Never build DTC Index, Trend Explorer, Global Creatives. **Creative reporting is approved (2026-10-12):** ad-level Meta data, the Creative Demand model, the Creative Score and our own Best Creatives view may be built (`docs/superpowers/specs/2026-10-12-creative-demand-design.md`); never copy Statlas's layout or copy for it. Status, order and how they work: `docs/reports-plan.md`; what Statlas does in each: `docs/statlas-findings.md` ("Reports"). Reports show Goal columns automatically once a plan exists (via `useDashboardData` / `aggregatePlan`).

**Planning layer (2026-10-01):** `/planning` plan editor (phases A and B built: monthly plan, daily targets, Plan P&L, P/F in `/reporting/pnl`); migration 0004 applied. **Models (2026-10-02):** New Customer and Returning Customer models built in the editor's Models tab, with actualization; migration 0007 applied (verified 2026-10-11). Calendar, Event model and the Statlas-order editor (Overview, Models, Calendar, Spend, Details, Input, P&L) built 2026-10-02; next: backtests, scenarios (`docs/scenarios-and-diagnostic.md`), Klaviyo events. Details: `docs/planning-layer.md`.

**DB migrations 0001-0008:** all applied (checked against the live database 2026-10-11; `order_lines` holds 91,635 rows, cohort tables are built). Older notes in `docs/` that call 0005-0008 "pending" are stale.

**Reports (2026-10-12):** Contribution Margin, Revenue Overview, New Vs Returning and AOV Histogram are built (migration 0010 applied) and every Home tile links to its report; registry statuses are `ready` (page exists), `waiting`, `planned`. Specs written, not built: channel mix, markets (needs Shopify address access first, so the Shopify submission files are updated but must not be sent before Markets exists), email and SMS plan, subscriptions, creative demand.

**Messaging connectors (2026-10-12):** Klaviyo, Postscript and Omnisend can be connected (key checked and saved, `syncs: false`, no data yet); the data sync is the next phase (`docs/superpowers/specs/2026-10-11-messaging-klaviyo-sms-design.md`).

**Scenarios (2026-10-12):** the plan editor's Summary tab, stretch plans (`scenario = 'target'`, one per client and year, generated from the baseline and one goal) and the Home Plan selector are built; migration 0011 is applied. Details in `docs/planning-layer.md`.

**ROAS targets (2026-10-14):** platform ROAS target = month aMER ÷ the channel's incrementality factor (strategist's formula). Details line "ROAS targets" (Suggested or typed per month, stored in the plan month inputs), ROAS panel in the Spend step, targets on Home's channel ROAS/iROAS tiles. `lib/planning/roas.ts`; plan `docs/superpowers/plans/2026-10-14-roas-targets.md`. Home now opens on Plan, month to date. Migration 0012 (ad-level Meta tables) is applied.

**Creative Demand and Score (2026-10-14):** fourth model in the plan's Models tab (new ads needed per month, Creative Score); `lib/creative/`, screen `components/planning/models/CreativeModel.tsx`, details in `docs/planning-layer.md`. Migration 0013 (read functions over the ad tables) is written and NOT applied: apply it with the strategist's go, then run a Meta history sync and the live check.

**Best Creatives (2026-10-14):** `/reporting/best-creatives` (Meta ads ranked against the account average; `lib/creative/best-creatives.ts`, `aggregate.ts`). Migration 0014 (its read functions) is written and NOT applied: apply it with the strategist's go, then run the live check in the plan.

**Connector registry (2026-10-12):** `lib/providers.ts` (browser metadata) + `lib/sync/registry.ts` (sync per provider) + `lib/job-plan.ts` (job logic); max 10 parallel jobs; "Needs attention" badge after 2 failed daily syncs. Migration 0009 must be applied before deploying. How to add a connector: `docs/connector-setup.md`.

**Direction (2026-10-11):** roll out to the 30+ clients. Next builds: connector foundation, then Klaviyo (email + SMS), Postscript, Omnisend, GA4, then the other ad platforms on demand. Parked ideas (TikTok Shop and cost-only channels, creative intelligence layer): `docs/future-vision.md`.

Open items: (1) Point6 has almost no product costs in Shopify, so COGS is ~0: use the COGS % / flat rate in Edit or upload costs by SKU; (2) compare September Shopify numbers (gross, discounts, returns, net, shipping, taxes, total, orders) against the database; (3) verify Meta existing-customer spend and Google brand spend against the platforms; (4) check the first Shopify history load finishes; (5) set `CRON_SECRET`; (6) later: forecasting layer, reports, Klaviyo/GA4, more platforms, onboarding more clients (one Shopify app per store unless a public app is approved).

Ideas wanted later (not built): marketing-event calendar inferred from Klaviyo/SMS sends plus a register for future initiatives (feeds the event-effect model); a per-market marketing calendar for multi-market brands (idea 2026-10-13, see the end of `docs/superpowers/specs/2026-10-12-markets-design.md`). The user's `Jack-7xyz/aMER_ModelV2` repo (C pipeline: linear fit of day-of-week-adjusted aMER vs spend, IQR/z-score outliers) is the reference for the new-revenue forecast.

## Rules
- Read-only in Statlas and in every integration. Never change Statlas settings or click Save/Calculate/Sync there.
- No agent messages a client without human approval.
- Never type credentials anywhere; ask the user.
- If browser tools fail 2–3 times, stop and ask instead of retrying.
- Get the user's go-ahead before starting a new phase (forecasting, reports, new connectors). Keep answers short: the user is not technical and values saving tokens/time.

## Confirmed decisions
- Revenue definition = **Order Revenue** for all clients (gross − discounts + shipping + tax, returns excluded). Used for MER, AOV, iROAS; refunds are a separate CM line.
- Contribution margin (user-confirmed 2026-09-29, final) = **Net Sales + Shipping − Cost of delivery − Ad spend**. Net Sales = gross − discounts − refunds (no tax). Shipping = shipping charges collected. **Cost of delivery = COGS plus the other variable costs of getting the product to the customer** (% of net sales + shipping, plus optional per-order cost); corrected 2026-10-13, the math is unchanged. COGS is pulled from Shopify variant cost; the Store Settings field labelled "Cost of delivery" holds only the non-COGS part. **Fixed costs are NOT in CM and not on the home dashboard**; they belong to the P&L output (bottom-line profit) built with the plan later.
- Incrementality (iROAS) multipliers are **editable per client** in settings. Defaults: Meta acquisition 1.2, Meta returning 0.6, Google non-brand 0.75, Google Brand 0.3, Pinterest 0.3.
- Google brand = campaign name contains "brand" (case-insensitive; the keyword is editable per client). Names containing "non-brand" / "nonbrand" / "non brand", or the tag "NB" as its own word (agency naming convention, editable per client), are NOT treated as brand. Meta returning = existing-customer audience segment. Attribution: 7-day click only.
- Dashboard must show year-over-year comparison for every metric.
- Red/green: within ±10% of the reference = neutral grey, in both directions. Beyond that: green when better, red when worse. Ad spend counts as higher-is-better (above plan is green, psychology). CAC/iCPA are lower-is-better.
- Plan comparison covers only elapsed days that have data (correct; Statlas showed the full month only because the demo store's API had stopped pulling).
- Stack: Next.js on Vercel, Supabase (Postgres, auth, RLS by pod). GitHub first, then Vercel. Theme in a single tokens file.
- Branding: black background, white lettering. Logos in `/Users/joaoklemcastelobranco/Apex Brands/Visual Identity/` (`basic/color.svg` icon "Λ", `basic 3/black-white.svg` wordmark). Font unknown: use a wide geometric sans as a placeholder.
- Plan targets are stored as daily rows per plan version (CM, total revenue, returning revenue, new revenue, aMER, spend, per-platform spend; optionally gross sales, discounts, shipping, refunds).
- Git: the user pushes with GitHub Desktop; Claude commits only when asked, with clear messages, one commit per finished piece. The user no longer edits in VS Code (avoids mixed commits).

@AGENTS.md

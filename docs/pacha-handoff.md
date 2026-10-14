# Pacha pitch: what the deck promises, and how to prepare the repo for Pacha's own accounts

Written 2026-10-13 for the next build session. Deck: `Consulting Projects/My Pacha/Pacha-Prophit-System-Proposal-DRAFT.pptx` (46 slides, v4). Agreement draft: `Consulting Projects/My Pacha/Pacha-Services-and-Licence-Agreement-DRAFT.docx`. Context: `Consulting Projects/My Pacha/context.md`.

## Facts from the client (Thomas, 2026-10-13)
- Five Shopify stores: France + Belgium + Luxembourg, UK, Germany + Austria, Switzerland, Netherlands. Currencies EUR, GBP, CHF.
- 100% subscription: Recharge (France, UK), Next Commerce (Germany, Switzerland), Juo (Netherlands). Rebills arrive in Shopify as orders under a sales channel.
- One Meta ad account per market; one Google Ads account for all markets.
- He reads the business as a total, then by country and market.

## Order of work (targets: kickoff Mon Oct 19, forecast Fri Oct 30, moment live Mon Nov 2)
1. **Multi-store account** (`docs/superpowers/specs/2026-10-13-multi-store-group-design.md`): market on connections and orders, per-store timezone, FX, market rollups, Home market strip, plan allocation by last-30-day share. Needed before the repo is shared.
2. **Rebills in daily targets** (fixed daily values from the schedule; weekday spread beyond).
3. **Subscription connectors and the Subscriptions report** (Recharge first, then Juo, then Next Commerce). No take-rate report.
4. After kickoff, as capacity allows: Creative Demand and Score, channel mix, EBITDA next to profit in the P&L view, the Growth Quotient in the app (`2026-10-13-growth-quotient-design.md`).
The deck (v4) also sells the dashboard and the 8 built reports (Marketing Efficiency, P&L, Contribution Margin, Revenue Overview, Paid Media Overview, Product by First Product, AOV Histogram, New Vs Returning) as part of the licence, and offers a full demo in the app. Model names in the deck: New Customer Revenue model, Returning Revenue model, Event Effect model, Creative Demand model; the app's own Models cards still say "New Revenue Model", "Retention Model" and "Event Revenue Model" (rename them in the UI to match before a live demo).
Everything above is shown in the deck as **Preview**; the models, curve, scenarios, P&L, Home and incrementality factors are shown as Built (checked against the app in demo mode on 2026-10-13).

## Clean export: what must change before the repo goes to Pacha
The agreement delivers the code at signing, to Pacha's own GitHub, to be deployed on Pacha's own Vercel and Supabase (EU region). Send a clean copy, not this working tree.
- **Apex branding and identity:** `theme/theme.ts` (name and logo paths; the wordmark and icons are in `public/brand/`), `app/layout.tsx` (title and description), `components/public/PublicPage.tsx` (footer), `lib/legal.ts` (company, app name, support email).
- **Sign-up restriction:** `app/login/page.tsx` and the trigger in `supabase/migrations/0001_init.sql` only allow `@apexbrands.io` and make `admin@apexbrands.io` the first admin. Change both to Pacha's domain and admin.
- **Shopify app:** `shopify.app.toml` points at the Apex app and `apex-data-beta.vercel.app`. Pacha should create its own app in its own Shopify account and install it in each store (see `docs/connector-setup.md`).
- **Ad credentials:** the Google flow uses an agency-level OAuth refresh token and MCC login id stored in `agency_secrets`, which are Apex's. Pacha needs its own credentials. Meta uses a System User token: create it in Pacha's Business Manager, one per market ad account.
- **Secrets and environment:** never ship `.env.local`; a new Supabase project, new Vercel project, `CRON_SECRET` and a new encryption key (`lib/crypto.ts`) per deployment. Apply migrations `0001` onward in order (including the new multi-store migration).
- **Third-party material that is not ours to hand over:** `docs/statlas-docs/`, `docs/statlas-findings.md`, `Statlas Original UX/`, `docs/creative-demand-reference/` (Statlas screenshots) and anything else derived from Statlas's own pages.
- **Apex client data and names:** `docs/dev-store/`, client names and figures in docs, `CLAUDE.md`, plans and changelog entries that mention real clients.
- **History:** start the client repository from a clean tree (no git history), so no secrets or client data travel with it.
- **Licence:** add a LICENSE file that matches the agreement (internal use, no resale, ownership of the base code stays with the Consultant) and a README with the deployment steps.

## Open points
- Does Next Commerce write rebills into Shopify as orders for the German and Swiss stores (João: yes, all do). Confirm on the first data load.
- Subscription apps appear as Shopify sales channels: add them to each store's DTC channels or rebills are dropped from revenue.
- Order and customer IDs: Shopify IDs are practically unique across stores; log any collision at ingest.

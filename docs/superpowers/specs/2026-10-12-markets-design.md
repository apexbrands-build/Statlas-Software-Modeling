# Markets: track each market against the forecast

Date: 2026-10-12. Status: draft for the strategist's review. Depends on the planning layer (`docs/planning-layer.md`) and the email % pattern (`2026-10-12-email-sms-plan-and-trackers-design.md`).

## Goal
For a brand that sells in several markets from one Shopify store (for example a European brand with one store and several Shopify Markets), keep the total forecast and add a market view: each market's actuals against its share of the forecast, on Home, so a good blended number cannot hide a country that is behind.

## Decisions (strategist, 2026-10-12)
- One Shopify store per account. A brand with separate stores (for example Europe and the US) gets separate accounts in the app. Several markets inside one store are handled here.
- The store's currency is used as is (Shopify already reports in it); no exchange rates.
- Each market's share of the forecast comes from history (year over year or the trailing 90 days) and can be overridden in the plan.

## Design

### Markets
A market is a name and a list of country codes, set in Store Settings (for example UK = GB; DACH = DE, AT, CH; France = FR). Orders from a country not in any market fall into an automatic **Other** market, so markets always add up to the total. Shopify's own market list can prefill the form (read-only `markets` query), but orders carry no market id (see Shopify access), so the country list is what counts.

### Data
- `orders` gets `ship_country` (two-letter code only; no street, name or other address data is stored).
- New table `market_daily_facts` (client, market, date, gross sales, discounts, shipping, tax, new and returning order revenue and orders, refunds): the same revenue lines as `daily_facts`, rebuilt by `rebuild_market_facts(client, from, to)` after each Shopify sync. `daily_facts` stays the blended total, and the markets must sum to it (a check, not a second source of truth).
- Ad spend by market is phase 2: Meta breaks spend down by country, Google by geography or a campaign-name tag (like the brand rule), and some clients use one ad account per market. Until phase 2, market views show revenue, orders, AOV and new vs returning only. Spend is never split by revenue share, because that would invent a MER.

### Plan
- A **Markets** line in the Details step: each market's % of planned order revenue per month, inferred from the same month last year (fallback: trailing 90 days), with the usual Plan, Inferred, Last year, Actual, lock and Extrapolate tools, forced to sum to 100% (the last market takes the remainder).
- Targets per market and day = the day's total target x the market's share, stored in `plan_market_targets` (plan, market, date, order revenue, new revenue, returning revenue). Total targets are untouched.

### Home
- A **Market** selector (All, then each market, then Other). Choosing a market shows the same tiles from `market_daily_facts` against that market's targets, with the usual red and green.
- A **Markets** strip under the header: one row per market with revenue, plan, % of plan, YoY and new vs returning share for the selected range, coloured the same way, so every market can be read at once next to the blended figure.

## Decision on Shopify access (strategist, 2026-10-12)
Read the country from the shipping address, store only the two-letter code, and ask Shopify to approve the address-level protected customer data access for the app, showing the app in depth in the review. Work needed with it:
- **Submission and public pages:** `docs/shopify-submission.md` (section 3 and the listing text), the `/privacy` page (`lib/legal.ts`) and the screencast script currently say the app never reads addresses; they change to "reads the shipping country only, stores the country code only" before the request goes in.
- **Sync degrades gracefully:** if Shopify has not granted the access, the orders query must still work. The country is requested so that a denied field never breaks the sync; orders are stored without a country and Store Settings shows "Country not available yet" until access is granted. Markets are hidden for a client with no country data.
- **Erasure:** the country code is kept with the order; the existing customer and shop redact webhook handling is checked against it (the code alone does not identify a person, which the privacy page states).

## Shopify access: what the research found
- Shopify's order object has no market field (checked in the Admin GraphQL reference; a developer-forum thread confirms there is no strong link between an order and its market and suggests matching the shipping country to the market's regions).
- The country comes from the shipping address. Address fields are protected customer data in the Admin API. Our public app declares Level 1 and states it never reads addresses (`docs/shopify-submission.md`, section 3), so as declared **the app cannot read countries**. Shopify's documentation did not state which level the Admin API requires for `countryCodeV2`; the safe assumption is Level 2, which means a stricter app review. The existing custom app ("Apex Data") may already allow it; confirm in the Dev Dashboard.
- Options: (A) request the address level and read `shippingAddress.countryCodeV2` per order, storing only the code; (B) use ShopifyQL aggregates by country (scope `read_reports`, no personal data; whether it splits new and returning customers is unverified). Recommended: confirm what the current app can read, then choose A for the European clients.

## Tests
Country-to-market mapping (including Other and a country listed twice), shares summing to 100%, targets per market sum to the total each day, markets sum to the blended facts, a market with no orders shows "–" not NaN, and the Home selector falls back to All when a client has no markets.

## Not in scope
Exchange rates, several stores under one brand (separate accounts by decision), a New Customer model per market, ad spend by market (phase 2), per-market creative.

## Done when
A client with markets set up sees the Market selector and the Markets strip on Home, the plan has a Markets line with targets per market, and markets reconcile to the total.

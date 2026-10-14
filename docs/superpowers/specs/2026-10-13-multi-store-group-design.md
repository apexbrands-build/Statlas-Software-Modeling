# Multi-store brands: one account, several Shopify stores as markets

Date: 2026-10-13. Status: DRAFT for the strategist's review, not started. First use: Pacha (5 Shopify stores, 100% subscription on Recharge, Next Commerce and Juo). Replaces `2026-10-12-markets-design.md` for brands that run one store per market (that spec stays for several markets inside one store).

## Goal
One account for the whole brand. It shows the total business in one reporting currency, then breaks it down by market and tracks each market against its share of the total plan. Subscriptions are first-class: rebills are tracked daily and feed the daily targets.

## Facts from the client (Thomas, 2026-10-13)
Five Shopify stores (France + Belgium + Luxembourg, UK, Germany + Austria, Switzerland, Netherlands). One Meta ad account per market, one Google account for all markets. He already reads the business as a total, then by country and market.

## Decisions (strategist, 2026-10-13)
- **One account per brand**, with one Shopify connection per store, each tagged with a market. No master account that sums other accounts (this overrides "separate accounts" in the markets spec for this case).
- **Model the total, then allocate.** Plan, models and targets run on the consolidated total. Each market gets its **last 30 days' share** of the target. Spend and aMER targets are the same for the whole brand; the market allocation is what is tracked.
- Newly scaled markets use that allocation with wide ranges; their own models only once they have enough history.
- **Markets on Home:** the total first, then each market underneath (spend, new revenue, aMER, returning revenue, MER, CM against its allocation).
- **Channels:** channel performance stays at the total level by default; campaigns per country are analysed in the Paid Media report with a market filter.
- **Spend by market.** Pacha runs **one Meta ad account per market**, so each Meta integration is tagged with its market and its spend maps directly. It runs **one Google Ads account for all markets**, so Google campaigns map to markets by a name tag ("name contains", as with the brand rule; Pacha works by language).
- **Market name defaults from the store name** (the shop's name or domain usually carries the market); editable in Store Settings.
- **Subscriptions are kept in scope:** connectors for the subscription platforms and a Subscriptions report. No "take rate" report (the business is 100% subscription).
- **Setup order:** the app is deployed on the client's own Vercel and Supabase before work starts; the client installs it in each of its Shopify stores.

## Visibility rule and priority (strategist, 2026-10-13, later the same day)
- This is a **general feature, not a Pacha-only branch**, and it ships to the main code. The criterion: **the market views (Home market strip and selector, the market filter in Paid Media, the market allocation line in the plan) appear only when a client has more than one Shopify store connected.** With one store, every screen stays exactly as it is today.
- It is **not first in line**: Pacha is not closed, and the strategist wants the core functionality finished first (subscriptions, creative, email and SMS, GA4, channel mix). Build it after those, or sooner if Pacha signs.

## What the code already allows (checked 2026-10-13)
- `integrations` is unique on (client, provider, account), so one client can hold several Shopify, Meta and Google connections.
- The Shopify sync (`lib/sync/run-shopify.ts`) runs per integration and writes orders with the client id, so five stores can feed one client.
- Nothing needs shipping addresses: the market is the store, so the Shopify address-level approval in the markets spec is **not needed** here.

## What has to be added
1. **Market on the connection.** `integrations` gets `market` (text), `currency` and `timezone` (both default to the client's). Store Settings: "Add Connection" lets the same provider be added more than once and asks for the market name.
2. **Market on orders.** `orders` (and `order_refunds`) get `integration_id`. The sync stamps it and uses the integration's timezone for `order_date` (today it uses the client's single timezone). Customers are scoped per store (a person who buys in two stores is new in each).
3. **Currency.** New `fx_rates` (month, currency, rate to the client's reporting currency). `rebuild_daily_facts` converts each order by its integration's currency and its month. Start with monthly average rates entered once for EUR, CHF and GBP; automate later.
4. **Market rollups.** `market_daily_facts` (as in the markets spec) keyed by market, rebuilt per integration; `daily_facts` stays the converted total and a check confirms the markets sum to it. Add a market column to channel facts for spend by market.
5. **Spend by market.** Meta: the integration's market. Google: a per-client list of market tags, where a campaign belongs to a market when its name contains the tag. Ad accounts in other currencies are converted like orders.
6. **Plan allocation.** Default share = last 30 days of the market's new and returning revenue; stored in `plan_market_targets` (from the markets spec); overridable. Totals untouched.
7. **Home and reports.** Market selector and Markets strip (markets spec), with the tiles named above; Paid Media report gets a market filter.
8. **Settings.** Subscription apps appear as Shopify sales channels, so they must be added to the client's DTC channels or rebills are dropped from revenue (default is Online Store and Shop only).

## Subscription layer
- **Rebills from orders (no connector needed):** a rebill is a returning order whose sales channel is a subscription app. Add `rebill_revenue` and `rebill_orders` to the daily facts.
- **Daily targets:** the planning generator already keeps a fixed value on a day and lets the other days absorb the difference. Scheduled rebills for the next 30 to 60 days are written as fixed daily returning values; later days keep the weekday-weighted spread of the monthly returning forecast. The month still reconciles to the Returning model.
- **Schedule:** from the connector (next billing date, interval, status) when available; otherwise inferred per customer as last order plus that customer's median gap. Expected rebills = scheduled x payment success x (1 - skip, pause, cancel risk), measured from history.
- **Connectors**, one provider file each: Recharge (France and UK), Juo (Netherlands), Next Commerce (Germany and Switzerland; API to be checked). `integrations.provider` needs the new names.
- **Subscriptions report:** MRR, active, paused and cancelled subscriptions, new subscriptions, churn by cohort, skips, failed payments, by market. Pacha's headline metric is MRR, so it belongs here.

## Not in scope
Per-market models for markets with short history, cross-store customer matching, exchange-rate automation (first version), a take-rate report, a per-market calendar (each store's plan already has a calendar when used as its own account; here the calendar stays at brand level with an optional market tag later).

## Build order and rough sizing (for the strategist to confirm)
1. Market on connection and orders, per-integration timezone, FX table and converted rollups, `market_daily_facts`: about 3 to 5 days. Everything else depends on it.
2. Home strip, allocation in the plan, Paid Media market filter, campaign tags: about 2 to 3 days.
3. Rebills from orders, daily-target injection: about 2 to 3 days.
4. Connectors and the Subscriptions report: Recharge about 3 to 4 days, Juo about 1 to 2, Next Commerce unknown until its API is read.
Sizing is a rough estimate, not a commitment. The strategist expects it to go faster than this (2026-10-13).

## Risks
- Shopify IDs are practically unique across stores, but the sync should log any order or customer ID that appears under two integrations.
- Short history in new markets: the allocation handles it for targets; the New Customer model is only trustworthy on the consolidated total.
- Currency: monthly average rates move the numbers slightly against what each store reports; say so on the screen.
- A store that installs late joins from its install date, so its history starts later and the totals change when it is added.

## Tests
Two stores in two currencies sum to the total in the reporting currency; markets sum to the total each day; a customer ID shared by two stores does not merge; a rebill order is counted as revenue only when its channel is in the DTC list; a fixed daily value keeps the month total; a market with no orders shows "-", not NaN.

## Done when
A brand with three Shopify stores in two currencies shows one Home with the total and a strip per market, the plan allocates the total target by market, and rebill orders are visible per day against the daily target.

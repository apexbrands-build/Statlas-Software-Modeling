# Subscriptions: data, report and forecast

Date: 2026-10-12. Status: approved by the strategist 2026-10-12; next step is its implementation plan. Depends on the connector foundation (`2026-10-11-connector-foundation-design.md`), the returning model (`docs/planning-layer.md`) and the report infrastructure (`2026-10-12-four-reports-design.md`).

## Goal
Know every client's subscription business inside Apex Analytics: how many people subscribe, how many leave, how much revenue it carries and what rebills are coming. Show it in a Subscriptions report, and put the rebill schedule into the returning revenue forecast.

## Decisions (strategist, 2026-10-12)
- **Both methods.** Loop and Skio connect through their APIs (one connection per store). Where a client has no API access (for example a Loop plan without it) or uses another app, the same report runs on an estimate from Shopify orders. The report does not care where the rows came from.
- **A Subscriptions report** is part of the build: share of new customers who subscribe, churn and the standard subscription metrics.
- Other apps (Recharge, Smartrr, Seal) get connectors later, one provider file each.

## What the research found
- Shopify's own subscription API (the "Access subscriptions APIs" request in the Dev Dashboard, scopes `read_customer_payment_methods` and `write_own_subscription_contracts`) is for apps that create subscriptions. The read scope returns only contracts the requesting app created (Shopify Community answers, Fivetran's connector team and a developer's test with PayWhirl all say contracts of other apps come back empty). **We do not request it**: it cannot read Loop or Skio subscriptions.
- Skio: GraphQL API (`graphql.skio.com`), reads on subscription records including the next billing date. Loop: Admin API with a token header and an order-schedule endpoint with `nextBillingDateEpoch`; reportedly only on Loop's Pro plan. Both come from third-party pages and are unverified: **step 1 of the plan answers them with a real key** (endpoints, fields, page size, rate limit, which plan unlocks the API).

## What to pull (and why)
One row per subscription, current state, in `subscriptions`:

| Field | Used for |
|---|---|
| `source` (`loop`, `skio`, `inferred`), `external_id` | identity |
| `customer_ref` = Shopify customer id as text | links to our orders (new vs returning, LTV). No email, name or address is stored |
| `status` (`active`, `paused`, `cancelled`), `started_at`, `paused_at`, `cancelled_at`, `cancel_reason` (the app's category text) | subscribers, churn, reasons, retention triangle |
| `interval_unit`, `interval_count` | cadence mix, MRR |
| `next_billing_at`, `next_amount` (store currency) | upcoming rebills, expected revenue |
| `orders_count`, `skips_count`, `last_order_at`, `last_payment_failed` | skip rate, failed payments, lifetime orders |
| line items (`sku`, quantity, price) in `subscription_items` | product mix, what people subscribe to |

Daily history is rebuilt from these dates: a subscription counts as active on day d when `started_at <= d` and it was not cancelled by d. Past pauses are not in the snapshot, so historical active counts ignore them (stated on the report).

From Shopify orders (no API needed): `orders.is_subscription` (the order came from a channel tagged Subscription) and `orders.is_first_order` (already stored). `daily_facts` gets `sub_orders`, `sub_revenue`, `sub_new_orders` (a customer's first order is a subscription order) and `sub_new_revenue`; rebills = subscription orders that are not first orders.

## Tagging subscription orders
A **Subscription** tag per channel in Store Settings > Sales channels, next to the DTC flag. The page suggests channels whose name contains skio, loop, recharge, smartrr, seal, appstle, bold, ordergroove or "subscriptions", but the strategist confirms. Stored as `subscriptionChannels` in the client's extra settings. Changing it rebuilds the subscription columns for the client.

## Source per client
Setting `subscriptionSource`: `none` (default), `inferred`, `loop` or `skio`. A connected, synced connector switches it automatically; the inferred rows stay in the table but the report and forecast read the chosen source only.

## Inferred subscriptions (Shopify orders only)
For each customer with at least one subscription order: cadence = median days between their subscription orders (one order only: the client's median cadence); `next_billing_at` = last subscription order + cadence; a subscriber is `cancelled` once no subscription order has come within 1.5 cadences of the last (cancel date = last order + cadence). The client's **rebill rate** = share of due rebills that happened, by order index (2nd, 3rd, 4th and later), is used as the probability that the next one lands. Limits stated on the report: no skips, pauses or reasons; a customer with several subscriptions counts once; amounts come from the last subscription order.

## Connectors (Loop, Skio)
Two provider files in `lib/providers.ts` and `lib/sync/registry.ts` with `auth: "client-key"`, `kind: "subscriptions"` (new kind). The sync pages through all subscriptions (full snapshot on connect; `updated since` where the API allows on recent runs), upserts `subscriptions` and `subscription_items`, then `finalize` calls `rebuild_subscription_facts`. `verify` makes one light call so a wrong key fails at connect. A plan without API access returns a clear error ("This Loop plan does not include API access; using the estimate from Shopify orders").

## Subscriptions report (`subscriptions` in the report registry)
Date range and Day/Week/Month buckets like the other reports; every figure has a prior-period and YoY comparison.
- **Cards:** Active subscribers; New subscribers; Cancelled; Monthly churn (cancelled in the month / active at its start); Subscription revenue and its share of order revenue; **% of new customers on subscription** (`sub_new_orders / new-customer orders`); Subscriber AOV against one-time AOV; MRR equivalent (sum of `next_amount` over active subscriptions, scaled to 30 days); Expected rebills next 30 days (orders and revenue).
- **Monthly table:** new, cancelled, net adds, active at end, churn %, subscription orders (first and rebill), revenue, share of revenue, attach rate, AOV, skip rate and failed-payment rate (connectors only).
- **Retention triangle:** subscribers by start month against months since start, % still active.
- **Upcoming rebills:** next 12 weeks, expected orders and revenue by week (rebill rate applied).
- **Mix:** interval mix, top subscribed products, cancel reasons (connector data only).
- A source line: "From Loop (synced 6:10)" or "Estimated from Shopify orders".

## Forecast (stage C)
- Returning revenue splits into **Subscription rebills** and **Other returning**. The cohort inputs for the Returning model leave subscription rebills out, so nothing is counted twice (`cohort_periods` gets a non-subscription revenue column).
- Subscription rebills for a day = for each active subscription due that day, `next_amount` x rebill rate, rolled forward by its interval with the churn decay the client's own subscriber survival curve gives. Inside the connector horizon the dates are the app's; past it, each subscription is projected by cadence. New subscribers in the plan = planned new-customer orders x the client's attach rate, entering the same curve.
- `plan_targets.sub_revenue` (nullable) holds the daily value, a slice of `returning_revenue`; daily targets spike on rebill days. The Details step shows Subscription rebills (expected) and Other returning (model) as two lines that add up to the returning total, with the usual override and lock.
- Home gets a **Subscriptions** section (active, new, churn, rebills this month against plan) once a client has a source.

## Stages
- **A. Data and report:** order tagging, `subscription` columns, inferred rows, rebuild function, report. Works for every client with a tagged channel.
- **B. Connectors:** Loop and Skio, replace the inferred rows where connected.
- **C. Forecast and Home:** schedule into the plan, the split returning lines, Home section.

## Data (next free migration numbers at build time)
`subscriptions`, `subscription_items`, `subscription_daily` (rebuilt: active, new, cancelled, paused, reactivated per source), `orders.is_subscription`, `daily_facts` subscription columns, `cohort_periods` non-subscription column, `plan_targets.sub_revenue`; all tables with row-level security by client like the others; written by the service role.

## Tests
Cadence, next date and cancel inference on fixture orders (one order, irregular gaps, a customer who stops); rebill rate by order index; active-on-date reconstruction; churn and attach-rate arithmetic; retention triangle; expected rebill schedule applies the rebill rate and the interval roll-forward; source precedence; mapping tests per connector from saved sample payloads; `rebuild` totals tie to `daily_facts`; division by zero shows "–".

## Not in scope
Changing subscriptions (the app is read-only), payment recovery, subscriber-level lists in the UI (no personal data), Recharge, Smartrr and Seal connectors, Shopify's native Subscriptions app data (cannot be read; its orders still count through the channel tag).

## Done when
A client with a tagged channel sees the Subscriptions report from Shopify orders; a client with a Loop or Skio key sees the same report from the app with the source line changed; the plan carries the rebill schedule; Home shows the section.

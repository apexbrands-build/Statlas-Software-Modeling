# Subscriptions, stage A1: tag subscription orders and the orders report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The strategist ticks which Shopify sales channels are subscriptions (Skio, Loop and so on); the app then splits every day's order revenue into subscription and one-time, and a new **Subscriptions** report shows subscription orders, rebills, revenue, share of revenue, the share of new customers who subscribe and AOV, for any date range with the usual comparisons. It works for every client from Shopify alone, with no API key.

**Architecture:** A per-client list of subscription channels; a SQL function marks orders of those channels (`orders.is_subscription`); a second SQL function fills four new `daily_facts` columns (it does not touch the existing rollup, so Home and every current report are unchanged); `DailyFact`/`Totals` carry the new fields; the report is a pure builder over the same bucketed facts as New Vs Returning.

**Tech Stack:** Supabase SQL functions, Next.js 16, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-subscriptions-design.md` (stage A, the order-based half). The inferred subscriber table, churn, retention, upcoming rebills (stage A2), the Loop and Skio connectors (stage B) and the forecast (stage C) are separate plans.

## Global Constraints

- Subscription numbers are a slice of DTC order revenue: only orders that are in a DTC channel, have revenue above 0 and are in a subscription channel count (the same filter `rebuild_daily_facts` uses), so subscription revenue can never exceed Order Revenue on Home.
- A rebill = a subscription order that is not the customer's first order; a new subscriber order = a subscription order that is the customer's first order (`is_first_order`).
- `rebuild_daily_facts` and `recompute_first_orders` are not edited. The new function runs after them.
- The subscription channel list is a client setting (`ExtraSettings.subscriptionChannels: string[]`, default `[]`); channel names match case-insensitively like `dtcChannels`.
- Migration `0013_subscription_orders.sql` (number may shift), additive; applied to the live project only after the strategist's go.
- `AGENTS.md`: read the matching Next.js guide in `node_modules/next/dist/docs/01-app` before touching route or page code.
- Division by zero shows a dash, never NaN (use `div` from `lib/metrics`).

## Review Focus

1. A client with no subscription channel ticked: the report says so plainly and shows no zeros dressed up as data; Home and other reports are untouched. Tested in Task 5.
2. Ticking or unticking a channel recalculates the client's whole history, not only new orders. Tested in Task 3.
3. A subscription order with revenue 0, a non-DTC subscription channel, or a refunded order: none of them inflates the numbers; subscription revenue never exceeds order revenue. Tested in Tasks 2 and 4 (SQL checked by a live query after applying).
4. A customer whose first order is a subscription order and who then rebills: counted once as a new subscriber order and the later orders as rebills. Tested in Task 5.
5. Channel names with different case or trailing spaces match. Tested in Task 1.

---

### Task 1: The setting and the matching rule

**Files:** Modify `lib/types.ts` (`ExtraSettings.subscriptionChannels`), `lib/defaults.ts`; create `lib/subscriptions/channels.ts`, `lib/subscriptions/channels.test.ts`; modify `components/settings/EditStoreDialog.tsx` (a "Subscription" switch beside each channel in the DTC channel list, line ~266).

**Interfaces:** Produces `isSubscriptionChannel(channel: string | null | undefined, list: string[]): boolean` (trimmed, case-insensitive, false for empty names), `suggestSubscriptionChannels(channels: string[]): string[]` (names containing skio, loop, recharge, smartrr, seal, appstle, bold, ordergroove or "subscription", case-insensitive).

- [ ] **Step 1: Write failing tests** for both functions (case, whitespace, empty, `null`, a list with a duplicate, "Loop Subscriptions" and "Skio" suggested, "Online Store" and "Shop" not) and that `defaultExtra()` has `subscriptionChannels: []`. Run: FAIL.
- [ ] **Step 2: Implement** the functions, the type, the default and the dialog switches (each switch edits `extra.subscriptionChannels`; suggested channels carry a small "suggested" tag). Run: PASS; `npx tsc --noEmit` clean.

### Task 2: Migration

**Files:** Create `supabase/migrations/0013_subscription_orders.sql`.

**Interfaces:** Produces `orders.is_subscription boolean not null default false`; `daily_facts.sub_orders`, `sub_revenue`, `sub_new_orders`, `sub_new_revenue` (numeric, default 0); `public.mark_subscription_orders(p_client uuid, p_channels text[]) returns void` (sets `is_subscription` for the client's orders from `lower(trim(sales_channel)) = any(lower-trimmed p_channels)`, and false for the rest); `public.rebuild_subscription_facts(p_client uuid, p_from date, p_to date) returns void` (for each day in the range: subscription orders = DTC orders with revenue above 0 and `is_subscription`; `sub_new_orders`/`sub_new_revenue` = those with `is_first_order`; updates only the four columns, inserting the day only when `daily_facts` has no row yet); both `security definer set search_path to 'public'`, executable by the service role only, with the statements written out in the migration (`revoke execute on function ... from public, anon, authenticated; grant execute on function ... to service_role;`), because `0005_exclude_free_orders.sql` itself carries no grants (they came from the separate lock-down migration).

- [ ] **Step 1: Write the migration** following the pattern of `0005_exclude_free_orders.sql`, plus the explicit revoke and grant statements above.
- [ ] **Step 2: Add a SQL check script** `supabase/checks/0013_subscription_orders.sql` (not run by tests): after applying, `select sum(sub_revenue) <= sum(new_order_revenue + returning_order_revenue)` per month for a client with channels marked, and `sum(sub_orders) = count(*) of is_subscription DTC orders`. Expected: true and equal.

### Task 3: Rollup runner

**Files:** Create `lib/sync/subscription-facts.ts` and `subscription-facts.test.ts`; modify `lib/sync/run-shopify.ts` (`finalizeShopify` calls it after `dbRollup`) and create `app/api/subscriptions/rebuild/route.ts` (POST `{ clientId }`: a signed-in user with access to the client, checked with row-level security as `app/api/integrations/connect/route.ts` does; it reads the saved channels and runs the rollup over the client's whole history, from the earliest order date to today). Client settings are saved from the browser straight to Supabase, so there is no server step to hook into: the Edit dialog calls this route right after it saves a changed channel list (read the Next.js route handler guide first, AGENTS.md).

**Interfaces:** Produces `runSubscriptionRollup(admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }, clientId: string, channels: string[], range: { from: string; to: string }): Promise<void>` that calls `mark_subscription_orders` then `rebuild_subscription_facts`, throwing the database message on error; `finalizeShopify` reads the client's channels from `client_settings.extra` and skips the call (and clears nothing) when the list is empty and no row was ever marked.

- [ ] **Step 1: Write failing tests** with a fake `rpc`: the two functions are called in order with the right arguments (channels array, range); an error from the first stops the second and rethrows its message; `finalizeShopify` (mocked deps) calls the runner with the saved channels over the sync range; a settings change calls it over the whole history (earliest order date to today).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

### Task 4: Facts and repository

**Files:** Modify `lib/types.ts` (`DailyFact`: `subOrders`, `subRevenue`, `subNewOrders`, `subNewRevenue`, all numbers), `lib/metrics.ts` (`Totals` and `aggregate` carry the four fields; `emptyTotals`), `lib/repository/supabase.ts` (map `sub_*` columns, 0 when the column is missing), `lib/repository/seed.ts` (a believable subscription share for the demo clients), `lib/metrics.test.ts`.

- [ ] **Step 1: Write failing tests:** `aggregate` over three days sums the four fields; `emptyTotals()` has zeros; a `DailyFact` without them (an old fixture) still aggregates as zero (the helper treats a missing field as 0 only where fixtures predate it: update the shared fixture builders instead of loosening the type). Run: FAIL.
- [ ] **Step 2: Implement.** Run the whole suite and `npx tsc --noEmit`: PASS (fix the fixtures that now need the four fields).

### Task 5: The report

**Files:** Create `lib/reports/subscriptions.ts`, `lib/reports/subscriptions.test.ts`, `components/reports/SubscriptionsReport.tsx`; modify `lib/reports/registry.ts` (status `ready`) and `components/reports/ReportRouter.tsx`.

**Interfaces:** Produces `SUBSCRIPTION_COLUMNS: ColumnDef[]` and `buildSubscriptions(facts: DailyFact[], by: GroupBy): NumTable` with columns Subscription Orders, New Subscriber Orders, Rebill Orders, Subscription Revenue, Revenue % Change, % of Order Revenue, % of New Customers on Subscription (`subNewOrders / newOrders`), Subscription AOV, One-Time AOV (`(order revenue - sub revenue) / (orders - sub orders)`), % of Orders on Subscription. Page: `SubscriptionsReport` over `FactsReport`, with a banner when `settings.extra.subscriptionChannels` is empty ("No subscription channel is ticked for this client. Tick the subscription channels in Store Settings, Edit, Sales channels.") and no table.

- [ ] **Step 1: Write failing tests:** a month of fixture days gives the right sums, rebills = subscription orders - new subscriber orders, the percentages, AOVs and the revenue change against the previous row; a bucket with no orders shows null, not NaN; subscription revenue never exceeds total revenue in the fixture; the registry marks `subscriptions` ready and a test that every ready report has a page still passes.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement** the builder, the page and the router case. **Step 4: Run** the suite, `npx tsc --noEmit`, `npx eslint .`, `npm run build`: PASS.

### Task 6: Docs and the live check

**Files:** Modify `docs/reports-plan.md`, `docs/changelog.md`, `CLAUDE.md`, `docs/connector-setup.md` (a "Subscription channels" note).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Live check (strategist, after the migration):** on a client that uses Skio or Loop, tick its subscription channel in Store Settings, open Reporting, Subscriptions for last month: the share of revenue and the share of new customers look plausible against the app's own dashboard; run `supabase/checks/0013_subscription_orders.sql`.

---

## Self-review

- **Spec coverage:** channel tagging, the four `daily_facts` columns (`sub_new_*`, rebills derived), the order-based report cards and table columns (share of revenue, attach rate, AOV) are covered. Subscribers, churn, MRR, retention, upcoming rebills, the inferred subscription table, connectors and the forecast are not in this plan (stages A2, B, C).
- **Type consistency:** `isSubscriptionChannel`, `runSubscriptionRollup`, `buildSubscriptions`, `SUBSCRIPTION_COLUMNS` and the four field names are spelled the same in every task.
- **Proportion:** six tasks, no function bodies.

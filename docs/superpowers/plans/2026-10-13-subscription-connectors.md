# Subscriptions, stage B: subscription app connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client's subscription app (Recharge first, then Loop and Skio, then Juo, then Next Commerce) connects with an API key per store; Apex Analytics pulls every subscription's current state daily into `subscriptions` and `subscription_items`, rebuilds the daily aggregates, switches the client's subscriber source to the app, and the Subscriptions report shows "From Recharge (synced 06:10)" plus what only an app knows: paused subscriptions, skips, failed payments, cancel reasons and top subscribed products.

**Architecture:** One shared runner (`lib/sync/run-subscriptions.ts`) drives every app through a small adapter interface (verify, fetch one page of subscriptions changed in a window, map to `SubscriptionRow`). Adapters sit in `lib/subscriptions/apps/<app>.ts` on the existing `requestJson` helper (`lib/messaging/http.ts`), register in `lib/sync/registry.ts` like Shopify, Meta and Google Ads, and use the existing chunked job queue: the job's date window is the "updated since/until" window, so history loads and daily syncs need no new job machinery. `finalize` rebuilds `subscription_daily` for the app's source (A2's function) and switches `subscriptionSource`.

**Tech Stack:** Next.js 16 server code, Supabase (service role writes), Vitest with saved, scrubbed sample payloads.

**Spec:** `docs/superpowers/specs/2026-10-12-subscriptions-design.md` (sections "Connectors (Loop, Skio)", "Source per client", "Subscriptions report"), the multi-store spec section "Subscription layer" (`docs/superpowers/specs/2026-10-13-multi-store-group-design.md`) and `docs/pacha-handoff.md` (order of work). Depends on stage A2 (`docs/superpowers/plans/2026-10-13-subscriptions-inferred-and-metrics.md`): its tables, `SubscriptionRecord`, `SubscriptionAppId`, `SourceConnection`, `effectiveSource`, `sourceLine`, `rebuild_subscription_daily` and the report page. Also uses the connector registry and messaging-connect work already built (`syncs` flag, `VERIFIERS`, `getVerifier`, `requestJson`, `PlatformError`, `CONNECT_LIMITS`, `readApiKey`).

## Scope change against the spec (strategist, 2026-10-13)

The approved spec builds Loop and Skio and lists Recharge as "later" and out of scope. The order given on 2026-10-13 is **Recharge, then Loop and Skio, then Juo, then Next Commerce** (Pacha uses Recharge, Next Commerce and Juo; the US clients mostly Recharge, Loop and Skio). This plan follows the new order; the spec's "Not in scope" line on Recharge should be updated when this plan is approved.

## Global Constraints

- Read-only against every app: GET calls only, except Skio's GraphQL, which is a POST carrying a `query` (a test asserts no request body contains `mutation`).
- The API key never leaves the server and never appears in a message or log (`redact`, `requestJson`'s `secret`).
- **No personal data:** no email, name, phone or address is stored, logged or saved in a fixture. The customer link is `customer_ref` = the Shopify customer id as numeric text (`numericId` from `lib/sync/shopify.ts` for a `gid://` value). Apps that return addresses or emails in the payload (Loop `shippingAddress`, Recharge `include=customer`, Juo `expand=customer`) have those fields dropped in the mapper; Juo is called without `expand`. Sample payloads saved for tests are scrubbed by hand first (placeholders `customer@example.com`, `Jane Doe`, `1 Main St`).
- Shopify's own subscription API is **not** used: it only returns contracts the requesting app created, so it cannot read these apps' subscriptions.
- Statuses map to `active`, `paused`, `cancelled` only; `expired` maps to `cancelled` at its end date; any value not listed in the app's section is a mapping error that fails the row into the run message (count of skipped rows), never the sync.
- Dates: app timestamps become store-timezone dates with `localDate(iso, timeZone)`, moved from `lib/sync/run-shopify.ts` (private today) to `lib/dates.ts`.
- Amounts: `next_amount` = the app's expected next charge for the items after discounts, before tax, plus delivery when the app gives it; a row whose currency differs from the client's currency keeps its amount but is left out of MRR (counted in a note), because there is no exchange-rate table yet.
- Disconnecting keeps loaded data (existing rule in `app/api/integrations/disconnect/route.ts`): `subscriptions.integration_id` is `on delete set null` (A2), and `effectiveSource` falls back to the estimate when the app has no live connection.
- Migration: the next free number at build time after A2 (expected `0015_subscription_connectors.sql`). Additive; applied only after the strategist's go.
- Platform facts below were read from public docs on 2026-10-13 and are **third-party and unverified until each app's Step 1** confirms them with a real key. No endpoint is used that is not listed in its app's section; anything marked "to confirm" must be confirmed or replaced in Step 1 before the adapter task starts.
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/01-app` before touching route or page code (Task F4 edits the report page; no new route is needed).

## Review Focus

1. A key that is wrong, revoked or on a plan without API access (Loop below Pro, reportedly): connecting fails with a plain message, nothing is saved, and the report keeps the Shopify estimate with a note naming the app. Tested in Task F3 and each adapter task.
2. A store with tens of thousands of subscriptions and a strict rate limit (Loop: 2 requests per 3 seconds, unverified): a chunk that cannot finish before the 45-second deadline fails as a timeout so the existing runner halves the window, and no page is skipped or written twice. Tested in Task F3.
3. Payloads that carry emails, names or addresses: none of it reaches a database row, a run message or a fixture. Tested in Task F2 and each adapter task.
4. A daily sync failing twice: "Needs attention" shows (existing counter), the report switches to the estimate with a note, and the next good sync switches back without the strategist doing anything, unless she or he picked the source by hand. Tested in Task F4.
5. Recharge's one-subscription-per-product model: a customer with three products on one address counts as one subscriber, not three. Tested in Task R2.

---

## Foundation

### Task F1: Provider ids, kind, cards and the migration

**Files:** Modify `lib/providers.ts`, `lib/providers.test.ts`, `components/settings/ProviderCards.tsx` (a "Subscriptions" group), `lib/sync/registry.test.ts`. Create `supabase/migrations/0015_subscription_connectors.sql` (number may shift).

**Interfaces:**
- Produces `ProviderId` values `"recharge" | "loop" | "skio" | "juo" | "nextcommerce"`, `ProviderKind` value `"subscriptions"`; each new provider `auth: "client-key"`, `available: false` and `syncs: false` until its adapter task flips both to true.
- Produces the migration: `integrations_provider_check` re-created with the five ids added to the list in `0009_providers_and_failures.sql`; the read functions of Task F4.

- [ ] **Step 1: Write failing tests:** every `SubscriptionAppId` (A2) is a `ProviderId` whose kind is `subscriptions`, and every `subscriptions` provider is a `SubscriptionAppId`; `DB_PROVIDER_IDS` contains the five ids; the existing "syncs means it has a sync" test still holds; `ProviderCards` groups (exported constant) include `subscriptions`.
- [ ] **Step 2: Run** `npx vitest run lib/providers.test.ts lib/sync/registry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the ids, kind, card group (title "Subscriptions"), and the migration's provider check.
- [ ] **Step 4: Run:** PASS; `npx tsc --noEmit` clean.

### Task F2: The normalised row and the writer

**Files:** Create `lib/subscriptions/connector.ts`, `lib/subscriptions/connector.test.ts`. Modify `lib/dates.ts` (add `localDate`), `lib/sync/run-shopify.ts` (import it instead of its private copy).

**Interfaces:**
- Consumes `SubscriptionRecord`, `SubscriptionAppId` (A2).
- Produces `interface SubscriptionRow { externalId: string; customerRef: string | null; status: "active" | "paused" | "cancelled"; startedAt: string; pausedAt: string | null; cancelledAt: string | null; cancelReason: string | null; intervalUnit: "day" | "week" | "month" | "year"; intervalCount: number; nextBillingAt: string | null; nextAmount: number | null; currency: string | null; ordersCount: number | null; skipsCount: number | null; lastOrderAt: string | null; lastPaymentFailed: boolean | null; items: { itemId: string; variantId: string | null; sku: string | null; title: string | null; quantity: number; price: number | null }[] }` (timestamps as ISO strings, as the app gives them).
- Produces `toDbRows(rows: SubscriptionRow[], ctx: { clientId: string; integrationId: string; source: SubscriptionAppId; timeZone: string }): { subscriptions: Record<string, unknown>[]; items: Record<string, unknown>[] }` (exactly the A2 columns, dates through `localDate`).
- Produces `writeSubscriptions(admin: SubsAdminLike, db: ReturnType<typeof toDbRows>, ctx: { clientId: string; source: SubscriptionAppId }): Promise<{ subscriptions: number; items: number }>` where `SubsAdminLike` is the subset of the Supabase client used: upsert `subscriptions` in batches of 500 on `client_id,source,external_id`, then for the same external ids delete `subscription_items` and insert the new items in batches of 500.
- Produces `ALLOWED_SUBSCRIPTION_KEYS` and `ALLOWED_ITEM_KEYS` (the column lists).

- [ ] **Step 1: Write failing tests:** `localDate("2026-10-13T02:30:00Z", "America/New_York") === "2026-10-12"`; `toDbRows` output keys are exactly the allowed lists; a row whose source object carried `email`, `first_name`, `address1` (added by the test to the input as extra properties) produces JSON without those strings; `customerRef "gid://shopify/Customer/123"` becomes `"123"`; 1,201 rows make three upsert calls (500, 500, 201); writing the same rows twice leaves the same upsert payload (idempotent); items of an external id are deleted before insert; an upsert error rejects with the database message and no item is touched.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS; the Shopify tests still pass.

### Task F3: Adapter interface and the shared runner

**Files:** Create `lib/subscriptions/adapter.ts`, `lib/sync/run-subscriptions.ts`, `lib/sync/run-subscriptions.test.ts`.

**Interfaces:**
- Produces `interface SubscriptionAdapter { source: SubscriptionAppId; platform: string; chunkDays: number; verify(input: { accountId: string; apiKey?: string }, fetchImpl?: typeof fetch): Promise<{ accountName: string; accountId?: string }>; fetchPage(key: string, accountId: string, window: { fromIso: string; toIso: string }, cursor: string | null, fetchImpl?: typeof fetch): Promise<{ rows: SubscriptionRow[]; skipped: number; next: string | null }> }`.
- Produces `class SubscriptionTimeout extends Error` (thrown when the deadline passes between pages, so `onChunkError` halves the window).
- Produces `syncSubscriptionApp(integrationId: string, range: SyncRange, ctx: SyncContext, adapter: SubscriptionAdapter, deps?: { admin?: SubsAdminLike; readKey?: (id: string) => Promise<string>; now?: () => number }): Promise<{ rows: number; skipped: number }>`: loads the integration and the client's timezone, records a `sync_runs` row, pages `fetchPage` from cursor null until `next` is null, writes each page with `writeSubscriptions` as it arrives, then updates `integrations` (`status "connected"`, `consecutive_failures 0`, `last_synced_at`, coverage like `run-meta.ts`) and the run (`rows_written`, message `"<n> subscriptions, <k> skipped rows"`); on error sets `status "error"`, `last_error` (300 characters, key redacted) and rethrows.
- Produces `appMessage(platform: string, e: unknown): string`: `rejected` gives "<App> rejected the API key. Create a new key in <App> and reconnect.", `forbidden` gives "This <App> key cannot read subscriptions. Check the key's permissions or the <App> plan (API access may need a higher plan). Showing the estimate from Shopify orders.", `rate_limited`/`unavailable` keep `requestJson`'s text.
- The window is the job's `[from, to]` as `from 00:00` to `to 23:59:59` in the store timezone, converted to ISO.

- [ ] **Step 1: Write failing tests** with a fake adapter and admin: three pages are written in order and the cursor passed each time is the previous `next`; the deadline passing after page 2 throws `SubscriptionTimeout` with pages 1 and 2 written (a retry rewrites them harmlessly: upsert); a `PlatformError("forbidden")` on page 1 sets the integration to `error` with the forbidden message, rethrows, and writes nothing; the key string inside an upstream error never appears in `last_error`; a page with `skipped: 2` adds to the run message; the window ISO strings for `2026-10-01..2026-10-14` in `Europe/Paris` start at `2026-09-30T22:00:00.000Z`.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

### Task F4: Finalize, source switching and the report additions

**Files:** Modify `lib/subscriptions/source.ts` and its test (A2), `lib/sync/run-subscriptions.ts` (add `finalizeSubscriptionApp`), `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`, `components/reports/SubscriptionsReport.tsx`, `components/reports/SubscriberSections.tsx` (A2), `lib/reports/subscribers.ts` and its test; extend the Task F1 migration with the read functions below.

**Interfaces:**
- Produces `finalizeSubscriptionApp(integrationId: string, adapter: SubscriptionAdapter, deps?): Promise<void>`: calls `rebuild_subscription_daily(p_client, p_source)` (A2), then `autoSource(extra, adapter.source)` and saves `client_settings.extra` when it returns a change.
- Produces `autoSource(extra: Pick<ExtraSettings, "subscriptionSource" | "subscriptionSourceSetByUser">, app: SubscriptionAppId): Partial<ExtraSettings> | null` (switch to the app when the source is `none` or `inferred` and not set by the user; null otherwise).
- Extends `effectiveSource` (A2) for app sources: the chosen app with a connection whose status is `connected` and not `needsAttention(consecutiveFailures)` is used; otherwise the estimate (when channels are ticked) or none, with the note "<App> needs attention; showing the estimate from Shopify orders." or "<App> is not connected; ...". `sourceLine("recharge", conn, tz)` gives "From Recharge (synced 06:10)" (time of `lastSyncedAt` in the store timezone; date added when not today).
- Produces `Repository.getSubscriptionConnections(clientId: string): Promise<SourceConnection[]>` (integrations of kind subscriptions, columns from `INTEGRATION_COLUMNS` plus `consecutive_failures`).
- Produces read functions `subscription_health(p_client uuid, p_source text)` returning `(active bigint, paused bigint, failed_payment bigint, skips bigint, orders bigint)` and `subscription_cancel_reasons(p_client uuid, p_source text, p_from date, p_to date)` returning `(reason text, subs bigint)` (null reason as "Not given") and `subscription_top_products(p_client uuid, p_source text, p_limit int default 10)` returning `(title text, sku text, subs bigint, quantity bigint)` over active subscriptions; `SubscriptionSummary` gains `health`, `cancelReasons`, `topProducts` (empty for `inferred`).
- Report: cards "Paused" and "Failed last payment" (current, no comparison) and "Skip rate" (skips / (skips + orders), lifetime) only for app sources; Mix gets "Cancel reasons (in range)" and "Top subscribed products".

- [ ] **Step 1: Write failing tests:** `autoSource` switches from `none` and from `inferred`, not when `subscriptionSourceSetByUser`, and not from another app; `effectiveSource("recharge", true, [{ provider: "recharge", status: "connected", consecutiveFailures: 2, ... }])` is `inferred` with the needs-attention note; the same with 0 failures is `recharge`; `sourceLine` formats the sync time in the store timezone; the report builder hides the three app-only cards for `inferred` and shows "–" for a skip rate with no orders; `finalizeSubscriptionApp` (fake admin) calls the rebuild with the adapter's source and saves settings only when `autoSource` changes something.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement**, reading the Next.js client component guide before editing the page (AGENTS.md). **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`: PASS; seed mode shows the report unchanged for demo clients (source `inferred`).

### Task F5: Registry wiring (one line per app)

**Files:** Modify `lib/sync/registry.ts`, `lib/sync/registry.test.ts`.

**Interfaces:**
- Produces `subscriptionSync(adapter: SubscriptionAdapter): ProviderSync` (`chunkDays: adapter.chunkDays`, `sync` calls `syncSubscriptionApp`, `finalize` calls `finalizeSubscriptionApp`, `verify` calls `adapter.verify` with `CONNECT_LIMITS`). Each adapter task adds `SYNCS.<app> = subscriptionSync(<app>Adapter)` and flips its provider to `available: true, syncs: true`.

- [ ] **Step 1: Write a failing test** with a fake adapter: `subscriptionSync(fake).sync` passes the range and context through, `finalize` runs after it, `verify` is the adapter's.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

---

## Recharge

Third-party facts (public reference, 2021-11 version, unverified): base `https://api.rechargeapps.com`, header `X-Recharge-Access-Token: <token>` and `X-Recharge-Version: 2021-11`, scope `read_subscriptions`; `GET /subscriptions` with `limit` up to 250, cursor pagination (`next_cursor`, passed back as `cursor`), `sort_by` including `updated_at-asc`, `include` including `customer`; subscription fields `id`, `address_id`, `customer_id` (Recharge's own id), `status`, `created_at`, `updated_at`, `cancelled_at`, `cancellation_reason`, `next_charge_scheduled_at`, `order_interval_unit`, `order_interval_frequency`, `charge_interval_frequency`, `price` (string), `quantity`, `sku`, `external_variant_id`, `product_title`, `presentment_currency`, `is_prepaid`, `max_retries_reached`. The Shopify customer id appears as `external_customer_id.ecommerce` on the customer object. A Recharge subscription is one product; one charge bills every subscription on an address.

### Task R1: Step 1, confirm the Recharge API with a real key

- [ ] **Step 1: The strategist creates a read-only API token** in the client's Recharge admin (Apps, API tokens; read scopes for subscriptions, customers, charges and store) and puts it herself or himself into `.env.local` (gitignored) as `PROBE_API_KEY`; Claude never types, prints or saves the key, runs only the read-only calls below from a throwaway script in the scratchpad, and the strategist deletes the line afterwards. The same procedure applies to every app's Step 1. Record in `docs/connector-setup.md` (no key, no personal data):
  1. Auth style and version header; which plan tier allows API tokens.
  2. A store-info call usable for `verify` that returns the store name and id (to confirm: `GET /store`); else `GET /subscriptions?limit=1` with a typed name.
  3. The list call and the changed-since filter: whether `updated_at_min` and `updated_at_max` exist on `GET /subscriptions`, whether filters may be combined with `cursor` (the docs suggest a cursor request carries only `limit`), and the page size.
  4. Field mapping: `status` values (expected `active`, `cancelled`, `expired`; is there a paused state?), `next_charge_scheduled_at` (date or timestamp, timezone), interval from `order_interval_*` vs `charge_interval_frequency` for prepaid, `cancellation_reason` text, `price` meaning (per unit, before discounts), whether `include=customer` gives `external_customer_id.ecommerce` on the list call.
  5. Skips and failed payments: where they live (to confirm: `GET /charges` with `status` skipped or error, filter by date) and whether one call per window is affordable.
  6. Rate limit (the reference only documents HTTP 429; note any limit header seen).
  7. Save 2 to 3 scrubbed sample payloads to `lib/subscriptions/apps/fixtures/recharge/`.
- [ ] **Step 2: Decide with the strategist** whether a Recharge subscriber is one address (proposed: group subscriptions by `address_id`) and compare the count with Recharge's own "active subscribers" figure.

### Task R2: Recharge adapter

**Files:** Create `lib/subscriptions/apps/recharge.ts`, `recharge.test.ts`. Modify `lib/providers.ts` (available, syncs, setup steps), `lib/sync/registry.ts`.

**Interfaces:**
- Produces `groupRechargeByAddress(subs: RechargeSubscription[], customers: Map<number, string | null>): SubscriptionRow[]` (one row per `address_id`: `externalId "addr:<id>"`, items = its subscriptions; active when any item is active, cancelled at the latest `cancelled_at` when all are cancelled or expired; next date = the earliest active `next_charge_scheduled_at`; amount = sum of active `price x quantity`; interval = the active items' most common unit and frequency; reason from the last cancelled item).
- Produces `rechargeAdapter: SubscriptionAdapter` (`source "recharge"`, `chunkDays 90`).

- [ ] **Step 1: Write failing tests** from the saved fixtures: three subscriptions on one address give one row with three items and a summed amount; one active and one cancelled item give an active row; all cancelled give `cancelledAt` = the later date; `expired` maps to cancelled; the Shopify customer id comes from `external_customer_id.ecommerce` and no customer email or name appears in the output; a 401 gives the R1-confirmed message and a plan without API access the forbidden message; `fetchPage` sends the confirmed headers and filters and follows the confirmed cursor; every request is a GET.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS; then flip the provider to available and syncing, add setup steps from R1, run the whole suite and `npm run build`.
- [ ] **Step 3 (live, strategist):** connect one US client, run a 48-month history load (Store Settings, Edit, history), then compare active subscribers and last month's new and cancelled with Recharge's dashboard and with A2's estimate; note the gap in `docs/changelog.md`.

## Loop

Third-party facts (Loop developer reference, version 2023-10, unverified; a newer `2026-04` version is mentioned by a third party): `GET https://api.loopsubscriptions.com/admin/2023-10/subscription`, header `X-Loop-Token: <token>` (scope "Read subscription contracts"), rate limit 2 requests per 3 seconds; query `pageNo`, `pageSize` (default 50, the endpoint page says up to 100, the pagination page says 50), `updatedAtStartEpoch` / `updatedAtEndEpoch`, `status` (`ACTIVE`, `CANCELLED`, `PAUSED`, `EXPIRED`), `lastInventoryAction` (`SKIPPED`...), `lastPaymentStatus` (`SUCCESS`, `FAILED`); response `data[]` and `pageInfo.hasNextPage`; fields `id`, `shopifyId`, `createdAt`, `updatedAt`, `status`, `cancellationReason`, `cancelledAt`, `pausedAt`, `completedOrdersCount`, `nextBillingDateEpoch`, `currencyCode`, `totalLineItemDiscountedPrice`, `deliveryPrice`, `isPrepaid`, `billingPolicy { interval, intervalCount }`, `lines[] { id, variantShopifyId, sku, quantity, price, discountedPrice, productTitle }`, `customer { id, shopifyId }`, and `shippingAddress` (dropped). The Admin API is reportedly on the Pro plan only.

### Task L1: Step 1, confirm the Loop API with a real key

- [ ] **Step 1:** with a client's Loop Admin API token (strategist creates it in Loop, Settings, API tokens, read scopes only), record: the plan tier that allows tokens (the message for other plans: "This Loop plan does not include API access; using the estimate from Shopify orders"); the current version string to use; a light `verify` call (to confirm: the list call with `pageSize=1`; is there a shop-info endpoint?); whether the `updatedAt*Epoch` filters are seconds or milliseconds and combine with `pageNo`; the real page-size maximum; `nextBillingDateEpoch` unit; whether `lastPaymentStatus` and `lastInventoryAction` come back as fields on each subscription or are filters only (skips count: is there a per-subscription count?); status values seen; `cancellationReason` text; the rate-limit response and any header; scrubbed samples to `lib/subscriptions/apps/fixtures/loop/`.

### Task L2: Loop adapter

**Files:** Create `lib/subscriptions/apps/loop.ts`, `loop.test.ts`. Modify `lib/providers.ts`, `lib/sync/registry.ts`.

**Interfaces:** Produces `mapLoopSubscription(s: LoopSubscription): SubscriptionRow` and `loopAdapter: SubscriptionAdapter` (`source "loop"`, `chunkDays 30`, a 1.5-second pause between pages through `requestJson`'s `sleep`).

- [ ] **Step 1: Write failing tests** from fixtures: `ACTIVE`, `PAUSED`, `CANCELLED`, `EXPIRED` map as the constraints say; `nextBillingDateEpoch` becomes an ISO date with the unit confirmed in L1; `customer.shopifyId` becomes `customerRef`; `ordersCount = completedOrdersCount`; `lastPaymentFailed` from the confirmed field; amount = discounted line total plus delivery; `shippingAddress` content never appears in the output; `pageInfo.hasNextPage false` ends paging; a 403 gives the Pro-plan message.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS; flip the provider, setup steps, suite and build. **Step 5 (live):** as R2 Step 3.

## Skio

Third-party facts (code.skio.com and help.skio.com, unverified): `POST https://graphql.skio.com/v1/graphql`, header `Authorization: API <key>` (the `API` prefix is required; a missing or wrong header shows as "field not found in query_root"), key created in Skio under API and Integrations, API; root field `Subscriptions(where, order_by, limit, offset)`; fields `id`, `status` (e.g. `ACTIVE`), `nextBillingDate`, `cancelledAt`, `createdAt`, `updatedAt` (to confirm), `statusContext`, `BillingPolicy { interval, intervalCount }`, `StorefrontUser { platformId }`, `SubscriptionLines { quantity, priceWithoutDiscount, ProductVariant { sku } }`; no `cancelReason` field on Subscription; limits: query depth 4, 100 nodes per request, 2,000 requests per minute per token; no sandbox.

### Task S1: Step 1, confirm the Skio API with a real key

- [ ] **Step 1:** record: the plan tier that gives API keys; a light `verify` query (to confirm: a shop or `Subscriptions(limit: 1) { id }`); whether `where: { updatedAt: { _gte, _lt } }` works and `order_by: { updatedAt: asc }` with `offset` paging is stable; how many subscriptions fit in one request under the 100-node rule with lines included; status values (paused? cancelled?); where cancel reasons, skips and failed payments live (to confirm: `statusContext`, a cancel-flow or billing-attempt table); whether `StorefrontUser.platformId` is the Shopify customer gid; scrubbed samples to `lib/subscriptions/apps/fixtures/skio/`.

### Task S2: Skio adapter

**Files:** Create `lib/subscriptions/apps/skio.ts`, `skio.test.ts`. Modify `lib/providers.ts`, `lib/sync/registry.ts`.

**Interfaces:** Produces `SKIO_SUBSCRIPTIONS_QUERY: string` (query text with `$from`, `$to`, `$limit`, `$offset`), `mapSkioSubscription(s: SkioSubscription): SubscriptionRow`, `skioAdapter: SubscriptionAdapter` (`source "skio"`, `chunkDays 60`; the cursor is the next offset as text).

- [ ] **Step 1: Write failing tests:** the request body's `query` contains `Subscriptions(` and no `mutation`; the header is `Authorization: API <key>`; a GraphQL `errors` array with HTTP 200 becomes a `PlatformError` (`bad_response`, or `rejected` for the query_root message); offset paging stops when a page is shorter than `limit`; mapping of status, interval, `platformId` (gid to numeric), lines and dates per the S1 notes.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS; flip the provider, suite and build. **Step 5 (live):** as R2 Step 3.

## Juo

Third-party facts (juo.dev Admin API reference, unverified): base `https://api.juo.io/admin/v1`, headers `X-Juo-Admin-Api-Key: <key>` and `X-Tenant-ID: <store>.myshopify.com`; `GET /subscriptions` with `query` (search syntax, e.g. `updatedAt:>="2026-01-01"`, fields `status`, `createdAt`, `updatedAt`, `nextBillingDate`, `canceledAt`, `customer`), `limit` 1 to 100 (default 20), cursors `after` / `before` (response `hasNextPage`, `endCursor`; also a `Link` header), `sort` (default `createdAt:asc`), `expand` (not used); statuses `active`, `paused`, `canceled`, `failed`, `expired`, `merged`; fields `id`, `currentCycle` (successful billings), `currencyCode`, `billingPolicy { interval: DAY | WEEK | MONTH | YEAR, intervalCount }`, `deliveryPrice`, `customer` (an id unless expanded), `items[] { id, title, quantity, totalPrice, variant, canceledAt }`; token-bucket rate limit with `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; no cancel reason field.

### Task J1: Step 1, confirm the Juo API with a real key

- [ ] **Step 1:** record: where the key is created and the plan that allows it; the account id is the `.myshopify.com` domain (the card asks for it); a light `verify` call; whether `customer` is the Shopify customer id or Juo's own (if Juo's own, whether a customer call gives the Shopify id without personal fields, else `customerRef` stays null); the meaning of `failed` (terminal, maps to cancelled at `updatedAt`, proposed) and `merged` (row dropped, proposed); `currentCycle` as `ordersCount`; sku inside `variant`; skips and failed payments (no field in the reference); the actual limit numbers in the headers; scrubbed samples to `lib/subscriptions/apps/fixtures/juo/`.

### Task J2: Juo adapter

**Files:** Create `lib/subscriptions/apps/juo.ts`, `juo.test.ts`. Modify `lib/providers.ts` (account label "Store domain"), `lib/sync/registry.ts`.

**Interfaces:** Produces `juoQuery(fromIso: string, toIso: string): string`, `mapJuoSubscription(s: JuoSubscription): SubscriptionRow | null` (null for `merged`), `juoAdapter: SubscriptionAdapter` (`source "juo"`, `chunkDays 90`; waits for `X-RateLimit-Reset` when `X-RateLimit-Remaining` is 0).

- [ ] **Step 1: Write failing tests:** `juoQuery` builds `updatedAt:>="<from>" AND updatedAt:<"<to>"`; both headers are sent and `expand` never is; `canceled` and `expired` map to cancelled, `merged` returns null and counts as skipped; paging follows `endCursor` until `hasNextPage` is false; amount = item `totalPrice` sum plus `deliveryPrice`; no personal field appears.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS; flip the provider, suite and build. **Step 5 (live):** with Pacha's Netherlands store only after Pacha signs, else any Juo client.

## Next Commerce

Third-party facts (Next Commerce, formerly 29 Next, developer docs, unverified): Admin API at `https://<store>.29next.store/api/admin/`, `Authorization: Bearer <access token>` of an OAuth app the store creates under Settings, API Access, version header `X-29Next-Api-Version: 2024-04-01`, 4 requests per second (HTTP 429 above); subscriptions exist as an Admin API resource (`/api/admin/subscriptions/{id}/` with `next_renewal_date`, interval and interval count, line items; standardised cancel reasons; a subscription transactions list). **No list endpoint, filter or field list was confirmed**, and Next Commerce is its own commerce platform: whether its customers carry a Shopify customer id is unknown.

### Task N1: Step 1, confirm the Next Commerce API with a real key

- [ ] **Step 1:** with an access token from an OAuth app with read permissions on subscriptions (strategist, in the store's Settings, API Access), record: the list endpoint and its pagination; a changed-since filter (if none: full snapshot each run, `chunkDays` the whole window, and a check that it fits in 45 seconds); the status values; the fields for next renewal, interval, amount, currency, lines and sku, cancel reason, failed renewals (transactions) and skips; whether any Shopify customer id is present (if not, `customerRef` is null and the attach rate for this store stays order-based); whether rebills really reach Shopify as orders (`docs/pacha-handoff.md` open point); the account id (store subdomain); scrubbed samples to `lib/subscriptions/apps/fixtures/nextcommerce/`. If no list endpoint exists, stop and plan an export-based route with the strategist.

### Task N2: Next Commerce adapter

**Files:** Create `lib/subscriptions/apps/nextcommerce.ts`, `nextcommerce.test.ts`. Modify `lib/providers.ts` (account label "Store subdomain"), `lib/sync/registry.ts`.

**Interfaces:** Produces `mapNextCommerceSubscription(s: NextCommerceSubscription): SubscriptionRow` and `nextCommerceAdapter: SubscriptionAdapter` (`source "nextcommerce"`; base URL built from the account id, which must match `^[a-z0-9-]+$`).

- [ ] **Step 1: Write failing tests** from N1's fixtures: the base URL refuses an account id with a dot, slash or scheme (no request to another host); the version header is sent; status, dates, interval, amount and lines map per N1; a 429 waits and retries through `requestJson`; no personal field appears.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS; flip the provider, suite and build. **Step 5 (live):** with a Next Commerce store (Pacha after signing).

### Task D1: Docs

**Files:** Modify `docs/connector-setup.md` (one section per app: where the key lives, the plan it needs, what is pulled, what is never stored), `docs/changelog.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-12-subscriptions-design.md` (the Recharge scope line, after approval).

- [ ] **Step 1: Write the docs** after each app goes live (one commit per app).

---

## Self-review

- **Spec coverage:** provider files with `auth: "client-key"` and the new `subscriptions` kind, full snapshot on connect and changed-since on daily runs (the job window), upserts into `subscriptions` and `subscription_items`, finalize rebuilding the aggregates, a light `verify`, the no-API-plan message, automatic source switching, the source line, skip and failed-payment figures, cancel reasons and top products are covered. Deviations: Recharge, Juo and Next Commerce are added and come first (strategist's order of 2026-10-13); skip and failed-payment **rates by month** become current figures, because the apps return a current snapshot, not a monthly history; Recharge rows are grouped by address (proposed in R1 Step 2).
- **Open risks in the code and docs:** (1) the client-level `subscriptionSource` holds one app, but Pacha would run three apps across five stores in one account; the read functions take one source today, and the multi-store plan must widen them to a list of sources per market; (2) Next Commerce may not link to Shopify customers at all; (3) history loads are capped at 48 months by `createJob`, so subscriptions cancelled and untouched before that are not loaded (the estimate still has them).
- **Type consistency:** `SubscriptionRow`, `SubscriptionAdapter`, `toDbRows`, `writeSubscriptions`, `syncSubscriptionApp`, `finalizeSubscriptionApp`, `subscriptionSync`, `autoSource`, `appMessage`, `SubscriptionTimeout` and the five adapter names are spelled the same in every task.
- **Proportion:** five foundation tasks, two per app, one docs task; no function bodies.

**Sizing:** about 9 to 11 working days for Claude in all (test first, plus one independent review): foundation 2.5 days; Recharge 1.5 to 2 (grouping by address, charges for skips and failures); Loop 1 (once a Pro-plan key exists); Skio 1.5 (GraphQL paging under the node limit); Juo 1; Next Commerce 1.5 to 3 (no list endpoint confirmed; could become an export route). What could blow it up: an app without a changed-since filter on a large store, plan-gated APIs (Loop Pro), Next Commerce lacking a Shopify customer link, and Pacha's multi-app account needing several sources per client. From the strategist: one read-only key per app from a real client (Recharge first), confirmation of each client's plan tier, the yes or no on grouping Recharge by address, the go for the migration, and updating the spec's Recharge scope line.

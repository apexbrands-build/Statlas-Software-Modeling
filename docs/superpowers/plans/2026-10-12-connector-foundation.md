# Connector Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new data connector costs one provider file and one registry entry, with a guided way to connect a client's API key, a capped job runner and a failure badge, so the app can roll out to 30+ clients.

**Architecture:** Two registries: `lib/providers.ts` (browser-safe metadata) and `lib/sync/registry.ts` (server-only sync functions). Pure decision logic moves out of `lib/jobs.ts` into `lib/job-plan.ts` so it is unit-tested. Meta, Google and Shopify keep their code; the registry wraps them.

**Tech Stack:** Next.js 16 (App Router, route handlers, `after`), Supabase (Postgres, service-role admin client), TypeScript, Vitest (`lib/**/*.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-10-11-connector-foundation-design.md`

## Global Constraints

- Provider list in the database check, exact: `shopify, meta, google_ads, pinterest, tiktok, bing, snapchat, youtube, applovin, klaviyo, postscript, omnisend, ga4, other`.
- `MAX_PARALLEL_JOBS` is 10.
- Store Settings shows a red "Needs attention" badge at 2 or more consecutive failures (`FAILURE_ALERT_AT = 2`).
- A daily "recent" job that ends in error adds 1 to `integrations.consecutive_failures`; a success resets it to 0. History jobs never change it.
- Client API keys are encrypted with `lib/crypto.ts` into `integration_secrets` and never returned to the browser; the connection dialog shows "Key saved" and a Replace field.
- Meta and Google keep their current connect routes. Shopify, Meta and Google syncs behave exactly as before.
- Integrations are read-only. No credentials in files, chat or git.
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/01-app` before writing route handler code.
- Git (repo `CLAUDE.md`): do not commit unless the user asks. Each task ends with a checkpoint that lists the files and a suggested message.
- Tests live in `lib/**/*.test.ts`; server modules are imported after `vi.mock("server-only", () => ({}))` (pattern in `lib/shopify.test.ts`).

## Review Focus

1. A connection row whose provider has no sync yet (for example Klaviyo connected before its connector exists): the tick skips it and the dialog shows no Sync button. Tested in Task 4.
2. More waiting jobs than free slots, or running jobs at or above the cap: kick only the free slots, never a negative count. Tested in Task 3.
3. API key hygiene: a padded or empty key, and an upstream error message that contains the key. Trimmed, rejected, redacted. Tested in Task 6.
4. Failure counter scope: history job errors do not count; a later successful recent run resets to 0. Tested in Task 3.
5. `consecutive_failures` null or undefined (rows read before the migration, older rows) must not show the badge. Tested in Task 2.

---

## File structure

- Create `supabase/migrations/0009_providers_and_failures.sql`
- Create `lib/providers.ts`, `lib/providers.test.ts`: provider metadata, labels, `needsAttention`.
- Create `lib/job-plan.ts`, `lib/job-plan.test.ts`: pure job logic (windows, progress, retry, failure counter, concurrency).
- Create `lib/sync/registry.ts`, `lib/sync/registry.test.ts`: server sync functions per provider.
- Modify `lib/jobs.ts`, `app/api/jobs/tick/route.ts`, `app/api/jobs/run/route.ts`: use the registry and job-plan.
- Create `lib/integration-secrets.ts`, `lib/integration-secrets.test.ts`: save and read a client API key.
- Create `lib/connect.ts`, `lib/connect.test.ts`, `app/api/integrations/connect/route.ts`: connect flow.
- Create `components/settings/ProviderCards.tsx`; modify `components/settings/StoreSettingsPage.tsx`.
- Modify `docs/connector-setup.md`, `docs/changelog.md`, `CLAUDE.md` (one status line).

---

### Task 1: Migration 0009

**Files:**
- Create: `supabase/migrations/0009_providers_and_failures.sql`

**Interfaces:**
- Produces: `integrations_provider_check` with the exact list above; `integrations.consecutive_failures int not null default 0`.

- [ ] **Step 1: Write the migration.** Drop `integrations_provider_check` if it exists and add it again with the exact provider list; `alter table integrations add column if not exists consecutive_failures int not null default 0`. Additive only.
- [ ] **Step 2: Ask the user to confirm applying it to the live project `ccejjijwrdnzljizzwsw`** (production data). On a yes, apply with the Supabase connector `apply_migration` (name `providers_and_failures`).
- [ ] **Step 3: Verify.** Run through `execute_sql`: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'integrations_provider_check'` shows all 14 providers; `select column_name, column_default from information_schema.columns where table_name = 'integrations' and column_name = 'consecutive_failures'` returns default `0`.
- [ ] **Step 4: Checkpoint.** Files: the migration. Message: "Add provider list and failure counter (migration 0009)".

---

### Task 2: Provider metadata

**Files:**
- Create: `lib/providers.ts`
- Test: `lib/providers.test.ts`

**Interfaces:**
- Produces (all exported from `lib/providers.ts`, no server imports):
  - `type ProviderId = "shopify" | "meta" | "google_ads" | "pinterest" | "tiktok" | "bing" | "snapchat" | "youtube" | "applovin" | "klaviyo" | "postscript" | "omnisend" | "ga4"`
  - `type ProviderKind = "commerce" | "ads" | "messaging" | "analytics"`
  - `type ProviderAuth = "shopify-oauth" | "agency-token" | "agency-google" | "client-key"`
  - `interface ProviderMeta { id: ProviderId; label: string; icon: string; kind: ProviderKind; auth: ProviderAuth; available: boolean; accountLabel: string; accountPlaceholder: string; setupSteps: string[] }`
  - `const PROVIDERS: Record<ProviderId, ProviderMeta>`; `const DB_PROVIDER_IDS: string[]` (all ids plus `"other"`); `const FAILURE_ALERT_AT = 2`
  - `providerLabel(id: string): string`; `needsAttention(failures: number | null | undefined): boolean`

- [ ] **Step 1: Write the failing tests** in `lib/providers.test.ts`:
  - every `PROVIDERS` key equals its `meta.id`.
  - only `shopify`, `meta` and `google_ads` have `available: true`.
  - `DB_PROVIDER_IDS` equals the provider list parsed (read the file with `fs`, match `provider in \(([^)]*)\)`, split on quotes) from `supabase/migrations/0009_providers_and_failures.sql`, compared as sorted arrays.
  - `providerLabel("meta") === "Facebook"`, `providerLabel("google_ads") === "Google Ads"`, `providerLabel("nope") === "nope"`.
  - `needsAttention(undefined)`, `needsAttention(null)`, `needsAttention(0)`, `needsAttention(1)` are false; `needsAttention(2)` and `needsAttention(5)` are true.
- [ ] **Step 2: Run** `npx vitest run lib/providers.test.ts`. Expected: FAIL, module `./providers` not found.
- [ ] **Step 3: Implement `lib/providers.ts`.** Labels: Shopify, Facebook (id `meta`), Google Ads, Pinterest, TikTok, Bing Ads, Snapchat, YouTube, AppLovin, Klaviyo, Postscript, Omnisend, GA4. `icon` is the key passed to `BrandIcon` (the id itself). Kinds: shopify commerce; meta, google_ads, pinterest, tiktok, bing, snapchat, youtube, applovin ads; klaviyo, postscript, omnisend messaging; ga4 analytics. Auth: shopify `shopify-oauth`; meta `agency-token`; google_ads and ga4 `agency-google`; klaviyo, postscript, omnisend `client-key`; the other ad platforms `agency-token` (provisional until the ad-platform spec). `accountLabel` and `accountPlaceholder` for the unavailable ones: Klaviyo "Account name" / "e.g. Acme Co", Postscript "Shop ID" / "e.g. 12345", Omnisend "Brand name" / "e.g. Acme Co", GA4 "GA4 property ID" / "e.g. 123456789", the ad platforms "Ad account ID" / "". `setupSteps: []` everywhere (each connector spec fills its own).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: `lib/providers.ts`, `lib/providers.test.ts`. Message: "Add browser-safe provider metadata".

---

### Task 3: Pure job logic

**Files:**
- Create: `lib/job-plan.ts`
- Test: `lib/job-plan.test.ts`

**Interfaces:**
- Produces (exported from `lib/job-plan.ts`, no server imports):
  - `const MAX_PARALLEL_JOBS = 10`
  - `interface JobRow { id: string; kind: "history" | "recent"; from_date: string; to_date: string; cursor_end: string; chunk_days: number; total_days: number; done_days: number; attempts: number }`
  - `chunkWindow(job: Pick<JobRow, "cursor_end" | "chunk_days" | "from_date">): { from: string; to: string }`
  - `afterChunk(job: JobRow, window: { from: string; to: string }): { finished: boolean; cursorEnd: string; doneDays: number; message: string }`
  - `onChunkError(job: Pick<JobRow, "chunk_days" | "attempts">, message: string, window: { from: string; to: string }): { retry: true; chunkDays: number; attempts: number; message: string } | { retry: false; message: string }`
  - `failureCount(previous: number | null | undefined, outcome: "ok" | "error"): number`
  - `shouldCountFailure(kind: JobRow["kind"]): boolean`
  - `selectToKick(waiting: string[], running: number, max?: number): string[]`

These replicate the arithmetic now inline in `processNextChunk` in `lib/jobs.ts`; behavior must not change.

- [ ] **Step 1: Write the failing tests** in `lib/job-plan.test.ts`:
  - `chunkWindow({ cursor_end: "2026-03-31", chunk_days: 14, from_date: "2026-01-01" })` equals `{ from: "2026-03-18", to: "2026-03-31" }`; with `cursor_end: "2026-01-05"` the `from` clamps to `"2026-01-01"`.
  - `afterChunk` not finishing: job `{ from_date: "2026-01-01", cursor_end: "2026-03-31", chunk_days: 14, total_days: 100, done_days: 20 }`, window `{ from: "2026-03-18", to: "2026-03-31" }` gives `{ finished: false, cursorEnd: "2026-03-17", doneDays: 34, message: "Loaded 2026-03-18 → 2026-03-31" }`.
  - `afterChunk` finishing: `cursor_end: "2026-01-10"`, `total_days: 100`, `done_days: 90`, window `{ from: "2026-01-01", to: "2026-01-10" }` gives `finished: true`, `cursorEnd: "2026-01-01"`, `doneDays: 100` (capped at `total_days`), `message: "Done"`.
  - `onChunkError`: `chunk_days: 14, attempts: 0` retries with `chunkDays: 7, attempts: 1` and a message starting `Retrying 2026-03-18 → 2026-03-31 in smaller pieces (`; `chunk_days: 1` returns `{ retry: false, ... }`; `attempts: 8` returns `retry: false`; a 400-character message is cut to 300 characters when not retrying.
  - `failureCount(null, "ok") === 0`, `failureCount(undefined, "error") === 1`, `failureCount(1, "error") === 2`, `failureCount(3, "ok") === 0`.
  - `shouldCountFailure("recent") === true`, `shouldCountFailure("history") === false`.
  - `selectToKick(["a","b","c"], 8, 10)` equals `["a","b"]`; running 10 gives `[]`; running 12 gives `[]`; `selectToKick([], 0)` gives `[]`; `selectToKick(["a"], 0, 0)` gives `[]`; the default `max` is `MAX_PARALLEL_JOBS` (12 waiting, 0 running returns 10).
- [ ] **Step 2: Run** `npx vitest run lib/job-plan.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/job-plan.ts`** with the signatures above. Date arithmetic is UTC day math as in `lib/jobs.ts` (`addDays`, `daysBetween` become local helpers here, inclusive day count). Retry message text and the 80 and 300 character cuts are copied from the current `processNextChunk`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: `lib/job-plan.ts`, `lib/job-plan.test.ts`. Message: "Extract pure job logic with tests".

---

### Task 4: Server sync registry

**Files:**
- Create: `lib/sync/registry.ts`
- Test: `lib/sync/registry.test.ts`

**Interfaces:**
- Consumes: `syncShopify(integrationId, opts: ShopifySyncOptions)` and `finalizeShopify(integrationId, body: { from?: string; to?: string })` from `./run-shopify`; `syncMeta(integrationId, body)` from `./run-meta`; `syncGoogle(integrationId, body)` from `./run-google`; `SyncRange` from `./range`; `PROVIDERS`, `ProviderId` from `@/lib/providers`.
- Produces (from `lib/sync/registry.ts`, server-only):
  - `interface SyncContext { kind: "history" | "recent"; deadline: number; firstChunk: boolean }`
  - `interface ProviderSync { chunkDays: number; sync(integrationId: string, range: SyncRange, ctx: SyncContext): Promise<void>; finalize?(integrationId: string, range: SyncRange): Promise<void>; verify?(input: { accountId: string; apiKey?: string }): Promise<{ accountName: string }> }`
  - `const SYNCS: Partial<Record<ProviderId, ProviderSync>>`; `getSync(provider: string): ProviderSync | undefined`; `syncableProviderIds(): ProviderId[]`

- [ ] **Step 1: Write the failing tests** in `lib/sync/registry.test.ts` (mock `server-only`, `./run-shopify`, `./run-meta`, `./run-google` with `vi.fn()` stubs, then import the registry):
  - `Object.keys(SYNCS).sort()` equals `["google_ads", "meta", "shopify"]` and `syncableProviderIds()` returns the same three.
  - for every `ProviderId`, `PROVIDERS[id].available === (id in SYNCS)`.
  - `chunkDays`: shopify 14, meta 60, google_ads 60.
  - shopify `sync(id, { from: "2026-01-01", to: "2026-01-14" }, { kind: "recent", deadline: 123, firstChunk: false })` calls `syncShopify` with `(id, { body: { from: "2026-01-01", to: "2026-01-14" }, products: true, includeUpdated: true, deadline: 123 })`; with `kind: "history", firstChunk: false` it passes `products: false, includeUpdated: false`; with `kind: "history", firstChunk: true` it passes `products: true`.
  - shopify `finalize(id, { from, to })` calls `finalizeShopify(id, { from, to })`; meta and google_ads `sync` call `syncMeta(id, { from, to })` and `syncGoogle(id, { from, to })`; meta and google_ads have no `finalize`.
  - `getSync("klaviyo")` and `getSync("nope")` are `undefined`.
- [ ] **Step 2: Run** `npx vitest run lib/sync/registry.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/sync/registry.ts`** with the signatures above. The shopify entry maps `ctx` exactly as `processNextChunk` does today: `products: ctx.firstChunk || ctx.kind === "recent"`, `includeUpdated: ctx.kind === "recent"`, `deadline: ctx.deadline`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** Files: `lib/sync/registry.ts`, `lib/sync/registry.test.ts`. Message: "Add server sync registry".

---

### Task 5: Job runner, tick and run route use the registry

**Files:**
- Modify: `lib/jobs.ts` (remove `CHUNK_DAYS` and the provider if/else; use `getSync` and `lib/job-plan`)
- Modify: `app/api/jobs/tick/route.ts`
- Modify: `app/api/jobs/run/route.ts`

**Interfaces:**
- Consumes: `getSync`, `syncableProviderIds` (Task 4); `chunkWindow`, `afterChunk`, `onChunkError`, `failureCount`, `shouldCountFailure`, `selectToKick`, `MAX_PARALLEL_JOBS`, `JobRow` (Task 3); `FAILURE_ALERT_AT` (Task 2).
- Produces from `lib/jobs.ts`: `kickWaitingJobs(): Promise<string[]>` (kicks waiting jobs up to the free slots, returns the ids it kicked); internal `recordOutcome(integrationId: string, kind: "history" | "recent", outcome: "ok" | "error"): Promise<void>`.

This code talks to the database, so it has no unit tests of its own; its logic is covered in Task 3 and it is verified in Task 8.

- [ ] **Step 1: Update `createJob`.** `chunk_days` is `getSync(integration.provider)?.chunkDays ?? 30`.
- [ ] **Step 2: Update `processNextChunk`.** Compute the window with `chunkWindow`. Inside the existing `try`, look up `getSync(job.provider)`; a missing entry throws `No sync for <provider>` (same text as today). Call `sync.sync(job.integration_id, window, { kind: job.kind, deadline: Date.now() + CHUNK_BUDGET_MS, firstChunk: job.first_chunk })`; on the last chunk call `sync.finalize?.(job.integration_id, { from: job.from_date, to: job.to_date })`. Use `afterChunk` for the next state and `onChunkError` for the retry or final error. When the job finishes, call `recordOutcome(..., "ok")`; when it ends in a final error, `recordOutcome(..., "error")`.
- [ ] **Step 3: Add `recordOutcome` and `kickWaitingJobs`.** `recordOutcome` returns without writing unless `shouldCountFailure(kind)`; otherwise it reads `consecutive_failures`, sets `failureCount(previous, outcome)`, and ignores a missing row (integration deleted mid-job). `kickWaitingJobs` counts `sync_jobs` with status `running`, selects the oldest `queued` jobs with `first_chunk = true` (order `created_at` ascending, limit `MAX_PARALLEL_JOBS`), passes the ids through `selectToKick`, calls `kickRunner` for each and returns the ids.
- [ ] **Step 4: Update `app/api/jobs/tick/route.ts`.** Queue a `recent` job for every `connected` integration whose provider is in `syncableProviderIds()` (replace the hardcoded list); in `after`, kick the stalled ids as today, then call `kickWaitingJobs()`. The response adds `failing`: the count of integrations with `consecutive_failures >= FAILURE_ALERT_AT` (`select("id", { count: "exact", head: true })`).
- [ ] **Step 5: Update `app/api/jobs/run/route.ts`.** In the `after` callback, when `processNextChunk` returns `more: false`, call `kickWaitingJobs()` so a finished job starts the next waiting one.
- [ ] **Step 6: Verify.** Run `npx tsc --noEmit` (expected: no errors) and `npm test` (expected: all existing and new tests pass).
- [ ] **Step 7: Checkpoint.** Files: the three modified files. Message: "Run sync jobs through the registry with a concurrency cap and failure counter".

---

### Task 6: Connect a client-key provider

**Files:**
- Create: `lib/integration-secrets.ts`, `lib/integration-secrets.test.ts`
- Create: `lib/connect.ts`, `lib/connect.test.ts`
- Create: `app/api/integrations/connect/route.ts`

**Interfaces:**
- Consumes: `encrypt`, `decrypt` from `@/lib/crypto`; `getAdminClient`, `getServerClient` from `@/lib/supabase/server`; `PROVIDERS`, `ProviderId`, `ProviderMeta` from `@/lib/providers`; `getSync` from `@/lib/sync/registry`.
- Produces:
  - `lib/integration-secrets.ts` (server-only): `saveApiKey(integrationId: string, apiKey: string): Promise<void>` (upsert on `integration_id`, stores `encrypt(JSON.stringify({ apiKey }))`, throws on a database error); `readApiKey(integrationId: string): Promise<string>` (throws `No saved key: reconnect the account` when absent).
  - `lib/connect.ts`: `interface ConnectInput { clientId: string; provider: ProviderId; accountId: string; apiKey?: string }`; `parseConnectBody(body: unknown, providers?: Record<string, ProviderMeta>): { ok: true; value: ConnectInput } | { ok: false; error: string }`; `redact(message: string, secret: string | undefined): string`; `interface ConnectDeps { verify(input: { accountId: string; apiKey?: string }): Promise<{ accountName: string }>; upsertIntegration(row: { clientId: string; provider: ProviderId; accountId: string; accountName: string }): Promise<{ id: string }>; saveApiKey(integrationId: string, apiKey: string): Promise<void>; markError(integrationId: string, message: string): Promise<void> }`; `connectProvider(input: ConnectInput, deps: ConnectDeps): Promise<{ id: string; accountName: string }>`.

- [ ] **Step 1: Write the failing tests for secrets** (mock `server-only` and `@/lib/supabase/server` with an in-memory fake of `from("integration_secrets").upsert(row, { onConflict })` and `.select("ciphertext").eq("integration_id", id).single()`; set `process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64")` before importing): the stored ciphertext does not contain the key text; `readApiKey` returns the key after `saveApiKey`; saving twice for one integration leaves one row holding the newer key; `readApiKey` with no row rejects with a message matching `/reconnect/i`.
- [ ] **Step 2: Write the failing tests for connect** in `lib/connect.test.ts`, using a fake registry `{ fake: { id: "fake", auth: "client-key", available: true, ... } }` passed as the second argument:
  - `parseConnectBody` trims the account ID and key (`accountId: "  acme \n"` becomes `"acme"`); a missing, empty or whitespace key for a `client-key` provider returns `{ ok: false, error: "API key is required" }`; an empty account ID returns `"Account ID is required"`; a provider that is unknown or `available: false` returns `"Provider not supported here"`; `"meta"` (auth `agency-token`) returns the same error; a non-object body returns an error; for an `agency-google` provider the value carries no `apiKey` even when one is sent.
  - `redact("bad key sk-123 rejected", "sk-123")` equals `"bad key *** rejected"`; with an undefined or empty secret the message is returned unchanged.
  - `connectProvider` calls `verify`, then `upsertIntegration`, then `saveApiKey` in that order for a `client-key` input and returns the account name; when `verify` throws an error containing the key, the thrown error has the key redacted and `upsertIntegration` is never called; when `saveApiKey` rejects, `markError` is called with the integration id and the error is rethrown with the key redacted; an `agency-google` input never calls `saveApiKey`.
- [ ] **Step 3: Run** `npx vitest run lib/integration-secrets.test.ts lib/connect.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 4: Implement `lib/integration-secrets.ts` and `lib/connect.ts`** with the signatures above. `connectProvider` needs to know whether to save a key: it saves only when `input.apiKey` is defined.
- [ ] **Step 5: Run** the same command. Expected: PASS.
- [ ] **Step 6: Read the route handler guide** in `node_modules/next/dist/docs/01-app` (Route Handlers), then implement `POST /api/integrations/connect` mirroring `app/api/meta/connect/route.ts`: parse with `parseConnectBody` (400 with its error), require a signed-in user (401), confirm the user can see the client through row-level security (403), find `getSync(provider)?.verify` (400 `This provider cannot be verified yet` if absent), then call `connectProvider` with real deps (`upsertIntegration` upserts `integrations` on `client_id,provider,account_id` with `status: "connected"` and `last_error: null`; `markError` sets `status: "error"` and `last_error`). Respond `{ ok: true, name }`; the response and every error message must never contain the key.
- [ ] **Step 7: Verify.** `npx tsc --noEmit` and `npm test`: no errors, all pass. No provider is `available` with a `client-key` yet, so the route is exercised end to end when the Klaviyo connector lands (messaging spec).
- [ ] **Step 8: Checkpoint.** Files: the five new files. Message: "Add client API key storage and generic connect route".

---

### Task 7: Store Settings UI from the registry

**Files:**
- Create: `components/settings/ProviderCards.tsx`
- Modify: `components/settings/StoreSettingsPage.tsx`

**Interfaces:**
- Consumes: `PROVIDERS` (iterate with `Object.values(PROVIDERS)`), `providerLabel`, `needsAttention`, `ProviderId`, `ProviderKind` from `@/lib/providers`.
- Produces: `ProviderCards(props: { clientId: string; isAdmin: boolean; onChanged: () => Promise<void>; onClose: () => void; setMsg: (m: string) => void }): JSX.Element` (client component).

No component test infrastructure exists (`vitest` includes `lib/**` only), so this task is verified by type check, lint, build and a visual check.

- [ ] **Step 1: Implement `ProviderCards`.** Render every provider except `shopify`, `meta` and `google_ads` (their hand-built cards stay), grouped under headings Ads, Email and SMS, Analytics (by `kind`). `available: false` renders the existing "Soon" row style (icon, label, "Soon" pill). `available: true` renders a card with its `setupSteps` list and a form by `auth`: `client-key` has an account input (placeholder from `accountPlaceholder`, label from `accountLabel`), a password-type key input and a Connect button posting `{ clientId, provider, accountId, apiKey }` to `/api/integrations/connect`; `agency-google` has the account input and Connect without a key. On success call `setMsg("Connected <name>. Click Edit, then Sync now.")`, `onChanged()`, `onClose()`; on error show the returned message under the form.
- [ ] **Step 2: Edit `StoreSettingsPage.tsx`.**
  - Add `consecutive_failures: number | null` to the local `Integration` interface and to the `integrations` select string.
  - Replace the local `PROVIDER_LABEL` with `providerLabel(...)` everywhere it is used.
  - In `AddConnectionDialog`, replace the `[["pinterest","Pinterest"],["klaviyo","Klaviyo"],["ga4","GA4"]].map(...)` block with `<ProviderCards ... />`. The Shopify, Meta and Google cards are unchanged.
  - In the integrations table Provider cell, after the existing ⚠️, show `<span title={r.last_error ?? ""}>Needs attention</span>` styled as a red pill (`text-bad`, `border-bad`) when `needsAttention(r.consecutive_failures)`.
  - In `ConnectionDialog`, set `syncable` to `PROVIDERS[row.provider as ProviderId]?.available ?? false`.
  - Page-level `onSync`: for `shopify`, `meta` and `google_ads` keep `syncAll(provider)`; for any other provider POST `{ integrationId, kind: "recent" }` to `/api/jobs/start` and set the message "Sync started in the background." (today an unknown provider would fall through to the Shopify branch).
- [ ] **Step 3: Verify.** `npx tsc --noEmit`, `npm run lint` and `npm run build` complete without errors. Then start `npm run dev` and open Store Settings with seed data (`dashboard-seed` launch config); expected: the page renders and shows the demo-data notice (connections only appear on real data).
- [ ] **Step 4: Checkpoint.** Files: the two component files. Message: "Render Add Connection from the provider registry and show the failure badge".

---

### Task 8: Verify end to end and document

**Files:**
- Modify: `docs/connector-setup.md` (new section "Adding a connector"), `docs/changelog.md` (dated entry), `CLAUDE.md` (one line under Status)

- [ ] **Step 1: Run the full checks.** `npm test` (all pass), `npx tsc --noEmit`, `npm run lint`, `npm run build`: no errors.
- [ ] **Step 2: Write the docs.** "Adding a connector": add the id to `lib/providers.ts` (metadata, `available: true`), add a `ProviderSync` entry to `lib/sync/registry.ts`, add the id to the database provider check through a new migration if it is not in the list, add a setup checklist to `setupSteps`, add tests. Changelog entry dated 2026-10-12 listing what changed. One `CLAUDE.md` Status line pointing to `lib/providers.ts` and `lib/sync/registry.ts`.
- [ ] **Step 3: Hand the live check to the user.** After they push with GitHub Desktop and Vercel deploys: (a) Store Settings loads and Add Connection shows Shopify, Meta, Google plus grouped "Soon" rows; (b) Sync now on the Meta and Google rows works as before; (c) a Shopify history load of a short range reaches `done` in `sync_jobs`; (d) `select id, consecutive_failures from integrations` shows 0 for every row. If `CRON_SECRET` is set, `GET /api/jobs/tick` with the bearer secret returns `ok`, `started`, `resumed` and `failing: 0`.
- [ ] **Step 4: Checkpoint.** Files: the three docs. Message: "Document the connector registry".

---

## Self-review

- **Spec coverage:** registry split (Tasks 2 and 4); job runner, tick, concurrency (Tasks 3 and 5); connect flow and key handling (Task 6); failure counter and badge (Tasks 3, 5, 7); Add Connection from the registry and Sync now for new providers (Task 7); migration (Task 1); tests (Tasks 2 to 4 and 6); docs (Task 8). Not in scope items are not planned.
- **Type consistency:** `ProviderId`, `ProviderMeta`, `ProviderSync`, `SyncContext`, `JobRow` and the function names are used with the same spelling in every task that consumes them.
- **Proportion:** logic with decisions is specified by signature and test assertions; no function body is written out.

# Messaging connectors, phase 1: connect and verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klaviyo, Postscript and Omnisend appear in Add Connection as live cards; pasting a client's API key verifies it against the platform, saves it encrypted and shows the connection, so the strategist can try a test account today. No data is synced yet.

**Architecture:** Each platform gets a small verify function in `lib/messaging/` over a shared request helper (timeouts, `Retry-After`, secret redaction). A new `syncs` flag on `ProviderMeta` separates "can connect" from "pulls data", so no daily job runs for a connection that has nothing to sync. The connect route reads a verifier from the registry instead of requiring a full sync.

**Tech Stack:** Next.js 16 route handler, Vitest with injected `fetch` fixtures.

**Spec:** `docs/superpowers/specs/2026-10-11-messaging-klaviyo-sms-design.md` (section "Update 2026-10-12: phase 1 is connect, verify and first sync"). Data sync (stats tables, rebuild function, Home tiles) is phase 2 and is planned once real payloads from a test key are in hand.

## Global Constraints

- The API key never leaves the server: not in a response, not in an error message, not in a log (`redact` from `lib/connect.ts`).
- Read-only against every platform: only GET calls for verification.
- Verify before saving: a wrong key creates no integration row (existing `connectProvider` behaviour).
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/01-app` before touching the route handler.
- Platform facts as read on 2026-10-12 (re-confirm with the real key in Task 6): **Klaviyo** `GET https://a.klaviyo.com/api/accounts`, headers `Authorization: Klaviyo-API-Key <key>` and `revision: 2026-07-15`, scope `accounts:read`, limits 1/s burst and 15/min; name at `data[0].attributes.contact_information.organization_name`, id at `data[0].id`, also `timezone` and `preferred_currency`. **Omnisend** header `X-API-KEY`, base `https://api.omnisend.com/v5`, no documented account-info endpoint (verify with `GET /v5/contacts?limit=1`; the name is the one the strategist types); its reports API allows only 10 requests a minute and 55 a day per brand, which phase 2 plans for. **Postscript** `Authorization: Bearer <Private API key>` (the Private key, never the Public one), keys at app.postscript.io/account/api, base `https://api.postscript.io/api/v2`; its public reference lists subscribers and events only, no campaign or revenue endpoint (verify with `GET /subscribers?limit=1`).

## Review Focus

1. A wrong, revoked or under-scoped key: the user sees a plain message naming the platform and what to fix (key rejected, missing scope), never a stack trace, never the key. Tested in Task 3.
2. A platform that is down, slow or rate-limiting (429, 5xx, timeout): connecting fails with a retry-later message and saves nothing. Tested in Task 2.
3. The same key connected twice for a client: one connection, not two (account id is the upsert key). Tested in Task 4.
4. A connected messaging account never shows a "Sync now" or history loader and never gets a daily job. Tested in Task 1.
5. Klaviyo returns no account (empty `data`): treated as a failed verification. Tested in Task 3.

---

### Task 1: `syncs` flag and connection-only providers

**Files:** Modify `lib/providers.ts`, `lib/providers.test.ts`, `lib/sync/registry.test.ts`, `components/settings/StoreSettingsPage.tsx`.

**Interfaces:** Produces `ProviderMeta.syncs: boolean` (true only for Shopify, Meta, Google Ads today); `ProviderMeta.accountFromKey?: boolean` (the account id comes from verification, so the form does not ask for it); `available` now means "can be connected".

- [ ] **Step 1: Write failing tests.** In `lib/sync/registry.test.ts` replace "available means it has a sync" with "syncs means it has a sync: `PROVIDERS[id].syncs === (id in SYNCS)` for every provider". In `lib/providers.test.ts`: every `syncs` provider is `available`; Klaviyo, Postscript and Omnisend are `available` with `syncs: false`; Klaviyo has `accountFromKey: true`. Run: FAIL.
- [ ] **Step 2: Implement.** Add the two fields to `ProviderMeta` and the `p()` builder; set Klaviyo, Postscript and Omnisend to `available: true` (accountFromKey for Klaviyo); `syncs` true for the three existing ones. In `StoreSettingsPage.tsx` the `syncable` check (line ~335) reads `PROVIDERS[...].syncs`; a connected row of a provider without `syncs` shows "Connected. Data sync is not built yet" in place of Sync now and the history loader.
- [ ] **Step 3: Run** `npx vitest run lib/providers.test.ts lib/sync/registry.test.ts` and `npx tsc --noEmit`. Expected: PASS, no errors.

### Task 2: Shared request helper

**Files:** Create `lib/messaging/http.ts` and `lib/messaging/http.test.ts`.

**Interfaces:** Produces `requestJson(url: string, init: { headers: Record<string, string>; method?: string; body?: string }, o?: { fetchImpl?: typeof fetch; timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void>; secret?: string; platform: string }): Promise<{ status: number; json: unknown }>` and `class PlatformError extends Error { kind: "rejected" | "forbidden" | "rate_limited" | "unavailable" | "bad_response" }`.

- [ ] **Step 1: Write failing tests** with an injected `fetchImpl`: 200 returns parsed JSON; 401 throws `PlatformError` kind `rejected`, 403 kind `forbidden`; 429 with `Retry-After: 2` sleeps 2000 ms and retries up to `retries` (default 2) then throws `rate_limited`; 500 and a thrown network error retry then throw `unavailable`; a timeout (fetch aborted) is `unavailable`; a non-JSON 200 is `bad_response`; every error message names the platform and never contains `secret` (the key appears in the thrown upstream text in the test and must come out as `***`).
- [ ] **Step 2: Run:** FAIL (module missing).
- [ ] **Step 3: Implement** `requestJson` and `PlatformError` (`AbortController` for the timeout, default 15000 ms; honour `Retry-After` seconds, else 1 s, then 3 s; `redact` from `lib/connect.ts`).
- [ ] **Step 4: Run:** PASS.

### Task 3: The three verifiers

**Files:** Create `lib/messaging/klaviyo.ts`, `omnisend.ts`, `postscript.ts` and one `*.test.ts` each.

**Interfaces:** Each exports `verifyKlaviyo | verifyOmnisend | verifyPostscript(input: { accountId: string; apiKey?: string }, fetchImpl?: typeof fetch): Promise<{ accountName: string; accountId?: string }>`. Klaviyo returns `accountId` from the API and `accountName` = organization name; Omnisend and Postscript return `accountName` = the typed `accountId`.

- [ ] **Step 1: Write failing tests** with fixture responses (the Klaviyo example shape from its reference; `{ data: [] }`; 401; 403 with a message about scopes; Omnisend and Postscript 200 and 401): Klaviyo returns the organization name and the account id, a missing organization name falls back to "Klaviyo account"; empty `data` throws "Klaviyo returned no account for this key"; 401 gives "Klaviyo rejected the API key. Create a new Private API key in Klaviyo (Settings, API keys) and paste it here."; 403 gives "This Klaviyo key cannot read the account. Give the key the Accounts, Campaigns, Flows, Metrics and Events read scopes, or use Read-Only access."; Omnisend 401/403 gives "Omnisend rejected the API key. Create one under Store settings, Integrations and API, API keys."; Postscript 401 gives "Postscript rejected the API key. Use the Private API key from Account, API (app.postscript.io/account/api), not the Public one."; the right headers and URLs are sent (assert on the injected fetch's calls); no function ever calls a non-GET method.
- [ ] **Step 2: Run:** FAIL.
- [ ] **Step 3: Implement** the three functions on `requestJson`.
- [ ] **Step 4: Run:** PASS.

### Task 4: Registry verifiers and the connect flow

**Files:** Modify `lib/sync/registry.ts`, `lib/sync/registry.test.ts`, `lib/connect.ts`, `lib/connect.test.ts`, `app/api/integrations/connect/route.ts`.

**Interfaces:** Produces `VERIFIERS: Partial<Record<ProviderId, NonNullable<ProviderSync["verify"]>>>` (klaviyo, postscript, omnisend) and `getVerifier(provider: string)` (a `SYNCS[provider].verify` first, else `VERIFIERS`). `connectProvider` uses the id returned by verification when there is one. `parseConnectBody` does not require `accountId` when `accountFromKey`.

- [ ] **Step 1: Write failing tests.** `registry.test.ts`: every provider that is `available` and `auth: "client-key"` has a verifier; `getVerifier("klaviyo")` is defined and `getVerifier("pinterest")` is not. `connect.test.ts`: a provider with `accountFromKey` and an empty `accountId` parses; the account id saved is the one verification returned; connecting the same key twice calls `upsertIntegration` with the same account id both times (one connection); a failed verification never calls `upsertIntegration` or `saveApiKey`.
- [ ] **Step 2: Run:** FAIL.
- [ ] **Step 3: Implement.** The registry imports the three verifiers (it stays server-only); the route calls `getVerifier`; `connectProvider` takes `verify()`'s optional `accountId` over the typed one. Read the Next.js route guide first (AGENTS.md).
- [ ] **Step 4: Run** `npx vitest run lib` and `npx tsc --noEmit`. Expected: PASS.

### Task 5: Cards, setup steps and wording

**Files:** Modify `lib/providers.ts` (setup steps), `components/settings/ProviderCards.tsx`.

- [ ] **Step 1: Setup steps** per provider in `ProviderMeta.setupSteps`, shown on the card: Klaviyo (Settings, API keys, Create Private API Key, Read-Only access or the read scopes Accounts, Campaigns, Flows, Metrics, Events, Lists, Segments; paste it here, no account field needed), Postscript (Account, API, copy the Private key), Omnisend (Store settings, Integrations and API, API keys, create a key with read access; type the brand name). The card hides the account field for `accountFromKey` providers and shows "Data sync comes next. Connecting now checks the key and saves it."
- [ ] **Step 2: Verify.** `npx tsc --noEmit`, `npx eslint .` (0 errors), `npm run build`, `npm test`. Check in the seed-mode dev server that the three cards appear under "Email and SMS" and the Klaviyo card has no account field.

### Task 6: Live check with the strategist's test key (hand-off)

- [ ] **Step 1: Docs.** `docs/connector-setup.md` gets a "Messaging keys" section (where each key lives, what the card checks); `docs/changelog.md` and `CLAUDE.md` one line each.
- [ ] **Step 2: Hand to the strategist after deploy:** Store Settings, Add Connection, pick the platform, paste the test key. Expected: Klaviyo shows the organization name; Omnisend and Postscript show the typed name; a wrong key shows the plain message. Ask them to also send (or let me read through the app) what the test account has: campaigns, flows and, for Postscript, whether any campaign data is reachable; phase 2 is planned from that.

---

## Self-review

- **Spec coverage:** phase 1 of the spec update (cards, key stored encrypted, verify, clear errors) is Tasks 1 to 5; the real-key check is Task 6. Stats tables, Reporting API sync, Omnisend reports sync, Postscript subscribers, `rebuild_messaging_facts`, Home SMS tiles, calendar events from sends and the onboarding checklist are phase 2 and deliberately absent.
- **Deviation from the spec on purpose:** the `syncs` flag (the old rule "available means it has a sync" cannot hold for a connection-only provider); Klaviyo's account id comes from the key instead of a typed field.
- **Type consistency:** `verify*` signatures match `ProviderSync["verify"]`; `PlatformError.kind` values are used only in Task 3 messages.
- **Proportion:** six tasks, no function bodies; messages are given verbatim only where users read them.

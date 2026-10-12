# Connector foundation: design

Date: 2026-10-11. Status: draft for the strategist's review. First of four specs for the channels sub-project (2: messaging, 3: GA4 and Email Metrics, 4: Home report links). Direction and parked ideas: `docs/future-vision.md`.

## Goal
A new connector costs one provider file and one registry entry, and connecting a new client is a guided, repeatable step. This supports the roll-out to 30+ clients.

## What the code does today
- `lib/jobs.ts` chooses the sync with an if/else on provider; chunk sizes sit in `CHUNK_DAYS`.
- `app/api/jobs/tick/route.ts` queues a recent re-sync only for `shopify`, `meta` and `google_ads`, and kicks every queued job at once.
- `components/settings/StoreSettingsPage.tsx` hardcodes provider labels, the "syncable" check and the Add Connection list (Pinterest, Klaviyo and GA4 show "Soon").
- Meta and Google have their own connect routes (`app/api/meta/connect`, `app/api/google/connect`). Meta uses an agency System User token, Google an agency OAuth token in `agency_secrets`. Shopify tokens sit encrypted in `integration_secrets`.
- `integrations_provider_check` lacks `omnisend`, `bing`, `snapchat`, `youtube` and `applovin`. `sync_jobs` has no provider check.
- Disconnecting deletes the `integrations` row; the cascade removes its secret.

## Design

### 1. Two registry files
- `lib/providers.ts` (safe for the browser): one `ProviderMeta` per provider with `id`, `label`, `icon`, `kind` (commerce, ads, messaging, analytics), `auth`, `available`, `accountLabel` and `setupSteps`. `auth` is one of `shopify-oauth`, `agency-token` (Meta), `agency-google` (Google Ads, GA4) or `client-key` (Klaviyo, Postscript, Omnisend).
- `lib/sync/registry.ts` (server only): one `ProviderSync` per provider with `chunkDays`, `sync(integrationId, range, ctx)`, optional `finalize(integrationId, range)` and optional `verify(input)`. `ctx` carries `kind` (history or recent), `deadline` and `firstChunk`. Shopify gets a thin wrapper that keeps its extra options. Meta and Google keep their code unchanged.
- Two files because Store Settings is a client component and cannot import server code.

### 2. Job runner
- `createJob` and `processNextChunk` read `chunkDays`, `sync` and `finalize` from the registry. A provider with no entry still fails with "No sync for X".
- The daily tick queues a recent sync for every connected integration whose provider has a registry entry, so a new connector joins the cron by registering.
- Concurrency: the tick kicks every job at once, which at 30+ clients is well over a hundred parallel tasks. The tick kicks at most `MAX_PARALLEL_JOBS` (10) queued jobs. When a job finishes, the runner claims and kicks the oldest queued job.

### 3. Connecting a client-key provider
- One route, `POST /api/integrations/connect`, with `{ clientId, provider, accountId, apiKey }`. It checks the user can see the client (row-level security, as the Meta route does), calls the provider's `verify`, upserts the integration, and writes `{ apiKey }` encrypted with `lib/crypto.ts` into `integration_secrets`. For `agency-google` providers the same route runs without a key.
- The key never goes back to the browser. The connection dialog shows "Key saved" and a Replace field.
- Meta and Google keep their current routes.

### 4. Status and failures
- New column `integrations.consecutive_failures` (int, default 0). A daily "recent" job that ends in error adds 1; a success resets it to 0.
- Store Settings shows a red "Needs attention" badge at 2 or more, with `last_error`. The tick response reports how many connections are failing.
- A cross-client health page belongs to the agency-layer sub-project, not here.

### 5. Add Connection dialog from the registry
Cards are rendered from `ProviderMeta`, grouped by kind. Each card shows its setup steps and the form that fits its `auth`. A provider with `available: false` shows "Soon". The existing Shopify, Meta and Google cards keep their behaviour. "Sync now" for new providers starts a `recent` job through `/api/jobs/start`; no new per-provider sync routes.

### 6. Migration `0009_providers_and_failures.sql`
- Replace `integrations_provider_check` with: shopify, meta, google_ads, pinterest, tiktok, bing, snapchat, youtube, applovin, klaviyo, postscript, omnisend, ga4, other.
- Add `integrations.consecutive_failures`.

### 7. Tests
- Contract test over both registries: ids match, `chunkDays` is at least 1, every provider with a `sync` has a `ProviderMeta`, every id is in the migration's provider list.
- Runner test with a fake provider: dispatch, chunk size, `finalize` on the last chunk, failure counter, concurrency cap.

## Not in scope
Rewriting Meta, Google or Shopify internals; a cross-client health page; per-provider rate-limit scheduling (each connector handles its own limits).

## Implementation notes
`AGENTS.md` warns that this Next.js version differs from older ones: read the matching guide in `node_modules/next/dist/docs/` before writing route code. Migrations are applied through the Supabase connector and the file is kept in `supabase/migrations/`.

## Done when
A fake provider registered in a test runs through history and recent jobs; Store Settings shows the failure badge; migration 0009 is applied; Shopify, Meta and Google syncs behave as before and the existing tests pass.

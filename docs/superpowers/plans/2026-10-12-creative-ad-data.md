# Creative Demand, stage 1: ad-level Meta data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every connected Meta ad account fills two new tables, one row per ad and one row per ad and day with spend, impressions, clicks, purchases and revenue, with each ad's format (video, image, carousel, other), launch date and a catalog flag. Stage 2 (Creative Score, demand model, screen) reads these tables.

**Architecture:** The existing Meta sync (`lib/sync/run-meta.ts`) gets an ad-level step after the campaign step. Pure mapping functions in `lib/sync/meta-ads.ts` turn Graph API rows into table rows; thin Graph calls sit in `lib/sync/meta.ts` next to `fetchCampaignDays`; an ad-level failure never fails the campaign sync (it is reported in the run message). Nothing changes in how spend, MER or CM are computed.

**Tech Stack:** Next.js 16 server code, Supabase (service role writes), Vitest with injected Graph responses.

**Spec:** `docs/superpowers/specs/2026-10-12-creative-demand-design.md` (section "Data: ad level from Meta"). Stage 2 and 3 are planned after this lands and the volumes are measured.

## Global Constraints

- Read-only against Meta (GET insights and ads only); the existing agency System User token and Store Settings attribution windows (default 7-day click, `metaWindows`) are reused.
- Only ids, names, dates, formats and metrics are stored: no creative images, texts or audience data.
- Migration `0012_meta_ads.sql` (the number may shift): additive, row-level security by `has_client_access`, writes by the service role only; applied to the live project only after the strategist's go (she or he said yes to migrations on 2026-10-12 for 0011; ask again for this one).
- `ad_spend_daily` (campaign level) stays the source of truth for spend; the ad-level total per day may differ by pennies or by ads Meta no longer returns, and the stage 2 screens say "ad-level".
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/01-app` before touching Next.js code (this plan edits server library code only).
- Catalog keywords default to `catalog, dpa, daba` and are a per-client setting `catalogKeywords` (comma-separated, case-insensitive, matched against the campaign name), like the Google brand rule.

## Review Focus

1. An account with thousands of ads or a long window: pagination ends, no page is skipped or repeated, a 500-row batch insert never exceeds Postgres limits. Tested in Tasks 3 and 4.
2. Meta returns an ad with no creative object, a dynamic creative or a deleted ad: the ad is stored with format `other`, never dropped and never crashing the sync. Tested in Task 2.
3. Re-syncing the same window twice leaves the same rows (no duplicates, a day that lost its spend is removed). Tested in Task 4.
4. The ad-level step failing (permission, rate limit) leaves the campaign sync, the connection status and `ad_spend_daily` untouched and says so in the run message. Tested in Task 4.
5. A campaign name containing a catalog keyword in any case, or none: the flag is right; an empty keyword list flags nothing. Tested in Task 2.

---

### Task 1: Tables and the catalog setting

**Files:** Create `supabase/migrations/0012_meta_ads.sql`. Modify `lib/types.ts` (`ExtraSettings.catalogKeywords: string`), `lib/defaults.ts`, `lib/defaults.test.ts` if present.

**Interfaces:** Produces tables `meta_ads(client_id, ad_id, name, campaign_id, campaign_name, adset_id, created_at, format, is_catalog, status, updated_at; pk (client_id, ad_id))` and `meta_ad_daily(client_id, ad_id, date, spend, impressions, clicks, purchases, revenue; pk (client_id, ad_id, date); index (client_id, date))`; `format` check in ('video','image','carousel','other'); the setting default `catalogKeywords: "catalog, dpa, daba"`.

- [ ] **Step 1: Write a failing test** that `defaultExtra()` has `catalogKeywords === "catalog, dpa, daba"`. Run: FAIL.
- [ ] **Step 2: Implement** the type field, the default and the migration (policies copied from `ad_spend_daily`). Run the test and `npx tsc --noEmit`: PASS.

### Task 2: Pure mapping

**Files:** Create `lib/sync/meta-ads.ts`, `lib/sync/meta-ads.test.ts`.

**Interfaces:** Produces `adFormat(creative: { object_type?: string; video_id?: string; asset_feed_spec?: unknown } | null | undefined): "video" | "image" | "carousel" | "other"`; `isCatalogCampaign(name: string | null | undefined, keywords: string): boolean`; `mapAdDay(row: AdInsightRow, windows: string[], clientId: string)` returning a `meta_ad_daily` row; `mapAd(ad: AdRow, clientId: string, keywords: string)` returning a `meta_ads` row; `AdInsightRow` and `AdRow` types (the Graph shapes used).

- [ ] **Step 1: Write failing tests:** `adFormat`: `object_type` VIDEO or a `video_id` gives video; PHOTO or SHARE with an image gives image; a creative with a carousel type (`object_type` "SHARE" with `child_attachments`, or `asset_feed_spec` with several images) gives carousel; anything else, null and undefined give other. `isCatalogCampaign("Spring DPA - US", "catalog, dpa, daba")` true, `"DABA retargeting"` true, `"Prospecting"` false, `"Dpa"` with keywords `""` false, whitespace around keywords ignored. `mapAdDay`: spend, impressions and clicks are numbers; purchases and revenue come from the same purchase-type preference as campaigns (`omni_purchase`, then `purchase`, then `offsite_conversion.fb_pixel_purchase`) summed over the requested windows; a row with no actions gives 0. `mapAd`: `created_at` from `created_time`, `status` from `effective_status`, `is_catalog` from the campaign name, `format` from `adFormat`; a missing creative gives format `other`.
- [ ] **Step 2: Run:** FAIL (module missing).
- [ ] **Step 3: Implement.** Export the purchase picking from `lib/sync/meta.ts` (`pickPurchase`) so both levels share it instead of copying it.
- [ ] **Step 4: Run:** PASS; `npx tsc --noEmit` clean.

### Task 3: Graph calls

**Files:** Modify `lib/sync/meta.ts`; extend `lib/sync/meta-ads.test.ts` (or `meta-fetch.test.ts`).

**Interfaces:** Produces `fetchAdDays(adAccountId, since, until, windows, graphImpl?)`: GET `{account}/insights` with `level=ad`, `time_increment=1`, `fields=ad_id,ad_name,adset_id,campaign_id,campaign_name,spend,impressions,clicks,actions,action_values`, `action_attribution_windows`, `limit=500`, following `paging.next` until none; and `fetchAds(adAccountId, adIds, graphImpl?)`: GET `{account}/ads` with `fields=id,name,adset_id,campaign_id,effective_status,created_time,creative{object_type,video_id,asset_feed_spec,object_story_spec}` and a `filtering` of `id IN` the given ids, in batches of 50 ids, following paging. `graph` becomes injectable (`graphImpl` defaults to the module's `graph`).

- [ ] **Step 1: Write failing tests** with a fake `graphImpl`: three pages of insights are concatenated and the `after` pages are requested in order with the same params; an empty account returns `[]`; `fetchAds` called with 120 ids makes 3 requests of 50, 50 and 20 ids and merges them; a Graph error on page 2 rejects with the Graph message (the caller decides what to do).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

### Task 4: Sync step and writer

**Files:** Create `lib/sync/run-meta-ads.ts` and `run-meta-ads.test.ts`; modify `lib/sync/run-meta.ts`.

**Interfaces:** Produces `syncMetaAds(admin: AdminLike, integration: { client_id: string; account_id: string }, since: string, until: string, windows: string[], keywords: string, deps?: { fetchAdDays; fetchAds }): Promise<{ ads: number; days: number }>` where `AdminLike` is the small subset of the Supabase client used (so a fake can stand in); `syncMeta` calls it after the campaign step inside its own try/catch and appends `Ad-level: N ads, M ad-days` or `Ad-level step failed: <message>` to the run message.

- [ ] **Step 1: Write failing tests** with a fake admin recording calls: it deletes the window's `meta_ad_daily` rows for the client, inserts the mapped rows in batches of 500, then upserts `meta_ads` for the ad ids seen (conflict `client_id,ad_id`); running it twice with the same fetch results ends with the same inserted set; an ad with spend in the window but missing from `fetchAds` is still stored with format `other` and the name from the insight row; when `fetchAdDays` throws, `syncMetaAds` rejects and nothing was deleted; in `syncMeta` (mocked deps) an ad-level rejection leaves `ad_spend_daily` written and the connection status `connected`, with the failure text in the run message.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement**, reading `catalogKeywords` from the client's `extra` settings next to the attribution windows. **Step 4: Run** `npx vitest run lib/sync` and the whole suite: PASS.

### Task 5: Setting field, docs and live check

**Files:** Modify the Store Settings Edit dialog (an "Ad creative" line in the Meta accordion for `catalogKeywords`), `docs/connector-setup.md`, `docs/changelog.md`, `CLAUDE.md`.

- [ ] **Step 1: Add the field** (text input, saved with the other extra settings) and a line in the Meta section of `docs/connector-setup.md`: ad-level data comes with the next Meta sync; run a history load for 13 months on each client (Store Settings, Edit, history).
- [ ] **Step 2: Verify:** `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npm test`.
- [ ] **Step 3: Live check after the migration is applied (strategist):** run Sync now on one Meta client with a long history, then in Supabase: `select count(*) from meta_ads where client_id = ...` and compare, for one month, `sum(spend)` of `meta_ad_daily` with the campaign-level `sum(spend)` of `ad_spend_daily` for platform meta (expect within a small percentage); note the row counts and the sync time per 60-day chunk, since they decide the chunk size for stage 2.

---

## Self-review

- **Spec coverage:** the two tables, format, catalog flag, attribution windows, daily sync and the backfill path (the history loader already runs the Meta sync per chunk) are covered. Moments tagging, the Creative Score, the demand model and the screens are stage 2 and deliberately absent.
- **Deviations on purpose:** none from the spec; the spec's "volumes measured in step 1" becomes the live check in Task 5 because volumes can only be measured on a real account.
- **Type consistency:** `AdInsightRow`, `AdRow`, `adFormat`, `isCatalogCampaign`, `mapAdDay`, `mapAd`, `fetchAdDays`, `fetchAds`, `syncMetaAds` are spelled the same wherever they are used.
- **Proportion:** five tasks; no function bodies, only signatures and the assertions each test makes.

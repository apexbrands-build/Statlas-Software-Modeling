import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdDays, fetchAds } from "./meta";
import { isCatalogCampaign, isRetryableAdError, mapAd, mapAdDay, RetryableAdError, type AdInsightRow, type AdRow } from "./meta-ads";

const BATCH = 500;

export interface AdSyncDeps {
  fetchAdDays: typeof fetchAdDays;
  fetchAds: typeof fetchAds;
}

const TIMEOUT = "TIMEOUT: ad-level data did not fit in one task";

async function inBatches<T>(rows: T[], deadline: number | undefined, write: (batch: T[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < rows.length; i += BATCH) {
    if (deadline !== undefined && Date.now() > deadline) throw new RetryableAdError(TIMEOUT);
    const { error } = await write(rows.slice(i, i + BATCH));
    if (error) throw new RetryableAdError(error.message);
  }
}

/**
 * Pulls ad-level Meta data for one connected ad account and window into `meta_ads` and `meta_ad_daily` (migration 0012).
 * Nothing is deleted until the ad-day fetch has succeeded. Failures that would leave a gap (out of time, rate limit, too much data, a write
 * that fails after the window was cleared) throw a retryable error so the job runner redoes the chunk smaller; other failures are notes.
 * If the ad details (names, launch date, creative type) cannot be read, the ad-days are still saved and the ads are stored with what the
 * insights carry, without overwriting anything already saved.
 */
export async function syncMetaAds(
  admin: SupabaseClient,
  integration: { client_id: string; account_id: string },
  since: string,
  until: string,
  windows: string[],
  keywords: string,
  opts: { deps?: AdSyncDeps; deadline?: number } = {},
): Promise<{ ads: number; days: number; note?: string }> {
  const { deadline } = opts;
  const deps = opts.deps ?? { fetchAdDays, fetchAds };
  const { client_id: clientId, account_id: accountId } = integration;

  const probe = await admin.from("meta_ads").select("ad_id").limit(1);
  if (probe.error && /meta_ads|relation|schema cache/i.test(probe.error.message)) throw new Error("Ad-level tables are not set up yet (migration 0012)");

  // Keep the catalog flag of every saved ad in line with the client's current keywords, not only the ads in this window.
  const notes: string[] = [];
  const flags = await admin.rpc("refresh_meta_ad_catalog", { p_client: clientId, p_keywords: keywords });
  if (flags.error) notes.push(`Catalog flags not refreshed (${flags.error.message}).`);

  // Each page is mapped as it arrives; only the small mapped rows (and the first row of each ad, for ads Meta cannot describe) are kept.
  const days: ReturnType<typeof mapAdDay>[] = [];
  const firstSeen = new Map<string, AdInsightRow>();
  await deps.fetchAdDays(accountId, since, until, windows, undefined, {
    deadline,
    onPage: (rows) => {
      for (const r of rows) {
        const d = mapAdDay(r, windows, clientId, accountId);
        if (d.spend <= 0) continue;
        days.push(d);
        if (!firstSeen.has(r.ad_id)) firstSeen.set(r.ad_id, { ad_id: r.ad_id, ad_name: r.ad_name, adset_id: r.adset_id, campaign_id: r.campaign_id, campaign_name: r.campaign_name, date_start: r.date_start });
      }
    },
  });
  const adIds = [...firstSeen.keys()];

  let details: AdRow[] = [];
  try {
    details = await deps.fetchAds(accountId, adIds, undefined, { deadline });
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    if (isRetryableAdError(e)) throw e;
    notes.push(`Ad details unavailable (${message}); ads stored without launch date or format.`);
  }
  const known = new Set(details.map((a) => a.id));

  // From here on a failure leaves the window cleared or partly written, so it must make the runner redo the chunk.
  try {
    const del = await admin.from("meta_ad_daily").delete().eq("client_id", clientId).eq("account_id", accountId).gte("date", since).lte("date", until);
    if (del.error) throw new RetryableAdError(del.error.message);
    await inBatches(days, deadline, (batch) => admin.from("meta_ad_daily").insert(batch));

    // Full rows (name, launch date, format, status) replace what is saved; ads Meta did not describe get a minimal row that never overwrites.
    const wanted = new Set(adIds);
    const full = details.filter((a) => wanted.has(a.id)).map((a) => mapAd(a, clientId, keywords, accountId));
    await inBatches(full, deadline, (batch) => admin.from("meta_ads").upsert(batch, { onConflict: "client_id,ad_id" }));
    const minimal = adIds
      .filter((id) => !known.has(id))
      .map((id) => {
        const r = firstSeen.get(id)!;
        return {
          client_id: clientId,
          account_id: accountId,
          ad_id: id,
          name: r.ad_name ?? null,
          campaign_id: r.campaign_id ?? null,
          campaign_name: r.campaign_name ?? null,
          adset_id: r.adset_id ?? null,
          created_at: null,
          format: "other",
          is_catalog: isCatalogCampaign(r.campaign_name, keywords),
          status: null,
          updated_at: new Date().toISOString(),
        };
      });
    await inBatches(minimal, deadline, (batch) => admin.from("meta_ads").upsert(batch, { onConflict: "client_id,ad_id", ignoreDuplicates: true }));
  } catch (e) {
    throw e instanceof RetryableAdError ? e : new RetryableAdError(e instanceof Error ? e.message : "Ad-level write failed");
  }

  return { ads: adIds.length, days: days.length, ...(notes.length ? { note: notes.join(" ") } : {}) };
}

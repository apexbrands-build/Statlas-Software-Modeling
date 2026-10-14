import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdDays, fetchAds } from "./meta";
import { mapAd, mapAdDay, isCatalogCampaign, type AdInsightRow, type AdRow } from "./meta-ads";

const BATCH = 500;

export interface AdSyncDeps {
  fetchAdDays: typeof fetchAdDays;
  fetchAds: typeof fetchAds;
}

async function inBatches<T>(rows: T[], write: (batch: T[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await write(rows.slice(i, i + BATCH));
    if (error) throw new Error(error.message);
  }
}

/**
 * Pulls ad-level Meta data for one connected ad account and window into `meta_ads` and `meta_ad_daily` (migration 0012).
 * Order matters for safety: nothing is deleted until the ad-day fetch has succeeded. The campaign sync never depends on this step.
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
  deps: AdSyncDeps = { fetchAdDays, fetchAds },
): Promise<{ ads: number; days: number; note?: string }> {
  const probe = await admin.from("meta_ads").select("ad_id").limit(1);
  if (probe.error && /meta_ads|relation|schema cache/i.test(probe.error.message)) throw new Error("Ad-level tables are not set up yet (migration 0012)");

  const insights: AdInsightRow[] = await deps.fetchAdDays(integration.account_id, since, until, windows);
  const days = insights.map((r) => mapAdDay(r, windows, integration.client_id)).filter((d) => d.spend > 0);
  const adIds = [...new Set(days.map((d) => d.ad_id))];

  let details: AdRow[] = [];
  let note: string | undefined;
  try {
    details = await deps.fetchAds(integration.account_id, adIds);
  } catch (e) {
    note = `Ad details unavailable (${e instanceof Error ? e.message : "error"}); ads stored without launch date or format.`;
  }
  const known = new Set(details.map((a) => a.id));

  const del = await admin.from("meta_ad_daily").delete().eq("client_id", integration.client_id).gte("date", since).lte("date", until);
  if (del.error) throw new Error(del.error.message);
  await inBatches(days, (batch) => admin.from("meta_ad_daily").insert(batch));

  // Full rows (name, launch date, format, status) replace what is saved; ads Meta did not describe get a minimal row that never overwrites.
  const full = details.filter((a) => adIds.includes(a.id)).map((a) => mapAd(a, integration.client_id, keywords));
  await inBatches(full, (batch) => admin.from("meta_ads").upsert(batch, { onConflict: "client_id,ad_id" }));
  const firstSeen = new Map(insights.map((r) => [r.ad_id, r]));
  const minimal = adIds
    .filter((id) => !known.has(id))
    .map((id) => {
      const r = firstSeen.get(id)!;
      return {
        client_id: integration.client_id,
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
  await inBatches(minimal, (batch) => admin.from("meta_ads").upsert(batch, { onConflict: "client_id,ad_id", ignoreDuplicates: true }));

  return { ads: adIds.length, days: days.length, ...(note ? { note } : {}) };
}

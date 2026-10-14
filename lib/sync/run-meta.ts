import "server-only";
import { getAdminClient } from "@/lib/supabase/server";
import { fetchCampaignDays, isExistingSegment } from "./meta";
import { metaWindows } from "./meta-windows";
import { splitCampaignDays } from "./meta-split";
import { resolveRange } from "./range";
import { isRetryableAdError } from "./meta-ads";
import { syncMetaAds } from "./run-meta-ads";


/** Pulls Meta spend for one connected ad account and rebuilds the Meta channel rows. */
export async function syncMeta(integrationId: string, body: { from?: string; to?: string; days?: number }, opts: { deadline?: number } = {}): Promise<{ rows: number; note?: string }> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from("integrations").select("id,client_id,provider,account_id").eq("id", integrationId).single();
  if (!integration || integration.provider !== "meta") throw new Error("Not a Meta connection");

  const { data: run } = await admin.from("sync_runs").insert({ client_id: integration.client_id, integration_id: integrationId, provider: "meta" }).select("id").single();
  try {
    const { from: since, to: until } = resolveRange(body, 30);
    const { data: st } = await admin.from("client_settings").select("extra").eq("client_id", integration.client_id).maybeSingle();
    const extra = (st?.extra ?? {}) as { fbAttrClick?: string; fbAttrView?: string; catalogKeywords?: string };
    const windows = metaWindows(extra.fbAttrClick, extra.fbAttrView);
    // 1) Total spend per campaign and day (source of truth for spend).
    const campaignDays = await fetchCampaignDays(integration.account_id, since, until, undefined, windows);

    // 2) Existing-customer spend: Advantage+ Shopping breakdown by audience segment.
    let note: string | undefined;
    let diagnostics = "";
    const existing = new Map<string, { spend: number; purchases: number; revenue: number }>();
    try {
      const segmented = await fetchCampaignDays(integration.account_id, since, until, "user_segment_key", windows);
      // Diagnostics: which segments did Meta return, and how much spend is in each?
      const bySegment = new Map<string, number>();
      for (const r of segmented) bySegment.set(r.segment ?? "(none)", (bySegment.get(r.segment ?? "(none)") ?? 0) + r.spend);
      diagnostics = `Segments returned: ${segmented.length === 0 ? "none" : [...bySegment.entries()].map(([k, v]) => `${k} ${v.toFixed(2)}`).join("; ")}`;
      for (const r of segmented) {
        if (!isExistingSegment(r.segment)) continue;
        const k = `${r.date}|${r.campaignId}`;
        const e = existing.get(k) ?? { spend: 0, purchases: 0, revenue: 0 };
        e.spend += r.spend;
        e.purchases += r.purchases;
        e.revenue += r.revenue;
        existing.set(k, e);
      }
      if (segmented.length === 0) note = "No audience-segment data returned: set the existing-customer definition in the ad account's audience settings, and use Advantage+ shopping campaigns.";
    } catch (e) {
      note = `Existing-customer split unavailable: ${e instanceof Error ? e.message : "error"}`;
    }

    // 3) Acquisition = total minus existing, per campaign-day. Existing rows get their own campaign id suffix.
    const spendRows = splitCampaignDays(campaignDays, existing).map((r) => ({ ...r, client_id: integration.client_id, platform: "meta" }));
    // Rebuild the window so rows from earlier syncs (old splits) cannot double count.
    await admin.from("ad_spend_daily").delete().eq("client_id", integration.client_id).eq("platform", "meta").gte("date", since).lte("date", until);
    for (let i = 0; i < spendRows.length; i += 500) {
      const { error } = await admin.from("ad_spend_daily").insert(spendRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    // Rebuild the Meta channel rows for the window from the raw campaign rows.
    const agg = new Map<string, { spend: number; rev: number; pur: number }>();
    for (const r of spendRows) {
      const channel = r.audience_type === "returning" ? "meta_returning" : "meta_acquisition";
      const key = `${r.date}|${channel}`;
      const a = agg.get(key) ?? { spend: 0, rev: 0, pur: 0 };
      a.spend += r.spend;
      a.rev += r.platform_revenue;
      a.pur += r.platform_purchases;
      agg.set(key, a);
    }
    await admin.from("daily_channel_facts").delete().eq("client_id", integration.client_id).in("channel", ["meta_acquisition", "meta_returning"]).gte("date", since).lte("date", until);
    const channelRows = [...agg.entries()].map(([key, v]) => {
      const [date, channel] = key.split("|");
      return { client_id: integration.client_id, date, channel, spend: v.spend, platform_revenue: v.rev, platform_purchases: v.pur, updated_at: new Date().toISOString() };
    });
    for (let i = 0; i < channelRows.length; i += 500) {
      const { error } = await admin.from("daily_channel_facts").insert(channelRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    // Ad-level step (creative data). Most failures (a missing permission, say) never fail the campaign sync or the connection: they go in the run
    // message. Running out of time, a rate limit or a half-written window do fail the chunk, so the job runner redoes it in smaller pieces
    // (the campaign step above is safe to repeat) instead of leaving a gap nobody would see.
    let adNote: string;
    try {
      const ad = await syncMetaAds(admin, integration, since, until, windows, extra.catalogKeywords ?? "catalog, dpa, daba", { deadline: opts.deadline });
      adNote = [`Ad-level: ${ad.ads} ads, ${ad.days} ad-days`, ad.note].filter(Boolean).join(". ");
    } catch (e) {
      if (isRetryableAdError(e)) throw e;
      adNote = `Ad-level step failed: ${e instanceof Error ? e.message : "error"}`;
    }

    const now = new Date().toISOString();
    const { data: cov } = await admin.from("integrations").select("coverage_start,coverage_end").eq("id", integrationId).single();
    const covStart = cov?.coverage_start && cov.coverage_start < since ? cov.coverage_start : since;
    const covEnd = cov?.coverage_end && cov.coverage_end > until ? cov.coverage_end : until;
    await admin.from("integrations").update({ status: "connected", consecutive_failures: 0, last_synced_at: now, last_error: note ?? null, coverage_start: covStart, coverage_end: covEnd }).eq("id", integrationId);
    const existingSpend = [...existing.values()].reduce((s, e) => s + e.spend, 0);
    const runMessage = [note, diagnostics, `Existing-customer spend: ${existingSpend.toFixed(2)}`, adNote].filter(Boolean).join(" | ");
    await admin.from("sync_runs").update({ status: "ok", finished_at: now, rows_written: spendRows.length, message: runMessage }).eq("id", run?.id ?? "");
    return { rows: spendRows.length, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await admin.from("integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), message: message.slice(0, 300) }).eq("id", run?.id ?? "");
    throw e;
  }
}

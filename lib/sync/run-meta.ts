import "server-only";
import { getAdminClient } from "@/lib/supabase/server";
import { fetchCampaignDays, isExistingSegment } from "./meta";
import { splitCampaignDays } from "./meta-split";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Pulls Meta spend for one connected ad account and rebuilds the Meta channel rows. */
export async function syncMeta(integrationId: string, days: number): Promise<{ rows: number; note?: string }> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from("integrations").select("id,client_id,provider,account_id").eq("id", integrationId).single();
  if (!integration || integration.provider !== "meta") throw new Error("Not a Meta connection");

  const { data: run } = await admin.from("sync_runs").insert({ client_id: integration.client_id, integration_id: integrationId, provider: "meta" }).select("id").single();
  try {
    const until = addDays(new Date().toISOString().slice(0, 10), -1);
    const since = addDays(until, -(Math.min(Math.max(days, 1), 800) - 1));
    // 1) Total spend per campaign and day (source of truth for spend).
    const campaignDays = await fetchCampaignDays(integration.account_id, since, until);

    // 2) Existing-customer spend: Advantage+ Shopping breakdown by audience segment.
    let note: string | undefined;
    let diagnostics = "";
    const existing = new Map<string, { spend: number; purchases: number; revenue: number }>();
    try {
      const segmented = await fetchCampaignDays(integration.account_id, since, until, "user_segment_key");
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

    const now = new Date().toISOString();
    await admin.from("integrations").update({ status: "connected", last_synced_at: now, last_error: note ?? null, coverage_start: since, coverage_end: until }).eq("id", integrationId);
    const existingSpend = [...existing.values()].reduce((s, e) => s + e.spend, 0);
    const runMessage = [note, diagnostics, `Existing-customer spend: ${existingSpend.toFixed(2)}`].filter(Boolean).join(" | ");
    await admin.from("sync_runs").update({ status: "ok", finished_at: now, rows_written: spendRows.length, message: runMessage }).eq("id", run?.id ?? "");
    return { rows: spendRows.length, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await admin.from("integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), message: message.slice(0, 300) }).eq("id", run?.id ?? "");
    throw e;
  }
}

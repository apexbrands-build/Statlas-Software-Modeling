import "server-only";
import { getAdminClient } from "@/lib/supabase/server";
import { fetchCampaignDays, isReturningCampaign } from "./meta";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Pulls Meta spend for one connected ad account and rebuilds the Meta channel rows. */
export async function syncMeta(integrationId: string, days: number): Promise<{ rows: number }> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from("integrations").select("id,client_id,provider,account_id").eq("id", integrationId).single();
  if (!integration || integration.provider !== "meta") throw new Error("Not a Meta connection");

  const { data: run } = await admin.from("sync_runs").insert({ client_id: integration.client_id, integration_id: integrationId, provider: "meta" }).select("id").single();
  try {
    const until = addDays(new Date().toISOString().slice(0, 10), -1);
    const since = addDays(until, -(Math.min(Math.max(days, 1), 800) - 1));
    const campaignDays = await fetchCampaignDays(integration.account_id, since, until);

    const spendRows = campaignDays.map((c) => ({
      client_id: integration.client_id,
      date: c.date,
      platform: "meta",
      campaign_id: c.campaignId,
      campaign_name: c.campaignName,
      category: isReturningCampaign(c.campaignName) ? "retention" : "acquisition",
      audience_type: isReturningCampaign(c.campaignName) ? "returning" : "new",
      spend: c.spend,
      platform_revenue: c.revenue,
      platform_purchases: c.purchases,
    }));
    for (let i = 0; i < spendRows.length; i += 500) {
      const { error } = await admin.from("ad_spend_daily").upsert(spendRows.slice(i, i + 500));
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
    await admin.from("integrations").update({ status: "connected", last_synced_at: now, last_error: null, coverage_end: until }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "ok", finished_at: now, rows_written: spendRows.length }).eq("id", run?.id ?? "");
    return { rows: spendRows.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await admin.from("integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), message: message.slice(0, 300) }).eq("id", run?.id ?? "");
    throw e;
  }
}

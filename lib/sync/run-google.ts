import "server-only";
import { adsSearch } from "@/lib/google";
import { getAdminClient } from "@/lib/supabase/server";
import { isBrandCampaign, mergeGoogleRows } from "./google-split";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Pulls Google Ads spend and purchase conversions for one client account; brand vs non-brand by campaign name. */
export async function syncGoogle(integrationId: string, days: number): Promise<{ rows: number; note?: string }> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from("integrations").select("id,client_id,provider,account_id").eq("id", integrationId).single();
  if (!integration || integration.provider !== "google_ads") throw new Error("Not a Google Ads connection");
  const { data: run } = await admin.from("sync_runs").insert({ client_id: integration.client_id, integration_id: integrationId, provider: "google_ads" }).select("id").single();

  try {
    const { data: settings } = await admin.from("client_settings").select("brand_campaign_keyword").eq("client_id", integration.client_id).maybeSingle();
    const keyword = (settings?.brand_campaign_keyword as string | undefined) ?? "brand";

    const until = addDays(new Date().toISOString().slice(0, 10), -1);
    const since = addDays(until, -(Math.min(Math.max(days, 1), 800) - 1));
    const range = `segments.date BETWEEN '${since}' AND '${until}'`;

    const costRows = await adsSearch(integration.account_id, `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros FROM campaign WHERE ${range} AND metrics.cost_micros > 0`);
    let note: string | undefined;
    let purchaseRows: Awaited<ReturnType<typeof adsSearch>> = [];
    try {
      purchaseRows = await adsSearch(
        integration.account_id,
        `SELECT segments.date, segments.conversion_action_category, campaign.id, campaign.name, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${range} AND segments.conversion_action_category = 'PURCHASE'`,
      );
    } catch (e) {
      note = `Purchase conversions unavailable: ${e instanceof Error ? e.message : "error"}`;
    }
    const campaignDays = mergeGoogleRows(costRows, purchaseRows);

    const spendRows = campaignDays.map((c) => ({
      client_id: integration.client_id,
      date: c.date,
      platform: "google_ads",
      campaign_id: c.campaignId,
      campaign_name: c.campaignName,
      category: isBrandCampaign(c.campaignName, keyword) ? "brand" : "acquisition",
      audience_type: "unknown",
      spend: c.spend,
      platform_revenue: c.revenue,
      platform_purchases: c.purchases,
    }));
    await admin.from("ad_spend_daily").delete().eq("client_id", integration.client_id).eq("platform", "google_ads").gte("date", since).lte("date", until);
    for (let i = 0; i < spendRows.length; i += 500) {
      const { error } = await admin.from("ad_spend_daily").insert(spendRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    const agg = new Map<string, { spend: number; rev: number; pur: number }>();
    for (const r of spendRows) {
      const channel = r.category === "brand" ? "google_brand" : "google_nonbrand";
      const k = `${r.date}|${channel}`;
      const a = agg.get(k) ?? { spend: 0, rev: 0, pur: 0 };
      a.spend += r.spend;
      a.rev += r.platform_revenue;
      a.pur += r.platform_purchases;
      agg.set(k, a);
    }
    await admin.from("daily_channel_facts").delete().eq("client_id", integration.client_id).in("channel", ["google_nonbrand", "google_brand"]).gte("date", since).lte("date", until);
    const channelRows = [...agg.entries()].map(([k, v]) => {
      const [date, channel] = k.split("|");
      return { client_id: integration.client_id, date, channel, spend: v.spend, platform_revenue: v.rev, platform_purchases: v.pur, updated_at: new Date().toISOString() };
    });
    for (let i = 0; i < channelRows.length; i += 500) {
      const { error } = await admin.from("daily_channel_facts").insert(channelRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    const brandSpend = spendRows.filter((r) => r.category === "brand").reduce((s, r) => s + r.spend, 0);
    const now = new Date().toISOString();
    await admin.from("integrations").update({ status: "connected", last_synced_at: now, last_error: note ?? null, coverage_start: since, coverage_end: until }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "ok", finished_at: now, rows_written: spendRows.length, message: [note, `Brand spend (name contains "${keyword}"): ${brandSpend.toFixed(2)}`].filter(Boolean).join(" | ") }).eq("id", run?.id ?? "");
    return { rows: spendRows.length, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await admin.from("integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), message: message.slice(0, 300) }).eq("id", run?.id ?? "");
    throw e;
  }
}

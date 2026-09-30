export interface GoogleCampaignDay {
  date: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  purchases: number;
  revenue: number;
}

/** Brand campaign = name contains the client's keyword (case-insensitive). An empty keyword never matches. */
export function isBrandCampaign(name: string, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  return k.length > 0 && name.toLowerCase().includes(k);
}

type Row = Record<string, Record<string, string | number>>;

/** Joins the cost query and the purchase-conversion query into one row per campaign and day. */
export function mergeGoogleRows(costRows: Row[], purchaseRows: Row[]): GoogleCampaignDay[] {
  const map = new Map<string, GoogleCampaignDay>();
  const key = (r: Row) => `${r.segments?.date}|${r.campaign?.id}`;
  const get = (r: Row): GoogleCampaignDay => {
    const k = key(r);
    let v = map.get(k);
    if (!v) {
      v = { date: String(r.segments?.date), campaignId: String(r.campaign?.id), campaignName: String(r.campaign?.name ?? ""), spend: 0, purchases: 0, revenue: 0 };
      map.set(k, v);
    }
    if (!v.campaignName && r.campaign?.name) v.campaignName = String(r.campaign.name);
    return v;
  };
  for (const r of costRows) get(r).spend += Number(r.metrics?.costMicros ?? 0) / 1_000_000;
  for (const r of purchaseRows) {
    const v = get(r);
    v.purchases += Number(r.metrics?.conversions ?? 0);
    v.revenue += Number(r.metrics?.conversionsValue ?? 0);
  }
  return [...map.values()].filter((d) => d.spend > 0 || d.purchases > 0);
}

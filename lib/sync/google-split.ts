export interface GoogleCampaignDay {
  date: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  purchases: number;
  revenue: number;
}

const NON_BRAND = /non[\s_-]*brand/i;

/**
 * Brand campaign = name contains the client's keyword (case-insensitive). An empty keyword never matches.
 * Never brand: names with the non-brand tag as its own word (e.g. "NB", the agency naming convention),
 * and "non-brand" / "nonbrand" / "non brand" names, even though they contain the word "brand".
 */
export function isBrandCampaign(name: string, keyword: string, nonBrandTag = "NB"): boolean {
  const k = keyword.trim().toLowerCase();
  if (k.length === 0) return false;
  const tag = nonBrandTag.trim().toLowerCase();
  if (tag && name.toLowerCase().split(/[^a-z0-9]+/).includes(tag)) return false;
  return name.replace(NON_BRAND, " ").toLowerCase().includes(k);
}

const words = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/);

/**
 * Audience of a Google campaign from the tags in its name, each as its own word in any case: the returning tag (RTN) = existing customers, the
 * acquisition tag (ACQ) = new customers. Anything else, including a name with both tags or a tag the client left empty, is unknown and counts as new.
 */
export function campaignAudience(name: string, acqTag: string, rtnTag: string): "new" | "returning" | "unknown" {
  const has = (tag: string) => {
    const t = tag.trim().toLowerCase();
    return t.length > 0 && words(name).includes(t);
  };
  const acq = has(acqTag);
  const rtn = has(rtnTag);
  if (rtn && !acq) return "returning";
  if (acq && !rtn) return "new";
  return "unknown";
}

/** The channel of a Google campaign: brand or non-brand, new customers (or untagged) or returning customers. */
export function googleChannel(brand: boolean, audience: "new" | "returning" | "unknown"): "google_nonbrand" | "google_brand" | "google_nonbrand_returning" | "google_brand_returning" {
  if (audience === "returning") return brand ? "google_brand_returning" : "google_nonbrand_returning";
  return brand ? "google_brand" : "google_nonbrand";
}

export interface GoogleRules {
  /** Brand keyword, the non-brand tag, and the audience tags of the client's naming convention. */
  keyword: string;
  nonBrandTag: string;
  acqTag: string;
  rtnTag: string;
}

export interface ClassifiedGoogleDay extends GoogleCampaignDay {
  category: "brand" | "acquisition";
  audience: "new" | "returning" | "unknown";
  channel: ReturnType<typeof googleChannel>;
}

/** Brand or not, and new or returning, for every campaign day, from the campaign name and the client's rules. */
export function classifyGoogleDays(days: GoogleCampaignDay[], rules: GoogleRules): ClassifiedGoogleDay[] {
  return days.map((d) => {
    const brand = isBrandCampaign(d.campaignName, rules.keyword, rules.nonBrandTag);
    const audience = campaignAudience(d.campaignName, rules.acqTag, rules.rtnTag);
    return { ...d, category: brand ? "brand" : "acquisition", audience, channel: googleChannel(brand, audience) };
  });
}

/** One row per date and channel, the shape of `daily_channel_facts`. */
export function channelTotals(days: ClassifiedGoogleDay[]): { date: string; channel: ClassifiedGoogleDay["channel"]; spend: number; platformRevenue: number; platformPurchases: number }[] {
  const agg = new Map<string, { date: string; channel: ClassifiedGoogleDay["channel"]; spend: number; platformRevenue: number; platformPurchases: number }>();
  for (const d of days) {
    const k = `${d.date}|${d.channel}`;
    const a = agg.get(k) ?? { date: d.date, channel: d.channel, spend: 0, platformRevenue: 0, platformPurchases: 0 };
    a.spend += d.spend;
    a.platformRevenue += d.revenue;
    a.platformPurchases += d.purchases;
    agg.set(k, a);
  }
  return [...agg.values()];
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

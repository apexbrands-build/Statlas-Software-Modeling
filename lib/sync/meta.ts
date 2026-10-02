import "server-only";

// Meta Marketing API (read-only). One agency System User token covers every client ad account it is assigned to.
const VERSION = process.env.META_API_VERSION ?? "v23.0";

interface Action {
  action_type: string;
  value: string;
  [window: string]: string | undefined;
}
interface InsightRow {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  user_segment_key?: string;
  spend: string;
  actions?: Action[];
  action_values?: Action[];
}

function token(): string {
  const t = process.env.META_SYSTEM_USER_TOKEN;
  if (!t) throw new Error("META_SYSTEM_USER_TOKEN is not set");
  return t;
}

async function graph<T>(pathOrUrl: string, params: Record<string, string> = {}): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? new URL(pathOrUrl) : new URL(`https://graph.facebook.com/${VERSION}/${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok || json.error) throw new Error(`Meta: ${json.error?.message ?? res.status}`);
  return json;
}

export function normalizeAdAccountId(input: string): string | null {
  const digits = input.trim().replace(/^act_/i, "");
  return /^\d{5,20}$/.test(digits) ? `act_${digits}` : null;
}

export async function fetchAdAccount(id: string) {
  return graph<{ id: string; name: string; currency: string; timezone_name: string; account_status: number }>(id, {
    fields: "name,currency,timezone_name,account_status",
  });
}

// Prefer the aggregated purchase event so orders are not double counted.
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function pickPurchase(list: Action[] | undefined, windows: string[]): number {
  if (!list) return 0;
  for (const t of PURCHASE_TYPES) {
    const a = list.find((x) => x.action_type === t);
    if (!a) continue;
    // Sum the requested windows; fall back to the plain value when Meta does not break it down.
    const parts = windows.map((w) => a[w]).filter((x) => x !== undefined);
    return parts.length ? parts.reduce<number>((s, x) => s + Number(x), 0) : Number(a.value);
  }
  return 0;
}

export interface CampaignDay {
  /** Audience segment (only when requested with breakdown user_segment_key). */
  segment?: string;
  date: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  purchases: number;
  revenue: number;
}

/**
 * Campaign-level daily insights; windows come from the store settings (default 7-day click).
 * breakdown "user_segment_key" splits Advantage+ Shopping campaigns into new / existing / engaged customers,
 * using the existing-customer definition saved in the ad account's audience settings.
 */
export async function fetchCampaignDays(adAccountId: string, since: string, until: string, breakdown?: string, windows: string[] = ["7d_click"]): Promise<CampaignDay[]> {
  const out: CampaignDay[] = [];
  let page = await graph<{ data: InsightRow[]; paging?: { next?: string } }>(`${adAccountId}/insights`, {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,spend,actions,action_values",
    action_attribution_windows: JSON.stringify(windows),
    limit: "500",
    ...(breakdown ? { breakdowns: breakdown } : {}),
  });
  for (;;) {
    for (const r of page.data) {
      out.push({
        segment: r.user_segment_key,
        date: r.date_start,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        spend: Number(r.spend ?? 0),
        purchases: pickPurchase(r.actions, windows),
        revenue: pickPurchase(r.action_values, windows),
      });
    }
    if (!page.paging?.next) break;
    page = await graph(page.paging.next);
  }
  return out;
}

/** True for the existing-customer segment returned by the user_segment_key breakdown. */
export function isExistingSegment(segment: string | undefined): boolean {
  return (segment ?? "").toLowerCase().includes("existing");
}

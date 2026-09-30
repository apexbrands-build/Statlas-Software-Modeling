import "server-only";

// Meta Marketing API (read-only). One agency System User token covers every client ad account it is assigned to.
const VERSION = process.env.META_API_VERSION ?? "v23.0";

interface Action {
  action_type: string;
  value: string;
  "7d_click"?: string;
}
interface InsightRow {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
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

function pickPurchase(list: Action[] | undefined): number {
  if (!list) return 0;
  for (const t of PURCHASE_TYPES) {
    const a = list.find((x) => x.action_type === t);
    if (a) return Number(a["7d_click"] ?? a.value ?? 0);
  }
  return 0;
}

export interface CampaignDay {
  date: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  purchases: number;
  revenue: number;
}

/** Campaign-level daily insights, 7-day click attribution. */
export async function fetchCampaignDays(adAccountId: string, since: string, until: string): Promise<CampaignDay[]> {
  const out: CampaignDay[] = [];
  let page = await graph<{ data: InsightRow[]; paging?: { next?: string } }>(`${adAccountId}/insights`, {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,spend,actions,action_values",
    action_attribution_windows: JSON.stringify(["7d_click"]),
    limit: "500",
  });
  for (;;) {
    for (const r of page.data) {
      out.push({
        date: r.date_start,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        spend: Number(r.spend ?? 0),
        purchases: pickPurchase(r.actions),
        revenue: pickPurchase(r.action_values),
      });
    }
    if (!page.paging?.next) break;
    page = await graph(page.paging.next);
  }
  return out;
}

/**
 * Returning (existing-customer) spend. Current rule: campaign name contains one of these words.
 * To be confirmed with the team; Advantage+ existing-customer budget splits would need ad-set level data.
 */
export const RETURNING_KEYWORDS = ["retention", "existing", "returning", "crm", "lapsed", "reactivation"];

export function isReturningCampaign(name: string): boolean {
  const n = name.toLowerCase();
  return RETURNING_KEYWORDS.some((k) => n.includes(k));
}

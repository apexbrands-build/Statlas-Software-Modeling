import "server-only";

import type { AdInsightRow, AdRow } from "./meta-ads";

// Meta Marketing API (read-only). One agency System User token covers every client ad account it is assigned to.
const VERSION = process.env.META_API_VERSION ?? "v23.0";

export interface Action {
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

export function pickPurchase(list: Action[] | undefined, windows: string[]): number {
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

type GraphFn = <T>(pathOrUrl: string, params?: Record<string, string>) => Promise<T>;

const timedOut = (deadline: number | undefined) => deadline !== undefined && Date.now() > deadline;
const TIMEOUT_MESSAGE = "TIMEOUT: ad-level data did not fit in one task";

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Meta's way of saying a request was too heavy or the service hiccuped: worth another try, unlike a missing permission. */
const TRANSIENT_GRAPH = /temporarily unavailable|unknown error occurred/i;
const RETRY_WAITS = [1000, 2500];

/** One Graph call, tried up to three times (waiting 1 s, then 2.5 s) when Meta fails transiently; any other error, or no time left before the deadline, rejects at once. */
async function callWithRetry<T>(fn: () => Promise<T>, opts: { deadline?: number; sleep?: Sleep }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (!TRANSIENT_GRAPH.test(message) || attempt >= RETRY_WAITS.length) throw e;
      if (opts.deadline !== undefined && Date.now() + RETRY_WAITS[attempt] > opts.deadline) throw e;
      await (opts.sleep ?? realSleep)(RETRY_WAITS[attempt]);
    }
  }
}

/**
 * Ad-level daily insights (one row per ad and day with spend). Follows every page; a Graph error rejects so the caller decides what to do.
 * With `onPage` each page is handed over and not kept (the raw rows carry long action lists); without it all rows are returned.
 * Past `deadline` it stops with a TIMEOUT before asking for the next page.
 */
export async function fetchAdDays(
  adAccountId: string,
  since: string,
  until: string,
  windows: string[] = ["7d_click"],
  graphImpl: GraphFn = graph,
  opts: { deadline?: number; onPage?: (rows: AdInsightRow[]) => void; sleep?: Sleep } = {},
): Promise<AdInsightRow[]> {
  const out: AdInsightRow[] = [];
  if (timedOut(opts.deadline)) throw new Error(TIMEOUT_MESSAGE);
  let page = await callWithRetry(
    () =>
      graphImpl<{ data: AdInsightRow[]; paging?: { next?: string } }>(`${adAccountId}/insights`, {
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({ since, until }),
        fields: "ad_id,ad_name,adset_id,campaign_id,campaign_name,spend,impressions,clicks,actions,action_values",
        action_attribution_windows: JSON.stringify(windows),
        limit: "100",
      }),
    opts,
  );
  for (;;) {
    if (opts.onPage) opts.onPage(page.data);
    else out.push(...page.data);
    if (!page.paging?.next) break;
    if (timedOut(opts.deadline)) throw new Error(TIMEOUT_MESSAGE);
    const next = page.paging.next;
    page = await callWithRetry(() => graphImpl<{ data: AdInsightRow[]; paging?: { next?: string } }>(next), opts);
  }
  return out;
}

const AD_FIELDS = "id,name,adset_id,campaign{id,name},effective_status,created_time,creative{object_type,video_id,asset_feed_spec,object_story_spec}";

/** Without a status filter the ads edge leaves out archived and deleted ads, whose launch date and format stage 2 needs for history. */
const ALL_STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"];

/** The ads behind the given ids (name, campaign, launch date, status, creative type), looked up 50 ids at a time. Past `deadline` it stops with a TIMEOUT. */
export async function fetchAds(adAccountId: string, adIds: string[], graphImpl: GraphFn = graph, opts: { deadline?: number; sleep?: Sleep } = {}): Promise<AdRow[]> {
  const out: AdRow[] = [];
  for (let i = 0; i < adIds.length; i += 50) {
    const batch = adIds.slice(i, i + 50);
    if (timedOut(opts.deadline)) throw new Error(TIMEOUT_MESSAGE);
    let page = await callWithRetry(
      () =>
        graphImpl<{ data: AdRow[]; paging?: { next?: string } }>(`${adAccountId}/ads`, {
          fields: AD_FIELDS,
          filtering: JSON.stringify([
            { field: "id", operator: "IN", value: batch },
            { field: "effective_status", operator: "IN", value: ALL_STATUSES },
          ]),
          limit: "100",
        }),
      opts,
    );
    for (;;) {
      out.push(...page.data);
      if (!page.paging?.next) break;
      if (timedOut(opts.deadline)) throw new Error(TIMEOUT_MESSAGE);
      const next = page.paging.next;
      page = await callWithRetry(() => graphImpl<{ data: AdRow[]; paging?: { next?: string } }>(next), opts);
    }
  }
  return out;
}


import type { Range } from "../dates";
import { getReport } from "./registry";

/** Home metric key -> the report behind it. The link icon shows only once that report is ready. */
export const HOME_REPORT_LINKS: Record<string, string> = {
  cm: "contribution-margin",
  orderRevenue: "revenue-overview",
  adSpend: "ads",
  mer: "mer",
  aov: "aov-histogram",
  orders: "new-vs-returning",
  emailRevenue: "email-metrics",
  emailOrders: "email-metrics",
  emailCampaignRevenue: "email-metrics",
  emailFlowRevenue: "email-metrics",
  emailRevPer1k: "email-metrics",
  // Meta ROAS / iROAS tile (merged row and the split acquisition row): the ad-by-ad view behind it.
  "meta.iroas": "best-creatives",
  "meta_acquisition.iroas": "best-creatives",
};

/** Link for a Home tile, carrying Home's date range, or null when the metric has no ready report. */
export function homeReportHref(metricKey: string, range?: Range): string | null {
  const slug = Object.hasOwn(HOME_REPORT_LINKS, metricKey) ? HOME_REPORT_LINKS[metricKey] : undefined;
  if (!slug || getReport(slug)?.status !== "ready") return null;
  return range ? `/reporting/${slug}?from=${range.from}&to=${range.to}` : `/reporting/${slug}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Range from `?from=&to=` in a report URL; null when missing, malformed, impossible or reversed (the report then uses the current month). */
export function parseRangeParams(from: string | null, to: string | null): Range | null {
  if (!from || !to || !validDate(from) || !validDate(to) || from > to) return null;
  return { from, to };
}

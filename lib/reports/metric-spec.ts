import type { Format } from "../format";
import { amerSpend, cmParts, div, orderRevenue, totalSpend, type Direction, type PlanTotals, type Totals } from "../metrics";
import type { ChannelKey, ClientSettings } from "../types";

/** One report metric: an actual value from the daily facts and, when the plan covers it, a goal. */
export interface MetricSpec {
  key: string;
  label: string;
  format: Format;
  direction: Direction;
  value: (t: Totals, s: ClientSettings) => number | null;
  goal?: (p: PlanTotals) => number | null;
}

const planSpend = (p: PlanTotals, keys: ChannelKey[]) => keys.reduce((s, k) => s + (p.spendByChannel[k] ?? 0), 0);
const sum = (t: Totals, keys: ChannelKey[], f: "spend" | "platformRevenue") => keys.reduce((s, k) => s + t.channels[k][f], 0);

const META: ChannelKey[] = ["meta_acquisition", "meta_returning"];
const GOOGLE: ChannelKey[] = ["google_nonbrand", "google_brand"];

/** Metrics of the Marketing Efficiency Report, in display order. */
export const MER_SPECS: MetricSpec[] = [
  { key: "cm", label: "Contribution Margin", format: "currency0", direction: "up", value: (t, s) => cmParts(t, s).cm, goal: (p) => p.cm },
  { key: "rev", label: "Website Revenue", format: "currency0", direction: "up", value: (t) => orderRevenue(t), goal: (p) => p.orderRevenue },
  { key: "spend", label: "Website Spend", format: "currency0", direction: "up", value: (t) => totalSpend(t), goal: (p) => p.spend },
  { key: "mer", label: "Marketing Efficiency Rating", format: "ratio2", direction: "up", value: (t) => div(orderRevenue(t), totalSpend(t)), goal: (p) => div(p.orderRevenue, p.spend) },
  { key: "acqRev", label: "Acquisition Revenue", format: "currency0", direction: "up", value: (t) => t.newOrderRevenue, goal: (p) => p.newRevenue },
  { key: "acqSpend", label: "Acquisition Spend", format: "currency0", direction: "up", value: (t, s) => amerSpend(t, s), goal: (p) => p.spend },
  { key: "amer", label: "Acquisition MER", format: "ratio2", direction: "up", value: (t, s) => div(t.newOrderRevenue, amerSpend(t, s)), goal: (p) => div(p.newRevenue, p.spend) },
  { key: "fbSpend", label: "Facebook Ad Spend", format: "currency0", direction: "up", value: (t) => sum(t, META, "spend"), goal: (p) => (planSpend(p, META) > 0 ? planSpend(p, META) : null) },
  { key: "fbConv", label: "Facebook Conversion Value", format: "currency0", direction: "up", value: (t) => sum(t, META, "platformRevenue") },
  { key: "fbRoas", label: "Facebook ROAS", format: "ratio2", direction: "up", value: (t) => div(sum(t, META, "platformRevenue"), sum(t, META, "spend")) },
  { key: "gSpend", label: "Google Ad Spend", format: "currency0", direction: "up", value: (t) => sum(t, GOOGLE, "spend"), goal: (p) => (planSpend(p, GOOGLE) > 0 ? planSpend(p, GOOGLE) : null) },
  { key: "gReturn", label: "Google Return", format: "currency0", direction: "up", value: (t) => sum(t, GOOGLE, "platformRevenue") },
  { key: "gRoas", label: "Google ROAS", format: "ratio2", direction: "up", value: (t) => div(sum(t, GOOGLE, "platformRevenue"), sum(t, GOOGLE, "spend")) },
];


/**
 * Columns of the Hourly Report, in blocks. The definitions are Home's (`METRICS`) and the Calendar Report's (`platformRows`): nothing
 * new is computed here. What this file adds is the block each column sits in, whether it adds up over the hours (a ratio does not:
 * every hour carries the day's target), and whether it has hourly actuals yet.
 */
import { METRICS } from "../metrics";
import { CHANNEL_KEYS, type ChannelKey } from "../types";
import { platformRows } from "./calendar-specs";
import type { MetricSpec } from "./metric-spec";

export type HourlyBlockId = "business" | "paid" | "metaAcq" | "metaRet" | "gNonBrand" | "gBrand" | "email" | "sms";

export const HOURLY_BLOCKS: { id: HourlyBlockId; label: string }[] = [
  { id: "business", label: "Business" },
  { id: "paid", label: "Paid total" },
  { id: "metaAcq", label: "Meta: acquisition" },
  { id: "metaRet", label: "Meta: retention" },
  { id: "gNonBrand", label: "Google: non-brand" },
  { id: "gBrand", label: "Google: brand" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
];

export interface HourlySpec extends MetricSpec {
  block: HourlyBlockId;
  /** The column's name under its block header. */
  short: string;
  /** A sum over the hours: its expectation is the day's target times the hour's share. False = a ratio, which carries the day's target on every hour. */
  additive: boolean;
  /** No hourly source yet (ad spend and everything built on it, email, SMS): the expectation shows and the actual says "no hourly data yet". */
  noHourly: boolean;
}

/** A business column built from a Home metric (its value and its plan target). */
function business(key: string, metricKey: string, label: string, noHourly = false): HourlySpec {
  const m = METRICS[metricKey];
  return { key, label, short: label, block: "business", format: m.format, direction: m.direction, value: m.value, goal: m.target, additive: Boolean(m.additive), noHourly };
}

/** Spend, platform revenue and ROAS of a group of channels, with the Calendar Report's goal rules. */
function platform(block: HourlyBlockId, name: string, keys: ChannelKey[], goals: "both" | "revenue"): HourlySpec[] {
  const [spend, revenue, roas] = platformRows(block, name, keys, goals);
  return [
    { ...spend, label: `${name} spend`, short: "Spend", block, additive: true, noHourly: true },
    { ...revenue, label: `${name} platform revenue`, short: "Platform revenue", block, additive: true, noHourly: true },
    { ...roas, label: `${name} ROAS`, short: "ROAS", block, additive: false, noHourly: true },
  ];
}

function mix(block: "email" | "sms", metricKey: string, label: string): HourlySpec {
  const m = METRICS[metricKey];
  return { key: block, label, short: "Revenue", block, format: m.format, direction: m.direction, value: m.value, goal: m.target, additive: true, noHourly: true };
}

export const HOURLY_SPECS: HourlySpec[] = [
  business("rev", "orderRevenue", "Revenue"),
  business("orders", "orders", "Orders"),
  business("aov", "aov", "AOV"),
  business("newRev", "newRevenue", "New revenue"),
  business("newOrders", "newOrders", "New orders"),
  business("newAov", "newAov", "New AOV"),
  business("retRev", "returningRevenue", "Returning revenue"),
  business("spend", "adSpend", "Ad spend", true),
  business("mer", "mer", "MER", true),
  business("amer", "amer", "aMER", true),
  business("cac", "weightedCac", "CAC", true),
  // Every paid channel: its revenue goal needs a ROAS target on every type that spends, and a blended ROAS has no goal (it would follow the planned mix, not the mix spent).
  ...platform("paid", "Paid total", CHANNEL_KEYS, "revenue"),
  ...platform("metaAcq", "Meta acquisition", ["meta_acquisition"], "both"),
  // The plan's own screens set no ROAS target for returning types; the trackers do (aMER ÷ the type's factor). This block shows one when the targets it is given include the type.
  ...platform("metaRet", "Meta retention", ["meta_returning"], "both"),
  ...platform("gNonBrand", "Google non-brand", ["google_nonbrand"], "both"),
  ...platform("gBrand", "Google brand", ["google_brand"], "both"),
  mix("email", "emailRevenue", "Email revenue"),
  mix("sms", "smsRevenue", "SMS revenue"),
];

export const hourlySpec = (key: string): HourlySpec | undefined => HOURLY_SPECS.find((s) => s.key === key);

/** Columns shown the first time: the ones with hourly actuals. */
export const DEFAULT_HOURLY_COLS: string[] = HOURLY_SPECS.filter((s) => !s.noHourly).map((s) => s.key);

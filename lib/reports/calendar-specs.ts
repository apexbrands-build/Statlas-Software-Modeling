/** Columns and Graph items of the Calendar Report, and its presets. Same definitions as Home and the other reports: nothing is computed here that `METRICS` or `MER_SPECS` do not already define. */
import { div, METRICS, type PlanTotals, type Totals } from "../metrics";
import type { ChannelKey } from "../types";
import { MER_SPECS, type MetricSpec } from "./metric-spec";

/** A report column built from an existing Home metric (value and plan target). */
function fromMetric(id: string, metricKey: string, label?: string): MetricSpec {
  const m = METRICS[metricKey];
  return { key: id, label: label ?? m.label, format: m.format, direction: m.direction, value: m.value, goal: m.target };
}

const fromMer = (id: string, merKey: string): MetricSpec => {
  const m = MER_SPECS.find((s) => s.key === merKey)!;
  return { ...m, key: id };
};

const sum = (t: Totals, keys: ChannelKey[], f: "spend" | "platformRevenue") => keys.reduce((s, k) => s + t.channels[k][f], 0);
const planSpend = (p: PlanTotals, keys: ChannelKey[]) => {
  const planned = keys.filter((k) => p.spendByChannel[k] !== undefined);
  return planned.length ? planned.reduce((s, k) => s + (p.spendByChannel[k] ?? 0), 0) : null;
};

/** Spend, revenue and ROAS rows for one group of channels. Spend has a plan goal; revenue and ROAS do not. */
function platformRows(prefix: string, label: string, keys: ChannelKey[]): MetricSpec[] {
  return [
    { key: `${prefix}Spend`, label: `${label} Spend`, format: "currency0", direction: "up", value: (t) => sum(t, keys, "spend"), goal: (p) => planSpend(p, keys) },
    { key: `${prefix}Rev`, label: `${label} Revenue`, format: "currency0", direction: "up", value: (t) => sum(t, keys, "platformRevenue") },
    { key: `${prefix}Roas`, label: `${label} ROAS`, format: "ratio2", direction: "up", value: (t) => div(sum(t, keys, "platformRevenue"), sum(t, keys, "spend")) },
  ];
}

const FB_ACQ: ChannelKey[] = ["meta_acquisition"];
const FB_NON: ChannelKey[] = ["meta_returning"];
const G_ACQ: ChannelKey[] = ["google_nonbrand"];
const G_BRAND: ChannelKey[] = ["google_brand"];

export const CALENDAR_SPECS: MetricSpec[] = [
  fromMetric("cm", "cm"),
  fromMetric("rev", "orderRevenue", "ECommerce Revenue"),
  fromMetric("spend", "adSpend", "Total Spend"),
  fromMetric("mer", "mer", "Marketing Efficiency Rating"),
  fromMetric("acqRev", "newRevenue", "Acquisition Revenue"),
  fromMer("acqSpend", "acqSpend"),
  fromMetric("amer", "amer", "Acquisition MER"),
  fromMetric("retRev", "returningRevenue", "Returning Revenue"),
  fromMetric("aov", "aov"),
  fromMetric("cac", "weightedCac", "CAC"),
  fromMetric("email", "emailRevenue", "Email Rev"),
  fromMetric("sms", "smsRevenue", "SMS Rev"),
  fromMetric("organic", "organicRevenue", "Organic Rev"),
  ...platformRows("fbAcq", "Facebook Acq", FB_ACQ),
  ...platformRows("fbNonAcq", "Facebook Non-Acq", FB_NON),
  ...platformRows("fb", "Facebook", [...FB_ACQ, ...FB_NON]),
  ...platformRows("gAcq", "Google Acq", G_ACQ),
  ...platformRows("gBrand", "Google Brand", G_BRAND),
  ...platformRows("g", "Google", ["google_nonbrand", "google_brand", "google_nonbrand_returning", "google_brand_returning"]),
];

export type PresetId = "all" | "basic" | "social" | "search" | "mess" | "onlyGoals" | "hideGoals";
export type GoalsMode = "show" | "only" | "hide";

export interface CalendarPreset {
  id: PresetId;
  label: string;
  description: string;
  /** Columns the preset selects; null keeps the current ones. */
  keys: string[] | null;
  /** What the preset does to the goal columns. */
  goals: GoalsMode;
}

const keysStarting = (...prefixes: string[]) => CALENDAR_SPECS.filter((s) => prefixes.some((p) => s.key.startsWith(p))).map((s) => s.key);

export const CALENDAR_PRESETS: CalendarPreset[] = [
  { id: "all", label: "All Columns", description: "Selects all columns available", keys: CALENDAR_SPECS.map((s) => s.key), goals: "show" },
  { id: "basic", label: "Basic MER View", description: "Quick overview: Contribution Margin, Revenue, Spend, MER", keys: ["cm", "rev", "spend", "mer"], goals: "show" },
  { id: "social", label: "Social Ads", description: "Shows only social ad data (Facebook)", keys: keysStarting("fb"), goals: "show" },
  { id: "search", label: "Search Ads", description: "Shows only search ad data (Google)", keys: keysStarting("g").filter((k) => !k.startsWith("fb")), goals: "show" },
  { id: "mess", label: "Email/SMS/Organic", description: "Shows only these columns", keys: ["email", "sms", "organic"], goals: "show" },
  { id: "onlyGoals", label: "Only Goals", description: "Shows only goals for visible columns", keys: null, goals: "only" },
  { id: "hideGoals", label: "Hide Goals", description: "Hides goals for visible columns", keys: null, goals: "hide" },
];

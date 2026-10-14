import type { PlanMonth } from "./types";
import { CHANNEL_KEYS, type ChannelKey, type PlanTargetDay } from "../types";

/** Short names for the daily plan table: what the strategists call each line. */
export const DAILY_SPEND_LABELS: Record<ChannelKey, string> = {
  meta_acquisition: "Meta new",
  meta_returning: "Meta returning",
  google_nonbrand: "Google non-brand",
  google_brand: "Google brand",
  google_nonbrand_returning: "Google returning",
  google_brand_returning: "Google brand returning",
  pinterest: "Pinterest",
  pinterest_returning: "Pinterest returning",
  youtube: "YouTube",
  youtube_returning: "YouTube returning",
  bing: "Bing",
  bing_returning: "Bing returning",
  applovin: "AppLovin",
  applovin_returning: "AppLovin returning",
  tiktok: "TikTok",
  tiktok_returning: "TikTok returning",
  snapchat: "Snapchat",
  snapchat_returning: "Snapchat returning",
};

const FIRST: ChannelKey[] = ["meta_acquisition", "meta_returning", "google_nonbrand", "google_brand"];

/** The per-platform spend columns of a month's daily plan: Meta and Google first, then every other channel, only those that spend on at least one day. */
export function dailySpendColumns(rows: PlanTargetDay[]): { key: ChannelKey; label: string }[] {
  const order = [...FIRST, ...CHANNEL_KEYS.filter((k) => !FIRST.includes(k))];
  return order.filter((k) => rows.some((r) => (r.spendByChannel[k] ?? 0) > 0)).map((key) => ({ key, label: DAILY_SPEND_LABELS[key] }));
}

/** The month the Spend step opens on: today's month when the plan's year has it, else the first planned month, else the first. */
export function defaultSpendMonth(months: PlanMonth[], today: string): string {
  const current = `${today.slice(0, 7)}-01`;
  return (months.find((m) => m.month === current) ?? months.find((m) => m.inputs) ?? months[0]).month;
}

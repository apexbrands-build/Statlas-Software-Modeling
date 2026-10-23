/** Meta campaign launches for the Calendar Report: one entry per distinct campaign per day an ad was created (catalog ads left out). */
import { addDays, type Range } from "../dates";

export interface MetaLaunch {
  date: string;
  campaign: string;
}

export interface MetaAdRow {
  campaign_name: string | null;
  created_at: string | null;
  is_catalog: boolean | null;
}

export function mapMetaLaunches(rows: MetaAdRow[]): MetaLaunch[] {
  const seen = new Set<string>();
  const out: MetaLaunch[] = [];
  for (const r of rows) {
    if (r.is_catalog || !r.created_at) continue;
    const date = r.created_at.slice(0, 10);
    const campaign = r.campaign_name?.trim() || "Unnamed campaign";
    const key = `${date}|${campaign}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, campaign });
  }
  return out.sort((a, b) => (a.date === b.date ? a.campaign.localeCompare(b.campaign) : a.date < b.date ? -1 : 1));
}

const DEMO_CAMPAIGNS = ["UK12 | ABO | Creative testing", "US11 | ABO | Creative testing", "UK12 | CBO | Sale scale-up", "US11 | ABO | UGC testing"];

/** A launch every sixth day through the range, for the demo build. */
export function demoMetaLaunches(range: Range): MetaLaunch[] {
  const out: MetaLaunch[] = [];
  for (let d = addDays(range.from, 5), i = 0; d <= range.to; d = addDays(d, 6), i++) out.push({ date: d, campaign: DEMO_CAMPAIGNS[i % DEMO_CAMPAIGNS.length] });
  return out;
}

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

/** The calendar day of a timestamp in a time zone (the store's day, like the creative read functions use), as YYYY-MM-DD. */
function dayIn(timestamp: string, timeZone: string): string | null {
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  } catch {
    return timestamp.slice(0, 10);
  }
}

/** Launches by the store's day: a campaign created at 19:00 Pacific on Jan 6 is a Jan 6 launch although its UTC timestamp says Jan 7. Days outside `range` are dropped. */
export function mapMetaLaunches(rows: MetaAdRow[], timeZone = "UTC", range?: Range): MetaLaunch[] {
  const seen = new Set<string>();
  const out: MetaLaunch[] = [];
  for (const r of rows) {
    if (r.is_catalog || !r.created_at) continue;
    const date = dayIn(r.created_at, timeZone);
    if (!date || (range && (date < range.from || date > range.to))) continue;
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

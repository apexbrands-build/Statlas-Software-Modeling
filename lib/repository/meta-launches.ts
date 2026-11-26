/** Meta campaign launches for the Calendar Report: one entry per distinct campaign per day an ad was created (catalog ads left out). */
import { addDays, diffDays, eachDay, type Range } from "../dates";

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

/** A campaign that got new ads in one hour of the store's clock (the Hourly Report's markers). */
export interface MetaLaunchHour {
  date: string;
  /** 0 to 23, the store's clock. */
  hour: number;
  campaign: string;
  /** New ads created in the campaign in that hour. */
  ads: number;
}

/** The hour (0-23) of a timestamp in a time zone; null when it cannot be read. */
function hourIn(timestamp: string, timeZone: string): number | null {
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return null;
  try {
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(t));
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
  } catch {
    return t.getUTCHours();
  }
}

/** New ads per campaign, store day and hour: the same rows and rules as `mapMetaLaunches` (catalog ads left out, the store's own day), kept by the hour. */
export function mapMetaLaunchHours(rows: MetaAdRow[], timeZone = "UTC", range?: Range): MetaLaunchHour[] {
  const by = new Map<string, MetaLaunchHour>();
  for (const r of rows) {
    if (r.is_catalog || !r.created_at) continue;
    const date = dayIn(r.created_at, timeZone);
    const hour = hourIn(r.created_at, timeZone);
    if (!date || hour === null || (range && (date < range.from || date > range.to))) continue;
    const campaign = r.campaign_name?.trim() || "Unnamed campaign";
    const key = `${date}|${hour}|${campaign}`;
    const cur = by.get(key);
    if (cur) cur.ads += 1;
    else by.set(key, { date, hour, campaign, ads: 1 });
  }
  return [...by.values()].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.hour !== b.hour ? a.hour - b.hour : a.campaign.localeCompare(b.campaign)));
}

/** Demo launches by hour: every third day counted from a fixed date, so a day has the same launches whatever range is asked. */
export function demoMetaLaunchHours(range: Range): MetaLaunchHour[] {
  const out: MetaLaunchHour[] = [];
  for (const date of eachDay(range.from, range.to)) {
    const i = Math.abs(diffDays("2024-01-01", date));
    if (i % 3 !== 0) continue;
    out.push({ date, hour: 9 + (i % 5), campaign: DEMO_CAMPAIGNS[i % DEMO_CAMPAIGNS.length], ads: 3 + (i % 4) });
  }
  return out;
}

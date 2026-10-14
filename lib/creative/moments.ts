/** Moments: calendar events (except email and SMS sends) that need their own new ads. Computed at read time, nothing stored. */
import { addDays, endOfMonth, startOfMonth } from "../dates";
import { eventDays, type MarketingEvent } from "../planning/events";

export const MOMENT_EXCLUDED_TYPES = ["email", "sms"];
export const MOMENTS_CAP = 0.3;
export const DEFAULT_LEAD_DAYS = 14;

export function isMoment(e: MarketingEvent): boolean {
  return !MOMENT_EXCLUDED_TYPES.includes(e.type);
}

/** Distinct moment days in the month / days in the month, capped (default 30%). */
export function momentsShare(month: string, events: MarketingEvent[], cap: number = MOMENTS_CAP): { share: number; days: number; capped: boolean } {
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const set = new Set<string>();
  for (const e of events) {
    if (!isMoment(e)) continue;
    for (const d of eventDays(e)) if (d >= from && d <= to) set.add(d);
  }
  const daysInMonth = Number(to.slice(8, 10));
  const raw = set.size / daysInMonth;
  const capped = raw > cap;
  return { share: capped ? cap : raw, days: set.size, capped };
}

/** A moment ad was launched within `leadDays` before a moment or inside it. */
export function isMomentAd(launchDate: string, events: MarketingEvent[], leadDays: number = DEFAULT_LEAD_DAYS): boolean {
  return events.some((e) => {
    if (!isMoment(e)) return false;
    const end = e.endDate >= e.date ? e.endDate : e.date;
    return launchDate >= addDays(e.date, -leadDays) && launchDate <= end;
  });
}

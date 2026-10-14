import { dayOfWeek, eachDay, endOfMonth } from "../dates";
import { eventDays, type DayMultipliers, type MarketingEvent } from "./events";

const WEEK_STARTS: Record<string, number> = { Sunday: 0, Monday: 1, Saturday: 6 };
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const startIndex = (weekStart: string) => WEEK_STARTS[weekStart] ?? 1;

/** The weekday names of the grid header, starting on the store's first day of the week (Monday, Sunday or Saturday; anything else is Monday). */
export function weekdayLabels(weekStart: string): string[] {
  const s = startIndex(weekStart);
  return Array.from({ length: 7 }, (_, i) => SHORT[(s + i) % 7]);
}

/** A month as rows of 7 cells starting on the store's first day of the week: each cell is a date, or null for the blanks before the 1st and after the last day. */
export function monthWeeks(month: string, weekStart: string = "Monday"): (string | null)[][] {
  const first = `${month.slice(0, 8)}01`;
  const days = eachDay(first, endOfMonth(first));
  const lead = (dayOfWeek(first) - startIndex(weekStart) + 7) % 7;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
}

export type DayHeat = "hot" | "warm" | "cool" | "flat";

/** How strongly the event model moves a day: hot = a lift of 25% or more in spend, aMER or returning revenue, warm = 5% or more, cool = the day only runs below normal. */
export function dayHeat(m: DayMultipliers | undefined): DayHeat {
  if (!m) return "flat";
  const peak = Math.max(m.spend, m.amer, m.returning);
  if (peak >= 1.25) return "hot";
  if (peak >= 1.05) return "warm";
  if (Math.min(m.spend, m.amer, m.returning) <= 0.95) return "cool";
  return "flat";
}

/** Events touching each month of `year` (index 0 = January); an event that spans two months counts once in each. */
export function monthEventCounts(events: MarketingEvent[], year: number): number[] {
  const counts = new Array<number>(12).fill(0);
  for (const e of events) {
    const months = new Set(eventDays(e).filter((d) => d.startsWith(`${year}-`)).map((d) => Number(d.slice(5, 7)) - 1));
    for (const m of months) counts[m] += 1;
  }
  return counts;
}

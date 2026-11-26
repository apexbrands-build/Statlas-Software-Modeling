import { validTimeZone, yesterdayLocal } from "./sync-schedule";

/**
 * "The last day with data", for Home, the reports, the plan comparison, the trackers and the plan editor: the latest day whose daily row
 * holds the whole day. Pure (no database) so it can be unit tested; `getLastDataDate` in `lib/repository/supabase.ts` applies it.
 *
 * A daily row can exist for a day that is still running: the Shopify store page loads today on purpose (and writes today's row), and so
 * does the Sync button in Store Settings late in a US store's day. Read as a finished day, a few hours of sales would be set against a
 * whole day's target. So a day counts only when (1) it is over on the store's own clock and (2) its row was built after it ended: a
 * row built at 15:00 holds the day up to 15:00 until the daily sync rebuilds it after midnight.
 */

/** The latest day that is over on the store's clock: its yesterday (`clients.timezone`; UTC when missing or unknown). */
export function lastCompleteDay(now: Date, timeZone: string | null | undefined): string {
  return yesterdayLocal(now, validTimeZone(timeZone));
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
function offsetMs(t: number, zone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

/** The instant a calendar day ('YYYY-MM-DD') begins on the store's clock, right on daylight-saving change days too. */
export function localMidnight(date: string, timeZone: string | null | undefined): Date {
  const zone = validTimeZone(timeZone);
  const wall = Date.parse(`${date}T00:00:00Z`);
  // The offset is read at a first guess, then again at the instant it gives: the second reading is the one in force at that midnight.
  const guess = wall - offsetMs(wall, zone);
  return new Date(wall - offsetMs(guess, zone));
}

export interface DailyRowStamp {
  date: string;
  /** When the row was last built (`daily_facts.updated_at`); null when unknown. */
  updatedAt: string | null;
}

/** True when the day's row was last built after the day ended on the store's clock, so it holds the whole day. An unknown build time is taken as whole. */
export function holdsWholeDay(row: DailyRowStamp, timeZone: string | null | undefined): boolean {
  if (!row.updatedAt) return true;
  const built = Date.parse(row.updatedAt);
  if (Number.isNaN(built)) return true;
  const nextDay = new Date(Date.parse(`${row.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return built >= localMidnight(nextDay, timeZone).getTime();
}

/**
 * The last day with data, from the newest daily rows (none later than `lastCompleteDay`): the newest one that holds its whole day.
 * If none of the rows given does (the daily sync has not run for days), the newest is returned rather than nothing; null when there are no rows.
 */
export function lastDataDate(rows: DailyRowStamp[], timeZone: string | null | undefined): string | null {
  const newestFirst = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return (newestFirst.find((r) => holdsWholeDay(r, timeZone)) ?? newestFirst[0])?.date ?? null;
}

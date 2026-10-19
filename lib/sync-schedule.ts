/** When each store's daily sync is due. Pure (no database, no server imports) so it can be unit tested; the tick route applies it.
 *  A store's day ends at its own midnight (clients.timezone, from Shopify), so the sync for "yesterday" is due a few minutes after that
 *  midnight, wherever the store is. The hourly tick starts it on the first run after that. */

/** Minutes after local midnight before yesterday counts as settled (late-processing orders, ad platform lag). */
export const SETTLE_MINUTES = 15;
/** A failed daily job is retried after this many hours (instead of every tick, which would raise the failure count at once). */
export const RETRY_AFTER_HOURS = 3;

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function localParts(now: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** The store's calendar date right now, 'YYYY-MM-DD'. */
export function localDate(now: Date, tz: string): string {
  const { y, m, d } = localParts(now, validTimeZone(tz));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The store's previous calendar day, 'YYYY-MM-DD': the last complete day, which the daily sync loads. */
export function yesterdayLocal(now: Date, tz: string): string {
  const today = localDate(now, tz);
  return new Date(new Date(`${today}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

/** The instant (UTC) at which the store's current calendar day began. Uses the offset in force now, so on a daylight-saving change day it can be an hour off. */
export function localDayStart(now: Date, tz: string): Date {
  const { y, m, d, h, mi, s } = localParts(now, validTimeZone(tz));
  const offsetMs = Date.UTC(y, m - 1, d, h, mi, s) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(y, m - 1, d) - offsetMs);
}

export interface RecentJob {
  createdAt: Date;
  status: "queued" | "running" | "done" | "error" | "cancelled";
}

/** True when this connection's daily sync should be started now: the store's day has rolled over and settled, and no daily ("recent") job
 *  has been started since that midnight. A job that is queued, running, done or was cancelled on purpose counts as today's sync; a failed one
 *  only blocks a retry for RETRY_AFTER_HOURS. */
export function dailySyncDue(now: Date, tz: string, recentJobs: RecentJob[]): boolean {
  const start = localDayStart(now, tz);
  if (now.getTime() < start.getTime() + SETTLE_MINUTES * 60_000) return false;
  return !recentJobs.some((j) => {
    if (j.createdAt.getTime() < start.getTime()) return false;
    if (j.status !== "error") return true;
    return now.getTime() - j.createdAt.getTime() < RETRY_AFTER_HOURS * 3_600_000;
  });
}

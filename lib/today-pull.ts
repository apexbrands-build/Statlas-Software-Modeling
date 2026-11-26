/** The hourly pull of today's orders: which stores, in what order and inside what time budget. Pure (no database, no server imports) so it
 *  can be unit tested; the tick route (`app/api/jobs/tick/route.ts`) applies it and `syncShopify` with `todayPull` does one store's pull.
 *
 *  The daily sync loads each store up to its yesterday. The Hourly report reads today's orders by hour, so every tick also loads the orders
 *  placed since the last one. A pull is not a sync job: it writes no `sync_jobs` row and never touches the connection's status, failure
 *  count or coverage, so it cannot raise "Needs attention" or change when the daily sync is due. It writes orders only, never today's
 *  `daily_facts` row: the daily rollup stays the daily sync's job, on days that are over. */

/** Stores pulled at the same time. */
export const TODAY_PULL_CONCURRENCY = 4;
/** One store's order fetch stops after this long. What it has by then is saved, and the next tick carries on from the last order loaded. */
export const TODAY_PULL_FETCH_MS = 25_000;
/** A store that has still not finished after this long gives its place to the next one (its own task is left to end by itself). */
export const TODAY_PULL_STORE_MS = 60_000;
/** No store is started once this much of the tick has passed (the tick's task is cut off at 300 s). Stores not reached go first next time. */
export const TODAY_PULL_BUDGET_MS = 200_000;
/** A pull starts this long before the last order already loaded: Shopify's order search can trail the newest orders by a moment. */
export const TODAY_PULL_OVERLAP_MS = 10 * 60_000;
/** A sync run that began less than this long ago and has not ended is taken as still working on the store. */
export const SYNC_IN_FLIGHT_MS = 5 * 60_000;
/**
 * Connection statuses that get pulled: the ones the tick keeps syncing. "error" only says the last sync failed (the tick retries it); on a
 * day like Black Friday a failed nightly sync must not also blank the day's hours. A pull never changes the status either way.
 * "disconnected" (app uninstalled) and "pending" are left alone.
 */
export const TODAY_PULL_STATUSES: readonly string[] = ["connected", "error"];

export interface PullConnection {
  id: string;
  provider: string;
  status: string;
}

/** A row of `sync_runs`: every Shopify sync (a job's chunk, the store page, a pull) writes one when it starts. */
export interface RecentRun {
  integrationId: string;
  status: string;
  startedAt: Date;
}

export interface TodayPullPlan {
  /** Connections to pull now, the one waiting longest first. */
  pull: string[];
  /** Left out: a sync job is queued or running for the connection (the job loads the same orders). */
  busy: number;
  /** Left out: another task started a sync of the store moments ago and has not finished (the store page, or the same tick delivered twice). */
  inFlight: number;
}

/**
 * Which connections get today's orders pulled on this tick. Only Shopify stores the tick keeps syncing (TODAY_PULL_STATUSES); never one with a
 * sync job queued or running, and never one another task is syncing right now. Ordered by the last time anything synced the store (never = first), so when a tick runs out
 * of time the stores it did not reach are first in line on the next one.
 */
export function planTodayPulls(input: { now: Date; connections: PullConnection[]; busyIds: Iterable<string>; runs: RecentRun[] }): TodayPullPlan {
  const busyIds = new Set(input.busyIds);
  const lastRun = new Map<string, number>();
  const inFlightIds = new Set<string>();
  for (const r of input.runs) {
    const t = r.startedAt.getTime();
    if (Number.isNaN(t)) continue;
    if (t > (lastRun.get(r.integrationId) ?? 0)) lastRun.set(r.integrationId, t);
    if (r.status === "running" && input.now.getTime() - t < SYNC_IN_FLIGHT_MS) inFlightIds.add(r.integrationId);
  }
  const pull: string[] = [];
  let busy = 0;
  let inFlight = 0;
  for (const c of input.connections) {
    if (c.provider !== "shopify" || !TODAY_PULL_STATUSES.includes(c.status)) continue;
    if (busyIds.has(c.id)) busy++;
    else if (inFlightIds.has(c.id)) inFlight++;
    else pull.push(c.id);
  }
  pull.sort((a, b) => (lastRun.get(a) ?? 0) - (lastRun.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  return { pull, busy, inFlight };
}

/**
 * The instant a pull asks Shopify for orders from: the last order already loaded today minus the overlap, never before the start of the
 * store's day (yesterday belongs to the daily sync) and never in the future. With no order loaded today yet it is the start of the day.
 */
export function todaySince(now: Date, dayStart: Date, lastLoaded: Date | null, overlapMs: number = TODAY_PULL_OVERLAP_MS): Date {
  const last = lastLoaded ? lastLoaded.getTime() : Number.NaN;
  if (Number.isNaN(last)) return dayStart;
  const from = Math.min(last, now.getTime()) - overlapMs;
  return from > dayStart.getTime() ? new Date(from) : dayStart;
}

export interface PullResults<T> {
  done: { id: string; result: T }[];
  failed: { id: string; error: string }[];
  /** The time budget ran out before these could start. */
  notReached: string[];
}

/**
 * Runs `pull` for each id, at most `concurrency` at a time, and never rejects: a store that fails or does not answer inside `storeMs` is
 * recorded and the others carry on. `mayStart` is asked before each store; once it says no, the stores left are reported as not reached.
 */
export async function runPulls<T>(
  ids: string[],
  opts: { pull: (id: string) => Promise<T>; mayStart: () => boolean; concurrency?: number; storeMs?: number },
): Promise<PullResults<T>> {
  const out: PullResults<T> = { done: [], failed: [], notReached: [] };
  const storeMs = opts.storeMs ?? TODAY_PULL_STORE_MS;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= ids.length) return;
      const id = ids[i];
      let go = false;
      try {
        go = opts.mayStart();
      } catch {
        go = false;
      }
      if (!go) {
        out.notReached.push(id);
        continue;
      }
      try {
        out.done.push({ id, result: await withTimeout(() => opts.pull(id), storeMs) });
      } catch (e) {
        out.failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? TODAY_PULL_CONCURRENCY, ids.length)) }, worker));
  return out;
}

/** The task's result, or a rejection once `ms` has passed. A task that loses the race is left to end by itself; its late failure is swallowed. */
function withTimeout<T>(task: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT: no answer after ${Math.round(ms / 1000)} s`)), ms);
    let running: Promise<T>;
    try {
      running = Promise.resolve(task());
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    running.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** One line for the server log: how the tick's pulls ended. */
export function pullSummary(results: PullResults<{ orders: number; partial?: boolean; skipped?: boolean }>): string {
  const partial = results.done.filter((d) => d.result.partial).length;
  const skipped = results.done.filter((d) => d.result.skipped).length;
  const orders = results.done.reduce((a, d) => a + (d.result.orders || 0), 0);
  const parts = [`${results.done.length - skipped} pulled (${orders} orders${partial ? `, ${partial} with more to load` : ""})`];
  if (skipped) parts.push(`${skipped} skipped (a sync job started)`);
  if (results.failed.length) parts.push(`${results.failed.length} failed: ${results.failed.map((f) => `${f.id} ${f.error.slice(0, 80)}`).join("; ")}`);
  if (results.notReached.length) parts.push(`${results.notReached.length} not reached`);
  return `today's orders: ${parts.join(", ")}`;
}

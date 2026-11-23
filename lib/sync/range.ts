/** A date range for a sync. Either explicit from/to, or the last `days` days ending yesterday (or the caller's `lastDay`). */
export interface SyncRange {
  from: string;
  to: string;
}

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `lastDay` lets a caller include a later day than yesterday (the store page passes the store's today so orders placed
 * minutes ago show up); scheduled and history syncs leave it out and stop at yesterday as before.
 */
export function resolveRange(body: { from?: string; to?: string; days?: number }, defaultDays: number, lastDay?: string): SyncRange {
  const end = lastDay && DATE.test(lastDay) ? lastDay : addDays(new Date().toISOString().slice(0, 10), -1);
  if (body.from && body.to && DATE.test(body.from) && DATE.test(body.to) && body.from <= body.to) {
    return { from: body.from, to: body.to > end ? end : body.to };
  }
  const days = Math.min(Math.max(body.days ?? defaultDays, 1), 800);
  return { from: addDays(end, -(days - 1)), to: end };
}

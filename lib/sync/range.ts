/** A date range for a sync. Either explicit from/to, or the last `days` days ending yesterday. */
export interface SyncRange {
  from: string;
  to: string;
}

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveRange(body: { from?: string; to?: string; days?: number }, defaultDays: number): SyncRange {
  const yesterday = addDays(new Date().toISOString().slice(0, 10), -1);
  if (body.from && body.to && DATE.test(body.from) && DATE.test(body.to) && body.from <= body.to) {
    return { from: body.from, to: body.to > yesterday ? yesterday : body.to };
  }
  const days = Math.min(Math.max(body.days ?? defaultDays, 1), 800);
  return { from: addDays(yesterday, -(days - 1)), to: yesterday };
}

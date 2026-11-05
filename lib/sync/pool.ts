/**
 * Runs `fn` over `items` with at most `limit` calls in flight, starting them in order. Results keep the order of `items`.
 * The first rejection rejects the whole call and stops new items from starting (calls already in flight finish on their own).
 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    for (;;) {
      if (failed) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

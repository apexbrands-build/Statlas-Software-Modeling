const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Sets one platform to `value` % and rescales the other unlocked platforms so everything still adds to 100.
 * Locked platforms keep their share. If the others are all 0, they share the remainder equally.
 */
export function rebalance(pct: Record<string, number>, keys: string[], locked: string[], key: string, value: number): Record<string, number> {
  const lockedSum = keys.filter((k) => k !== key && locked.includes(k)).reduce((a, k) => a + (pct[k] ?? 0), 0);
  const v = Math.min(Math.max(0, value), Math.max(0, 100 - lockedSum));
  const others = keys.filter((k) => k !== key && !locked.includes(k));
  const remaining = 100 - v - lockedSum;
  const othersSum = others.reduce((a, k) => a + (pct[k] ?? 0), 0);
  const out: Record<string, number> = { ...pct, [key]: round2(v) };
  for (const k of others) {
    out[k] = round2(othersSum > 0 ? ((pct[k] ?? 0) / othersSum) * remaining : others.length ? remaining / others.length : 0);
  }
  return out;
}

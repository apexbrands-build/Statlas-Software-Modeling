/** A Shopify sales channel found on a client's orders. */
export interface OrderChannel {
  channel: string;
  orders: number;
}

/**
 * The channel switches Store Settings offers: every channel found on the store's orders (most orders first), then channels that are
 * switched on but have no orders yet (the defaults of a new store). Names match case-insensitively, as the sync does; the spelling
 * found on the orders wins.
 */
export function channelOptions(found: OrderChannel[], selected: string[]): OrderChannel[] {
  const seen = new Set<string>();
  const out: OrderChannel[] = [];
  for (const f of [...found].sort((a, b) => b.orders - a.orders || a.channel.localeCompare(b.channel))) {
    const key = f.channel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  for (const s of selected) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ channel: s, orders: 0 });
  }
  return out;
}

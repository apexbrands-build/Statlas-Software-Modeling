/**
 * Whether an order's sales channel counts as direct-to-consumer.
 * On a partner development store every channel except Point of Sale counts: orders there are created by hand
 * (admin, draft orders, import apps), so the configured list ("Online Store", "Shop") would leave Home empty.
 */
export function isDtcChannel(channel: string, configured: Set<string>, devStore: boolean): boolean {
  const c = channel.toLowerCase();
  return configured.has(c) || (devStore && c !== "point of sale");
}

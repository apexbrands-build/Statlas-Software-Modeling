export interface OrderForClassification {
  orderId: string;
  customerId: string | null;
  customerLifetimeOrders: number | null;
  createdAt: string;
}

/**
 * Marks first orders. A customer's earlier orders (before the window) = lifetime orders - orders inside the window.
 * Guest checkouts count as new. Without lifetime counts the classification is approximate (window only).
 */
export function markFirstOrders(orders: OrderForClassification[]): Map<string, boolean> {
  const sorted = [...orders].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const inWindow = new Map<string, number>();
  for (const o of sorted) if (o.customerId) inWindow.set(o.customerId, (inWindow.get(o.customerId) ?? 0) + 1);
  const seen = new Set<string>();
  const result = new Map<string, boolean>();
  for (const o of sorted) {
    if (!o.customerId) {
      result.set(o.orderId, true);
      continue;
    }
    const before = o.customerLifetimeOrders === null ? 0 : Math.max(0, o.customerLifetimeOrders - (inWindow.get(o.customerId) ?? 0));
    const first = before === 0 && !seen.has(o.customerId);
    seen.add(o.customerId);
    result.set(o.orderId, first);
  }
  return result;
}

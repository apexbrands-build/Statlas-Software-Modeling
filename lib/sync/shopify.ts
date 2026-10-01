import "server-only";
import { shopifyGraphql } from "@/lib/shopify";

// Read-only Shopify pulls. No names, emails or addresses are requested: only ids, money, tags and timing.

interface Money {
  shopMoney: { amount: string };
}
interface OrderNode {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  tags: string[];
  sourceName: string | null;
  channelInformation?: { channelDefinition?: { channelName: string | null } | null } | null;
  customer?: { id: string; numberOfOrders?: string } | null;
  totalPriceSet: Money;
  subtotalPriceSet: Money;
  totalDiscountsSet: Money;
  totalShippingPriceSet: Money;
  totalTaxSet: Money;
  totalRefundedSet: Money;
  taxesIncluded: boolean;
  refunds: { id: string; createdAt: string; totalRefundedSet: Money; refundLineItems: { nodes: { subtotalSet: Money }[] } }[];
  lineItems: { nodes: { quantity: number; variant: { id: string } | null; discountedTotalSet: Money }[] };
}
interface OrdersPage {
  orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] };
}

const num = (m: Money | undefined) => Number(m?.shopMoney.amount ?? 0);
export const numericId = (gid: string) => gid.split("/").pop() ?? gid;

const orderFields = (withCustomerCount: boolean) => `
  id createdAt cancelledAt test tags sourceName
  channelInformation { channelDefinition { channelName } }
  customer { id ${withCustomerCount ? "numberOfOrders" : ""} }
  totalPriceSet { shopMoney { amount } }
  subtotalPriceSet { shopMoney { amount } }
  totalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  taxesIncluded
  refunds { id createdAt totalRefundedSet { shopMoney { amount } } refundLineItems(first: 100) { nodes { subtotalSet { shopMoney { amount } } } } }
  lineItems(first: 100) { nodes { quantity variant { id } discountedTotalSet { shopMoney { amount } } } }`;

export interface VariantCost {
  variantId: string;
  sku: string | null;
  title: string;
  unitCost: number | null;
}

export async function fetchVariantCosts(shop: string, token: string): Promise<VariantCost[]> {
  const out: VariantCost[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { id: string; sku: string | null; title: string; product: { title: string }; inventoryItem: { unitCost: { amount: string } | null } | null }[];
      };
    } = await shopifyGraphql(
      shop,
      token,
      `query($cursor: String) { productVariants(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id sku title product { title } inventoryItem { unitCost { amount } } } } }`,
      { cursor },
    );
    for (const v of data.productVariants.nodes) {
      out.push({
        variantId: numericId(v.id),
        sku: v.sku,
        title: `${v.product.title}${v.title && v.title !== "Default Title" ? ` - ${v.title}` : ""}`,
        unitCost: v.inventoryItem?.unitCost ? Number(v.inventoryItem.unitCost.amount) : null,
      });
    }
    if (!data.productVariants.pageInfo.hasNextPage) break;
    cursor = data.productVariants.pageInfo.endCursor;
  }
  return out;
}

export interface RawOrder {
  orderId: string;
  customerId: string | null;
  customerLifetimeOrders: number | null;
  createdAt: string;
  channel: string;
  tags: string[];
  /** Order Revenue = gross - discounts + shipping + tax, refunds NOT deducted (Shopify "total sales" before returns). */
  orderRevenue: number;
  subtotal: number; // after discounts, before shipping and tax
  discounts: number;
  shipping: number;
  tax: number;
  totalRefunded: number;
  refunds: { id: string; createdAt: string; total: number; itemsSubtotal: number }[];
  lines: { variantId: string | null; quantity: number; sales: number }[];
}

const SOURCE_TO_CHANNEL: Record<string, string> = {
  web: "Online Store",
  pos: "Point of Sale",
  shopify_draft_order: "Draft Orders",
  iphone: "Online Store",
  android: "Online Store",
};

/** Orders matching a Shopify search query. Without the read_all_orders scope Shopify only exposes the last 60 days. */
export async function fetchOrders(shop: string, token: string, searchQuery: string): Promise<{ orders: RawOrder[]; approximateNewReturning: boolean }> {
  const out: RawOrder[] = [];
  let withCount = true;
  let approximate = false;
  let cursor: string | null = null;
  for (;;) {
    const queryFor = (c: boolean) => `query($cursor: String, $q: String!) { orders(first: 50, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor } nodes { ${orderFields(c)} } } }`;
    let data: OrdersPage;
    try {
      data = await shopifyGraphql<OrdersPage>(shop, token, queryFor(withCount), { cursor, q: searchQuery });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (withCount && /ACCESS_DENIED|protected|not approved/i.test(msg)) {
        withCount = false;
        approximate = true;
        continue;
      }
      throw e;
    }
    for (const o of data.orders.nodes) {
      if (o.test || o.cancelledAt) continue;
      const channel = o.channelInformation?.channelDefinition?.channelName ?? SOURCE_TO_CHANNEL[o.sourceName ?? ""] ?? o.sourceName ?? "Unknown";
      const subtotal = num(o.subtotalPriceSet);
      const shipping = num(o.totalShippingPriceSet);
      const tax = num(o.totalTaxSet);
      out.push({
        orderId: numericId(o.id),
        customerId: o.customer ? numericId(o.customer.id) : null,
        customerLifetimeOrders: o.customer?.numberOfOrders !== undefined ? Number(o.customer.numberOfOrders) : null,
        createdAt: o.createdAt,
        channel,
        tags: o.tags,
        // Tax-inclusive stores already have tax inside the subtotal, so it is not added twice.
        orderRevenue: subtotal + shipping + (o.taxesIncluded ? 0 : tax),
        subtotal,
        discounts: num(o.totalDiscountsSet),
        shipping,
        tax,
        totalRefunded: num(o.totalRefundedSet),
        refunds: o.refunds.map((r) => ({
          id: numericId(r.id),
          createdAt: r.createdAt,
          total: num(r.totalRefundedSet),
          itemsSubtotal: r.refundLineItems.nodes.reduce((sum, n) => sum + num(n.subtotalSet), 0),
        })),
        lines: o.lineItems.nodes.map((l) => ({ variantId: l.variant ? numericId(l.variant.id) : null, quantity: l.quantity, sales: num(l.discountedTotalSet) })),
      });
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return { orders: out, approximateNewReturning: approximate };
}


/** Scopes the store actually granted (read_all_orders decides how far back orders can be read). */
export async function fetchGrantedScopes(shop: string, token: string): Promise<string[]> {
  const data = await shopifyGraphql<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>(shop, token, "{ currentAppInstallation { accessScopes { handle } } }");
  return data.currentAppInstallation.accessScopes.map((s) => s.handle);
}

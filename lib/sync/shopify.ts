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
  lineItems: { nodes: { quantity: number; variant: { id: string } | null }[] };
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
  lineItems(first: 100) { nodes { quantity variant { id } } }`;

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
  orderRevenue: number; // total price: net sales + shipping + tax + refunds (refunds not deducted)
  subtotal: number;
  discounts: number;
  shipping: number;
  tax: number;
  refunds: number;
  lines: { variantId: string | null; quantity: number }[];
}

const SOURCE_TO_CHANNEL: Record<string, string> = {
  web: "Online Store",
  pos: "Point of Sale",
  shopify_draft_order: "Draft Orders",
  iphone: "Online Store",
  android: "Online Store",
};

/** Orders created since `sinceIso` (Shopify only exposes the last 60 days without the read_all_orders scope). */
export async function fetchOrders(shop: string, token: string, sinceIso: string): Promise<{ orders: RawOrder[]; approximateNewReturning: boolean }> {
  const out: RawOrder[] = [];
  let withCount = true;
  let approximate = false;
  let cursor: string | null = null;
  for (;;) {
    const queryFor = (c: boolean) => `query($cursor: String, $q: String!) { orders(first: 50, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor } nodes { ${orderFields(c)} } } }`;
    let data: OrdersPage;
    try {
      data = await shopifyGraphql<OrdersPage>(shop, token, queryFor(withCount), { cursor, q: `created_at:>=${sinceIso}` });
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
      out.push({
        orderId: numericId(o.id),
        customerId: o.customer ? numericId(o.customer.id) : null,
        customerLifetimeOrders: o.customer?.numberOfOrders !== undefined ? Number(o.customer.numberOfOrders) : null,
        createdAt: o.createdAt,
        channel,
        tags: o.tags,
        orderRevenue: num(o.totalPriceSet),
        subtotal: num(o.subtotalPriceSet),
        discounts: num(o.totalDiscountsSet),
        shipping: num(o.totalShippingPriceSet),
        tax: num(o.totalTaxSet),
        refunds: num(o.totalRefundedSet),
        lines: o.lineItems.nodes.map((l) => ({ variantId: l.variant ? numericId(l.variant.id) : null, quantity: l.quantity })),
      });
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return { orders: out, approximateNewReturning: approximate };
}

export { markFirstOrders } from "./first-orders";

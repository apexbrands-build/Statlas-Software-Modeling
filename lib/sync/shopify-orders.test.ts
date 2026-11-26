import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graphql = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/shopify", () => ({ shopifyGraphql: graphql }));

const { fetchOrders } = await import("./shopify");

const money = (amount: number) => ({ shopMoney: { amount: String(amount) } });
const node = (id: number) => ({
  id: `gid://shopify/Order/${id}`,
  createdAt: `2026-11-27T07:${String(id).padStart(2, "0")}:00Z`,
  processedAt: null,
  cancelledAt: null,
  test: false,
  tags: [],
  sourceName: "web",
  customer: { id: `gid://shopify/Customer/${id}`, numberOfOrders: "1" },
  totalPriceSet: money(100),
  subtotalPriceSet: money(90),
  totalDiscountsSet: money(0),
  totalShippingPriceSet: money(5),
  totalTaxSet: money(5),
  totalRefundedSet: money(0),
  taxesIncluded: false,
  refunds: [],
  lineItems: { nodes: [] },
});

/** Three pages of one order each; every page takes ten seconds to come back. */
function threeSlowPages() {
  let page = 0;
  graphql.mockImplementation(async () => {
    page++;
    vi.setSystemTime(Date.now() + 10_000);
    return { orders: { pageInfo: { hasNextPage: page < 3, endCursor: `cursor${page}` }, nodes: [node(page)] } };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-27T21:10:00Z"));
  graphql.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("fetchOrders at its deadline", () => {
  it("still fails as before when the caller did not ask for a partial result (the daily sync retries a smaller piece)", async () => {
    threeSlowPages();
    await expect(fetchOrders("s.myshopify.com", "tok", "created_at:>=2026-11-26", Date.now() + 15_000)).rejects.toThrow("TIMEOUT: too many orders for one task");
  });

  it("returns the orders read so far, oldest first, when a partial result is allowed", async () => {
    threeSlowPages();
    const got = await fetchOrders("s.myshopify.com", "tok", "created_at:>='2026-11-27T07:00:00Z'", Date.now() + 15_000, false, true);
    expect(got.truncated).toBe(true);
    expect(got.orders.map((o) => o.orderId)).toEqual(["1", "2"]);
    expect(graphql).toHaveBeenCalledTimes(2);
  });

  it("is not marked truncated when everything fit", async () => {
    threeSlowPages();
    const got = await fetchOrders("s.myshopify.com", "tok", "created_at:>='2026-11-27T07:00:00Z'", Date.now() + 60_000, false, true);
    expect(got.truncated).toBe(false);
    expect(got.orders.map((o) => o.orderId)).toEqual(["1", "2", "3"]);
  });

  it("returns nothing, marked truncated, when the time was already up", async () => {
    threeSlowPages();
    const got = await fetchOrders("s.myshopify.com", "tok", "q", Date.now() - 1, false, true);
    expect(got).toEqual({ orders: [], approximateNewReturning: false, truncated: true });
    expect(graphql).not.toHaveBeenCalled();
  });

  it("asks Shopify for the oldest orders first, which is what lets a cut-off pull carry on from its last order", async () => {
    threeSlowPages();
    await fetchOrders("s.myshopify.com", "tok", "q");
    expect(String(graphql.mock.calls[0][2])).toContain("sortKey: CREATED_AT");
    expect(String(graphql.mock.calls[0][2])).not.toContain("reverse");
  });
});

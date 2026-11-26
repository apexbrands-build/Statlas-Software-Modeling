import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawOrder } from "./shopify";

/** One call to the database: what it was (`select`, `insert`, `update`, `upsert` or `rpc`), on which table or function, with which values and filters. */
interface Op {
  kind: "select" | "insert" | "update" | "upsert" | "rpc";
  target: string;
  values?: unknown;
  filters: [string, ...unknown[]][];
}
type Answer = { data?: unknown; error?: { code?: string; message: string } | null };

const state = vi.hoisted(() => ({
  ops: [] as Op[],
  timezone: "America/Denver" as string | null,
  lastOrderToday: null as string | null,
  activeJobs: [] as { id: string }[],
  /** Overrides the answer of one call; return undefined to keep the default. */
  answer: undefined as undefined | ((op: Op) => Answer | undefined),
}));

const shopify = vi.hoisted(() => ({ fetchOrders: vi.fn(), fetchVariantCosts: vi.fn(), fetchIsDevStore: vi.fn(), fetchGrantedScopes: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/crypto", () => ({ decrypt: () => JSON.stringify({ access_token: "tok", scope: "read_orders" }), encrypt: (s: string) => s }));
vi.mock("@/lib/shopify-installs", () => ({ freshTokens: async (_shop: string, tokens: unknown) => tokens, saveInstallTokens: async () => {} }));
vi.mock("./shopify", () => shopify);
vi.mock("@/lib/supabase/server", () => {
  const defaults = (op: Op): Answer => {
    if (op.kind !== "select") return { data: op.target === "sync_runs" ? { id: "run1" } : null, error: null };
    switch (op.target) {
      case "integrations":
        return { data: { id: "i1", client_id: "c1", provider: "shopify", account_id: "store.myshopify.com", coverage_start: "2026-01-01", coverage_end: "2026-11-26" }, error: null };
      case "integration_secrets":
        return { data: { ciphertext: "x" }, error: null };
      case "clients":
        return { data: { timezone: state.timezone }, error: null };
      case "orders":
        return { data: state.lastOrderToday ? [{ created_at: state.lastOrderToday }] : [], error: null };
      case "sync_jobs":
        return { data: state.activeJobs, error: null };
      default:
        return { data: null, error: null };
    }
  };
  const settle = (op: Op): Answer => {
    state.ops.push(op);
    return state.answer?.(op) ?? defaults(op);
  };
  const query = (target: string) => {
    const op: Op = { kind: "select", target, filters: [] };
    const q: Record<string, unknown> = {};
    for (const write of ["insert", "update", "upsert"] as const) {
      q[write] = (values: unknown) => {
        op.kind = write;
        op.values = values;
        return q;
      };
    }
    for (const filter of ["select", "eq", "gt", "gte", "lte", "in", "order", "limit"]) {
      q[filter] = (...args: unknown[]) => {
        if (filter !== "select") op.filters.push([filter, ...args]);
        return q;
      };
    }
    q.single = async () => settle(op);
    q.maybeSingle = async () => settle(op);
    q.then = (resolve: (v: Answer) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(settle(op)).then(resolve, reject);
    return q;
  };
  return { getAdminClient: () => ({ from: query, rpc: async (fn: string, args: unknown) => settle({ kind: "rpc", target: fn, values: args, filters: [] }) }) };
});

const { syncShopify } = await import("./run-shopify");

const order = (id: string, createdAt: string, extra: Partial<RawOrder> = {}): RawOrder => ({
  orderId: id,
  customerId: `cust-${id}`,
  customerLifetimeOrders: 1,
  createdAt,
  channel: "Online Store",
  tags: [],
  orderRevenue: 100,
  subtotal: 90,
  discounts: 0,
  shipping: 5,
  tax: 5,
  totalRefunded: 0,
  refunds: [],
  lines: [{ lineId: `line-${id}`, title: "Tee", productId: "p1", variantId: "v1", quantity: 1, sales: 90 }],
  ...extra,
});
const fetched = (orders: RawOrder[], truncated = false) => shopify.fetchOrders.mockResolvedValue({ orders, approximateNewReturning: false, truncated });

const writes = (target: string) => state.ops.filter((o) => o.kind !== "select" && o.target === target);
const rpcs = () => state.ops.filter((o) => o.kind === "rpc").map((o) => o.target);
const lastRun = () => writes("sync_runs").filter((o) => o.kind === "update").at(-1)?.values as { status: string; message: string; rows_written?: number };
const missingFunction = { code: "PGRST202", message: "Could not find the function public.recompute_first_orders_since(p_client, p_since) in the schema cache" };

// 14:10 on Black Friday in Denver (UTC-7); the store's day began at 07:00Z.
const NOW = "2026-11-27T21:10:00Z";
const pull = (deadline = 123) => syncShopify("i1", { body: {}, todayPull: true, deadline });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  state.ops = [];
  state.timezone = "America/Denver";
  state.lastOrderToday = null;
  state.activeJobs = [];
  state.answer = undefined;
  for (const f of Object.values(shopify)) f.mockReset();
  shopify.fetchIsDevStore.mockResolvedValue(false);
  shopify.fetchVariantCosts.mockResolvedValue([]);
  fetched([]);
});
afterEach(() => vi.useRealTimers());

describe("syncShopify, the hourly pull of today's orders", () => {
  it("asks Shopify for the orders placed since the store's midnight when none of today is loaded yet, and keeps what it has at the deadline", async () => {
    await pull(987);
    expect(shopify.fetchOrders).toHaveBeenCalledWith("store.myshopify.com", "tok", "created_at:>='2026-11-27T07:00:00Z'", 987, false, true);
    const watermark = state.ops.find((o) => o.kind === "select" && o.target === "orders")!;
    expect(watermark.filters).toEqual(expect.arrayContaining([["eq", "client_id", "c1"], ["gte", "order_date", "2026-11-27"], ["order", "created_at", { ascending: false }], ["limit", 1]]));
  });

  it("carries on from the last order already loaded today, ten minutes back", async () => {
    state.lastOrderToday = "2026-11-27T20:12:30+00:00";
    await pull();
    expect(shopify.fetchOrders.mock.calls[0][2]).toBe("created_at:>='2026-11-27T20:02:30Z'");
  });

  it("saves the orders and recomputes new vs returning for today's customers, and writes nothing else", async () => {
    fetched([order("1", "2026-11-27T20:15:00Z"), order("2", "2026-11-27T20:40:00Z", { customerId: null })]);
    const result = await pull();

    expect(result).toEqual({ orders: 2, range: { from: "2026-11-27", to: "2026-11-27" } });
    const saved = writes("orders")[0].values as Record<string, unknown>[];
    expect(saved.map((r) => [r.order_id, r.order_date, r.is_dtc, r.order_revenue])).toEqual([
      ["1", "2026-11-27", true, 100],
      ["2", "2026-11-27", true, 100],
    ]);
    expect(writes("order_lines")).toHaveLength(1);
    // new vs returning: the lighter function, from the start of the store's day, and only that
    expect(state.ops.filter((o) => o.kind === "rpc")).toEqual([{ kind: "rpc", target: "recompute_first_orders_since", values: { p_client: "c1", p_since: "2026-11-27T07:00:00.000Z" }, filters: [] }]);
    // no daily row for a day in progress, no change to the connection, no product refresh
    expect(rpcs()).not.toContain("rebuild_daily_facts");
    expect(writes("integrations")).toEqual([]);
    expect(writes("daily_facts")).toEqual([]);
    expect(writes("sync_jobs")).toEqual([]);
    expect(writes("products")).toEqual([]);
    expect(shopify.fetchVariantCosts).not.toHaveBeenCalled();
    expect(lastRun()).toMatchObject({ status: "ok", rows_written: 2 });
    expect(lastRun().message).toBe("Today's orders since 2026-11-27T07:00:00.000Z: 2 saved");
  });

  it("a pull that fails leaves the connection exactly as it was: not in error, failure count untouched, only the run log says so", async () => {
    shopify.fetchOrders.mockRejectedValue(new Error("Shopify 502: bad gateway"));
    await expect(pull()).rejects.toThrow("Shopify 502: bad gateway");
    expect(writes("integrations")).toEqual([]);
    expect(writes("orders")).toEqual([]);
    expect(rpcs()).toEqual([]);
    expect(lastRun()).toMatchObject({ status: "error", message: "Today's orders: Shopify 502: bad gateway" });
  });

  it("a database failure while saving does not touch the connection either", async () => {
    fetched([order("1", "2026-11-27T20:15:00Z")]);
    state.answer = (op) => (op.kind === "upsert" && op.target === "orders" ? { data: null, error: { message: "canceling statement due to statement timeout" } } : undefined);
    await expect(pull()).rejects.toThrow("statement timeout");
    expect(writes("integrations")).toEqual([]);
    expect(rpcs()).toEqual([]);
    expect(lastRun().status).toBe("error");
  });

  it("falls back to the full recompute while migration 0024 is not applied", async () => {
    fetched([order("1", "2026-11-27T20:15:00Z")]);
    state.answer = (op) => (op.target === "recompute_first_orders_since" ? { data: null, error: missingFunction } : undefined);
    await expect(pull()).resolves.toMatchObject({ orders: 1 });
    expect(rpcs()).toEqual(["recompute_first_orders_since", "recompute_first_orders"]);
    expect(state.ops.find((o) => o.target === "recompute_first_orders")!.values).toEqual({ p_client: "c1" });
    expect(writes("integrations")).toEqual([]);
    expect(lastRun().status).toBe("ok");
  });

  it("any other failure of the lighter function fails the pull quietly instead of running the heavy one", async () => {
    fetched([order("1", "2026-11-27T20:15:00Z")]);
    state.answer = (op) => (op.target === "recompute_first_orders_since" ? { data: null, error: { code: "40P01", message: "deadlock detected" } } : undefined);
    await expect(pull()).rejects.toThrow("deadlock detected");
    expect(rpcs()).toEqual(["recompute_first_orders_since"]);
    expect(writes("integrations")).toEqual([]);
    expect(lastRun()).toMatchObject({ status: "error", message: "Today's orders: deadlock detected" });
  });

  it("ignores orders dated before the pull's start: older orders are the daily sync's, and their new vs returning is not recomputed here", async () => {
    fetched([order("old", "2026-11-20T10:00:00Z"), order("yesterday", "2026-11-27T06:59:59Z"), order("new", "2026-11-27T07:00:00Z")]);
    await expect(pull()).resolves.toMatchObject({ orders: 1 });
    expect((writes("orders")[0].values as { order_id: string }[]).map((r) => r.order_id)).toEqual(["new"]);
    expect((writes("order_lines")[0].values as { order_id: string }[]).map((r) => r.order_id)).toEqual(["new"]);

    state.ops = [];
    fetched([order("old", "2026-11-20T10:00:00Z")]); // e.g. Shopify ignored the date filter
    await expect(pull()).resolves.toMatchObject({ orders: 0 });
    expect(writes("orders")).toEqual([]);
    expect(rpcs()).toEqual([]);
  });

  it("writes nothing when a sync job started for the store while the orders were being fetched", async () => {
    fetched([order("1", "2026-11-27T20:15:00Z")]);
    state.activeJobs = [{ id: "job1" }];
    await expect(pull()).resolves.toEqual({ orders: 0, range: { from: "2026-11-27", to: "2026-11-27" }, skipped: true });
    expect(writes("orders")).toEqual([]);
    expect(rpcs()).toEqual([]);
    expect(writes("integrations")).toEqual([]);
    expect(lastRun()).toMatchObject({ status: "ok", rows_written: 0 });
    const check = state.ops.find((o) => o.kind === "select" && o.target === "sync_jobs")!;
    expect(check.filters).toEqual(expect.arrayContaining([["eq", "integration_id", "i1"], ["in", "status", ["queued", "running"]]]));
  });

  it("saves what it got when the fetch ran out of time and says there is more to load", async () => {
    fetched([order("1", "2026-11-27T07:15:00Z")], true);
    await expect(pull()).resolves.toEqual({ orders: 1, range: { from: "2026-11-27", to: "2026-11-27" }, partial: true });
    expect(writes("orders")).toHaveLength(1);
    expect(rpcs()).toEqual(["recompute_first_orders_since"]);
    expect(lastRun().message).toContain("1 saved (out of time: the next pull carries on from the last one)");
  });

  it("with no new order it writes no order and runs no database function", async () => {
    await expect(pull()).resolves.toEqual({ orders: 0, range: { from: "2026-11-27", to: "2026-11-27" } });
    expect(writes("orders")).toEqual([]);
    expect(rpcs()).toEqual([]);
    expect(state.ops.some((o) => o.target === "sync_jobs")).toBe(false);
    expect(lastRun()).toMatchObject({ status: "ok", rows_written: 0 });
  });

  it("uses the store's own day: a Sydney store at the same instant is already on the 28th", async () => {
    state.timezone = "Australia/Sydney"; // 08:10 on the 28th; its day began at 13:00Z on the 27th
    fetched([order("1", "2026-11-27T20:15:00Z")]);
    const result = await pull();
    expect(result.range).toEqual({ from: "2026-11-28", to: "2026-11-28" });
    expect(shopify.fetchOrders.mock.calls[0][2]).toBe("created_at:>='2026-11-27T13:00:00Z'");
    expect((writes("orders")[0].values as { order_date: string }[])[0].order_date).toBe("2026-11-28");
  });
});

describe("syncShopify, the daily sync and the store page (unchanged by the hourly pull)", () => {
  it("the daily sync still rebuilds the daily rows through yesterday and marks the connection connected", async () => {
    fetched([order("1", "2026-11-25T20:15:00Z")]);
    const result = await syncShopify("i1", { body: { from: "2026-11-13", to: "2026-11-26" }, products: true, includeUpdated: true, deadline: 555 });

    expect(result.range).toEqual({ from: "2026-11-13", to: "2026-11-26" });
    expect(shopify.fetchVariantCosts).toHaveBeenCalled();
    expect(shopify.fetchOrders).toHaveBeenCalledWith("store.myshopify.com", "tok", "created_at:>=2026-11-12 OR updated_at:>=2026-11-12 OR processed_at:>=2026-11-12", 555, false, false);
    expect(state.ops.filter((o) => o.kind === "rpc").map((o) => [o.target, o.values])).toEqual([
      ["recompute_first_orders", { p_client: "c1" }],
      ["rebuild_daily_facts", { p_client: "c1", p_from: "2026-11-13", p_to: "2026-11-26" }],
    ]);
    expect(writes("integrations").at(-1)!.values).toMatchObject({ status: "connected", consecutive_failures: 0, coverage_end: "2026-11-26" });
    expect(lastRun().status).toBe("ok");
    expect(lastRun().message.startsWith("2026-11-13 → 2026-11-26")).toBe(true);
    expect(state.ops.some((o) => o.target === "sync_jobs")).toBe(false);
  });

  it("the daily sync still puts the connection in error when it fails", async () => {
    shopify.fetchOrders.mockRejectedValue(new Error("TIMEOUT: too many orders for one task"));
    await expect(syncShopify("i1", { body: { from: "2026-11-13", to: "2026-11-26" }, includeUpdated: true })).rejects.toThrow("TIMEOUT");
    expect(writes("integrations").map((o) => o.values)).toEqual([{ status: "error", last_error: "TIMEOUT: too many orders for one task" }]);
    expect(lastRun()).toMatchObject({ status: "error", message: "TIMEOUT: too many orders for one task" });
  });

  it("the store page's refresh still loads today and writes today's daily row: its own page shows today on purpose", async () => {
    fetched([order("1", "2026-11-27T20:15:00Z")]);
    const result = await syncShopify("i1", { body: { days: 2 }, products: false, includeUpdated: true, includeToday: true, deadline: 555 });
    expect(result.range).toEqual({ from: "2026-11-26", to: "2026-11-27" });
    expect(shopify.fetchVariantCosts).not.toHaveBeenCalled();
    expect(shopify.fetchOrders.mock.calls[0].slice(2)).toEqual(["created_at:>=2026-11-25 OR updated_at:>=2026-11-25 OR processed_at:>=2026-11-25", 555, false, false]);
    expect(state.ops.filter((o) => o.kind === "rpc").map((o) => [o.target, o.values])).toEqual([
      ["recompute_first_orders", { p_client: "c1" }],
      ["rebuild_daily_facts", { p_client: "c1", p_from: "2026-11-26", p_to: "2026-11-27" }],
    ]);
    expect(writes("integrations").at(-1)!.values).toMatchObject({ status: "connected", coverage_end: "2026-11-27" });
  });
});

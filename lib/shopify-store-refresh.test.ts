import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const afterTasks: Array<() => unknown> = [];
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => void afterTasks.push(fn) }));
const installs = { findStoreIntegration: vi.fn(), installTokens: vi.fn(), provisionStoreClient: vi.fn() };
vi.mock("@/lib/shopify-installs", () => installs);
const jobs = { createJob: vi.fn(), kickRunner: vi.fn(), queuedJobId: vi.fn() };
vi.mock("@/lib/jobs", () => jobs);
const sync = { syncShopify: vi.fn() };
vi.mock("@/lib/sync/run-shopify", () => sync);

process.env.SHOPIFY_CLIENT_SECRET = "client-secret";
const { POST } = await import("@/app/api/shopify/store/refresh/route");
const { signStoreLink } = await import("./store-link");

const shop = "apex-analytics-test.myshopify.com";
const call = (body: unknown) => POST(new Request("https://app.test/api/shopify/store/refresh", { method: "POST", body: JSON.stringify(body) }));

describe("store page refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    sync.syncShopify.mockResolvedValue({ orders: 3 });
    jobs.queuedJobId.mockResolvedValue(null);
  });

  it("connects a store installed before installs connected themselves, then pulls today's orders", async () => {
    installs.findStoreIntegration.mockResolvedValue(null);
    installs.installTokens.mockResolvedValue({ access_token: "t", scope: "read_orders" });
    installs.provisionStoreClient.mockResolvedValue({ clientId: "c1", integrationId: "i1" });
    jobs.createJob.mockResolvedValue({ id: "j1", alreadyRunning: false });

    const res = await call(signStoreLink(shop, "client-secret"));

    expect(res.status).toBe(200);
    expect(installs.provisionStoreClient).toHaveBeenCalledWith(shop, expect.anything());
    expect(jobs.createJob).toHaveBeenCalledWith("i1", { kind: "history", months: 12 });
    await Promise.all(afterTasks.map((t) => t()));
    expect(jobs.kickRunner).toHaveBeenCalledWith("j1");
    expect(sync.syncShopify).toHaveBeenCalledWith("i1", expect.objectContaining({ includeToday: true }));
  });

  it("restarts a waiting history load of a connected store and pulls today's orders", async () => {
    installs.findStoreIntegration.mockResolvedValue({ id: "i2", status: "connected" });
    jobs.queuedJobId.mockResolvedValue("j9");

    const res = await call(signStoreLink(shop, "client-secret"));

    expect(res.status).toBe(200);
    expect(installs.provisionStoreClient).not.toHaveBeenCalled();
    await Promise.all(afterTasks.map((t) => t()));
    expect(jobs.kickRunner).toHaveBeenCalledWith("j9");
    expect(sync.syncShopify).toHaveBeenCalledWith("i2", expect.objectContaining({ includeToday: true }));
  });

  it("answers 404 for a store that is not installed", async () => {
    installs.findStoreIntegration.mockResolvedValue(null);
    installs.installTokens.mockResolvedValue(null);
    const res = await call(signStoreLink(shop, "client-secret"));
    expect(res.status).toBe(404);
    expect(installs.provisionStoreClient).not.toHaveBeenCalled();
  });

  it("answers 401 for a link that was not signed by us", async () => {
    const res = await call({ ...signStoreLink(shop, "client-secret"), sig: "0".repeat(64) });
    expect(res.status).toBe(401);
    expect(sync.syncShopify).not.toHaveBeenCalled();
  });
});

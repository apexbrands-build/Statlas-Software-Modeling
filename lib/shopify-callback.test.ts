import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const afterTasks: Array<() => unknown> = [];
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => void afterTasks.push(fn) }));
vi.mock("@/lib/shopify", () => ({ normalizeShop: (s: string) => s, verifyShopifyHmac: () => true }));
const installs = { exchangeCode: vi.fn(), saveInstall: vi.fn(), provisionStoreClient: vi.fn(), linkInstallToClient: vi.fn() };
vi.mock("@/lib/shopify-installs", () => installs);
const jobs = { createJob: vi.fn(), kickRunner: vi.fn() };
vi.mock("@/lib/jobs", () => jobs);
vi.mock("@/lib/supabase/server", () => ({ getServerClient: vi.fn() }));

process.env.SHOPIFY_CLIENT_ID = "client-id";
process.env.SHOPIFY_CLIENT_SECRET = "client-secret";
const { GET } = await import("@/app/api/shopify/callback/route");
const { verifyStoreLink } = await import("./store-link");

const shop = "v2mhrj-xn.myshopify.com";
function installRequest() {
  const cookie = `shopify_oauth=${encodeURIComponent(JSON.stringify({ state: "st", clientId: null, shop }))}`;
  return new Request(`https://app.test/api/shopify/callback?shop=${shop}&code=c&state=st&hmac=x&timestamp=1`, { headers: { cookie } });
}

describe("Shopify install from the App Store (no Apex user)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    installs.exchangeCode.mockResolvedValue({ access_token: "t", scope: "read_orders" });
  });

  it("connects the store, starts loading its orders and opens the store's own page", async () => {
    installs.provisionStoreClient.mockResolvedValue({ clientId: "c1", integrationId: "i1" });
    jobs.createJob.mockResolvedValue({ id: "j1", alreadyRunning: false });

    const res = await GET(installRequest());

    expect(installs.saveInstall).toHaveBeenCalledWith(shop, expect.anything());
    expect(installs.provisionStoreClient).toHaveBeenCalledWith(shop, expect.anything());
    expect(jobs.createJob).toHaveBeenCalledWith("i1", { kind: "history", months: 12 });
    await Promise.all(afterTasks.map((t) => t()));
    expect(jobs.kickRunner).toHaveBeenCalledWith("j1");
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/shopify/store");
    expect(verifyStoreLink({ shop: to.searchParams.get("shop"), exp: to.searchParams.get("exp"), sig: to.searchParams.get("sig") }, "client-secret")).toBe(shop);
  });

  it("still lands on the install page when the store could not be connected", async () => {
    installs.provisionStoreClient.mockResolvedValue(null);
    const res = await GET(installRequest());
    expect(jobs.createJob).not.toHaveBeenCalled();
    expect(new URL(res.headers.get("location")!).pathname).toBe("/shopify");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS, type ProviderId } from "../providers";

const mocks = vi.hoisted(() => ({
  syncShopify: vi.fn(async () => ({})),
  finalizeShopify: vi.fn(async () => ({})),
  syncMeta: vi.fn(async () => ({})),
  syncGoogle: vi.fn(async () => ({})),
}));
vi.mock("server-only", () => ({}));
vi.mock("./run-shopify", () => ({ syncShopify: mocks.syncShopify, finalizeShopify: mocks.finalizeShopify }));
vi.mock("./run-meta", () => ({ syncMeta: mocks.syncMeta }));
vi.mock("./run-google", () => ({ syncGoogle: mocks.syncGoogle }));
const { SYNCS, getSync, getVerifier, syncableProviderIds } = await import("./registry");

const range = { from: "2026-01-01", to: "2026-01-14" };

beforeEach(() => vi.clearAllMocks());

describe("sync registry", () => {
  it("registers exactly Shopify, Meta and Google Ads", () => {
    expect(Object.keys(SYNCS).sort()).toEqual(["google_ads", "meta", "shopify"]);
    expect([...syncableProviderIds()].sort()).toEqual(["google_ads", "meta", "shopify"]);
  });

  it("keeps the provider metadata and the registry in agreement: syncs means it has a sync", () => {
    for (const id of Object.keys(PROVIDERS) as ProviderId[]) expect(PROVIDERS[id].syncs).toBe(id in SYNCS);
  });

  it("passes the job's scope to Meta, and only the daily sync refreshes ad details", async () => {
    await SYNCS.meta!.sync("i2", range, { kind: "history", deadline: 1, firstChunk: false, scope: "ads" });
    expect(mocks.syncMeta).toHaveBeenLastCalledWith("i2", range, { deadline: 1, scope: "ads", refreshDetails: false });
    expect(SYNCS.meta!.adsAfterCampaign).toBe(true);
    expect(SYNCS.meta!.adsChunkDays).toBe(28);
  });

  it("keeps today's chunk sizes", () => {
    expect(SYNCS.shopify!.chunkDays).toBe(14);
    expect(SYNCS.meta!.chunkDays).toBe(60);
    expect(SYNCS.google_ads!.chunkDays).toBe(60);
  });

  it("passes the recent-sync options to Shopify", async () => {
    await SYNCS.shopify!.sync("i1", range, { kind: "recent", deadline: 123, firstChunk: false, scope: "all" });
    expect(mocks.syncShopify).toHaveBeenCalledWith("i1", { body: range, products: true, includeUpdated: true, deadline: 123 });
  });

  it("refreshes products on the first history chunk only", async () => {
    await SYNCS.shopify!.sync("i1", range, { kind: "history", deadline: 1, firstChunk: false, scope: "all" });
    expect(mocks.syncShopify).toHaveBeenLastCalledWith("i1", { body: range, products: false, includeUpdated: false, deadline: 1 });
    await SYNCS.shopify!.sync("i1", range, { kind: "history", deadline: 1, firstChunk: true, scope: "all" });
    expect(mocks.syncShopify).toHaveBeenLastCalledWith("i1", { body: range, products: true, includeUpdated: false, deadline: 1 });
  });

  it("finalizes Shopify over the whole job range", async () => {
    await SYNCS.shopify!.finalize!("i1", range);
    expect(mocks.finalizeShopify).toHaveBeenCalledWith("i1", range);
  });

  it("calls the Meta and Google syncs with the range and has no finalize for them", async () => {
    await SYNCS.meta!.sync("i2", range, { kind: "recent", deadline: 1, firstChunk: false, scope: "all" });
    await SYNCS.google_ads!.sync("i3", range, { kind: "history", deadline: 1, firstChunk: true, scope: "all" });
    expect(mocks.syncMeta).toHaveBeenCalledWith("i2", range, { deadline: 1, scope: "all", refreshDetails: true });
    expect(mocks.syncGoogle).toHaveBeenCalledWith("i3", range);
    expect(SYNCS.meta!.finalize).toBeUndefined();
    expect(SYNCS.google_ads!.finalize).toBeUndefined();
  });

  it("returns undefined for a provider with no sync (a row connected before its connector exists)", () => {
    expect(getSync("klaviyo")).toBeUndefined();
    expect(getSync("nope")).toBeUndefined();
  });
});

describe("verifiers", () => {
  it("every connectable client-key provider can check a key", () => {
    for (const id of Object.keys(PROVIDERS) as ProviderId[]) {
      const meta = PROVIDERS[id];
      if (meta.available && meta.auth === "client-key") expect(getVerifier(id), id).toBeTypeOf("function");
    }
  });

  it("has none for a provider that cannot be connected here", () => {
    expect(getVerifier("pinterest")).toBeUndefined();
    expect(getVerifier("nope")).toBeUndefined();
    expect(getVerifier("constructor")).toBeUndefined();
  });

  it("does not register the messaging platforms as syncs, so they get no daily job", () => {
    for (const id of ["klaviyo", "postscript", "omnisend"] as const) expect(id in SYNCS).toBe(false);
    expect(syncableProviderIds()).not.toContain("klaviyo");
  });
});


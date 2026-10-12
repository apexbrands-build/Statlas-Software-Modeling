import { describe, expect, it, vi } from "vitest";
import { PlatformError, requestJson } from "./http";

const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const opts = (over: Partial<Parameters<typeof requestJson>[2]> = {}) => ({ platform: "Klaviyo", sleep: async () => {}, secret: "sk-live-123", ...over });

describe("requestJson", () => {
  it("returns the parsed JSON of a successful answer", async () => {
    const fetchImpl = vi.fn(async () => ok({ data: [1] }));
    const r = await requestJson("https://x.test/a", { headers: { a: "b" } }, opts({ fetchImpl }));
    expect(r).toEqual({ status: 200, json: { data: [1] } });
    expect(fetchImpl).toHaveBeenCalledWith("https://x.test/a", expect.objectContaining({ headers: { a: "b" } }));
  });

  it("turns 401 into a rejected key and 403 into a forbidden one, without retrying", async () => {
    for (const [status, kind] of [[401, "rejected"], [403, "forbidden"]] as const) {
      const fetchImpl = vi.fn(async () => ok({}, status));
      const err = await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl })).catch((e) => e);
      expect(err).toBeInstanceOf(PlatformError);
      expect(err.kind).toBe(kind);
      expect(err.message).toContain("Klaviyo");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("waits the time the platform asks for on 429, retries, and gives up as rate limited", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ok({}, 429, { "Retry-After": "2" }));
    const err = await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl, sleep, retries: 2 })).catch((e) => e);
    expect(err.kind).toBe("rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("recovers when a retry succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({}, 429, { "Retry-After": "1" })).mockResolvedValueOnce(ok({ fine: true }));
    const r = await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl }));
    expect(r.json).toEqual({ fine: true });
  });

  it("retries server errors and network failures, then reports the platform as unavailable", async () => {
    const down = vi.fn(async () => ok({}, 503));
    expect((await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl: down, retries: 1 })).catch((e) => e)).kind).toBe("unavailable");
    expect(down).toHaveBeenCalledTimes(2);
    const boom = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    expect((await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl: boom, retries: 0 })).catch((e) => e)).kind).toBe("unavailable");
  });

  it("treats a request that takes too long as unavailable", async () => {
    const hang = (_url: string, init: { signal?: AbortSignal }) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    const err = await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl: hang as unknown as typeof fetch, timeoutMs: 5, retries: 0 })).catch((e) => e);
    expect(err.kind).toBe("unavailable");
  });

  it("calls a 200 that is not JSON, and other unexpected statuses, a bad response", async () => {
    expect((await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl: async () => ok("<html>") })).catch((e) => e)).kind).toBe("bad_response");
    const err = await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl: async () => ok({}, 404) })).catch((e) => e);
    expect(err.kind).toBe("bad_response");
    expect(err.message).toContain("404");
  });

  it("never lets the key into a message, even when the platform's own error text contains it", async () => {
    const fetchImpl = async () => {
      throw new Error("bad header Klaviyo-API-Key sk-live-123");
    };
    const err = await requestJson("https://x.test", { headers: {} }, opts({ fetchImpl, retries: 0 })).catch((e) => e);
    expect(err.message).not.toContain("sk-live-123");
    expect(err.message).toContain("***");
  });
});

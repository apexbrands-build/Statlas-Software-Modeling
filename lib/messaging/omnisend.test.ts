import { describe, expect, it, vi } from "vitest";
import { verifyOmnisend } from "./omnisend";

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const input = { accountId: "  Acme Co ", apiKey: "os_secret_9" };

describe("verifyOmnisend", () => {
  it("accepts a working key and names the connection with the name that was typed", async () => {
    const f = vi.fn(async () => answer({ contacts: [] }));
    expect(await verifyOmnisend(input, f)).toEqual({ accountName: "Acme Co" });
  });

  it("makes one read-only call with the X-API-KEY header", async () => {
    const f = vi.fn(async () => answer({ contacts: [] }));
    await verifyOmnisend(input, f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method?: string; headers: Record<string, string> }];
    expect(url).toBe("https://api.omnisend.com/v5/contacts?limit=1");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers["X-API-KEY"]).toBe("os_secret_9");
  });

  it("explains a rejected key", async () => {
    const msg = "Omnisend rejected the API key. Create one under Store settings, Integrations and API, API keys.";
    await expect(verifyOmnisend(input, async () => answer({}, 401))).rejects.toThrow(msg);
    await expect(verifyOmnisend(input, async () => answer({}, 403))).rejects.toThrow(msg);
  });

  it("asks for a key when there is none", async () => {
    await expect(verifyOmnisend({ accountId: "Acme" }, async () => answer({}))).rejects.toThrow("API key is required");
  });
});

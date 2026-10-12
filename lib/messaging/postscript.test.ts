import { describe, expect, it, vi } from "vitest";
import { verifyPostscript } from "./postscript";

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const input = { accountId: "Acme Co", apiKey: "ps_secret_5" };

describe("verifyPostscript", () => {
  it("accepts a working Private key and names the connection with the name that was typed", async () => {
    const f = vi.fn(async () => answer({ subscribers: [] }));
    expect(await verifyPostscript(input, f)).toEqual({ accountName: "Acme Co" });
  });

  it("makes one read-only call with a Bearer header", async () => {
    const f = vi.fn(async () => answer({ subscribers: [] }));
    await verifyPostscript(input, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method?: string; headers: Record<string, string> }];
    expect(url).toBe("https://api.postscript.io/api/v2/subscribers?limit=1");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer ps_secret_5");
  });

  it("tells the strategist to use the Private key when the key is rejected", async () => {
    const msg = "Postscript rejected the API key. Use the Private API key from Account, API (app.postscript.io/account/api), not the Public one.";
    await expect(verifyPostscript(input, async () => answer({}, 401))).rejects.toThrow(msg);
    await expect(verifyPostscript(input, async () => answer({}, 403))).rejects.toThrow(msg);
  });

  it("asks for a key when there is none", async () => {
    await expect(verifyPostscript({ accountId: "Acme" }, async () => answer({}))).rejects.toThrow("API key is required");
  });
});

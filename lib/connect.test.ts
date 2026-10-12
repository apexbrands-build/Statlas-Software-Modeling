import { describe, expect, it } from "vitest";
import { connectProvider, parseConnectBody, redact, type ConnectDeps } from "./connect";
import { PROVIDERS, type ProviderMeta } from "./providers";

// No client-key provider is available yet, so the tests pass a registry with an available one.
const registry: Record<string, ProviderMeta> = {
  klaviyo: { ...PROVIDERS.klaviyo, available: true },
  ga4: { ...PROVIDERS.ga4, available: true },
  meta: PROVIDERS.meta,
  omnisend: PROVIDERS.omnisend,
};
const good = { clientId: "c1", provider: "klaviyo", accountId: "acme", apiKey: "pk_123" };

describe("parseConnectBody", () => {
  it("trims the account id and the key", () => {
    const r = parseConnectBody({ ...good, accountId: "  acme \n", apiKey: "  pk_123 \t" }, registry);
    expect(r).toEqual({ ok: true, value: { clientId: "c1", provider: "klaviyo", accountId: "acme", apiKey: "pk_123" } });
  });

  it("rejects a missing, empty or blank key for a client-key provider", () => {
    for (const apiKey of [undefined, "", "   ", 42]) {
      expect(parseConnectBody({ ...good, apiKey }, registry)).toEqual({ ok: false, error: "API key is required" });
    }
  });

  it("rejects an empty account id", () => {
    expect(parseConnectBody({ ...good, accountId: "  " }, registry)).toEqual({ ok: false, error: "Account ID is required" });
  });

  it("rejects providers that are unknown, unavailable, or connected another way", () => {
    for (const provider of ["nope", "omnisend", "meta", "constructor"]) {
      expect(parseConnectBody({ ...good, provider }, registry)).toEqual({ ok: false, error: "Provider not supported here" });
    }
  });

  it("rejects a body that is not an object", () => {
    for (const body of [null, "x", 5, undefined]) expect(parseConnectBody(body, registry).ok).toBe(false);
  });

  it("drops the key for an agency-google provider even when one is sent", () => {
    const r = parseConnectBody({ clientId: "c1", provider: "ga4", accountId: "123456789", apiKey: "ignored" }, registry);
    expect(r).toEqual({ ok: true, value: { clientId: "c1", provider: "ga4", accountId: "123456789" } });
  });
});

describe("redact", () => {
  it("hides the secret wherever it appears", () => {
    expect(redact("bad key sk-123 rejected, sk-123 again", "sk-123")).toBe("bad key *** rejected, *** again");
  });
  it("leaves the message alone without a secret", () => {
    expect(redact("plain", undefined)).toBe("plain");
    expect(redact("plain", "")).toBe("plain");
  });
});

function fakeDeps(over: Partial<ConnectDeps> = {}) {
  const calls: string[] = [];
  const deps: ConnectDeps = {
    verify: async () => {
      calls.push("verify");
      return { accountName: "Acme Co" };
    },
    upsertIntegration: async () => {
      calls.push("upsert");
      return { id: "int-1" };
    },
    saveApiKey: async () => {
      calls.push("saveKey");
    },
    markError: async () => {
      calls.push("markError");
    },
    ...over,
  };
  return { calls, deps };
}

describe("connectProvider", () => {
  const input = { clientId: "c1", provider: "klaviyo" as const, accountId: "acme", apiKey: "sk-live-1" };

  it("verifies, saves the connection, then saves the key, and returns the account name", async () => {
    const { calls, deps } = fakeDeps();
    expect(await connectProvider(input, deps)).toEqual({ id: "int-1", accountName: "Acme Co" });
    expect(calls).toEqual(["verify", "upsert", "saveKey"]);
  });

  it("redacts the key from a failed verification and never saves the connection", async () => {
    const { calls, deps } = fakeDeps({ verify: async () => { throw new Error("401 for key sk-live-1"); } });
    await expect(connectProvider(input, deps)).rejects.toThrow("401 for key ***");
    expect(calls).not.toContain("upsert");
  });

  it("marks the connection in error and redacts the key when saving the key fails", async () => {
    const marked: string[] = [];
    const { deps } = fakeDeps({
      saveApiKey: async () => { throw new Error("write failed for sk-live-1"); },
      markError: async (id, message) => { marked.push(`${id}:${message}`); },
    });
    await expect(connectProvider(input, deps)).rejects.toThrow("write failed for ***");
    expect(marked).toEqual(["int-1:write failed for ***"]);
  });

  it("never saves a key for a provider connected without one", async () => {
    const { calls, deps } = fakeDeps();
    await connectProvider({ clientId: "c1", provider: "ga4", accountId: "123456789" }, deps);
    expect(calls).toEqual(["verify", "upsert"]);
  });
});

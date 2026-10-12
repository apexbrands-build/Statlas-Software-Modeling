import { describe, expect, it } from "vitest";
import { connectProvider, parseConnectBody, redact, type ConnectDeps } from "./connect";
import { PROVIDERS, type ProviderMeta } from "./providers";

// The tests pass their own registry: Klaviyo and GA4 available, Omnisend switched off so the "unavailable" case stays covered.
const registry: Record<string, ProviderMeta> = {
  klaviyo: { ...PROVIDERS.klaviyo, available: true },
  ga4: { ...PROVIDERS.ga4, available: true },
  meta: PROVIDERS.meta,
  omnisend: { ...PROVIDERS.omnisend, available: false },
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

  it("rejects an empty account id for a provider that cannot tell its own account", () => {
    expect(parseConnectBody({ clientId: "c1", provider: "ga4", accountId: "  " }, registry)).toEqual({ ok: false, error: "Account ID is required" });
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

describe("connecting a provider whose account comes from the key", () => {
  it("lets the account id be empty when the platform tells it (Klaviyo)", () => {
    const r = parseConnectBody({ clientId: "c1", provider: "klaviyo", accountId: "", apiKey: "pk_1" }, registry);
    expect(r).toEqual({ ok: true, value: { clientId: "c1", provider: "klaviyo", accountId: "", apiKey: "pk_1" } });
    const missing = parseConnectBody({ clientId: "c1", provider: "klaviyo", apiKey: "pk_1" }, registry);
    expect(missing.ok).toBe(true);
  });

  it("still requires a typed name for a provider that cannot tell its own account", () => {
    const r = parseConnectBody({ clientId: "c1", provider: "omnisend", accountId: "", apiKey: "k" }, { omnisend: { ...PROVIDERS.omnisend } });
    expect(r).toEqual({ ok: false, error: "Account ID is required" });
  });

  it("saves the connection under the account id the platform returned", async () => {
    const rows: { accountId: string }[] = [];
    const { deps } = fakeDeps({
      verify: async () => ({ accountName: "Acme Co", accountId: "AcCt12" }),
      upsertIntegration: async (row) => {
        rows.push(row);
        return { id: "int-1" };
      },
    });
    await connectProvider({ clientId: "c1", provider: "klaviyo", accountId: "", apiKey: "pk_1" }, deps);
    expect(rows).toEqual([expect.objectContaining({ accountId: "AcCt12", accountName: "Acme Co" })]);
  });

  it("connecting the same key twice targets the same account, so there is one connection and not two", async () => {
    const rows: string[] = [];
    const { deps } = fakeDeps({
      verify: async () => ({ accountName: "Acme Co", accountId: "AcCt12" }),
      upsertIntegration: async (row) => {
        rows.push(row.accountId);
        return { id: "int-1" };
      },
    });
    const input = { clientId: "c1", provider: "klaviyo" as const, accountId: "", apiKey: "pk_1" };
    await connectProvider(input, deps);
    await connectProvider({ ...input, accountId: "typed later" }, deps);
    expect(rows).toEqual(["AcCt12", "AcCt12"]);
  });

  it("falls back to the typed account id when the platform returns none", async () => {
    const rows: string[] = [];
    const { deps } = fakeDeps({
      upsertIntegration: async (row) => {
        rows.push(row.accountId);
        return { id: "int-1" };
      },
    });
    await connectProvider({ clientId: "c1", provider: "omnisend", accountId: "Acme", apiKey: "k" }, deps);
    expect(rows).toEqual(["Acme"]);
  });
});

describe("replacing a key", () => {
  const base = { clientId: "c1", provider: "klaviyo" as const, accountId: "AcCt12", apiKey: "pk_new", expectedAccountId: "AcCt12" };

  it("passes the account the connection already has through the request", () => {
    const r = parseConnectBody({ clientId: "c1", provider: "klaviyo", accountId: "AcCt12", apiKey: "pk_new", expectedAccountId: "  AcCt12 " }, registry);
    expect(r).toEqual({ ok: true, value: { clientId: "c1", provider: "klaviyo", accountId: "AcCt12", apiKey: "pk_new", expectedAccountId: "AcCt12" } });
    const none = parseConnectBody({ clientId: "c1", provider: "klaviyo", accountId: "AcCt12", apiKey: "pk_new" }, registry);
    expect(none.ok && "expectedAccountId" in none.value).toBe(false);
  });

  it("accepts a new key from the same account", async () => {
    const { calls, deps } = fakeDeps({ verify: async () => ({ accountName: "Acme Co", accountId: "AcCt12" }) });
    await expect(connectProvider(base, deps)).resolves.toEqual({ id: "int-1", accountName: "Acme Co" });
    expect(calls).toEqual(["upsert", "saveKey"]);
  });

  it("refuses a key from a different account instead of quietly making a second connection", async () => {
    const { calls, deps } = fakeDeps({ verify: async () => ({ accountName: "Other Brand", accountId: "ZzZ99" }) });
    await expect(connectProvider(base, deps)).rejects.toThrow("This key belongs to a different Klaviyo account (Other Brand). Disconnect this connection or add the key as a new connection.");
    expect(calls).toEqual([]);
  });

  it("does not compare accounts for a platform that cannot name its account", async () => {
    const { calls, deps } = fakeDeps();
    await connectProvider({ clientId: "c1", provider: "omnisend", accountId: "Acme", apiKey: "k", expectedAccountId: "Acme" }, deps);
    expect(calls).toEqual(["verify", "upsert", "saveKey"]);
  });
});

describe("a connection with no account id", () => {
  it("is refused rather than saved with a blank id", async () => {
    const { calls, deps } = fakeDeps({ verify: async () => ({ accountName: "Acme Co" }) });
    await expect(connectProvider({ clientId: "c1", provider: "klaviyo", accountId: "", apiKey: "pk_1" }, deps)).rejects.toThrow("Could not identify the account for this key");
    expect(calls).toEqual([]);
  });
});

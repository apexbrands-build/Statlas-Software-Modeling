import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DB_PROVIDER_IDS, FAILURE_ALERT_AT, needsAttention, PROVIDERS, providerLabel } from "./providers";

describe("provider metadata", () => {
  it("keys every provider by its own id", () => {
    for (const [key, meta] of Object.entries(PROVIDERS)) expect(meta.id).toBe(key);
  });

  it("can connect Shopify, Meta, Google Ads and the three messaging platforms, but only the first three sync data", () => {
    const list = (pick: (p: (typeof PROVIDERS)[keyof typeof PROVIDERS]) => boolean) => Object.values(PROVIDERS).filter(pick).map((p) => p.id).sort();
    expect(list((p) => p.available)).toEqual(["google_ads", "klaviyo", "meta", "omnisend", "postscript", "shopify"]);
    expect(list((p) => p.syncs)).toEqual(["google_ads", "meta", "shopify"]);
  });

  it("never lets a provider sync without being connectable", () => {
    for (const p of Object.values(PROVIDERS)) if (p.syncs) expect(p.available).toBe(true);
  });

  it("takes Klaviyo's account from its key, and asks for a name for the others", () => {
    expect(PROVIDERS.klaviyo.accountFromKey).toBe(true);
    expect(PROVIDERS.omnisend.accountFromKey).toBeFalsy();
    expect(PROVIDERS.postscript.accountFromKey).toBeFalsy();
  });

  it("matches the provider list in migration 0009 (so the code and the database check cannot drift)", () => {
    const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/0009_providers_and_failures.sql"), "utf8");
    const match = /provider in \(([^)]*)\)/i.exec(sql);
    expect(match).not.toBeNull();
    const fromSql = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect([...DB_PROVIDER_IDS].sort()).toEqual(fromSql);
  });

  it("labels providers for display and falls back to the id", () => {
    expect(providerLabel("meta")).toBe("Facebook");
    expect(providerLabel("google_ads")).toBe("Google Ads");
    expect(providerLabel("nope")).toBe("nope");
  });

  it("flags a connection only at 2 or more consecutive failures", () => {
    expect(FAILURE_ALERT_AT).toBe(2);
    for (const v of [undefined, null, 0, 1]) expect(needsAttention(v)).toBe(false);
    for (const v of [2, 5]) expect(needsAttention(v)).toBe(true);
  });
});

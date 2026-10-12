import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DB_PROVIDER_IDS, FAILURE_ALERT_AT, needsAttention, PROVIDERS, providerLabel } from "./providers";

describe("provider metadata", () => {
  it("keys every provider by its own id", () => {
    for (const [key, meta] of Object.entries(PROVIDERS)) expect(meta.id).toBe(key);
  });

  it("marks only Shopify, Meta and Google Ads as available", () => {
    const available = Object.values(PROVIDERS).filter((p) => p.available).map((p) => p.id).sort();
    expect(available).toEqual(["google_ads", "meta", "shopify"]);
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

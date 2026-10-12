import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The public pages Shopify and merchants read must not claim data the app does not read yet.
const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("public pages only claim what the Shopify sync reads", () => {
  const readsCountry = read("lib/sync/shopify.ts").includes("countryCodeV2");

  for (const page of ["app/privacy/page.tsx", "app/shopify/page.tsx"]) {
    it(`${page} mentions the shipping country only if the sync reads it`, () => {
      const claimsCountry = /shipping country|country of the shipping address/i.test(read(page));
      expect(!claimsCountry || readsCountry).toBe(true);
    });
  }
});

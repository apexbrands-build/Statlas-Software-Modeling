import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_FILES } from "./brand-files";
import { PROVIDERS } from "./providers";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("brand image files", () => {
  it("has a logo for every messaging platform that can be connected", () => {
    for (const p of Object.values(PROVIDERS)) if (p.kind === "messaging" && p.available) expect(BRAND_FILES[p.id], p.id).toBeTypeOf("string");
  });

  it("points every logo at a small real PNG inside public/", () => {
    for (const [id, url] of Object.entries(BRAND_FILES)) {
      expect(url.startsWith("/brand/"), id).toBe(true);
      const file = path.resolve(__dirname, "../public", url.slice(1));
      expect(statSync(file).size, id).toBeLessThan(20000);
      expect(readFileSync(file).subarray(0, 4).equals(PNG), id).toBe(true);
    }
  });
});

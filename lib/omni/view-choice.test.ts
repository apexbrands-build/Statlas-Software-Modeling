import { describe, expect, it } from "vitest";
import { BUSINESS_VIEW, readViewChoice, SITE_VIEW, writeViewChoice } from "./view-choice";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("the Home view a client was last looked at with", () => {
  it("starts on the own site", () => {
    expect(readViewChoice("c", [SITE_VIEW, BUSINESS_VIEW], store())).toBe(SITE_VIEW);
  });
  it("is remembered per client", () => {
    const s = store();
    writeViewChoice("c", "amazon", s);
    expect(readViewChoice("c", [SITE_VIEW, BUSINESS_VIEW, "amazon"], s)).toBe("amazon");
    expect(readViewChoice("other", [SITE_VIEW, BUSINESS_VIEW, "amazon"], s)).toBe(SITE_VIEW);
  });
  it("falls back to the own site when the remembered channel no longer exists", () => {
    const s = store();
    writeViewChoice("c", "amazon", s);
    expect(readViewChoice("c", [SITE_VIEW, BUSINESS_VIEW], s)).toBe(SITE_VIEW);
  });
  it("is the own site when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); } };
    expect(readViewChoice("c", [SITE_VIEW], blocked)).toBe(SITE_VIEW);
  });
});

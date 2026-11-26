import { describe, expect, it } from "vitest";
import { readMap, writeMap } from "./import-map";

function fakeStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("column mappings remembered in the browser", () => {
  it("gives back what was saved, per store, channel and kind of file", () => {
    const s = fakeStorage();
    writeMap("c1", "tiktok_shop", "tiktok_overview", { day: "date", "creator sales": "affiliate_gmv", notes: null }, s);
    expect(readMap("c1", "tiktok_shop", "tiktok_overview", s)).toEqual({ day: "date", "creator sales": "affiliate_gmv", notes: null });
    expect(readMap("c1", "tiktok_shop", "generic", s)).toEqual({});
    expect(readMap("c2", "tiktok_shop", "tiktok_overview", s)).toEqual({});
  });
  it("is empty when there is no storage, when it throws, or when what is stored is not a mapping", () => {
    expect(readMap("c1", "amazon", "generic", null)).toEqual({});
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readMap("c1", "amazon", "generic", broken)).toEqual({});
    expect(() => writeMap("c1", "amazon", "generic", { a: "date" }, broken)).not.toThrow();
    const s = fakeStorage();
    s.setItem("apex.importmap.c1.amazon.generic", '["not","a","map"]');
    expect(readMap("c1", "amazon", "generic", s)).toEqual({});
    s.setItem("apex.importmap.c1.amazon.generic", '{"a":"date","b":5,"c":null}');
    expect(readMap("c1", "amazon", "generic", s)).toEqual({ a: "date", c: null });
  });
});

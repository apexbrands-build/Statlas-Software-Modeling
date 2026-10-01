import { describe, expect, it } from "vitest";
import { rebalance } from "./alloc";

const keys = ["a", "b", "c"];
const total = (p: Record<string, number>) => keys.reduce((s, k) => s + (p[k] ?? 0), 0);

describe("rebalance", () => {
  it("rescales the others proportionally", () => {
    const r = rebalance({ a: 50, b: 30, c: 20 }, keys, [], "a", 70);
    expect(r).toEqual({ a: 70, b: 18, c: 12 });
  });
  it("keeps locked platforms fixed", () => {
    const r = rebalance({ a: 50, b: 30, c: 20 }, keys, ["c"], "a", 60);
    expect(r.c).toBe(20);
    expect(r.a).toBe(60);
    expect(r.b).toBe(20);
  });
  it("cannot take more than what the locked ones leave", () => {
    const r = rebalance({ a: 50, b: 30, c: 20 }, keys, ["c"], "a", 95);
    expect(r.a).toBe(80);
    expect(total(r)).toBeCloseTo(100);
  });
  it("shares the rest equally when the others are 0", () => {
    const r = rebalance({ a: 100, b: 0, c: 0 }, keys, [], "a", 40);
    expect(r).toEqual({ a: 40, b: 30, c: 30 });
  });
});

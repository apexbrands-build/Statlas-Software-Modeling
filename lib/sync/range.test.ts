import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRange } from "./range";

describe("resolveRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T15:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("still stops at yesterday by default", () => {
    expect(resolveRange({ from: "2026-11-20", to: "2026-11-23" }, 60)).toEqual({ from: "2026-11-20", to: "2026-11-22" });
    expect(resolveRange({ days: 2 }, 60)).toEqual({ from: "2026-11-21", to: "2026-11-22" });
  });
  it("can include the store's today when the caller allows it", () => {
    expect(resolveRange({ from: "2026-11-22", to: "2026-11-23" }, 60, "2026-11-23")).toEqual({ from: "2026-11-22", to: "2026-11-23" });
    expect(resolveRange({ days: 2 }, 60, "2026-11-23")).toEqual({ from: "2026-11-22", to: "2026-11-23" });
  });
  it("never goes past the allowed last day", () => {
    expect(resolveRange({ from: "2026-11-22", to: "2026-11-25" }, 60, "2026-11-23")).toEqual({ from: "2026-11-22", to: "2026-11-23" });
  });
});

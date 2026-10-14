import { describe, expect, it } from "vitest";
import type { MarketingEvent } from "../planning/events";
import { MOMENTS_CAP, isMoment, isMomentAd, momentsShare } from "./moments";

const ev = (type: string, date: string, endDate = date): MarketingEvent => ({
  id: `${type}-${date}`,
  clientId: "c1",
  date,
  endDate,
  type,
  name: type,
  source: "manual",
});

const NOV = "2026-11-01";
const bf = ev("black_friday", "2026-11-27", "2026-11-30");

describe("momentsShare", () => {
  it("distinct moment days in the month, overlap once, next month's days ignored", () => {
    const r = momentsShare(NOV, [bf, ev("promotion", "2026-11-28", "2026-12-02")]);
    expect(r.days).toBe(4);
    expect(r.share).toBeCloseTo(4 / 30, 10);
    expect(r.capped).toBe(false);
  });
  it("caps at 30%", () => {
    const r = momentsShare(NOV, [ev("promotion", "2026-11-01", "2026-11-20")]);
    expect(r.days).toBe(20);
    expect(r.share).toBe(MOMENTS_CAP);
    expect(r.capped).toBe(true);
  });
  it("a custom cap applies", () => {
    expect(momentsShare(NOV, [ev("promotion", "2026-11-01", "2026-11-20")], 0.5).share).toBe(0.5);
  });
  it("email and SMS add nothing", () => {
    expect(momentsShare(NOV, [ev("email", "2026-11-03"), ev("sms", "2026-11-04", "2026-11-06")])).toEqual({ share: 0, days: 0, capped: false });
    expect(isMoment(ev("email", "2026-11-03"))).toBe(false);
    expect(isMoment(bf)).toBe(true);
  });
  it("no events gives 0", () => {
    expect(momentsShare(NOV, [])).toEqual({ share: 0, days: 0, capped: false });
  });
});

describe("isMomentAd", () => {
  it("launched within 14 days before a moment or inside it", () => {
    expect(isMomentAd("2026-11-13", [bf])).toBe(true);
    expect(isMomentAd("2026-11-12", [bf])).toBe(false);
    expect(isMomentAd("2026-11-29", [bf])).toBe(true);
    expect(isMomentAd("2026-12-01", [bf])).toBe(false);
  });
  it("lead days are configurable; email and SMS are never moments", () => {
    expect(isMomentAd("2026-11-12", [bf], 15)).toBe(true);
    expect(isMomentAd("2026-11-20", [ev("email", "2026-11-27")])).toBe(false);
  });
});

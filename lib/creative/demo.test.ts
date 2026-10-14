import { describe, expect, it } from "vitest";
import { demoCreativeHistory, demoCreativeMonth } from "./demo";
import { formatEvidence, formatGroup, videoShare } from "./format";
import { scoreMetrics } from "./metrics";
import { METRIC_KEYS } from "./score";

const AS_OF = "2026-10-13";

describe("demoCreativeHistory", () => {
  const h = demoCreativeHistory("client-1", AS_OF);

  it("is deterministic: the same client gives the same history, another client a different one", () => {
    expect(demoCreativeHistory("client-1", AS_OF)).toEqual(h);
    expect(demoCreativeHistory("client-2", AS_OF)).not.toEqual(h);
  });

  it("has at least 20 ads of each format group launched in the last year, so the video share rests on evidence", () => {
    const ev = formatEvidence(h.ads, AS_OF);
    expect(ev.video.count).toBeGreaterThanOrEqual(20);
    expect(ev.image.count).toBeGreaterThanOrEqual(20);
    expect(videoShare(ev).reason).toBe("evidence");
    expect(h.ads.some((a) => formatGroup(a.format) === "image" && a.format !== "image")).toBe(true);
  });

  it("includes zero-spend ads and catalog ads", () => {
    expect(h.ads.some((a) => !a.isCatalog && a.spendTotal === 0)).toBe(true);
    expect(h.ads.some((a) => a.isCatalog)).toBe(true);
  });

  it("gives five scored metrics", () => {
    const m = scoreMetrics(h);
    for (const k of METRIC_KEYS) expect(m[k], k).not.toBeNull();
  });

  it("covers every month from January of last year to the as-of month, in order, and never beyond the as-of date", () => {
    const months = h.months.map((m) => m.month);
    expect(months[0]).toBe("2025-01-01");
    expect(months.at(-1)).toBe("2026-10-01");
    expect([...months].sort()).toEqual(months);
    expect(h.days.at(-1)!.date).toBe(AS_OF);
    expect(h.days).toHaveLength(97);
    expect(h.asOf).toBe(AS_OF);
  });

  it("is internally consistent: carried spend never exceeds a month's spend, and launches in the months match the ads", () => {
    for (const m of h.months) expect(m.carriedSpend).toBeLessThanOrEqual(m.spend + 1e-6);
    const launched = h.months.filter((m) => m.month >= "2025-11-01").reduce((s, m) => s + m.launched.video + m.launched.image + m.launched.carousel + m.launched.other, 0);
    expect(launched).toBeGreaterThan(50);
  });
});

describe("demoCreativeMonth", () => {
  it("returns the month's launched ads and its days, deterministically", () => {
    const a = demoCreativeMonth("client-1", "2026-09-01", AS_OF);
    expect(demoCreativeMonth("client-1", "2026-09-01", AS_OF)).toEqual(a);
    expect(a.days).toHaveLength(30);
    expect(a.ads.length).toBeGreaterThan(0);
    expect(a.ads.every((x) => x.launchDate.startsWith("2026-09"))).toBe(true);
  });
});

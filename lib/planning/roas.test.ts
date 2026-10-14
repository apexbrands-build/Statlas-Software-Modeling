import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { blankInputs, type PlanMonth, type PlanMonthInputs } from "./types";
import { actualPlatformRoas, planRoasTargets, roasChannels, roasOf, roasTarget, rowMethod, suggestedRoas, withRoas } from "./roas";
import type { ClientSettings, DailyFact } from "../types";

const settings = (multipliers: ClientSettings["multipliers"]): ClientSettings => ({ ...defaultSettings("c"), multipliers });
const inputs = (over: Partial<PlanMonthInputs> = {}): PlanMonthInputs => ({ ...blankInputs(), spend: 1000, amer: 2.21, platformPct: { google: 50, meta: 50 }, ...over });
const month = (m: string, i: PlanMonthInputs | null): PlanMonth => ({ month: `${m}-01`, inputs: i, status: "in_progress", locked: false });

describe("suggestedRoas: platform ROAS target = aMER / incrementality factor", () => {
  it("divides the aMER by the factor", () => {
    expect(suggestedRoas(2.21, 0.75)).toBeCloseTo(2.9467, 3);
    expect(suggestedRoas(2.21, 1.2)).toBeCloseTo(1.8417, 3);
    expect(suggestedRoas(2.21, 0.3)).toBeCloseTo(7.3667, 3);
  });
  it("is null, never Infinity or NaN, when the factor or the aMER is zero or missing", () => {
    expect(suggestedRoas(2.21, 0)).toBeNull();
    expect(suggestedRoas(0, 1.2)).toBeNull();
    expect(suggestedRoas(Number.NaN, 1.2)).toBeNull();
    expect(suggestedRoas(2.21, -1)).toBeNull();
  });
});

describe("roasChannels", () => {
  it("always has Google, Google Brand and Meta, and never a returning channel", () => {
    const ch = roasChannels(settings({ meta_returning: 0.6 }), []);
    expect(ch).toEqual(expect.arrayContaining(["google_nonbrand", "google_brand", "meta_acquisition"]));
    expect(ch).not.toContain("meta_returning");
  });
  it("adds a channel that has a factor or planned spend, and leaves out the rest", () => {
    expect(roasChannels(settings({ pinterest: 0.3 }), [])).toContain("pinterest");
    expect(roasChannels(settings({}), [month("2026-11", inputs({ platformPct: { tiktok: 20, meta: 80 } }))])).toContain("tiktok");
    expect(roasChannels(settings({}), [month("2026-11", inputs())])).not.toContain("tiktok");
  });
});

describe("roasTarget", () => {
  it("uses a manual value when there is one", () => {
    expect(roasTarget(inputs({ roas: { meta_acquisition: 2.5 } }), "meta_acquisition", 1.2)).toEqual({ value: 2.5, manual: true });
  });
  it("falls back to the suggested value when the manual value is missing, zero or negative", () => {
    expect(roasTarget(inputs(), "meta_acquisition", 1.2).manual).toBe(false);
    expect(roasTarget(inputs({ roas: { meta_acquisition: 0 } }), "meta_acquisition", 1.2).manual).toBe(false);
    expect(roasTarget(inputs({ roas: { meta_acquisition: -3 } }), "meta_acquisition", 1.2).manual).toBe(false);
    expect(roasTarget(inputs(), "meta_acquisition", 1.2).value).toBeCloseTo(1.8417, 3);
  });
  it("is null for a month with no inputs, and works on a plan saved before ROAS existed (no roas field)", () => {
    expect(roasTarget(null, "meta_acquisition", 1.2)).toEqual({ value: null, manual: false });
    const old = inputs();
    delete old.roas;
    expect(roasTarget(old, "google_nonbrand", 0.75).value).toBeCloseTo(2.9467, 3);
  });
});

describe("planRoasTargets and roasOf", () => {
  const s = settings({ google_nonbrand: 0.75, meta_acquisition: 1.2, google_brand: 0.3 });
  const months = [month("2026-11", inputs()), month("2026-12", inputs({ amer: 3, roas: { meta_acquisition: 2.2 } })), month("2027-01", null)];
  const targets = planRoasTargets(months, s);

  it("has a target per channel for every month with inputs, from that month's aMER and the client's factors", () => {
    expect(targets["2026-11"].google_nonbrand).toBeCloseTo(2.9467, 3);
    expect(targets["2026-11"].meta_acquisition).toBeCloseTo(1.8417, 3);
    expect(targets["2026-12"].google_brand).toBeCloseTo(10, 6);
  });
  it("keeps a manual value for its month only", () => {
    expect(targets["2026-12"].meta_acquisition).toBe(2.2);
    expect(targets["2026-11"].meta_acquisition).not.toBe(2.2);
  });
  it("skips a month with no inputs", () => {
    expect(targets["2027-01"]).toBeUndefined();
  });
  it("uses factor 1 for a channel with no factor", () => {
    expect(planRoasTargets([month("2026-11", inputs())], settings({}))["2026-11"].google_nonbrand).toBeCloseTo(2.21, 6);
  });
  it("answers by the date's month and is null for an unknown month, channel or a returning channel", () => {
    const of = roasOf(targets);
    expect(of("2026-11-17", "meta_acquisition")).toBeCloseTo(1.8417, 3);
    expect(of("2026-12-02", "meta_acquisition")).toBe(2.2);
    expect(of("2027-01-05", "meta_acquisition")).toBeNull();
    expect(of("2026-11-17", "meta_returning")).toBeNull();
  });
});

describe("withRoas", () => {
  it("sets a typed target for one channel and leaves the others and the rest of the month alone", () => {
    const i = inputs({ roas: { google_nonbrand: 3 } });
    const next = withRoas(i, "meta_acquisition", 2.4);
    expect(next.roas).toEqual({ google_nonbrand: 3, meta_acquisition: 2.4 });
    expect(next.amer).toBe(i.amer);
    expect(i.roas).toEqual({ google_nonbrand: 3 });
  });
  it("clears the channel (back to Suggested) for null, zero or a negative number, and drops an empty list", () => {
    expect(withRoas(inputs({ roas: { meta_acquisition: 2, google_nonbrand: 3 } }), "meta_acquisition", null).roas).toEqual({ google_nonbrand: 3 });
    expect(withRoas(inputs({ roas: { meta_acquisition: 2 } }), "meta_acquisition", 0).roas).toBeUndefined();
    expect(withRoas(inputs({ roas: { meta_acquisition: 2 } }), "meta_acquisition", -1).roas).toBeUndefined();
  });
  it("works on inputs saved before ROAS existed", () => {
    expect(withRoas(inputs(), "meta_acquisition", 2).roas).toEqual({ meta_acquisition: 2 });
  });
});

describe("rowMethod", () => {
  const ms = (a: Partial<PlanMonthInputs["roas"]> | null, b: Partial<PlanMonthInputs["roas"]> | null) => [month("2026-11", inputs({ roas: a ?? undefined })), month("2026-12", inputs({ roas: b ?? undefined })), month("2027-01", null)];
  it("is suggested when no month has a typed value, manual when every month with inputs has one, mixed otherwise", () => {
    expect(rowMethod(ms(null, null), "meta_acquisition")).toBe("suggested");
    expect(rowMethod(ms({ meta_acquisition: 2 }, { meta_acquisition: 2.5 }), "meta_acquisition")).toBe("manual");
    expect(rowMethod(ms({ meta_acquisition: 2 }, null), "meta_acquisition")).toBe("mixed");
  });
  it("ignores months with no inputs and is suggested when none has inputs", () => {
    expect(rowMethod([month("2026-11", null)], "meta_acquisition")).toBe("suggested");
  });
});

describe("actualPlatformRoas", () => {
  const fact = (spend: number, rev: number): DailyFact => {
    const f = { clientId: "c", date: "2026-10-01", channels: { meta_acquisition: { spend, platformRevenue: rev, platformPurchases: 1 } } };
    return f as unknown as DailyFact;
  };
  it("is platform-reported revenue over spend across the facts", () => {
    expect(actualPlatformRoas([fact(100, 200), fact(100, 160)], "meta_acquisition")).toBeCloseTo(1.8, 10);
  });
  it("is null with no spend, and for a channel the facts do not carry", () => {
    expect(actualPlatformRoas([fact(0, 0)], "meta_acquisition")).toBeNull();
    expect(actualPlatformRoas([], "meta_acquisition")).toBeNull();
    expect(actualPlatformRoas([fact(100, 200)], "pinterest")).toBeNull();
  });
});

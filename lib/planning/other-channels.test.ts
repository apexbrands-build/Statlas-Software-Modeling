import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { ClientSettings, DailyFact, HaloSettings, OtherChannel, RetailerRow } from "../types";
import type { Curve } from "./new-customer";
import { adCreatedReturning, adCreatedUnitsPerStoreWeek, capHalo, haloWarnings, otherChannelsOf, otherForecast, retailFrame, spendRatio, weeksIn } from "./other-channels";
import { blankInputs, type PlanMonthInputs } from "./types";

const amazon: OtherChannel = { key: "amazon", label: "Amazon", kind: "marketplace", costPct: 65, aov: 30 };
const target: RetailerRow = { retailer: "Target", launchMonth: "2027-03", doors: 1000, unitsPerStoreWeek: 2, shelfPrice: 30, pipelineUnits: 12000 };
const withHalo = (h: HaloSettings, over: Partial<ClientSettings> = {}): ClientSettings => {
  const base = defaultSettings("c");
  return { ...base, multipliers: { meta_acquisition: 1.2, meta_returning: 0.6 }, extra: { ...base.extra, halo: h }, ...over };
};
const inputs = (over: Partial<PlanMonthInputs> = {}): PlanMonthInputs => ({ ...blankInputs(), spend: 100000, amer: 1.5, platformPct: { meta: 100 }, altPct: { meta: 10 }, ...over });

describe("retailFrame: doors x units per store per week x shelf price", () => {
  it("counts a full month of sell-through and the brand's net share of it", () => {
    const f = retailFrame([target], 50, "2027-04-01");
    expect(weeksIn("2027-04-01")).toBeCloseTo(30 / 7, 10);
    expect(f.sellThrough).toBeCloseTo(257142.86, 1);
    expect(f.netRevenue).toBeCloseTo(128571.43, 1);
    expect(f.doors).toBe(1000);
  });
  it("adds the first stocking order once, in the launch month", () => {
    expect(retailFrame([target], 50, "2027-03-01").netRevenue).toBeCloseTo(312857.14, 1);
    expect(retailFrame([target], 50, "2027-05-01").netRevenue).toBeCloseTo((1000 * 2 * 31 * 30 * 0.5) / 7, 1);
  });
  it("is zero before the launch month", () => {
    expect(retailFrame([target], 50, "2027-02-01")).toEqual({ sellThrough: 0, netRevenue: 0, doors: 0, weeks: weeksIn("2027-02-01") });
  });
  it("adds retailers together", () => {
    const heb: RetailerRow = { retailer: "H-E-B", launchMonth: "2027-04", doors: 300, unitsPerStoreWeek: 1, shelfPrice: 30 };
    const f = retailFrame([target, heb], 50, "2027-05-01");
    expect(f.doors).toBe(1300);
    expect(f.sellThrough).toBeCloseTo(((1000 * 2 + 300 * 1) * 31 * 30) / 7, 1);
  });
  it("ignores rows with no doors, no price or broken numbers", () => {
    const bad = [{ ...target, doors: 0 }, { ...target, shelfPrice: Number.NaN }, { ...target, unitsPerStoreWeek: -2 }];
    expect(retailFrame(bad, 50, "2027-04-01").netRevenue).toBe(0);
  });
});

describe("spendRatio: revenue at the assumed spend over revenue at the planned spend", () => {
  const curve: Curve = { kind: "revenue", a: 1000, b: 1.5, r2: 1 };
  it("follows the curve, so it is not a straight line", () => {
    expect(spendRatio(curve, 1000, 500)).toBeCloseTo(0.7, 10);
  });
  it("is 1 when no assumed spend is typed and 0 when it is zero", () => {
    expect(spendRatio(curve, 1000, null)).toBe(1);
    expect(spendRatio(curve, 1000, 0)).toBe(0);
  });
  it("falls back to a straight line with no curve", () => {
    expect(spendRatio(null, 1000, 500)).toBe(0.5);
  });
  it("is 1, never NaN, when the plan has no spend", () => {
    expect(spendRatio(curve, 0, 500)).toBe(1);
  });
});

describe("otherForecast: the typed line moves with the spend it did not assume", () => {
  it("is the typed line when the forecast assumed the planned spend", () => {
    expect(otherForecast(100000, 20000, 1)).toBe(100000);
  });
  it("is the typed line plus the whole halo when the forecast assumed no ads", () => {
    expect(otherForecast(100000, 20000, 0)).toBe(120000);
  });
  it("adds only the halo on the extra spend", () => {
    expect(otherForecast(100000, 20000, 0.8)).toBeCloseTo(104000, 6);
  });
  it("goes down when the plan spends less than the forecast assumed", () => {
    expect(otherForecast(100000, 20000, 1.25)).toBeCloseTo(95000, 6);
  });
});

describe("capHalo", () => {
  it("caps the halo at the channel's forecast and says so", () => {
    expect(capHalo(30000, 20000)).toEqual({ value: 20000, capped: true });
  });
  it("leaves it alone under the forecast or with no forecast", () => {
    expect(capHalo(15000, 20000)).toEqual({ value: 15000, capped: false });
    expect(capHalo(30000, null)).toEqual({ value: 30000, capped: false });
  });
});

describe("adCreatedUnitsPerStoreWeek: the retail sanity check", () => {
  it("turns halo revenue into units per store per week", () => {
    expect(adCreatedUnitsPerStoreWeek(64285.71, 15, 1000, 30 / 7)).toBeCloseTo(1, 4);
  });
  it("is null with no doors, no price or no weeks", () => {
    expect(adCreatedUnitsPerStoreWeek(64285.71, 15, 0, 30 / 7)).toBeNull();
    expect(adCreatedUnitsPerStoreWeek(64285.71, 0, 1000, 30 / 7)).toBeNull();
  });
});

describe("adCreatedReturning: what retention ads add to returning revenue", () => {
  const fact = (spend: number, rev: number): DailyFact => ({ clientId: "c", date: "2026-10-01", channels: { meta_returning: { spend, platformRevenue: rev, platformPurchases: 1 } } }) as unknown as DailyFact;
  const s = withHalo({ channels: [], cells: {} });
  it("is planned retention spend x the channel's recent platform ROAS x its factor", () => {
    const r = adCreatedReturning(inputs(), s, [fact(1000, 3000)]);
    expect(r.revenue).toBeCloseTo(18000, 6);
    expect(r.byChannel.meta_returning).toBeCloseTo(18000, 6);
  });
  it("adds nothing for a channel with no recent spend", () => {
    expect(adCreatedReturning(inputs(), s, []).revenue).toBe(0);
  });
  it("adds nothing when the plan has no retention spend", () => {
    expect(adCreatedReturning(inputs({ altPct: {} }), s, [fact(1000, 3000)]).revenue).toBe(0);
  });
});

describe("haloWarnings", () => {
  const cell = (over: object) => withHalo({ channels: [amazon], cells: { meta_acquisition: { amazon: { value: 0.2, source: "own_test", ...over } } } });
  const kinds = (s: ClientSettings, spend: number) => haloWarnings(s, { meta_acquisition: spend }, "2026-11-23").map((w) => w.kind);
  it("flags a benchmark or an assumption", () => {
    expect(kinds(cell({ source: "benchmark" }), 100000)).toEqual(["benchmark"]);
    expect(kinds(cell({ source: "assumption" }), 100000)).toEqual(["benchmark"]);
    expect(kinds(cell({}), 100000)).toEqual([]);
  });
  it("flags a factor measured more than six months ago", () => {
    expect(kinds(cell({ measuredOn: "2026-04-01" }), 100000)).toEqual(["old"]);
    expect(kinds(cell({ measuredOn: "2026-09-01" }), 100000)).toEqual([]);
  });
  it("flags planned spend more than 30% away from the spend it was measured at", () => {
    expect(kinds(cell({ measuredSpend: 100000 }), 140000)).toEqual(["range"]);
    expect(kinds(cell({ measuredSpend: 100000 }), 60000)).toEqual(["range"]);
    expect(kinds(cell({ measuredSpend: 100000 }), 120000)).toEqual([]);
  });
  it("says which ad channel and sales channel each warning is about", () => {
    expect(haloWarnings(cell({ source: "benchmark" }), { meta_acquisition: 1 }, "2026-11-23")[0]).toEqual({ channel: "meta_acquisition", salesChannel: "amazon", kind: "benchmark" });
  });
  it("skips cells with no value, with no planned spend, or on a deleted sales channel", () => {
    expect(kinds(cell({ value: 0, source: "benchmark" }), 100000)).toEqual([]);
    expect(haloWarnings(cell({ source: "benchmark" }), {}, "2026-11-23")).toEqual([]);
    const orphan = withHalo({ channels: [], cells: { meta_acquisition: { amazon: { value: 0.2, source: "benchmark" } } } });
    expect(kinds(orphan, 100000)).toEqual([]);
  });
});

describe("otherChannelsOf: the lines a plan month shows", () => {
  it("lists the client's channels with what is typed, and leaves out lines whose channel was deleted", () => {
    const s = withHalo({ channels: [amazon], cells: {} });
    const lines = otherChannelsOf(inputs({ other: { amazon: { revenue: 50000, assumedSpend: null }, gone: { revenue: 9 } } }), s);
    expect(lines.map((l) => l.channel.key)).toEqual(["amazon"]);
    expect(lines[0].line).toEqual({ revenue: 50000, assumedSpend: null });
  });
  it("gives an empty line for a channel with nothing typed", () => {
    const s = withHalo({ channels: [amazon], cells: {} });
    expect(otherChannelsOf(inputs(), s)[0].line).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { ClientSettings, DailyFact, HaloSettings, OtherChannel, RetailerRow } from "../types";
import type { Curve } from "./new-customer";
import { adCreatedReturning, adCreatedUnitsPerStoreWeek, channelForecast, haloWarnings, otherMonth, retailFrame, retailNetPrice, spendRatio, weeksIn } from "./other-channels";
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
  it("ignores a row whose launch month is empty or not a month", () => {
    expect(retailFrame([{ ...target, launchMonth: "" }], 50, "2027-04-01").netRevenue).toBe(0);
    expect(retailFrame([{ ...target, launchMonth: "soon" }], 50, "2027-04-01").netRevenue).toBe(0);
    expect(retailNetPrice([{ ...target, launchMonth: "" }], 50, "2027-04-01")).toBeNull();
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

describe("channelForecast: the typed line moved by the spend it did not assume", () => {
  it("is the typed line when the forecast assumed the planned spend: the halo only moves credit", () => {
    expect(channelForecast(100000, 20000, 1)).toEqual({ forecast: 100000, created: 20000, capped: false });
  });
  it("is the typed line plus the whole halo when the forecast assumed no ads", () => {
    expect(channelForecast(100000, 20000, 0)).toEqual({ forecast: 120000, created: 20000, capped: false });
  });
  it("adds only the halo on the extra spend", () => {
    expect(channelForecast(100000, 20000, 0.8).forecast).toBeCloseTo(104000, 6);
  });
  it("goes down when the plan spends less than the forecast assumed", () => {
    expect(channelForecast(100000, 20000, 1.25).forecast).toBeCloseTo(95000, 6);
  });
  it("caps what the ads created at the forecast: the typed number wins over the factor", () => {
    expect(channelForecast(20000, 30000, 1)).toEqual({ forecast: 20000, created: 20000, capped: true });
  });
  it("never goes negative when the factor says the ads created more than the whole forecast", () => {
    const r = channelForecast(50000, 34000, 4);
    expect(r.forecast).toBeCloseTo(12500, 6);
    expect(r.created).toBeCloseTo(12500, 6);
    expect(r.capped).toBe(true);
  });
  it("credits nothing to the ads on a channel typed as zero", () => {
    expect(channelForecast(0, 30000, 1)).toEqual({ forecast: 0, created: 0, capped: true });
  });
  it("has no forecast and no cap with nothing typed", () => {
    expect(channelForecast(null, 30000, 1)).toEqual({ forecast: null, created: 30000, capped: false });
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
  it("reports what the same ads create on other sales channels, apart from .com", () => {
    const withCell = withHalo({ channels: [amazon], cells: { meta_returning: { amazon: { value: 0.1, source: "assumption" } } } });
    const r = adCreatedReturning(inputs(), withCell, [fact(1000, 3000)]);
    expect(r.revenue).toBeCloseTo(18000, 6);
    expect(r.halo.amazon).toBeCloseTo(3000, 6);
    expect(r.haloRevenue).toBeCloseTo(3000, 6);
    expect(adCreatedReturning(inputs(), s, [fact(1000, 3000)]).halo).toEqual({});
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

describe("retailNetPrice: the brand's average net price per unit on shelf", () => {
  const heb: RetailerRow = { retailer: "H-E-B", launchMonth: "2027-04", doors: 500, unitsPerStoreWeek: 2, shelfPrice: 20 };
  it("weights each retailer's price by the units it sells", () => {
    expect(retailNetPrice([target, heb], 50, "2027-05-01")).toBeCloseTo(13.3333, 3);
  });
  it("is null before any launch", () => {
    expect(retailNetPrice([target], 50, "2027-02-01")).toBeNull();
  });
});

describe("otherMonth: a plan month's other sales channels", () => {
  const retailCh: OtherChannel = { key: "retail", label: "Retail", kind: "retail", costPct: 55, aov: 15, netPct: 50, retailers: [target] };
  const s = (cells: HaloSettings["cells"], channels: OtherChannel[] = [amazon]) => withHalo({ channels, cells }, { multipliers: { meta_acquisition: 1.2 } });
  const own = { value: 0.2, source: "own_test" as const };
  const month = (other?: PlanMonthInputs["other"]) => inputs({ altPct: {}, other });

  it("gives the month's .com new revenue, the blended aMER and the halo on each channel", () => {
    const m = otherMonth("2027-04-01", month(), s({ meta_acquisition: { amazon: own } }), null);
    expect(m.acqSpend).toBe(100000);
    expect(m.newRevenue).toBeCloseTo(150000, 6);
    expect(m.blendedAmer).toBeCloseTo(1.75, 10);
    expect(m.modelled).toBe(true);
    expect(m.benchmark).toBe(false);
    expect(m.lines[0].halo).toBeCloseTo(25000, 6);
  });
  it("has no forecast for a channel with nothing typed, and does not cap its halo", () => {
    const l = otherMonth("2027-04-01", month(), s({ meta_acquisition: { amazon: own } }), null).lines[0];
    expect(l.typed).toBeNull();
    expect(l.forecast).toBeNull();
    expect(l.created).toBeCloseTo(25000, 6);
    expect(l.capped).toBe(false);
  });
  it("keeps the typed line when it assumed the planned spend, and adds the halo when it assumed no ads", () => {
    const cells = { meta_acquisition: { amazon: own } };
    expect(otherMonth("2027-04-01", month({ amazon: { revenue: 100000 } }), s(cells), null).lines[0].forecast).toBe(100000);
    expect(otherMonth("2027-04-01", month({ amazon: { revenue: 100000, assumedSpend: 0 } }), s(cells), null).lines[0].forecast).toBeCloseTo(125000, 6);
    expect(otherMonth("2027-04-01", month({ amazon: { revenue: 100000, assumedSpend: 50000 } }), s(cells), null).lines[0].forecast).toBeCloseTo(112500, 6);
  });
  it("caps what the ads created at the channel's forecast", () => {
    const l = otherMonth("2027-04-01", month({ amazon: { revenue: 20000 } }), s({ meta_acquisition: { amazon: own } }), null).lines[0];
    expect(l.created).toBe(20000);
    expect(l.capped).toBe(true);
  });
  it("uses the retail frame until a number is typed, and checks the halo against units per store", () => {
    const cells = { meta_acquisition: { retail: { value: 0.07, source: "assumption" as const } } };
    const l = otherMonth("2027-04-01", month(), s(cells, [retailCh]), null).lines[0];
    expect(l.frame).toBeCloseTo(128571.43, 1);
    expect(l.base).toBeCloseTo(128571.43, 1);
    expect(l.forecast).toBeCloseTo(128571.43, 1);
    expect(l.halo).toBeCloseTo(8750, 4);
    expect(l.doors).toBe(1000);
    expect(l.unitsPerStoreWeek).toBeCloseTo(0.13611, 4);
    const typed = otherMonth("2027-04-01", month({ retail: { revenue: 90000 } }), s(cells, [retailCh]), null).lines[0];
    expect(typed.base).toBe(90000);
  });
  it("stays at or above zero when the forecast assumed more spend than the plan and the factor overshoots it", () => {
    const cells = { meta_acquisition: { amazon: own } };
    const ok = otherMonth("2027-04-01", month({ amazon: { revenue: 50000, assumedSpend: 200000 } }), s(cells), null).lines[0];
    expect(ok.forecast).toBeCloseTo(25000, 6);
    expect(ok.capped).toBe(false);
    const over = otherMonth("2027-04-01", month({ amazon: { revenue: 30000, assumedSpend: 200000 } }), s(cells), null).lines[0];
    expect(over.forecast).toBeCloseTo(15000, 6);
    expect(over.created).toBeCloseTo(15000, 6);
    expect(over.capped).toBe(true);
  });
  it("checks units per store against the full halo, so a capped line still shows the overshoot", () => {
    const cells = { meta_acquisition: { retail: { value: 0.07, source: "assumption" as const } } };
    const l = otherMonth("2027-04-01", month({ retail: { revenue: 5000 } }), s(cells, [retailCh]), null).lines[0];
    expect(l.capped).toBe(true);
    expect(l.created).toBe(5000);
    expect(l.unitsPerStoreWeek).toBeCloseTo(0.13611, 4);
  });
  it("is plain when the client has channels but no halo", () => {
    const m = otherMonth("2027-04-01", month({ amazon: { revenue: 100000 } }), s({}), null);
    expect(m.blendedAmer).toBe(1.5);
    expect(m.modelled).toBe(false);
    expect(m.lines[0].halo).toBe(0);
    expect(m.lines[0].forecast).toBe(100000);
  });
  it("treats a negative or non-numeric typed line as nothing typed", () => {
    const l = otherMonth("2027-04-01", month({ amazon: { revenue: Number.NaN } }), s({ meta_acquisition: { amazon: own } }), null).lines[0];
    expect(l.typed).toBeNull();
    expect(otherMonth("2027-04-01", month({ amazon: { revenue: -5 } }), s({}), null).lines[0].typed).toBeNull();
  });
});

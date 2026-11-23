import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { ClientSettings, HaloSettings, OtherChannel } from "../types";
import { acquisitionShares, blendedAmer, cellValue, channelSpendShares, haloMix, haloOf, haloRevenue, haloSettingsOf, totalFactor } from "./halo";

const amazon: OtherChannel = { key: "amazon", label: "Amazon", kind: "marketplace", costPct: 65, aov: 30 };
const retail: OtherChannel = { key: "retail", label: "Retail", kind: "retail", costPct: 55, aov: 15, netPct: 50 };

/** Meta 1.2 on .com with a 0.2 Amazon halo; Google non-brand 0.6 with none (the spec's worked example). */
const halo = (over: Partial<HaloSettings> = {}): HaloSettings => ({ channels: [amazon], cells: { meta_acquisition: { amazon: { value: 0.2, source: "benchmark" } } }, ...over });
const settings = (h: HaloSettings | undefined, over: Partial<ClientSettings> = {}): ClientSettings => {
  const base = defaultSettings("c");
  return { ...base, multipliers: { meta_acquisition: 1.2, google_nonbrand: 0.6 }, extra: { ...base.extra, halo: h }, ...over };
};
const split = { platformPct: { meta: 80, google: 20 }, altPct: { meta: 10, google: 25 } };

describe("haloSettingsOf", () => {
  it("is empty when the client has typed nothing", () => {
    expect(haloSettingsOf(settings(undefined))).toEqual({ channels: [], cells: {} });
  });
  it("is empty, not a crash, when what is saved is not the expected shape", () => {
    expect(haloSettingsOf(settings("oops" as unknown as HaloSettings))).toEqual({ channels: [], cells: {} });
    expect(haloSettingsOf(settings({ channels: "x", cells: null } as unknown as HaloSettings))).toEqual({ channels: [], cells: {} });
  });
});

describe("cellValue", () => {
  it("is the typed value", () => {
    expect(cellValue({ value: 0.2, source: "benchmark" }, amazon)).toBe(0.2);
  });
  it("converts a retail cell measured on shelf sales to the brand's net revenue", () => {
    expect(cellValue({ value: 0.3, source: "own_test", onShelf: true }, retail)).toBeCloseTo(0.15, 10);
    expect(cellValue({ value: 0.3, source: "own_test" }, retail)).toBe(0.3);
  });
  it("counts an empty, negative or non-numeric value as zero", () => {
    expect(cellValue(undefined, amazon)).toBe(0);
    expect(cellValue({ value: -1, source: "assumption" }, amazon)).toBe(0);
    expect(cellValue({ value: Number.NaN, source: "assumption" }, amazon)).toBe(0);
    expect(cellValue({ value: undefined as unknown as number, source: "assumption" }, amazon)).toBe(0);
  });
});

describe("totalFactor: the .com factor plus the channel's halo factors", () => {
  it("adds the halo to the .com factor", () => {
    expect(totalFactor("meta_acquisition", settings(halo()))).toBeCloseTo(1.4, 10);
  });
  it("is the .com factor alone for a channel with no halo", () => {
    expect(totalFactor("google_nonbrand", settings(halo()))).toBe(0.6);
  });
  it("counts a channel with no saved factor as 1, with or without a halo", () => {
    expect(totalFactor("tiktok", settings(halo()))).toBe(1);
    const s = settings(halo({ cells: { tiktok: { amazon: { value: 0.2, source: "assumption" } } } }));
    expect(totalFactor("tiktok", s)).toBeCloseTo(1.2, 10);
  });
  it("ignores a cell whose sales channel no longer exists", () => {
    const s = settings(halo({ cells: { meta_acquisition: { amazon: { value: 0.2, source: "benchmark" }, gone: { value: 5, source: "assumption" } } } }));
    expect(haloOf("meta_acquisition", s)).toEqual({ amazon: 0.2 });
    expect(totalFactor("meta_acquisition", s)).toBeCloseTo(1.4, 10);
  });
});

describe("channelSpendShares and acquisitionShares", () => {
  it("splits total spend by channel", () => {
    const s = channelSpendShares(split);
    expect(s.meta_acquisition).toBeCloseTo(0.72, 10);
    expect(s.meta_returning).toBeCloseTo(0.08, 10);
    expect(s.google_nonbrand).toBeCloseTo(0.15, 10);
    expect(s.google_brand).toBeCloseTo(0.05, 10);
  });
  it("keeps only the spend that counts toward aMER, as shares that sum to 1", () => {
    const s = acquisitionShares(split, settings(halo(), { excludeBrandFromAmer: true, excludeMetaReturningFromAmer: true }));
    expect(Object.keys(s).sort()).toEqual(["google_nonbrand", "meta_acquisition"]);
    expect(s.meta_acquisition).toBeCloseTo(0.827586, 5);
    expect(s.google_nonbrand).toBeCloseTo(0.172414, 5);
  });
  it("includes brand and returning spend when the client counts them in aMER", () => {
    const s = acquisitionShares(split, settings(halo(), { excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false }));
    expect(s.meta_acquisition).toBeCloseTo(0.72, 10);
    expect(s.meta_returning).toBeCloseTo(0.08, 10);
    expect(s.google_nonbrand).toBeCloseTo(0.15, 10);
    expect(s.google_brand).toBeCloseTo(0.05, 10);
  });
  it("is empty for a month with no platform split", () => {
    expect(acquisitionShares({ platformPct: {}, altPct: {} }, settings(halo()))).toEqual({});
    expect(acquisitionShares({ platformPct: { meta: 0 }, altPct: {} }, settings(halo()))).toEqual({});
  });
});

describe("haloMix: the spec's worked example", () => {
  const mix = haloMix({ meta_acquisition: 0.8, google_nonbrand: 0.2 }, settings(halo()));
  it("weights .com by each channel's share of spend", () => {
    expect(mix.w).toBeCloseTo(0.885714, 5);
    expect(mix.share.amazon).toBeCloseTo(0.129032, 5);
  });
  it("gives the blended aMER and the halo revenue", () => {
    expect(blendedAmer(1.5, mix)).toBeCloseTo(1.693548, 5);
    expect(haloRevenue(150, mix).amazon).toBeCloseTo(19.3548, 3);
  });
  it("says the result is modelled and rests on a benchmark", () => {
    expect(mix.modelled).toBe(true);
    expect(mix.benchmark).toBe(true);
  });
  it("is not a benchmark once every cell behind it comes from the client's own test", () => {
    const own = haloMix({ meta_acquisition: 1 }, settings(halo({ cells: { meta_acquisition: { amazon: { value: 0.2, source: "own_test" } } } })));
    expect(own.benchmark).toBe(false);
  });
});

describe("haloMix: nothing to model", () => {
  it("leaves aMER as it is when no halo is typed", () => {
    const mix = haloMix({ meta_acquisition: 0.8, google_nonbrand: 0.2 }, settings(undefined));
    expect(mix).toEqual({ w: 1, share: {}, modelled: false, benchmark: false });
    expect(blendedAmer(1.5, mix)).toBe(1.5);
    expect(haloRevenue(150, mix)).toEqual({});
  });
  it("leaves aMER as it is for a month with no split, never NaN", () => {
    const mix = haloMix({}, settings(halo()));
    expect(mix.w).toBe(1);
    expect(blendedAmer(1.5, mix)).toBe(1.5);
  });
  it("skips a channel whose total factor is zero", () => {
    const s = settings(halo({ cells: { google_nonbrand: { amazon: { value: 0.2, source: "own_test" } } } }), { multipliers: { meta_acquisition: 0, google_nonbrand: 0.6 } });
    const both = haloMix({ meta_acquisition: 0.5, google_nonbrand: 0.5 }, s);
    const alone = haloMix({ google_nonbrand: 1 }, s);
    expect(both.share.amazon).toBeCloseTo(alone.share.amazon, 10);
    expect(both.w).toBeCloseTo(0.75, 10);
  });
});

import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { aggregatePlan, channelMetricDefs, groupRoasTarget, type ChannelGroup } from "./metrics";
import type { RoasOf } from "./planning/roas";
import type { ChannelKey, ClientSettings, PlanTargetDay } from "./types";

const settings: ClientSettings = { ...defaultSettings("c"), multipliers: { meta_acquisition: 1.2, google_nonbrand: 0.75, meta_returning: 0.6 } };
const day = (date: string, spendByChannel: Partial<Record<ChannelKey, number>>): PlanTargetDay => ({
  planId: "p", clientId: "c", date, orderRevenue: 1000, newRevenue: 600, returningRevenue: 400, orders: 10, newOrders: 6,
  spend: Object.values(spendByChannel).reduce((a, v) => a + (v ?? 0), 0), cm: 100, spendByChannel,
});
/** Platform ROAS targets: November 2.0 for Meta, December 1.0; none for returning channels. */
const roasOf: RoasOf = (date, ch) => (ch === "meta_returning" ? null : ch === "meta_acquisition" ? (date.startsWith("2026-11") ? 2 : 1) : ch === "google_nonbrand" ? 3 : null);
const meta: ChannelGroup = { id: "meta", label: "Meta", channels: ["meta_acquisition"] };

describe("aggregatePlan with ROAS targets", () => {
  it("keeps planned spend and expected platform revenue per channel", () => {
    const p = aggregatePlan([day("2026-11-10", { meta_acquisition: 100 }), day("2026-12-10", { meta_acquisition: 300 })], roasOf);
    expect(p.platformRoasPlan.meta_acquisition).toEqual({ spend: 400, expectedRevenue: 100 * 2 + 300 * 1 });
  });
  it("has nothing without targets, and skips channels that have none", () => {
    expect(aggregatePlan([day("2026-11-10", { meta_acquisition: 100 })]).platformRoasPlan).toEqual({});
    expect(aggregatePlan([day("2026-11-10", { meta_returning: 50 })], roasOf).platformRoasPlan).toEqual({});
  });
});

describe("groupRoasTarget", () => {
  const p = aggregatePlan([day("2026-11-10", { meta_acquisition: 100 }), day("2026-12-10", { meta_acquisition: 300 })], roasOf);

  it("weights the months by planned spend, not by averaging them", () => {
    expect(groupRoasTarget(p, settings, ["meta_acquisition"], false)).toBeCloseTo(500 / 400, 10);
  });
  it("is the incremental target (platform target times the factor) in incremental mode", () => {
    expect(groupRoasTarget(p, settings, ["meta_acquisition"], true)).toBeCloseTo((500 / 400) * 1.2, 10);
  });
  it("is null when the group has spending channels without a target, such as Meta Returning", () => {
    const mixed = aggregatePlan([day("2026-11-10", { meta_acquisition: 100, meta_returning: 40 })], roasOf);
    expect(groupRoasTarget(mixed, settings, ["meta_acquisition", "meta_returning"], false)).toBeNull();
    expect(groupRoasTarget(mixed, settings, ["meta_returning"], false)).toBeNull();
  });
  it("is null when only part of a channel's planned spend has a target (a month with no aMER), instead of quietly using the covered months", () => {
    const partial: RoasOf = (date, ch) => (ch === "meta_acquisition" && date.startsWith("2026-11") ? 2 : null);
    const t = aggregatePlan([day("2026-11-10", { meta_acquisition: 100 }), day("2026-12-10", { meta_acquisition: 300 })], partial);
    expect(groupRoasTarget(t, settings, ["meta_acquisition"], false)).toBeNull();
  });
  it("ignores a channel in the group that has no planned spend", () => {
    expect(groupRoasTarget(p, settings, ["meta_acquisition", "meta_returning"], false)).toBeCloseTo(500 / 400, 10);
  });
  it("is null with no targets or no spend", () => {
    expect(groupRoasTarget(aggregatePlan([day("2026-11-10", { meta_acquisition: 100 })]), settings, ["meta_acquisition"], false)).toBeNull();
    expect(groupRoasTarget(aggregatePlan([]), settings, ["meta_acquisition"], false)).toBeNull();
  });
});

describe("channelMetricDefs targets", () => {
  const p = aggregatePlan([day("2026-11-10", { meta_acquisition: 100 })], roasOf);
  it("the ROAS tile has a plan target, platform ROAS in platform mode and iROAS in incremental mode", () => {
    const platform = channelMetricDefs(meta, false).find((d) => d.key === "meta.iroas")!;
    const incremental = channelMetricDefs(meta, true).find((d) => d.key === "meta.iroas")!;
    expect(platform.target!(p, settings)).toBeCloseTo(2, 10);
    expect(incremental.target!(p, settings)).toBeCloseTo(2.4, 10);
  });
  it("spend keeps its own target and the other channel tiles still have none", () => {
    const defs = channelMetricDefs(meta, true);
    expect(defs.find((d) => d.key === "meta.spend")!.target!(p, settings)).toBe(100);
    expect(defs.filter((d) => d.target).map((d) => d.key).sort()).toEqual(["meta.iroas", "meta.spend"]);
  });
});

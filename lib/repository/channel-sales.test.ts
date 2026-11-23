import { describe, expect, it } from "vitest";
import type { ChannelSale } from "../omni/types";
import { haloSettingsOf } from "../planning/halo";
import { SeedRepository } from "./seed";

const row = (date: string, revenue: number, over: Partial<ChannelSale> = {}): ChannelSale => ({ date, channel: "amazon", retailer: "", revenue, orders: 1, units: 1, adSpend: 0, source: "import", ...over });

describe("demo data: one client sells on other channels", () => {
  it("ships Amazon, TikTok Shop and Retail with a Meta halo on Amazon marked as a benchmark", async () => {
    const repo = new SeedRepository();
    const h = haloSettingsOf(await repo.getSettings("kettle"));
    expect(h.channels.map((c) => c.key)).toEqual(["amazon", "tiktok_shop", "retail"]);
    expect(h.cells.meta_acquisition?.amazon).toMatchObject({ value: 0.2, source: "benchmark" });
  });
  it("leaves the other demo clients on their own site only", async () => {
    const repo = new SeedRepository();
    expect(haloSettingsOf(await repo.getSettings("northwind")).channels).toEqual([]);
    expect(await repo.getChannelSales("northwind", "2026-03-01", "2026-03-31")).toEqual([]);
  });
});

describe("demo data: sales of the other channels", () => {
  it("gives the same days on every call, one row per channel and day", async () => {
    const a = await new SeedRepository().getChannelSales("kettle", "2026-03-01", "2026-03-31");
    const b = await new SeedRepository().getChannelSales("kettle", "2026-03-01", "2026-03-31");
    expect(a).toEqual(b);
    expect(new Set(a!.map((r) => r.channel))).toEqual(new Set(["amazon", "tiktok_shop", "retail"]));
    expect(a!.filter((r) => r.channel === "amazon")).toHaveLength(31);
    expect(a!.every((r) => r.revenue > 0 && r.source === "demo")).toBe(true);
  });
  it("gives the marketplaces their own ad spend and retail none", async () => {
    const rows = (await new SeedRepository().getChannelSales("kettle", "2026-03-01", "2026-03-31"))!;
    expect(rows.filter((r) => r.channel === "amazon").every((r) => r.adSpend > 0)).toBe(true);
    expect(rows.filter((r) => r.channel === "tiktok_shop").every((r) => r.adSpend > 0)).toBe(true);
    expect(rows.filter((r) => r.channel === "retail").every((r) => r.adSpend === 0)).toBe(true);
  });
  it("has nothing after the last day with data", async () => {
    expect(await new SeedRepository().getChannelSales("kettle", "2031-01-01", "2031-01-31")).toEqual([]);
  });
});

describe("saving imported sales", () => {
  it("replaces only the days in the file, and an imported day wins over a generated one", async () => {
    const repo = new SeedRepository();
    await repo.saveChannelSales("kettle", "amazon", [row("2026-03-05", 123)]);
    const days = (await repo.getChannelSales("kettle", "2026-03-04", "2026-03-06"))!.filter((r) => r.channel === "amazon");
    expect(days.map((r) => [r.date, r.source])).toEqual([
      ["2026-03-04", "demo"],
      ["2026-03-05", "import"],
      ["2026-03-06", "demo"],
    ]);
    expect(days[1].revenue).toBe(123);
  });
  it("replaces a day that is imported again, with all its retailers", async () => {
    const repo = new SeedRepository();
    await repo.saveChannelSales("kettle", "retail", [row("2026-03-05", 100, { channel: "retail", retailer: "Target" }), row("2026-03-05", 50, { channel: "retail", retailer: "H-E-B" })]);
    await repo.saveChannelSales("kettle", "retail", [row("2026-03-05", 70, { channel: "retail", retailer: "Target" })]);
    const day = (await repo.getChannelSales("kettle", "2026-03-05", "2026-03-05"))!.filter((r) => r.channel === "retail");
    expect(day.map((r) => [r.retailer, r.revenue])).toEqual([["Target", 70]]);
  });
  it("keeps the channel of the import, whatever the rows say", async () => {
    const repo = new SeedRepository();
    await repo.saveChannelSales("kettle", "amazon", [row("2026-03-05", 9, { channel: "something else" })]);
    const day = (await repo.getChannelSales("kettle", "2026-03-05", "2026-03-05"))!;
    expect(day.filter((r) => r.channel === "amazon")[0].revenue).toBe(9);
  });
});

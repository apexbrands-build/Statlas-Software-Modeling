import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { emptyTotals } from "../metrics";
import type { MarketingEvent } from "../planning/events";
import { FLAT_SEASONALITY, generateMonth } from "../planning/generate";
import { DEFAULT_CREATIVE } from "../planning/models";
import { planFigures } from "../planning/summary";
import { blankInputs, type PlanMonth, type PlanMonthInputs } from "../planning/types";
import type { ClientSettings, DailyFact } from "../types";
import { computeCreativeMonth, creativeInsights, isStale, keepCreative, launchProgress, lockAll, regenerateCreative, yearTable, type CreativeMonth } from "./plan";
import { creativeScore } from "./score";
import { launchedAd, monthAgg } from "./fixtures";
import type { CreativeHistory } from "./types";

const ev = (type: string, date: string, endDate = date): MarketingEvent => ({ id: `${type}-${date}`, clientId: "c1", date, endDate, type, name: type, source: "manual" });
const inputsFor = (over: Partial<PlanMonthInputs> = {}): PlanMonthInputs => ({ ...blankInputs(), spend: 110000, amer: 2, platformPct: { meta: 80, google: 20 }, ...over });
const NOW = "2026-09-30T12:00:00.000Z";

/** Four complete months at 50,000 non-catalog spend of which 35,000 is carried (carry 0.7) and three ads averaging 300 in their first 30 days. */
const history = (over: Partial<CreativeHistory> = {}): CreativeHistory => ({
  asOf: "2026-09-30",
  months: ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"].map((m) => monthAgg(m, 50000, 35000)),
  ads: [launchedAd({ adId: "a", launchDate: "2026-06-01", spend30: 0 }), launchedAd({ adId: "b", launchDate: "2026-06-05", spend30: 300 }), launchedAd({ adId: "c", launchDate: "2026-06-10", spend30: 600 })],
  days: [],
  scoreAds: [],
  ...over,
});
const compute = (o: Partial<Parameters<typeof computeCreativeMonth>[0]> = {}) =>
  computeCreativeMonth({ month: "2026-09-01", inputs: inputsFor(), history: history(), events: [], planNonCatalog: {}, now: NOW, ...o });

describe("computeCreativeMonth without usable ad-level spend", () => {
  const facts = { byMonth: { "2026-08-01": 50000 }, last30: 48000 };

  it("never treats current spend as 0 when there is no ad history: it falls back to the campaign-level Meta spend and says so", () => {
    const c = compute({ history: null, metaFacts: facts })!;
    expect(c.basis.currentSpend).toBe(50000);
    expect(c.basis.currentSource).toBe("facts");
    expect(c.needed).toBe(Math.ceil((88000 - 50000 * 0.725) / 295 - 1e-9));
  });

  it("falls back for a month the ad history has no row for, and uses the ad history for a month it has", () => {
    const noAug = history({ months: history().months.filter((m) => m.month !== "2026-08-01") });
    expect(compute({ history: noAug, metaFacts: facts })!.basis).toMatchObject({ currentSpend: 50000, currentSource: "facts" });
    expect(compute({ metaFacts: { byMonth: { "2026-08-01": 1 }, last30: 1 } })!.basis).toMatchObject({ currentSpend: 50000, currentSource: "actual" });
  });

  it("for the open month with no ad days, uses the last 30 days of campaign spend", () => {
    const c = compute({ month: "2026-10-01", history: null, metaFacts: facts })!;
    expect(c.basis).toMatchObject({ currentSpend: 48000, currentSource: "facts" });
  });

  it("still says 0 when there is no ad history and no campaign spend either", () => {
    expect(compute({ history: null })!.basis).toMatchObject({ currentSpend: 0, currentSource: "actual" });
  });
});

describe("computeCreativeMonth: what the model says and what was typed", () => {
  it("keeps the model's own need next to a typed one, and the raw Meta spend", () => {
    const c = compute({ overrides: { needed: 40 } })!;
    expect(c.needed).toBe(40);
    expect(c.basis.modelNeeded).toBe(177);
    expect(c.basis.metaSpend).toBe(88000);
    expect(compute()!.basis.modelNeeded).toBe(177);
  });
});

describe("computeCreativeMonth", () => {
  it("asks for the ads the Meta target needs beyond what carries over: (88,000 - 50,000 x 0.7) / 300 = 177", () => {
    const c = compute()!;
    expect(c.needed).toBe(177);
    expect(c.basis).toMatchObject({ targetSpend: 88000, currentSpend: 50000, spendPerAd: 300, source: "account", reason: "ok", videoShare: 0.5 });
    expect(c.basis.carryRate).toBeCloseTo(0.7, 10);
    expect(c.computedAt).toBe(NOW);
    expect(c.locked).toBe(false);
  });

  it("splits the need into moments (the calendar's share of the month) and evergreen, and each part into video and image", () => {
    const c = compute({ events: [ev("promotion", "2026-09-01", "2026-09-06")] })!;
    expect(c.basis.momentsShare).toBeCloseTo(0.2, 10);
    expect(c.moments).toBe(35);
    expect(c.evergreen).toBe(142);
    expect(c.split.moments.video + c.split.moments.image).toBe(35);
    expect(c.split.evergreen.video + c.split.evergreen.image).toBe(142);
    expect(c.moments + c.evergreen).toBe(c.needed);
  });

  it("follows the strategist's overrides: a typed need, carry rate, spend per ad or moments share", () => {
    const cal = [ev("promotion", "2026-09-01", "2026-09-06")];
    const typed = compute({ events: cal, overrides: { needed: 40 } })!;
    expect([typed.needed, typed.moments, typed.evergreen]).toEqual([40, 8, 32]);
    expect(compute({ overrides: { carryRate: 1 } })!.needed).toBe(127);
    expect(compute({ overrides: { spendPerAd: 400 } })!.needed).toBe(133);
    const share = compute({ events: cal, overrides: { momentsShare: 0.1 } })!;
    expect(share.moments).toBe(18);
    expect(share.basis.momentsShare).toBe(0.1);
    expect(compute({ overrides: { carryRate: 1 } })!.overrides).toEqual({ carryRate: 1 });
  });

  it("needs no ads when the spend already running covers the target, and says so", () => {
    const c = compute({ inputs: inputsFor({ spend: 20000 }) })!;
    expect(c.needed).toBe(0);
    expect(c.basis.reason).toBe("covered");
  });

  it("needs no ads, and says why, when the month plans no Meta spend", () => {
    const c = compute({ inputs: inputsFor({ platformPct: { google: 100 } }) })!;
    expect(c.needed).toBe(0);
    expect(c.basis.reason).toBe("no_meta_spend");
  });

  it("leaves catalog spend out of the target using the last three complete months' catalog share", () => {
    const months = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"].map((m) => monthAgg(m, 40000, 28000, 10000));
    const c = compute({ history: history({ months }) })!;
    expect(c.basis.targetSpend).toBeCloseTo(70400, 6);
    expect(c.needed).toBe(142);
  });

  it("uses the Canon defaults when there is no ad history (carry 0.725, 295 per ad)", () => {
    const c = compute({ history: null })!;
    expect(c.basis).toMatchObject({ carryRate: 0.725, spendPerAd: 295, source: "defaults" });
    expect(c.needed).toBe(299);
  });

  it("is null for a month with no plan inputs", () => {
    expect(compute({ inputs: null })).toBeNull();
  });
});

const saved = (over: Partial<CreativeMonth> = {}): CreativeMonth => ({
  needed: 10, evergreen: 8, moments: 2, split: { evergreen: { video: 4, image: 4 }, moments: { video: 1, image: 1 } },
  basis: { metaSpend: 1000, targetSpend: 1000, currentSpend: 0, currentSource: "actual", modelNeeded: 10, carryRate: 0.7, spendPerAd: 300, momentsShare: 0.2, videoShare: 0.5, source: "defaults", reason: "ok" },
  overrides: {}, locked: false, computedAt: NOW, ...over,
});
const month = (m: string, inputs: PlanMonthInputs | null, locked = false): PlanMonth => ({ month: `${m}-01`, inputs, status: "in_progress", locked });

describe("regenerateCreative", () => {
  const A = month("2026-01", inputsFor({ creative: saved({ overrides: { carryRate: 0.9 } }) }));
  const B = month("2026-02", inputsFor({ creative: saved({ needed: 77 }) }), true);
  const C = month("2026-03", inputsFor({ creative: saved({ needed: 88, locked: true }) }));
  const D = month("2026-04", null);
  const E = month("2026-05", inputsFor());

  it("recomputes unlocked months with their saved overrides, and leaves a locked month (plan or creative) exactly as saved", () => {
    const calls: [string, unknown][] = [];
    const out = regenerateCreative([A, B, C, D, E], (m, o) => (calls.push([m.month, o]), saved({ needed: 1, overrides: o })));
    expect(calls).toEqual([["2026-01-01", { carryRate: 0.9 }], ["2026-05-01", {}]]);
    expect(out["2026-02-01"]).toBe(B.inputs!.creative);
    expect(out["2026-03-01"]).toBe(C.inputs!.creative);
    expect(out["2026-01-01"].overrides).toEqual({ carryRate: 0.9 });
  });

  it("skips months with no inputs, and a locked month that has no creative block yet", () => {
    const out = regenerateCreative([D, month("2026-06", inputsFor(), true)], () => saved());
    expect(out).toEqual({});
  });

  it("drops a month whose compute gives nothing", () => {
    expect(regenerateCreative([E], () => null)).toEqual({});
  });
});

describe("lockAll, isStale and keepCreative", () => {
  it("lockAll locks or unlocks every month that has a creative block and ignores the rest", () => {
    const ms = [month("2026-01", inputsFor({ creative: saved() })), month("2026-02", inputsFor()), month("2026-03", null)];
    expect(Object.keys(lockAll(ms, true))).toEqual(["2026-01-01"]);
    expect(lockAll(ms, true)["2026-01-01"].locked).toBe(true);
    expect(lockAll([month("2026-01", inputsFor({ creative: saved({ locked: true }) }))], false)["2026-01-01"].locked).toBe(false);
  });

  it("isStale when the plan's Meta spend moved more than 1% from the one the block was computed for", () => {
    const c = saved({ basis: { ...saved().basis, metaSpend: 88000 } });
    expect(isStale(c, 88000)).toBe(false);
    expect(isStale(c, 88500)).toBe(false);
    expect(isStale(c, 89000)).toBe(true);
    expect(isStale(saved({ basis: { ...saved().basis, metaSpend: 0 } }), 0)).toBe(false);
    expect(isStale(saved({ basis: { ...saved().basis, metaSpend: 0 } }), 100)).toBe(true);
  });

  it("isStale does not fire just because the catalog share moved while the plan's Meta spend did not", () => {
    const c = saved({ basis: { ...saved().basis, metaSpend: 88000, targetSpend: 79200 } });
    expect(isStale(c, 88000)).toBe(false);
  });

  it("keepCreative carries the creative block onto freshly filled inputs, and gives null for null", () => {
    const prev = inputsFor({ creative: saved({ needed: 5 }) });
    expect(keepCreative(prev, inputsFor({ spend: 1 }))!.creative!.needed).toBe(5);
    expect(keepCreative(null, inputsFor())!.creative).toBeUndefined();
    expect(keepCreative(prev, null)).toBeNull();
  });
});

describe("launchProgress", () => {
  it("counts the month's launches as moment or evergreen and video or image (carousel counts as image), ignoring catalog ads and other months", () => {
    const events = [ev("black_friday", "2026-11-27", "2026-11-30")];
    const ads = [
      launchedAd({ adId: "m1", launchDate: "2026-11-20", format: "video" }),
      launchedAd({ adId: "e1", launchDate: "2026-11-02", format: "carousel" }),
      launchedAd({ adId: "cat", launchDate: "2026-11-20", format: "video", isCatalog: true }),
      launchedAd({ adId: "oct", launchDate: "2026-10-20", format: "video" }),
    ];
    expect(launchProgress(ads, events, "2026-11-01", 14)).toEqual({ moments: { video: 1, image: 0 }, evergreen: { video: 0, image: 1 } });
  });
});

describe("yearTable", () => {
  const settings: ClientSettings = { ...defaultSettings("c1"), excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false };
  const fact = (date: string, metaSpend: number, platformRevenue: number, newRevenue: number): DailyFact => {
    const channels = emptyTotals().channels;
    channels.meta_acquisition = { spend: metaSpend, platformRevenue, platformPurchases: 1 };
    return { clientId: "c1", date, grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: newRevenue, returningOrderRevenue: 0, newOrders: 1, returningOrders: 0, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels };
  };
  const h = history({ months: [monthAgg("2025-09-01", 1000, 0, 0, { video: 3, image: 2 }), monthAgg("2026-09-01", 2000, 0, 0, { video: 4 })] });
  const months: PlanMonth[] = Array.from({ length: 12 }, (_, i) => month(`2026-${String(i + 1).padStart(2, "0")}`, null));
  months[8] = month("2026-09", inputsFor({ creative: saved({ needed: 40 }) }));
  months[10] = month("2026-11", inputsFor({ spend: 100000, amer: 2.5, platformPct: { meta: 100 }, creative: saved({ needed: 50 }) }));
  const t = yearTable({ year: 2026, months, history: h, facts: [fact("2025-09-10", 1000, 3000, 2500), fact("2026-09-10", 2000, 5000, 5000)], settings, lastData: "2026-09-30" });
  const sep = t.rows[8];
  const nov = t.rows[10];

  it("has twelve rows, January first", () => {
    expect(t.rows).toHaveLength(12);
    expect(t.rows[0].month).toBe("2026-01-01");
  });

  it("an elapsed month shows what happened: launches, Meta spend and aMER, next to last year's", () => {
    expect(sep).toMatchObject({ target: 40, launchedThisYear: 4, launchedLastYear: 5, metaSpendLastYear: 1000, spendThisYear: 2000, spendIsActual: true });
    expect(sep.amerLastYear).toBeCloseTo(2.5, 10);
    expect(sep.roasLastYear).toBeCloseTo(3, 10);
    expect(sep.amerThisYear).toBeCloseTo(2.5, 10);
  });

  it("a month still to come shows the plan: its Meta spend and aMER", () => {
    expect(nov).toMatchObject({ target: 50, spendThisYear: 100000, spendIsActual: false, amerThisYear: 2.5 });
  });

  it("a month with no launches shows 0, not null, and one with no plan has no target", () => {
    expect(t.rows[0].launchedThisYear).toBe(0);
    expect(t.rows[0].launchedLastYear).toBe(0);
    expect(t.rows[0].target).toBeNull();
  });

  it("the total row adds up the rows", () => {
    const sum = (f: (r: (typeof t.rows)[number]) => number | null) => t.rows.reduce((a, r) => a + (f(r) ?? 0), 0);
    expect(t.total.target).toBe(sum((r) => r.target));
    expect(t.total.target).toBe(90);
    expect(t.total.launchedThisYear).toBe(sum((r) => r.launchedThisYear));
    expect(t.total.launchedLastYear).toBe(sum((r) => r.launchedLastYear));
    expect(t.total.metaSpendLastYear).toBe(sum((r) => r.metaSpendLastYear));
    expect(t.total.spendThisYear).toBe(sum((r) => r.spendThisYear));
  });

  it("works with no ad history at all", () => {
    const none = yearTable({ year: 2026, months, history: null, facts: [], settings, lastData: "2026-09-30" });
    expect(none.rows).toHaveLength(12);
    expect(none.total.launchedThisYear).toBe(0);
  });
});

describe("creativeInsights", () => {
  const metrics = { zeroRevenue: 0.5, concentration: 0.2, roasDegradation: -0.05, spendDegradation: -0.2, evergreenShare: 0.4 };

  it("for a score under 50 says the account needs more new ads, names the weakest and strongest part, and stays short", () => {
    const poor = { score: 40, parts: { zeroRevenue: 10, concentration: 90, roasDegradation: 30, spendDegradation: 40, evergreenShare: 30 }, mode: "provisional" as const };
    const out = creativeInsights(poor, metrics, null);
    expect(out.some((s) => /needs more new ads/i.test(s))).toBe(true);
    expect(out.some((s) => /no revenue/i.test(s))).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it("does not say the account needs more ads when the score is 75 or more", () => {
    const great = creativeScore({ zeroRevenue: 0.25, concentration: 0.15, roasDegradation: 0.1, spendDegradation: 0.2, evergreenShare: 0.5 });
    expect(creativeInsights(great, metrics, null).some((s) => /needs more new ads/i.test(s))).toBe(false);
  });

  it("mentions a month that is already covered or has no Meta spend", () => {
    const part = { score: 60, parts: { zeroRevenue: 60, concentration: 60, roasDegradation: 60, spendDegradation: 60, evergreenShare: 60 }, mode: "provisional" as const };
    expect(creativeInsights(part, metrics, saved({ basis: { ...saved().basis, reason: "covered" } })).join(" ")).toMatch(/already covered|covers/i);
    expect(creativeInsights(part, metrics, saved({ basis: { ...saved().basis, reason: "no_meta_spend" } })).join(" ")).toMatch(/no Meta spend/i);
  });

  it("says when the need was typed over the model, with the model's number, instead of describing a calculation that was not used", () => {
    const part = { score: 60, parts: { zeroRevenue: 60, concentration: 60, roasDegradation: 60, spendDegradation: 60, evergreenShare: 60 }, mode: "provisional" as const };
    const typed = saved({ needed: 40, overrides: { needed: 40 }, basis: { ...saved().basis, reason: "covered", modelNeeded: 0 } });
    const text = creativeInsights(part, metrics, typed).join(" ");
    expect(text).toMatch(/typed 40/i);
    expect(text).toMatch(/model gives 0/i);
    expect(text).not.toMatch(/already covered|no new ads are needed/i);
  });

  it("explains there is not enough data when no part could be scored", () => {
    const none = creativeScore({ zeroRevenue: null, concentration: null, roasDegradation: null, spendDegradation: null, evergreenShare: null });
    const out = creativeInsights(none, { zeroRevenue: null, concentration: null, roasDegradation: null, spendDegradation: null, evergreenShare: null }, null);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/not enough/i);
  });
});

describe("the creative block never changes a target", () => {
  const settings: ClientSettings = defaultSettings("c1");
  const base = inputsFor({ spend: 30000, amer: 2, returningRevenue: 20000 });
  const gen = (inputs: PlanMonthInputs) => generateMonth({ planId: "p", clientId: "c1", month: "2026-11-01", inputs, seasonality: FLAT_SEASONALITY, deliveryCostPerOrder: 1, excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false });

  it("generateMonth returns identical daily rows with and without a creative block", () => {
    expect(gen({ ...base, creative: saved({ needed: 99 }) })).toEqual(gen(base));
  });

  it("planFigures gives the same figures both ways", () => {
    const rows = gen(base);
    const plain = [month("2026-11", base)];
    const withBlock = [month("2026-11", { ...base, creative: saved({ needed: 99 }) })];
    expect(planFigures(rows, withBlock, 2026, settings)).toEqual(planFigures(rows, plain, 2026, settings));
  });

  it("the model's own settings start at a 14-day lead and the calendar rule", () => {
    expect(DEFAULT_CREATIVE).toEqual({ leadDays: 14, momentRule: "calendar" });
  });
});

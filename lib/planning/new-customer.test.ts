import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { buildSpendTable, curveAmer, curveMarginal, evaluateSpend, fitNewCustomerModel, niceStep, optimalSpend, type Curve, type DayPoint, type ModelSettings } from "./new-customer";

const settings: ModelSettings = {
  newCostPct: 26,
  returningCostPct: 26,
  aov: 83.66,
  ltv60Multiplier: 1.12,
  ltv365Multiplier: 1.2604,
  overModelPct: 0,
  minCm: 0,
  minCm60: 0,
  minCm365: 0,
};

// Deterministic pseudo-noise so the test is stable.
const noise = (i: number) => Math.sin(i * 12.9898) * 0.5;

function synthetic(days: number, truth: Curve, flatDow = true): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays("2025-01-01", i);
    const spend = 2000 + ((i * 37) % 60) * 100; // 2,000 .. 7,900 a day
    const amer = curveAmer(truth, spend) * (1 + noise(i) * 0.1);
    out.push({ date, spend, newRevenue: spend * amer * (flatDow ? 1 : 1) });
  }
  return out;
}

describe("new customer model fit", () => {
  const flat = [0, 0, 0, 0, 0, 0, 0];

  it("recovers a power curve from noisy days", () => {
    const truth: Curve = { kind: "power", a: 40, b: -0.5, r2: 1 };
    const fit = fitNewCustomerModel(synthetic(500, truth), flat, { kind: "power" });
    expect(fit).not.toBeNull();
    expect(fit!.curve.b).toBeCloseTo(-0.5, 1);
    expect(fit!.curve.r2).toBeGreaterThan(0.9);
  });

  it("recovers a linear curve and prefers it when it fits better", () => {
    const truth: Curve = { kind: "linear", a: 5, b: -0.0004, r2: 1 };
    const fit = fitNewCustomerModel(synthetic(500, truth), flat, { kind: "auto" });
    expect(fit!.curve.kind).toBe("linear");
    expect(fit!.curve.b).toBeCloseTo(-0.0004, 4);
  });

  it("uses the revenue line (aMER_ModelV2 method) by default", () => {
    const fit = fitNewCustomerModel(synthetic(500, { kind: "power", a: 40, b: -0.5, r2: 1 }), flat);
    expect(fit!.curve.kind).toBe("revenue");
  });

  it("actualizing with recent data moves the curve toward recent behaviour", () => {
    // Older days follow one curve; the last 60 days have a higher curve (more spending power).
    const old: Curve = { kind: "linear", a: 5, b: -0.0004, r2: 1 };
    const better: Curve = { kind: "linear", a: 6.5, b: -0.0004, r2: 1 };
    const pts = synthetic(500, old);
    const cut = pts[440].date;
    const recent = synthetic(500, better).filter((p) => p.date >= cut);
    const mixed = [...pts.filter((p) => p.date < cut), ...recent];
    const plain = fitNewCustomerModel(mixed, flat)!;
    const act = fitNewCustomerModel(mixed, flat, { recent: { from: cut, weight: 20 } })!;
    const at = (f: typeof plain) => curveAmer(f.curve, 5000);
    expect(at(act)).toBeGreaterThan(at(plain));
    expect(at(act)).toBeLessThanOrEqual(curveAmer(better, 5000) + 0.2);
  });

  it("returns null with too little data", () => {
    expect(fitNewCustomerModel(synthetic(30, { kind: "power", a: 40, b: -0.5, r2: 1 }), flat)).toBeNull();
  });

  it("drops Black Friday week and outliers", () => {
    const truth: Curve = { kind: "power", a: 40, b: -0.5, r2: 1 };
    const pts = synthetic(500, truth);
    pts[10] = { ...pts[10], newRevenue: pts[10].spend * 60 }; // absurd day
    const fit = fitNewCustomerModel(pts, flat)!;
    expect(fit.dropped.some((d) => d.date === pts[10].date && d.reason === "outlier")).toBe(true);
    expect(fit.dropped.some((d) => d.reason === "bfcm")).toBe(true);
  });
});

describe("spend table", () => {
  const curve: Curve = { kind: "power", a: 40, b: -0.5, r2: 1 };

  it("matches the reference tool's arithmetic for CM and LTV", () => {
    // Reference: spend 95,617, new revenue 197,239, cost 26% -> CM 50,340.
    const p = evaluateSpend({ kind: "power", a: 1, b: 0, r2: 1 }, { ...settings, ltv365Multiplier: 1.2604 }, 95617, 31);
    expect(p.amer).toBeCloseTo(1, 6);
    const cm = 197239 * (1 - 0.26) - 95617;
    expect(Math.round(cm)).toBe(50340);
    // 1-year LTV revenue = orders x AOV x multiplier = new revenue x 1.2604
    expect(p.ltv365Revenue / p.newRevenue).toBeCloseTo(1.2604, 6);
    expect(p.cac).toBeCloseTo(83.66, 2); // aMER 1 -> CAC = AOV
  });

  it("aMER falls and revenue rises as spend rises; markers are ordered by payback horizon", () => {
    const t = buildSpendTable(curve, settings, 30, 400000, 5000);
    const amers = t.points.map((p) => p.amer);
    expect(amers.every((a, i) => i === 0 || a < amers[i - 1])).toBe(true);
    const revs = t.points.map((p) => p.newRevenue);
    expect(revs.every((r, i) => i === 0 || r > revs[i - 1])).toBe(true);
    // Longer horizons justify spending at least as much.
    const cm = optimalSpend(t, "cm")!;
    const cm60 = optimalSpend(t, "cm60")!;
    const cm365 = optimalSpend(t, "cm365")!;
    expect(cm60).toBeGreaterThanOrEqual(cm);
    expect(cm365).toBeGreaterThanOrEqual(cm60);
  });

  it("applies % over model and minimum constraints", () => {
    const base = evaluateSpend(curve, settings, 100000, 30);
    const over = evaluateSpend(curve, { ...settings, overModelPct: 25 }, 100000, 30);
    expect(over.amer / base.amer).toBeCloseTo(1.25, 6);
    const t = buildSpendTable(curve, { ...settings, minCm: 1e12 }, 30, 100000, 5000);
    expect(t.best.cm).toBeNull();
  });

  it("niceStep rounds to 1/2/5", () => {
    expect(niceStep(4200)).toBe(5000);
    expect(niceStep(1800)).toBe(2000);
    expect(niceStep(900)).toBe(1000);
  });
});

describe("Max markers stay inside the spend range the history supports", () => {
  it("never picks a Max point above markerMax, even when CM keeps rising", () => {
    // revenue line with marginal return 2.2 per $: after a 37% cost it is 1.39 per $, so CM only ever rises with spend
    const curve: Curve = { kind: "revenue", a: 3000, b: 2.2, r2: 1 };
    const s: ModelSettings = { ...settings, newCostPct: 37 };
    const open = buildSpendTable(curve, s, 30, 300000, 10000);
    expect(optimalSpend(open, "cm")).toBe(300000); // without a cap the "best" is the edge of the table (the bug seen in Oct)
    const capped = buildSpendTable(curve, s, 30, 300000, 10000, 1, 40000);
    expect(optimalSpend(capped, "cm")).toBe(40000);
    expect(optimalSpend(capped, "revenue")).toBe(40000);
  });
});

describe("guardrail beyond the observed spend", () => {
  const base: Curve = { kind: "revenue", a: 3000, b: 2.2, r2: 1 };
  const guarded = (gamma: number): Curve => ({ ...base, guard: { s0: 1000, gamma } });

  it("changes nothing inside the observed range and is continuous at its edge", () => {
    expect(curveAmer(guarded(1), 800)).toBeCloseTo(curveAmer(base, 800), 9);
    expect(curveAmer(guarded(1), 1000)).toBeCloseTo(curveAmer(base, 1000), 9);
    expect(curveAmer(guarded(1), 1000.001)).toBeCloseTo(curveAmer(base, 1000), 2);
  });

  it("fades returns the further spend goes past history (50x spend is far below the unguarded line)", () => {
    const x = 50_000;
    expect(curveAmer(base, x)).toBeCloseTo(2.26, 1); // the bug: still profitable at 50x
    expect(curveAmer(guarded(1), x)).toBeLessThan(0.6);
    expect(curveAmer(guarded(2), x)).toBeLessThan(curveAmer(guarded(1), x));
    expect(curveAmer(guarded(0.5), x)).toBeGreaterThan(curveAmer(guarded(1), x));
    expect(curveMarginal(guarded(1), x)).toBeCloseTo(2.2 / 50, 6);
  });

  it("gives Max CM an interior optimum a little beyond history instead of the table's edge", () => {
    const s: ModelSettings = { ...settings, newCostPct: 37 };
    const t = buildSpendTable(guarded(1), s, 1, 20_000, 100);
    const best = optimalSpend(t, "cm")!;
    expect(best).toBeGreaterThan(1000);
    expect(best).toBeLessThan(2000); // marginal return 2.2·(1000/x) × 0.63 = 1 at x ≈ 1,390
  });
});

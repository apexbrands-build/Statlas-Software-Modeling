import { isBfcm } from "./history";

/**
 * New Customer Model: how new-customer revenue (aMER) falls as spend rises.
 * Method follows the aMER_ModelV2 pipeline: weekday-adjust each day's aMER, drop outliers (IQR), fit aMER against spend.
 * Two curve shapes are tried and the better fit (R²) is used unless the user picks one:
 *   linear  aMER = a + b·spend      (the repo's method; revenue then peaks and turns down)
 *   power   aMER = a·spend^b        (never negative, flattens out; looks like the Statlas curve)
 * Everything is fitted on DAILY spend, then shown on monthly spend (daily × days in the month).
 */

export interface DayPoint {
  date: string;
  /** Spend that counts toward aMER (brand / returning spend already removed per client settings). */
  spend: number;
  newRevenue: number;
}

export type CurveKind = "linear" | "power";

export interface Curve {
  kind: CurveKind;
  a: number;
  b: number;
  /** R² measured on aMER (not on the log). */
  r2: number;
}

export interface FitResult {
  curve: Curve;
  alternatives: Record<CurveKind, Curve | null>;
  /** Days used in the fit, with weekday-adjusted aMER. */
  used: { date: string; spend: number; amer: number; adjAmer: number }[];
  dropped: { date: string; reason: "bfcm" | "outlier" | "excluded" }[];
  /** 90th percentile of (actual adjusted aMER / model) - 1, in %: how far above the average line the good days sit. */
  recommendedOverPct: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Least squares y = a + b·x; `ws` optionally weights each point (recent days count more when actualizing). Null when x has no spread. */
export function ols(xs: number[], ys: number[], ws?: number[]): { a: number; b: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const w = ws ?? xs.map(() => 1);
  const sw = w.reduce((a, b) => a + b, 0);
  const mx = xs.reduce((a, x, i) => a + x * w[i], 0) / sw;
  const my = ys.reduce((a, y, i) => a + y * w[i], 0) / sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += w[i] * (xs[i] - mx) ** 2;
    sxy += w[i] * (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

export function curveAmer(c: Curve, dailySpend: number): number {
  if (dailySpend <= 0) return 0;
  if (c.kind === "linear") return Math.max(0, c.a + c.b * dailySpend);
  return c.a * dailySpend ** c.b;
}

/** Marginal new revenue per extra unit of spend at this daily spend (d(spend·aMER)/d(spend)). */
export function curveMarginal(c: Curve, dailySpend: number): number {
  if (dailySpend <= 0) return 0;
  if (c.kind === "linear") return Math.max(0, c.a + 2 * c.b * dailySpend);
  return c.a * (1 + c.b) * dailySpend ** c.b;
}

function r2Of(c: Curve, pts: { spend: number; adjAmer: number }[]): number {
  const my = mean(pts.map((p) => p.adjAmer));
  let ssRes = 0;
  let ssTot = 0;
  for (const p of pts) {
    ssRes += (p.adjAmer - curveAmer(c, p.spend)) ** 2;
    ssTot += (p.adjAmer - my) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

function fitKind(kind: CurveKind, pts: { spend: number; adjAmer: number; w: number }[]): Curve | null {
  const ws = pts.map((p) => p.w);
  if (kind === "linear") {
    const f = ols(pts.map((p) => p.spend), pts.map((p) => p.adjAmer), ws);
    if (!f) return null;
    const c: Curve = { kind, a: f.a, b: f.b, r2: 0 };
    return { ...c, r2: r2Of(c, pts) };
  }
  const f = ols(pts.map((p) => Math.log(p.spend)), pts.map((p) => Math.log(p.adjAmer)), ws);
  if (!f) return null;
  const c: Curve = { kind, a: Math.exp(f.a), b: f.b, r2: 0 };
  return { ...c, r2: r2Of(c, pts) };
}

/**
 * Fits the curve. `dowOffsets` are the weekday offsets in % (index 0 = Sunday), as in the plan's weekday pattern.
 * `kind` defaults to the straight line (the aMER_ModelV2 method); "auto" picks whichever shape fits better.
 * `recent` actualizes the model: days on or after `recent.from` count `recent.weight` times as much, so a curve that has moved
 * (more spend without the same drop in efficiency) is picked up without throwing the history away.
 * `skipDate` lets the event model remove days driven by marketing events. Returns null with too little data (< 60 usable days).
 */
export interface FitOptions {
  kind?: CurveKind | "auto";
  recent?: { from: string; weight: number } | null;
  skipDate?: (date: string) => boolean;
}

export function fitNewCustomerModel(points: DayPoint[], dowOffsets: number[], opts: FitOptions = {}): FitResult | null {
  const dropped: FitResult["dropped"] = [];
  const base: { date: string; spend: number; amer: number; adjAmer: number }[] = [];
  for (const p of points) {
    if (p.spend <= 0 || p.newRevenue <= 0) continue;
    if (isBfcm(p.date)) {
      dropped.push({ date: p.date, reason: "bfcm" });
      continue;
    }
    if (opts.skipDate?.(p.date)) {
      dropped.push({ date: p.date, reason: "excluded" });
      continue;
    }
    const dow = new Date(`${p.date}T00:00:00Z`).getUTCDay();
    const mult = 1 + (dowOffsets[dow] ?? 0) / 100;
    const amer = p.newRevenue / p.spend;
    base.push({ date: p.date, spend: p.spend, amer, adjAmer: amer / (mult > 0 ? mult : 1) });
  }
  if (base.length < 60) return null;

  // IQR fences on the adjusted aMER and on spend.
  const fences = (vals: number[]) => {
    const s = [...vals].sort((x, y) => x - y);
    const q1 = quantile(s, 0.25);
    const q3 = quantile(s, 0.75);
    return { lo: q1 - 1.5 * (q3 - q1), hi: q3 + 1.5 * (q3 - q1) };
  };
  const fa = fences(base.map((p) => p.adjAmer));
  const fs = fences(base.map((p) => p.spend));
  const used = base.filter((p) => {
    const ok = p.adjAmer >= fa.lo && p.adjAmer <= fa.hi && p.spend >= fs.lo && p.spend <= fs.hi;
    if (!ok) dropped.push({ date: p.date, reason: "outlier" });
    return ok;
  });
  if (used.length < 40) return null;

  const weighted = used.map((p) => ({ ...p, w: opts.recent && p.date >= opts.recent.from ? Math.max(1, opts.recent.weight) : 1 }));
  const alternatives: Record<CurveKind, Curve | null> = { linear: fitKind("linear", weighted), power: fitKind("power", weighted) };
  // A positive slope or exponent means "more spend, better aMER": not usable as a spend curve.
  const usable = (c: Curve | null) => (c && c.b < 0 ? c : null);
  const lin = usable(alternatives.linear);
  const pow = usable(alternatives.power);
  const kind = opts.kind ?? "linear";
  const chosen = kind === "auto" ? (lin && pow ? (pow.r2 >= lin.r2 ? pow : lin) : (lin ?? pow)) : usable(alternatives[kind]);
  if (!chosen) return null;

  const ratios = used.map((p) => p.adjAmer / Math.max(curveAmer(chosen, p.spend), 1e-9)).sort((x, y) => x - y);
  const recommendedOverPct = Math.max(0, (quantile(ratios, 0.9) - 1) * 100);
  return { curve: chosen, alternatives, used, dropped, recommendedOverPct: Math.round(recommendedOverPct * 10) / 10 };
}

/* ------------------------------------------------------------------ */
/* Spend table                                                         */
/* ------------------------------------------------------------------ */

export interface ModelSettings {
  /** Costs as % of new order revenue (COGS, delivery, returns, tax). Same for the first order and for later orders. */
  newCostPct: number;
  returningCostPct: number;
  /** New-customer average order value. */
  aov: number;
  /** Repeat revenue within 60 days / 365 days as a multiple of the first order (LTV = AOV x multiplier). */
  ltv60Multiplier: number;
  ltv365Multiplier: number;
  /** How far above the fitted line to plan, % (Statlas "% Over Model"). */
  overModelPct: number;
  /** Points below these are not eligible for the "Max" markers. */
  minCm: number;
  minCm60: number;
  minCm365: number;
}

export interface SpendPoint {
  spend: number;
  amer: number;
  cac: number;
  incAmer: number;
  incCac: number;
  orders: number;
  newRevenue: number;
  cm: number;
  ltv60Revenue: number;
  ltv60Cm: number;
  ltv365Revenue: number;
  ltv365Cm: number;
}

/** Everything the model says about one month spending `monthlySpend` (days = days in that month). */
export function evaluateSpend(curve: Curve, s: ModelSettings, monthlySpend: number, days: number): SpendPoint {
  const x = monthlySpend / days;
  const over = 1 + s.overModelPct / 100;
  const amer = curveAmer(curve, x) * over;
  const incAmer = curveMarginal(curve, x) * over;
  const newRevenue = monthlySpend * amer;
  const orders = s.aov > 0 ? newRevenue / s.aov : 0;
  const cm = newRevenue * (1 - s.newCostPct / 100) - monthlySpend;
  const ltvRev = (mult: number) => orders * s.aov * mult;
  const ltvCm = (mult: number) => {
    const total = ltvRev(mult);
    return newRevenue * (1 - s.newCostPct / 100) + Math.max(0, total - newRevenue) * (1 - s.returningCostPct / 100) - monthlySpend;
  };
  return {
    spend: monthlySpend,
    amer,
    cac: orders > 0 ? monthlySpend / orders : 0,
    incAmer,
    incCac: incAmer > 0 && s.aov > 0 ? s.aov / incAmer : 0,
    orders,
    newRevenue,
    cm,
    ltv60Revenue: ltvRev(s.ltv60Multiplier),
    ltv60Cm: ltvCm(s.ltv60Multiplier),
    ltv365Revenue: ltvRev(s.ltv365Multiplier),
    ltv365Cm: ltvCm(s.ltv365Multiplier),
  };
}

export type OptimizeFor = "cm" | "cm60" | "cm365" | "revenue" | "other";
export const OPTIMIZE_LABELS: Record<OptimizeFor, string> = { cm: "Max CM", cm60: "Max 60-day CM", cm365: "Max 1-year CM", revenue: "Max Revenue", other: "Other" };

export interface SpendTable {
  points: SpendPoint[];
  /** Index into points for each marker (null when no point qualifies). */
  best: Record<Exclude<OptimizeFor, "other">, number | null>;
}

/** A tidy step (1, 2, 5 x 10^n) so the table reads like $5,000, $10,000 ... */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Spend table from `step` up to `maxSpend`, plus the Max CM / 60-day CM / 1-year CM / Revenue markers. */
export function buildSpendTable(curve: Curve, s: ModelSettings, days: number, maxSpend: number, step: number): SpendTable {
  const points: SpendPoint[] = [];
  for (let sp = step; sp <= maxSpend + 1e-9; sp += step) points.push(evaluateSpend(curve, s, sp, days));
  const pick = (value: (p: SpendPoint) => number, min: number) => {
    let bi: number | null = null;
    points.forEach((p, i) => {
      if (min > 0 && value(p) < min) return;
      if (bi === null || value(p) > value(points[bi])) bi = i;
    });
    return bi;
  };
  return {
    points,
    best: {
      cm: pick((p) => p.cm, s.minCm),
      cm60: pick((p) => p.ltv60Cm, s.minCm60),
      cm365: pick((p) => p.ltv365Cm, s.minCm365),
      revenue: pick((p) => p.newRevenue, 0),
    },
  };
}

/** Spend that optimizes the chosen target (a point from the table). */
export function optimalSpend(table: SpendTable, target: Exclude<OptimizeFor, "other">): number | null {
  const i = table.best[target];
  return i === null ? null : table.points[i].spend;
}

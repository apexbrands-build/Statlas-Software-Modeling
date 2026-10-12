import { isBfcm } from "./history";

/**
 * New Customer Model: how new-customer revenue (aMER) falls as spend rises.
 * Default method is the aMER_ModelV2 pipeline (Jack's C code, src/main.c):
 *   1. weekday-adjust each day's aMER,
 *   2. drop outliers: spend buckets (Scott's rule), keep days within ±1σ of their bucket's mean adjusted aMER,
 *   3. straight-line OLS of adjusted REVENUE (spend × adjusted aMER) on daily spend: rev = a + b·spend.
 *      aMER at any spend is rev / spend = b + a/spend; "a" is the implied revenue at $0 spend.
 * Other shapes can be picked (or "auto" compares them on revenue R²):
 *   linear  aMER = a + b·spend      (revenue then peaks and turns down)
 *   power   aMER = a·spend^b        (never negative, flattens out; looks like the Statlas curve)
 * Everything is fitted on DAILY spend, then shown on monthly spend (daily × days in the month).
 */

export interface DayPoint {
  date: string;
  /** Spend that counts toward aMER (brand / returning spend already removed per client settings). */
  spend: number;
  newRevenue: number;
}

export type CurveKind = "revenue" | "linear" | "power";
export const CURVE_LABELS: Record<CurveKind, string> = { revenue: "Revenue line (aMER_ModelV2)", linear: "aMER line", power: "Flattening curve" };

export interface Curve {
  kind: CurveKind;
  /** revenue: intercept (revenue at $0 spend) / linear: intercept / power: scale. */
  a: number;
  /** revenue: slope (marginal revenue per $) / linear: slope / power: exponent. */
  b: number;
  /**
   * Guardrail beyond the spend the history has seen (daily spend `s0`, the 95th-percentile day). The fitted line is only trusted up to
   * s0; past it the marginal revenue per extra $ is the marginal at s0 times (s0/x)^gamma, so returns fade the further spend goes
   * beyond anything the client has run (gamma 1 = revenue grows like a logarithm). Null/absent = follow the fitted line forever.
   */
  guard?: { s0: number; gamma: number } | null;
  /** R² measured on revenue for the revenue line, on aMER for the other shapes (not on the log). */
  r2: number;
}

export interface FitResult {
  curve: Curve;
  alternatives: Record<CurveKind, Curve | null>;
  /** Days used in the fit, with weekday-adjusted aMER. */
  used: { date: string; spend: number; amer: number; adjAmer: number }[];
  dropped: { date: string; reason: "bfcm" | "outlier" | "excluded" }[];
  /** Highest daily spend among the days used: beyond it the table is an extrapolation. */
  maxObservedSpend: number;
  /** 90th percentile of (actual adjusted aMER / model) - 1, in %: how far above the average line the good days sit. */
  recommendedOverPct: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

type BasePoint = { date: string; spend: number; amer: number; adjAmer: number };

/** Global IQR fences (1.5×) on adjusted aMER and on spend. */
function iqrFilter(base: BasePoint[]): boolean[] {
  const fences = (vals: number[]) => {
    const s = [...vals].sort((x, y) => x - y);
    const q1 = quantile(s, 0.25);
    const q3 = quantile(s, 0.75);
    return { lo: q1 - 1.5 * (q3 - q1), hi: q3 + 1.5 * (q3 - q1) };
  };
  const fa = fences(base.map((p) => p.adjAmer));
  const fs = fences(base.map((p) => p.spend));
  return base.map((p) => p.adjAmer >= fa.lo && p.adjAmer <= fa.hi && p.spend >= fs.lo && p.spend <= fs.hi);
}

/**
 * Jack's filter (detect_outliers_and_buckets in main.c): bucket days by spend (Scott's rule width 3.5·sd/∛n, at least
 * clamp(√n, 5, 20) buckets), then keep days whose adjusted aMER is within ±1 standard deviation of their bucket's mean.
 */
export function bucketFilter(base: BasePoint[]): boolean[] {
  const n = base.length;
  if (n === 0) return [];
  const spends = base.map((p) => p.spend);
  const min = Math.min(...spends);
  const max = Math.max(...spends);
  const m = mean(spends);
  const variance = n > 1 ? (spends.reduce((a, x) => a + x * x, 0) - n * m * m) / (n - 1) : 0;
  const sd = Math.sqrt(Math.max(variance, 0));
  let width = (3.5 * sd) / Math.cbrt(n);
  if (width <= 0) width = (max - min) / 10 + 1e-6;
  let nbins = Math.max(1, Math.ceil((max - min) / width));
  const minBins = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(n))));
  if (nbins < minBins) {
    nbins = minBins;
    width = (max - min) / nbins;
  }
  const bin = (x: number) => Math.min(nbins - 1, Math.max(0, width > 0 ? Math.floor((x - min) / width) : 0));
  const sum = new Array<number>(nbins).fill(0);
  const sq = new Array<number>(nbins).fill(0);
  const cnt = new Array<number>(nbins).fill(0);
  for (const p of base) {
    const b = bin(p.spend);
    cnt[b] += 1;
    sum[b] += p.adjAmer;
    sq[b] += p.adjAmer ** 2;
  }
  const means = sum.map((v, b) => (cnt[b] ? v / cnt[b] : 0));
  const sds = sq.map((v, b) => (cnt[b] ? Math.sqrt(Math.max(v / cnt[b] - means[b] ** 2, 0)) : 0));
  return base.map((p) => {
    const b = bin(p.spend);
    return p.adjAmer >= means[b] - sds[b] - 1e-12 && p.adjAmer <= means[b] + sds[b] + 1e-12;
  });
}

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

function baseAmer(c: Curve, dailySpend: number): number {
  if (dailySpend <= 0) return 0;
  if (c.kind === "revenue") return Math.max(0, c.b + c.a / dailySpend);
  if (c.kind === "linear") return Math.max(0, c.a + c.b * dailySpend);
  return c.a * dailySpend ** c.b;
}

/** Marginal new revenue per extra unit of spend at this daily spend (d(spend·aMER)/d(spend)) on the fitted shape alone. */
function baseMarginal(c: Curve, dailySpend: number): number {
  if (dailySpend <= 0) return 0;
  if (c.kind === "revenue") return Math.max(0, c.b);
  if (c.kind === "linear") return Math.max(0, c.a + 2 * c.b * dailySpend);
  return c.a * (1 + c.b) * dailySpend ** c.b;
}

export function curveAmer(c: Curve, dailySpend: number): number {
  if (dailySpend <= 0) return 0;
  const g = c.guard;
  if (!g || dailySpend <= g.s0) return baseAmer(c, dailySpend);
  const r0 = g.s0 * baseAmer(c, g.s0);
  const m0 = baseMarginal(c, g.s0);
  const extra = Math.abs(g.gamma - 1) < 1e-9 ? g.s0 * Math.log(dailySpend / g.s0) : (g.s0 ** g.gamma * (dailySpend ** (1 - g.gamma) - g.s0 ** (1 - g.gamma))) / (1 - g.gamma);
  return (r0 + m0 * extra) / dailySpend;
}

/** Marginal new revenue per extra unit of spend at this daily spend. */
export function curveMarginal(c: Curve, dailySpend: number): number {
  if (dailySpend <= 0) return 0;
  const g = c.guard;
  if (!g || dailySpend <= g.s0) return baseMarginal(c, dailySpend);
  return baseMarginal(c, g.s0) * (g.s0 / dailySpend) ** g.gamma;
}

function r2Of(c: Curve, pts: { spend: number; adjAmer: number }[], onRevenue = false): number {
  const f = (p: { spend: number }, v: number) => (onRevenue ? v * p.spend : v);
  const my = mean(pts.map((p) => f(p, p.adjAmer)));
  let ssRes = 0;
  let ssTot = 0;
  for (const p of pts) {
    ssRes += (f(p, p.adjAmer) - f(p, curveAmer(c, p.spend))) ** 2;
    ssTot += (f(p, p.adjAmer) - my) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

function fitKind(kind: CurveKind, pts: { spend: number; adjAmer: number; w: number }[]): Curve | null {
  const ws = pts.map((p) => p.w);
  if (kind === "revenue") {
    const f = ols(pts.map((p) => p.spend), pts.map((p) => p.spend * p.adjAmer), ws);
    if (!f) return null;
    const c: Curve = { kind, a: f.a, b: f.b, r2: 0 };
    return { ...c, r2: r2Of(c, pts, true) };
  }
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
 * `kind` defaults to the revenue line (the aMER_ModelV2 method); "auto" picks whichever shape fits better on revenue R².
 * `recent` actualizes the model: days on or after `recent.from` count `recent.weight` times as much, so a curve that has moved
 * (more spend without the same drop in efficiency) is picked up without throwing the history away.
 * `skipDate` lets the event model remove days driven by marketing events. Returns null with too little data (< 60 usable days).
 */
export interface FitOptions {
  kind?: CurveKind | "auto";
  /** Exponent of the guardrail beyond the observed spend (see Curve.guard): 1 = standard, 0.5 = mild, 2 = strict, null = off. Default 1. */
  guard?: number | null;
  /** "bucket" = Jack's spend-bucket ±1σ filter (default); "iqr" = global 1.5×IQR fences on aMER and spend. */
  outliers?: "bucket" | "iqr";
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

  const filter = (opts.outliers ?? "bucket") === "bucket" ? bucketFilter : iqrFilter;
  let keep: boolean[];
  const recentIdx = opts.recent ? base.map((p, i) => (p.date >= opts.recent!.from ? i : -1)).filter((i) => i >= 0) : [];
  if (opts.recent && recentIdx.length >= 10 && base.length - recentIdx.length >= 30) {
    // Actualizing: the recent days may sit on a different curve on purpose, so each period is judged against its own
    // buckets. Otherwise the filter would throw away the new behaviour as "outliers" of the long history.
    keep = new Array<boolean>(base.length).fill(true);
    const isRecent = new Set(recentIdx);
    const oldIdx = base.map((_, i) => i).filter((i) => !isRecent.has(i));
    for (const idxs of [oldIdx, recentIdx]) {
      const k = filter(idxs.map((i) => base[i]));
      idxs.forEach((i, j) => (keep[i] = k[j]));
    }
  } else keep = filter(base);
  const used = base.filter((p, i) => {
    if (!keep[i]) dropped.push({ date: p.date, reason: "outlier" });
    return keep[i];
  });
  if (used.length < 40) return null;

  const weighted = used.map((p) => ({ ...p, w: opts.recent && p.date >= opts.recent.from ? Math.max(1, opts.recent.weight) : 1 }));
  const alternatives: Record<CurveKind, Curve | null> = { revenue: fitKind("revenue", weighted), linear: fitKind("linear", weighted), power: fitKind("power", weighted) };
  // aMER-line and power shapes need a falling curve (negative slope or exponent); the revenue line needs a positive slope
  // (each extra $ brings revenue), as in the C code. Anything else is not usable as a spend curve.
  const usable = (c: Curve | null) => (c && (c.kind === "revenue" ? c.b > 0 : c.b < 0) ? c : null);
  const kind = opts.kind ?? "revenue";
  let chosen: Curve | null;
  if (kind === "auto") {
    const cands = (["revenue", "linear", "power"] as CurveKind[]).map((k) => usable(alternatives[k])).filter((c): c is Curve => c !== null);
    chosen = cands.sort((x, y) => r2Of(y, used, true) - r2Of(x, used, true))[0] ?? null;
  } else chosen = usable(alternatives[kind]);
  if (!chosen) return null;

  const ratios = used.map((p) => p.adjAmer / Math.max(curveAmer(chosen, p.spend), 1e-9)).sort((x, y) => x - y);
  const recommendedOverPct = Math.max(0, (quantile(ratios, 0.9) - 1) * 100);
  const sortedSpend = used.map((p) => p.spend).sort((x, y) => x - y);
  const s0 = quantile(sortedSpend, 0.95);
  const gamma = opts.guard === undefined ? 1 : opts.guard;
  const guarded: Curve = gamma === null || s0 <= 0 ? chosen : { ...chosen, guard: { s0, gamma } };
  return { curve: guarded, alternatives, used, dropped, maxObservedSpend: Math.max(...used.map((p) => p.spend)), recommendedOverPct: Math.round(recommendedOverPct * 10) / 10 };
}

/* ------------------------------------------------------------------ */
/* Spend table                                                         */
/* ------------------------------------------------------------------ */

/** Estimate of the 90-day multiplier from the 60-day and 1-year ones (straight line between them), used when no 90-day value is known. */
export const interpolate90 = (m60: number, m365: number): number => m60 + ((m365 - m60) * 30) / 305;

export interface ModelSettings {
  /** Costs as % of new order revenue (COGS, delivery, returns, tax). Same for the first order and for later orders. */
  newCostPct: number;
  returningCostPct: number;
  /** New-customer average order value. */
  aov: number;
  /** Repeat revenue within 60 days / 365 days as a multiple of the first order (LTV = AOV x multiplier). */
  ltv60Multiplier: number;
  ltv365Multiplier: number;
  /** 90-day payback; missing = estimated between the 60-day and 1-year multipliers. */
  ltv90Multiplier?: number;
  /** How far above the fitted line to plan, % (Statlas "% Over Model"). */
  overModelPct: number;
  /** Points below these are not eligible for the "Max" markers. */
  minCm: number;
  minCm60: number;
  minCm365: number;
  minCm90?: number;
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
  ltv90Revenue: number;
  ltv90Cm: number;
  ltv365Revenue: number;
  ltv365Cm: number;
}

/** Everything the model says about one month spending `monthlySpend` (days = days in that month). */
export function evaluateSpend(curve: Curve, s: ModelSettings, monthlySpend: number, days: number, seasonIdx = 1): SpendPoint {
  const x = monthlySpend / days;
  const over = (1 + s.overModelPct / 100) * seasonIdx;
  const amer = curveAmer(curve, x) * over;
  const incAmer = curveMarginal(curve, x) * over;
  const newRevenue = monthlySpend * amer;
  const orders = s.aov > 0 ? newRevenue / s.aov : 0;
  const cm = newRevenue * (1 - s.newCostPct / 100) - monthlySpend;
  const m90 = s.ltv90Multiplier ?? interpolate90(s.ltv60Multiplier, s.ltv365Multiplier);
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
    ltv90Revenue: ltvRev(m90),
    ltv90Cm: ltvCm(m90),
    ltv365Revenue: ltvRev(s.ltv365Multiplier),
    ltv365Cm: ltvCm(s.ltv365Multiplier),
  };
}

export type OptimizeFor = "cm" | "cm60" | "cm90" | "cm365" | "revenue" | "other";
export const OPTIMIZE_LABELS: Record<OptimizeFor, string> = { cm: "Max CM", cm60: "Max 60-day CM", cm90: "Max 90-day CM", cm365: "Max 1-year CM", revenue: "Max Revenue at break-even", other: "Other" };

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

/** Spend table from `step` up to `maxSpend`, plus the Max CM / 60-day CM / 90-day CM / 1-year CM / Revenue markers. */
/** `markerMax`: the Max markers are only picked among rows up to this spend (the range the history supports). */
export function buildSpendTable(curve: Curve, s: ModelSettings, days: number, maxSpend: number, step: number, seasonIdx = 1, markerMax?: number): SpendTable {
  const points: SpendPoint[] = [];
  for (let sp = step; sp <= maxSpend + 1e-9; sp += step) points.push(evaluateSpend(curve, s, sp, days, seasonIdx));
  const pick = (value: (p: SpendPoint) => number, min: number, breakEven = false) => {
    let bi: number | null = null;
    points.forEach((p, i) => {
      if (min > 0 && value(p) < min) return;
      if (breakEven && p.cm < 0) return;
      if (markerMax != null && p.spend > markerMax + 1e-9) return;
      if (bi === null || value(p) > value(points[bi])) bi = i;
    });
    return bi;
  };
  return {
    points,
    best: {
      cm: pick((p) => p.cm, s.minCm),
      cm60: pick((p) => p.ltv60Cm, s.minCm60),
      cm90: pick((p) => p.ltv90Cm, s.minCm90 ?? 0),
      cm365: pick((p) => p.ltv365Cm, s.minCm365),
      revenue: pick((p) => p.newRevenue, 0, true),
    },
  };
}

/** Spend that optimizes the chosen target (a point from the table). */
export function optimalSpend(table: SpendTable, target: Exclude<OptimizeFor, "other">): number | null {
  const i = table.best[target];
  return i === null ? null : table.points[i].spend;
}


/* ------------------------------------------------------------------ */
/* Monthly seasonality of spending power                               */
/* ------------------------------------------------------------------ */

/**
 * Index per calendar month (index 0 = January) of how much better or worse than the fitted curve the days of that month
 * performed (adjusted aMER ÷ curve aMER), over all past years. Needs two years of days; each month is pulled toward 1 when
 * it has few days (`(n·avg + k)/(n + k)`, k = 20) and the set is re-centred so the average day stays at 1.
 * Black Friday week and event days are not in `used` already, so they do not leak into November.
 */
export function monthlyAmerIndex(used: { date: string; spend: number; adjAmer: number }[], curve: Curve): { index: number[]; days: number[]; years: number } {
  const flat = { index: new Array<number>(12).fill(1), days: new Array<number>(12).fill(0), years: 0 };
  if (used.length === 0) return flat;
  const years = new Set(used.map((p) => p.date.slice(0, 4))).size;
  const sum = new Array<number>(12).fill(0);
  const cnt = new Array<number>(12).fill(0);
  let all = 0;
  let allN = 0;
  for (const p of used) {
    const model = curveAmer(curve, p.spend);
    if (model <= 0) continue;
    const m = Number(p.date.slice(5, 7)) - 1;
    const r = p.adjAmer / model;
    sum[m] += r;
    cnt[m] += 1;
    all += r;
    allN += 1;
  }
  if (years < 2 || allN === 0) return { ...flat, days: cnt, years };
  const overall = all / allN;
  const K = 20;
  const index = sum.map((v, m) => (cnt[m] ? (v / cnt[m] / overall) * (cnt[m] / (cnt[m] + K)) + K / (cnt[m] + K) : 1));
  return { index, days: cnt, years };
}

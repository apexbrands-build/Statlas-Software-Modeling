/** Creative Demand in the plan: what each month needs (stored in the month's inputs), regeneration, the year table and the plain-language insights. */
import { addDays, addYears, endOfMonth, startOfMonth } from "../dates";
import { aggregate, METRICS } from "../metrics";
import type { MarketingEvent } from "../planning/events";
import type { PlanMonth, PlanMonthInputs } from "../planning/types";
import type { ClientSettings, DailyFact } from "../types";
import { carryRate, catalogShare, currentSpend, metaSpendOf, monthsWithData, neededAds, spendPerNewAd } from "./demand";
import { formatEvidence, formatGroup, splitFormats, videoShare, type FormatCount } from "./format";
import { isMomentAd, momentsShare } from "./moments";
import { scoreLabel, type creativeScore, type MetricKey } from "./score";
import { AD_FORMATS, type CreativeHistory, type LaunchedAd } from "./types";

/** What the strategist typed over the model; each one beats the number the model would have used. */
export interface CreativeOverrides {
  carryRate?: number;
  spendPerAd?: number;
  momentsShare?: number;
  needed?: number;
}

/** One plan month's creative need, kept in `PlanMonthInputs.creative` (inside the saved month inputs, no table of its own). */
export interface CreativeMonth {
  needed: number;
  evergreen: number;
  moments: number;
  split: { evergreen: FormatCount; moments: FormatCount };
  basis: {
    /** The plan month's Meta spend (before leaving out catalog). Staleness compares this one. */
    metaSpend: number;
    targetSpend: number;
    currentSpend: number;
    /** Where current spend came from: last month's ad data, the latest 30 days, the plan, or campaign totals when ad data was missing. */
    currentSource: "actual" | "last30" | "plan" | "facts";
    /** What the model alone asks for, so a typed `needed` can be shown next to it. */
    modelNeeded: number;
    carryRate: number;
    spendPerAd: number;
    momentsShare: number;
    videoShare: number;
    source: "account" | "defaults";
    reason: "ok" | "covered" | "no_meta_spend";
  };
  overrides: CreativeOverrides;
  locked: boolean;
  computedAt: string;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

/**
 * The creative need of one plan month. Target = the month's non-catalog Meta spend; spend already running into the month counts at the carry rate;
 * the rest is divided by what a new ad spends in its first 30 days. A typed `needed` replaces the result, the other overrides replace their input.
 */
export function computeCreativeMonth(a: {
  month: string;
  inputs: PlanMonthInputs | null;
  history: CreativeHistory | null;
  events: MarketingEvent[];
  planNonCatalog: Record<string, number>;
  /** Campaign-level Meta spend (by month and over the latest 30 days): stands in where the ad-level data has nothing. */
  metaFacts?: { byMonth: Record<string, number>; last30: number };
  overrides?: CreativeOverrides;
  now: string;
}): CreativeMonth | null {
  if (!a.inputs) return null;
  const month = startOfMonth(a.month);
  const h = a.history;
  const asOf = h?.asOf ?? a.now.slice(0, 10);
  const openMonth = startOfMonth(asOf);
  const months = h?.months ?? [];
  const ads = h?.ads ?? [];
  const o = a.overrides ?? {};

  const carry = carryRate(months, openMonth);
  const perAd = spendPerNewAd(ads, asOf, monthsWithData(months));
  const meta = metaSpendOf(a.inputs);
  const targetSpend = meta * (1 - catalogShare(months, openMonth));
  const last30 = (h?.days ?? []).filter((d) => d.date > addDays(asOf, -30) && d.date <= asOf).reduce((s, d) => s + d.spend, 0);
  const current = currentSpend(month, { months, openMonth, last30NonCatalog: last30, planNonCatalog: a.planNonCatalog, hasAdDays: (h?.days.length ?? 0) > 0, facts: a.metaFacts });

  const carryUsed = o.carryRate ?? carry.value;
  const perAdUsed = o.spendPerAd ?? perAd.value;
  const calc = neededAds(targetSpend, current.value, carryUsed, perAdUsed);
  const needed = o.needed !== undefined ? Math.max(0, Math.round(o.needed)) : calc.needed;
  const reason = meta <= 0 ? "no_meta_spend" : calc.covered ? "covered" : "ok";

  const share = o.momentsShare !== undefined ? clamp01(o.momentsShare) : momentsShare(month, a.events).share;
  const moments = Math.min(needed, Math.round(needed * share));
  const evergreen = needed - moments;
  const vs = videoShare(formatEvidence(ads, asOf));

  return {
    needed,
    evergreen,
    moments,
    split: { evergreen: splitFormats(evergreen, vs.share), moments: splitFormats(moments, vs.share) },
    basis: {
      metaSpend: meta,
      targetSpend,
      currentSpend: current.value,
      currentSource: current.source,
      modelNeeded: calc.needed,
      carryRate: carryUsed,
      spendPerAd: perAdUsed,
      momentsShare: share,
      videoShare: vs.share,
      source: carry.source === "account" && perAd.source === "account" ? "account" : "defaults",
      reason,
    },
    overrides: o,
    locked: false,
    computedAt: a.now,
  };
}

/**
 * Recomputes the creative block of every plan month that is not locked, passing back the overrides it saved. A month locked in the plan or
 * in its creative block comes back exactly as saved; a month with no inputs has none.
 */
export function regenerateCreative(months: PlanMonth[], compute: (m: PlanMonth, overrides: CreativeOverrides) => CreativeMonth | null): Record<string, CreativeMonth> {
  const out: Record<string, CreativeMonth> = {};
  for (const m of months) {
    if (!m.inputs) continue;
    const saved = m.inputs.creative;
    if (m.locked || saved?.locked) {
      if (saved) out[m.month] = saved;
      continue;
    }
    const c = compute(m, saved?.overrides ?? {});
    if (c) out[m.month] = c;
  }
  return out;
}

/** The creative blocks with `locked` set, for every month that has one. */
export function lockAll(months: PlanMonth[], locked: boolean): Record<string, CreativeMonth> {
  const out: Record<string, CreativeMonth> = {};
  for (const m of months) if (m.inputs?.creative) out[m.month] = { ...m.inputs.creative, locked };
  return out;
}

/**
 * True when the plan month's Meta spend is more than 1% away from the one the block was computed for (a stretch plan, a spend edit after saving).
 * The raw Meta spend is compared, not the target without catalog, so a catalog share that moves as months complete does not raise it.
 */
export function isStale(c: CreativeMonth, metaSpend: number): boolean {
  const was = c.basis.metaSpend ?? c.basis.targetSpend;
  if (was === metaSpend) return false;
  return Math.abs(was - metaSpend) / Math.max(Math.abs(was), Math.abs(metaSpend)) > 0.01;
}

/** A Fill from last year or recent actuals replaces a month's inputs: the month keeps its creative block. */
export function keepCreative(prev: PlanMonthInputs | null, next: PlanMonthInputs | null): PlanMonthInputs | null {
  if (!next) return null;
  return prev?.creative ? { ...next, creative: prev.creative } : next;
}

/** What was launched in a month so far, by moment or evergreen and video or image (carousel counts as image); catalog ads are left out. */
export function launchProgress(ads: LaunchedAd[], events: MarketingEvent[], month: string, leadDays: number): { moments: FormatCount; evergreen: FormatCount } {
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const out = { moments: { video: 0, image: 0 }, evergreen: { video: 0, image: 0 } };
  for (const a of ads) {
    if (a.isCatalog || a.launchDate < from || a.launchDate > to) continue;
    const bucket = isMomentAd(a.launchDate, events, leadDays) ? out.moments : out.evergreen;
    bucket[formatGroup(a.format)] += 1;
  }
  return out;
}

export interface YearRow {
  month: string;
  /** Ads the plan asks for (the month's creative block); null when the month has none. */
  target: number | null;
  launchedThisYear: number;
  launchedLastYear: number;
  metaSpendLastYear: number;
  amerLastYear: number | null;
  /** Meta's platform-reported ROAS last year (revenue over spend). */
  roasLastYear: number | null;
  /** Meta spend: what happened for a completed month, the plan's for the rest. */
  spendThisYear: number;
  spendIsActual: boolean;
  amerThisYear: number | null;
}

const META_CHANNELS = ["meta_acquisition", "meta_returning"] as const;
const metaSpendOfFacts = (facts: DailyFact[]) => facts.reduce((s, f) => s + META_CHANNELS.reduce((x, k) => x + (f.channels?.[k]?.spend ?? 0), 0), 0);
const metaRevenueOfFacts = (facts: DailyFact[]) => facts.reduce((s, f) => s + META_CHANNELS.reduce((x, k) => x + (f.channels?.[k]?.platformRevenue ?? 0), 0), 0);
const launchedIn = (h: CreativeHistory | null, month: string) => {
  const row = h?.months.find((m) => m.month === month);
  return row ? AD_FORMATS.reduce((s, f) => s + (row.launched[f] ?? 0), 0) : 0;
};

/**
 * The year at a glance: per month the ads the plan asks for, the ads launched this year and last, and Meta spend, aMER and ROAS of last year
 * beside this year (what happened for completed months, the plan for the rest). The total row adds the counts and spend; its aMER columns are
 * the year's aMER from the facts and, for this year, the Meta-spend-weighted average of the months.
 */
export function yearTable(a: { year: number; months: PlanMonth[]; history: CreativeHistory | null; facts: DailyFact[]; settings: ClientSettings; lastData: string }): { rows: YearRow[]; total: YearRow } {
  const amerOf = (facts: DailyFact[]) => (facts.length ? METRICS.amer.value(aggregate(facts), a.settings) : null);
  const inMonth = (start: string) => a.facts.filter((f) => f.date >= start && f.date <= endOfMonth(start));

  const rows: YearRow[] = Array.from({ length: 12 }, (_, i) => {
    const key = `${a.year}-${String(i + 1).padStart(2, "0")}-01`;
    const lyKey = addYears(key, -1);
    const plan = a.months.find((m) => m.month === key) ?? null;
    const lyFacts = inMonth(lyKey);
    const lySpend = metaSpendOfFacts(lyFacts);
    const elapsed = endOfMonth(key) <= a.lastData;
    const facts = inMonth(key);
    return {
      month: key,
      target: plan?.inputs?.creative?.needed ?? null,
      launchedThisYear: launchedIn(a.history, key),
      launchedLastYear: launchedIn(a.history, lyKey),
      metaSpendLastYear: lySpend,
      amerLastYear: amerOf(lyFacts),
      roasLastYear: lySpend > 0 ? metaRevenueOfFacts(lyFacts) / lySpend : null,
      spendThisYear: elapsed ? metaSpendOfFacts(facts) : metaSpendOf(plan?.inputs ?? null),
      spendIsActual: elapsed,
      amerThisYear: elapsed ? amerOf(facts) : plan?.inputs && plan.inputs.amer > 0 ? plan.inputs.amer : null,
    };
  });

  const sum = (f: (r: YearRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const targets = rows.filter((r) => r.target !== null);
  const lyYearFacts = a.facts.filter((f) => f.date >= addYears(`${a.year}-01-01`, -1) && f.date <= addYears(`${a.year}-12-31`, -1));
  const lySpendTotal = metaSpendOfFacts(lyYearFacts);
  const weighted = rows.filter((r) => r.amerThisYear !== null && r.spendThisYear > 0);
  const weight = weighted.reduce((s, r) => s + r.spendThisYear, 0);
  const total: YearRow = {
    month: String(a.year),
    target: targets.length ? targets.reduce((s, r) => s + (r.target ?? 0), 0) : null,
    launchedThisYear: sum((r) => r.launchedThisYear),
    launchedLastYear: sum((r) => r.launchedLastYear),
    metaSpendLastYear: sum((r) => r.metaSpendLastYear),
    amerLastYear: amerOf(lyYearFacts),
    roasLastYear: lySpendTotal > 0 ? metaRevenueOfFacts(lyYearFacts) / lySpendTotal : null,
    spendThisYear: sum((r) => r.spendThisYear),
    spendIsActual: false,
    amerThisYear: weight > 0 ? weighted.reduce((s, r) => s + (r.amerThisYear ?? 0) * r.spendThisYear, 0) / weight : null,
  };
  return { rows, total };
}

const PART_LABEL: Record<MetricKey, string> = {
  zeroRevenue: "ads that spent with no revenue",
  concentration: "spend concentrated in a few ads",
  roasDegradation: "ROAS holding up after a launch",
  spendDegradation: "spend holding up over four weeks",
  evergreenShare: "ads older than 30 days still spending",
};

/** Two to five plain sentences about the score and the month: the weakest and strongest part, the low-score warning, the month's need or why it is zero. */
export function creativeInsights(score: ReturnType<typeof creativeScore>, _metrics: Record<MetricKey, number | null>, month: CreativeMonth | null): string[] {
  const out: string[] = [];
  const monthLines: string[] = [];
  if (month) {
    if (month.overrides.needed !== undefined) monthLines.push(`You typed ${month.needed} new ads for this month (the model gives ${month.basis.modelNeeded}): ${month.moments} for moments and ${month.evergreen} evergreen.`);
    else if (month.basis.reason === "no_meta_spend") monthLines.push("This month plans no Meta spend, so no new ads are needed.");
    else if (month.basis.reason === "covered") monthLines.push("The Meta target for this month is already covered by the spend that carries over, so no new ads are needed.");
    else monthLines.push(`${month.needed} new ads needed this month: ${month.moments} for moments and ${month.evergreen} evergreen.`);
  }
  if (score.score === null) return ["Not enough ad data yet to score this account: the score appears once Meta ads have spent.", ...monthLines];

  out.push(`Creative Score ${score.score} (${scoreLabel(score.score)})${score.score < 50 ? ": the account needs more new ads." : "."}`);
  const parts = (Object.keys(score.parts) as MetricKey[]).filter((k) => score.parts[k] !== null).sort((x, y) => (score.parts[x] as number) - (score.parts[y] as number));
  if (parts.length) {
    const weak = parts[0];
    const strong = parts[parts.length - 1];
    out.push(`Weakest: ${PART_LABEL[weak]} (${score.parts[weak]}/100).`);
    if (score.parts[strong] !== score.parts[weak]) out.push(`Strongest: ${PART_LABEL[strong]} (${score.parts[strong]}/100).`);
  }
  return [...out, ...monthLines];
}

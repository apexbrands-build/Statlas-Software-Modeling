/** Creative Demand in the plan: what each month needs (stored in the month's inputs), regeneration, the year table and the plain-language insights. */
import { addDays, addYears, endOfMonth, startOfMonth } from "../dates";
import type { MarketingEvent } from "../planning/events";
import type { PlanMonth, PlanMonthInputs } from "../planning/types";
import { carryRate, catalogShare, ctcRecommendation, currentSpend, metaSpendOf, monthsWithData, neededAds, spendPerNewAd, type CtcRecommendation } from "./demand";
import { SCORE_DEFINITIONS } from "./definitions";
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
    /** "ctc": the Modeling page's four inputs (needs last year's spend for the month). "canon": the Canon's spend-gap arithmetic, used when there is no last-year baseline. Absent in blocks saved before 2026-10-20 (they were Canon). */
    method?: "ctc" | "canon";
    /** The four inputs behind a "ctc" number. */
    ctc?: CtcRecommendation;
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
 * The creative need of one plan month. With last year's spend for the month it follows the CTC Modeling page: last year's launches in the month x
 * the planned-spend change x the Creative Score's health multiplier x the evergreen carry-forward, raised when the spend gap needs more (see
 * `ctcRecommendation`). Without it, the Canon's arithmetic: target = the month's non-catalog Meta spend, spend already running into the month counts
 * at the carry rate and the rest is divided by what a new ad spends in its first 30 days. A typed `needed` replaces the result.
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
  /** The account's Creative Score and Evergreen Share: inputs 3 and 4 of the recommendation. */
  score?: number | null;
  evergreenShare?: number | null;
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

  // The CTC Modeling page's recommendation: last year's launches in this month, scaled by the planned-spend change, the Creative Score and the evergreen share.
  const lastYear = addYears(month, -1);
  const lyRow = months.find((m) => m.month === lastYear);
  const lyFacts = a.metaFacts?.byMonth[lastYear];
  const lastYearSpend = lyRow && lyRow.spend > 0 ? lyRow.spend : lyFacts !== undefined ? lyFacts * (1 - catalogShare(months, openMonth)) : 0;
  const lastYearAds = lyRow ? AD_FORMATS.reduce((x, f) => x + (lyRow.launched[f] ?? 0), 0) : 0;
  const gap = Math.max(0, targetSpend - (current.value > 0 ? current.value : 0) * (carryUsed > 0 ? carryUsed : 0));
  const rec = ctcRecommendation({ lastYearAds, lastYearSpend, targetSpend, score: a.score ?? null, evergreenShare: a.evergreenShare ?? null, gap });
  const modelNeeded = rec ? rec.ads : calc.needed;

  const needed = o.needed !== undefined ? Math.max(0, Math.round(o.needed)) : modelNeeded;
  const reason = meta <= 0 ? "no_meta_spend" : !rec && calc.covered ? "covered" : "ok";

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
      modelNeeded,
      method: rec ? "ctc" : "canon",
      ...(rec ? { ctc: rec } : {}),
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
 * Recomputes the ad plan of every plan month that has inputs, passing back the overrides it saved. A month whose ad plan is locked comes back
 * exactly as saved. A month locked in the plan is not frozen here: the plan's lock is about its targets, and the ad plan follows them.
 */
export function regenerateCreative(months: PlanMonth[], saved: Record<string, CreativeMonth>, compute: (m: PlanMonth, overrides: CreativeOverrides) => CreativeMonth | null): Record<string, CreativeMonth> {
  const out: Record<string, CreativeMonth> = {};
  for (const m of months) {
    if (!m.inputs) continue;
    const was = saved[m.month];
    if (was?.locked) {
      out[m.month] = was;
      continue;
    }
    const c = compute(m, was?.overrides ?? {});
    if (c) out[m.month] = c;
  }
  return out;
}

/** The saved blocks with `locked` set. */
export function lockAll(saved: Record<string, CreativeMonth>, locked: boolean): Record<string, CreativeMonth> {
  return Object.fromEntries(Object.entries(saved).map(([month, b]) => [month, { ...b, locked }]));
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

const PART_LABEL: Record<MetricKey, string> = Object.fromEntries((Object.keys(SCORE_DEFINITIONS) as MetricKey[]).map((k) => [k, SCORE_DEFINITIONS[k].name])) as Record<MetricKey, string>;

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

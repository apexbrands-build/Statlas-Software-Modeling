/**
 * Deterministic demo data for the Creative Score and the Creative Demand model (demo mode only): a few hundred ads over about 21 months with
 * launches, decaying daily spend, winners that live long, zero-spend ads and catalog ads. The same client and date always give the same history.
 */
import { addDays, diffDays, endOfMonth, startOfMonth } from "../dates";
import { zeroLaunched, type AdFormat, type CreativeDay, type CreativeHistory, type LaunchedAd, type MonthAgg, type ScoreAd } from "./types";

interface DemoAd {
  id: string;
  name: string;
  format: AdFormat;
  isCatalog: boolean;
  launch: string;
  /** Daily spend and revenue by date (only days up to the as-of date). */
  daily: Map<string, { spend: number; revenue: number }>;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** mulberry32 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const normal = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function makeAds(clientId: string, asOf: string): DemoAd[] {
  const r = rng(hash(clientId));
  const from = `${Number(asOf.slice(0, 4)) - 1}-01-01`;
  const span = diffDays(from, asOf);
  const n = Math.round(span * 0.45);
  const ads: DemoAd[] = [];
  for (let i = 0; i < n; i++) {
    const launch = addDays(from, Math.floor(r() * (span + 1)));
    const f = r();
    const format: AdFormat = f < 0.4 ? "video" : f < 0.75 ? "image" : f < 0.9 ? "carousel" : "other";
    const isCatalog = r() < 0.08;
    const zero = r() < 0.05;
    const winner = r() < 0.12;
    const spend30 = zero ? 0 : Math.exp(Math.log(240) + 0.8 * normal(r));
    const decay = winner ? 0.992 : 0.955 + r() * 0.03;
    const life = winner ? 120 + Math.floor(r() * 150) : 8 + Math.floor(r() * 50);
    const d0 = (spend30 * (1 - decay)) / (1 - decay ** 30);
    const roas0 = r() < 0.15 ? 0 : Math.exp(Math.log(2.3) + 0.45 * normal(r));
    const daily = new Map<string, { spend: number; revenue: number }>();
    if (spend30 > 0) {
      for (let t = 0; t <= life; t++) {
        const date = addDays(launch, t);
        if (date > asOf) break;
        const spend = d0 * decay ** t * (0.8 + 0.4 * r());
        daily.set(date, { spend, revenue: spend * roas0 * Math.max(0.3, 1 - 0.006 * t) });
      }
    }
    ads.push({ id: `demo-${i}`, name: `${format === "video" ? "Video" : "Static"} ${i + 1}`, format, isCatalog, launch, daily });
  }
  return ads;
}

const sumRange = (ad: DemoAd, from: string, to: string, f: "spend" | "revenue") => {
  let s = 0;
  for (const [d, v] of ad.daily) if (d >= from && d <= to) s += v[f];
  return s;
};

function launchedAd(ad: DemoAd): LaunchedAd {
  const end7 = addDays(ad.launch, 6);
  const end30 = addDays(ad.launch, 29);
  return {
    adId: ad.id,
    name: ad.name,
    format: ad.format,
    isCatalog: ad.isCatalog,
    launchDate: ad.launch,
    spend7: sumRange(ad, ad.launch, end7, "spend"),
    spend30: sumRange(ad, ad.launch, end30, "spend"),
    revenue30: sumRange(ad, ad.launch, end30, "revenue"),
    spendTotal: sumRange(ad, "0000-01-01", "9999-12-31", "spend"),
    revenueTotal: sumRange(ad, "0000-01-01", "9999-12-31", "revenue"),
  };
}

function creativeDays(ads: DemoAd[], from: string, to: string): CreativeDay[] {
  const map = new Map<string, CreativeDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) map.set(d, { date: d, spend: 0, revenue: 0, catalogSpend: 0, launched: zeroLaunched() });
  for (const ad of ads) {
    const l = map.get(ad.launch);
    if (l && !ad.isCatalog) l.launched[ad.format] += 1;
    for (const [d, v] of ad.daily) {
      const row = map.get(d);
      if (!row) continue;
      if (ad.isCatalog) row.catalogSpend += v.spend;
      else {
        row.spend += v.spend;
        row.revenue += v.revenue;
      }
    }
  }
  return [...map.values()];
}

function monthAggs(ads: DemoAd[], asOf: string): MonthAgg[] {
  const first = `${Number(asOf.slice(0, 4)) - 1}-01-01`;
  const map = new Map<string, MonthAgg>();
  for (let m = first; m <= startOfMonth(asOf); m = addDays(endOfMonth(m), 1)) map.set(m, { month: m, spend: 0, catalogSpend: 0, carriedSpend: 0, launched: zeroLaunched() });
  for (const ad of ads) {
    if (!ad.isCatalog) map.get(startOfMonth(ad.launch))!.launched[ad.format] += 1;
    for (const [d, v] of ad.daily) {
      const m = map.get(startOfMonth(d))!;
      if (ad.isCatalog) m.catalogSpend += v.spend;
      else {
        m.spend += v.spend;
        if (ad.launch < m.month) m.carriedSpend += v.spend;
      }
    }
  }
  return [...map.values()];
}

function scoreAds(ads: DemoAd[], asOf: string): ScoreAd[] {
  const from = addDays(asOf, -29);
  const week = (ad: DemoAd, a: number, b: number) => sumRange(ad, addDays(asOf, a), addDays(asOf, b), "spend");
  return ads
    .filter((ad) => !ad.isCatalog && (ad.launch >= from || sumRange(ad, from, asOf, "spend") > 0))
    .map((ad) => ({
      adId: ad.id,
      launchDate: ad.launch,
      spend30: sumRange(ad, from, asOf, "spend"),
      revenue30: sumRange(ad, from, asOf, "revenue"),
      weeks: [week(ad, -27, -21), week(ad, -20, -14), week(ad, -13, -7), week(ad, -6, 0)] as [number, number, number, number],
    }));
}

export function demoCreativeHistory(clientId: string, asOf: string): CreativeHistory {
  const ads = makeAds(clientId, asOf);
  return {
    asOf,
    months: monthAggs(ads, asOf),
    ads: ads.filter((a) => a.launch >= addDays(asOf, -364)).map(launchedAd),
    days: creativeDays(ads, addDays(asOf, -96), asOf),
    scoreAds: scoreAds(ads, asOf),
  };
}

/** The ads launched in one month and that month's days (up to the as-of date), for the month view. */
export function demoCreativeMonth(clientId: string, month: string, asOf: string): { ads: LaunchedAd[]; days: CreativeDay[] } {
  const ads = makeAds(clientId, asOf);
  const from = startOfMonth(month);
  const to = endOfMonth(month) < asOf ? endOfMonth(month) : asOf;
  return { ads: ads.filter((a) => a.launch >= from && a.launch <= endOfMonth(month)).map(launchedAd), days: creativeDays(ads, from, to) };
}

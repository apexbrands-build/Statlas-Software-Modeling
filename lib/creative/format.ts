/**
 * Format split (images vs videos). Carousel and other count as images.
 * Video share = 50% video's share of winner spend + 50% current production mix (last 12 months, non-catalog);
 * 50/50 when either format has under 20 ads.
 */
import { addDays } from "../dates";
import type { AdFormat, LaunchedAd } from "./types";

export interface FormatCount {
  video: number;
  image: number;
}

export type FormatGroup = "video" | "image";

export const MIN_ADS_PER_FORMAT = 20;

export interface FormatStats {
  count: number;
  spend: number;
  revenue: number;
  roas: number | null;
  winners: number;
  winnerSpend: number;
}

export function formatGroup(f: AdFormat): FormatGroup {
  return f === "video" ? "video" : "image";
}

/** Non-catalog ads launched in the 365 days to `asOf`; winner = spendTotal above the mean per ad over both formats. */
export function formatEvidence(ads: LaunchedAd[], asOf: string): Record<FormatGroup, FormatStats> {
  const from = addDays(asOf, -364);
  const pool = ads.filter((a) => !a.isCatalog && a.launchDate >= from && a.launchDate <= asOf);
  const mean = pool.length ? pool.reduce((s, a) => s + a.spendTotal, 0) / pool.length : 0;
  const blank = (): FormatStats => ({ count: 0, spend: 0, revenue: 0, roas: null, winners: 0, winnerSpend: 0 });
  const out: Record<FormatGroup, FormatStats> = { video: blank(), image: blank() };
  for (const a of pool) {
    const s = out[formatGroup(a.format)];
    s.count += 1;
    s.spend += a.spendTotal;
    s.revenue += a.revenueTotal;
    if (a.spendTotal > mean) {
      s.winners += 1;
      s.winnerSpend += a.spendTotal;
    }
  }
  for (const s of Object.values(out)) s.roas = s.spend > 0 ? s.revenue / s.spend : null;
  return out;
}

export function videoShare(ev: Record<FormatGroup, FormatStats>): { share: number; reason: "evidence" | "few_ads" } {
  if (ev.video.count < MIN_ADS_PER_FORMAT || ev.image.count < MIN_ADS_PER_FORMAT) return { share: 0.5, reason: "few_ads" };
  const winnerTotal = ev.video.winnerSpend + ev.image.winnerSpend;
  const winnerPart = winnerTotal > 0 ? ev.video.winnerSpend / winnerTotal : 0.5;
  const mix = ev.video.count / (ev.video.count + ev.image.count);
  return { share: Math.round((0.5 * winnerPart + 0.5 * mix) * 1e9) / 1e9, reason: "evidence" };
}

/** Split n ads by the video share; the remainder goes to the larger share (tie: video). */
export function splitFormats(n: number, share: number): FormatCount {
  const total = Math.max(0, Math.round(n));
  if (!total) return { video: 0, image: 0 };
  const s = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0.5));
  let video = Math.floor(total * s + 1e-9);
  let image = Math.floor(total * (1 - s) + 1e-9);
  const rest = total - video - image;
  if (s >= 0.5) video += rest;
  else image += rest;
  return { video, image };
}

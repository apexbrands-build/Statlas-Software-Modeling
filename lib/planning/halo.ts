import type { ChannelKey, ClientSettings, HaloCell, HaloSettings, OtherChannel } from "../types";
import { PLAN_PLATFORMS, type PlanMonthInputs } from "./types";

/**
 * Halo layer: what ads create on sales channels other than .com (Amazon, TikTok Shop, retail).
 * A halo factor has the same unit as an incrementality factor (incremental revenue per $1 of revenue the ad platform
 * reports), so a channel's total factor is its .com factor plus its halo factors. Factors are typed from tests run
 * outside the app; nothing here estimates one. With nothing typed every result equals the .com-only number.
 */

const EMPTY: HaloSettings = { channels: [], cells: {} };

/** The client's other sales channels and halo cells; empty when nothing usable is saved. */
export function haloSettingsOf(settings: ClientSettings): HaloSettings {
  const h = settings.extra?.halo as unknown;
  if (!h || typeof h !== "object") return { ...EMPTY };
  const { channels, cells } = h as { channels?: unknown; cells?: unknown };
  return {
    channels: Array.isArray(channels) ? (channels as OtherChannel[]).filter((c) => c && typeof c.key === "string" && c.key !== "") : [],
    cells: cells && typeof cells === "object" && !Array.isArray(cells) ? (cells as HaloSettings["cells"]) : {},
  };
}

/** A cell's factor on the channel's net revenue: never negative; a retail cell measured on shelf sales is scaled by the channel's net %. */
export function cellValue(cell: HaloCell | undefined, channel: OtherChannel): number {
  const v = Number(cell?.value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (channel.kind === "retail" && cell?.onShelf) {
    const net = Number(channel.netPct ?? 100);
    return Number.isFinite(net) && net > 0 ? (v * net) / 100 : 0;
  }
  return v;
}

/** The halo factors of an ad channel, per existing sales channel (zeros and deleted channels left out). */
export function haloOf(k: ChannelKey, settings: ClientSettings): Record<string, number> {
  const { channels, cells } = haloSettingsOf(settings);
  const row = cells[k];
  const out: Record<string, number> = {};
  if (!row) return out;
  for (const c of channels) {
    const v = cellValue(row[c.key], c);
    if (v > 0) out[c.key] = v;
  }
  return out;
}

/** .com factor (1 when none is saved) plus the channel's halo factors. */
export function totalFactor(k: ChannelKey, settings: ClientSettings): number {
  return (settings.multipliers[k] ?? 1) + Object.values(haloOf(k, settings)).reduce((a, b) => a + b, 0);
}

type Split = Pick<PlanMonthInputs, "platformPct" | "altPct">;

/** Each channel's share of a plan month's total ad spend (sums to 1); empty when the month has no platform split. */
export function channelSpendShares(inputs: Split): Partial<Record<ChannelKey, number>> {
  const sum = PLAN_PLATFORMS.reduce((a, p) => a + Math.max(0, inputs.platformPct[p.key] ?? 0), 0);
  const out: Partial<Record<ChannelKey, number>> = {};
  if (sum <= 0) return out;
  for (const p of PLAN_PLATFORMS) {
    const share = Math.max(0, inputs.platformPct[p.key] ?? 0) / sum;
    if (share <= 0) continue;
    const alt = Math.min(1, Math.max(0, (inputs.altPct[p.key] ?? 0) / 100));
    if (share * (1 - alt) > 0) out[p.main] = share * (1 - alt);
    if (share * alt > 0) out[p.alt] = share * alt;
  }
  return out;
}

/**
 * Each channel's share of the spend that counts toward aMER (sums to 1), by the same rule as `amerSpend`: brand search and
 * the platforms' non-acquisition spend are left out when the client's settings exclude them.
 */
export function acquisitionShares(inputs: Split, settings: Pick<ClientSettings, "excludeBrandFromAmer" | "excludeMetaReturningFromAmer">): Partial<Record<ChannelKey, number>> {
  const all = channelSpendShares(inputs);
  const kept: Partial<Record<ChannelKey, number>> = {};
  for (const p of PLAN_PLATFORMS) {
    if (all[p.main]) kept[p.main] = all[p.main];
    const excluded = p.key === "google" ? settings.excludeBrandFromAmer : settings.excludeMetaReturningFromAmer;
    if (all[p.alt] && !excluded) kept[p.alt] = all[p.alt];
  }
  const sum = Object.values(kept).reduce((a, b) => a + (b ?? 0), 0);
  const out: Partial<Record<ChannelKey, number>> = {};
  if (sum <= 0) return out;
  for (const [k, v] of Object.entries(kept)) out[k as ChannelKey] = (v ?? 0) / sum;
  return out;
}

export interface HaloMix {
  /** .com's weight in what the ads create: blended aMER = aMER / w. 1 = nothing to model. */
  w: number;
  /** Halo revenue on each other sales channel as a share of .com new revenue. */
  share: Record<string, number>;
  /** True when a halo changes the numbers. */
  modelled: boolean;
  /** True when a cell behind the result is a benchmark or an assumption, not the client's own test. */
  benchmark: boolean;
}

/**
 * What a month's channel mix creates beyond .com. Each channel is assumed to deliver the same whole-business return, so its
 * .com part is share x IF / F and its halo part on sales channel k is share x halo_k / F (F = total factor).
 * Channels with a total factor of zero create nothing and are skipped.
 */
export function haloMix(shares: Partial<Record<ChannelKey, number>>, settings: ClientSettings): HaloMix {
  const none: HaloMix = { w: 1, share: {}, modelled: false, benchmark: false };
  const { cells } = haloSettingsOf(settings);
  const rows = (Object.entries(shares) as [ChannelKey, number][])
    .map(([k, s]) => ({ k, s: Number(s), halo: haloOf(k, settings), f: totalFactor(k, settings), com: settings.multipliers[k] ?? 1 }))
    .filter((r) => Number.isFinite(r.s) && r.s > 0 && Number.isFinite(r.f) && r.f > 0);
  const norm = rows.reduce((a, r) => a + r.s, 0);
  if (norm <= 0) return none;
  const com = rows.reduce((a, r) => a + (r.s / norm) * (Math.max(0, r.com) / r.f), 0);
  if (com <= 0) return none;
  const share: Record<string, number> = {};
  let benchmark = false;
  for (const r of rows) {
    for (const [key, h] of Object.entries(r.halo)) {
      share[key] = (share[key] ?? 0) + ((r.s / norm) * (h / r.f)) / com;
      if (cells[r.k]?.[key]?.source !== "own_test") benchmark = true;
    }
  }
  const extra = Object.values(share).reduce((a, b) => a + b, 0);
  if (extra <= 0) return none;
  return { w: 1 / (1 + extra), share, modelled: true, benchmark };
}

/** New revenue across every sales channel over the spend that counts toward aMER. */
export function blendedAmer(amer: number, mix: HaloMix): number {
  return mix.w > 0 ? amer / mix.w : amer;
}

/** Halo revenue per other sales channel for a given .com new revenue. */
export function haloRevenue(newRevenue: number, mix: HaloMix): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, s] of Object.entries(mix.share)) out[k] = newRevenue * s;
  return out;
}

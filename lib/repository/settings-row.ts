import { defaultSettings, DEFAULT_MULTIPLIERS } from "../defaults";
import type { ChannelKey, ClientSettings } from "../types";

const n = (v: unknown) => Number(v ?? 0);

/** The saved factors exactly as saved: a factor the strategist deleted stays deleted. Defaults apply only when the row has no usable list. */
function savedMultipliers(v: unknown): Partial<Record<ChannelKey, number>> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Partial<Record<ChannelKey, number>>) } : { ...DEFAULT_MULTIPLIERS };
}

/** A `client_settings` row as the app's settings. */
export function settingsFromRow(clientId: string, data: Record<string, unknown>): ClientSettings {
  const base = defaultSettings(clientId);
  return {
    ...base,
    multipliers: savedMultipliers(data.multipliers),
    otherVariablePct: n(data.other_variable_pct),
    cogsFallbackPct: n(data.cogs_fallback_pct),
    cogsFlatRate: Boolean(data.cogs_flat_rate),
    excludedOrderTags: (data.excluded_order_tags as string[]) ?? [],
    extra: { ...base.extra, ...((data.extra as Partial<ClientSettings["extra"]>) ?? {}) },
    deliveryCostPerOrder: n(data.delivery_cost_per_order),
    monthlyFixedCosts: n(data.monthly_fixed_costs),
    brandCampaignKeyword: (data.brand_campaign_keyword as string) ?? base.brandCampaignKeyword,
    dtcChannels: (data.dtc_channels as string[]) ?? base.dtcChannels,
    excludeBrandFromAmer: Boolean(data.exclude_brand_from_amer),
    excludeMetaReturningFromAmer: Boolean(data.exclude_meta_returning_from_amer),
  };
}

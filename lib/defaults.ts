import type { ChannelKey, ClientSettings } from "./types";

export const DEFAULT_MULTIPLIERS: Record<ChannelKey, number> = {
  google_nonbrand: 0.75,
  google_brand: 0.3,
  meta_acquisition: 1.2,
  meta_returning: 0.6,
  pinterest: 0.3,
};

/** Settings for a client that has none saved yet. */
export function defaultSettings(clientId: string): ClientSettings {
  return {
    clientId,
    multipliers: { ...DEFAULT_MULTIPLIERS },
    otherVariablePct: 0,
    deliveryCostPerOrder: 0,
    monthlyFixedCosts: 0,
    attributionWindow: "7d_click",
    revenueDefinition: "order_revenue",
    brandCampaignKeyword: "branded",
    excludeBrandFromAmer: false,
    excludeMetaReturningFromAmer: false,
    dtcChannels: ["Online Store", "Shop"],
  };
}

import type { ChannelKey, ClientSettings, ExtraSettings } from "./types";

export const DEFAULT_MULTIPLIERS: Partial<Record<ChannelKey, number>> = {
  google_nonbrand: 0.65,
  google_brand: 0.15,
  google_nonbrand_returning: 0.65,
  google_brand_returning: 0.15,
  meta_acquisition: 1.15,
  meta_returning: 0.6,
  pinterest: 0.3,
};

export function defaultExtra(): ExtraSettings {
  return {
    logoUrl: "",
    industry: "",
    weekStartDay: "Monday",
    showIncrementalByDefault: true,
    fbClickWindow: "1 Day",
    fbAttrClick: "7 Day",
    fbAttrView: "Disabled",
    fbViewWindow: "Disabled",
    fbClickType: "Unique Outbound Clicks",
    fbExcludeOnsite: false,
    fbUseIncrementalDefault: false,
    googleRevenueTiming: "Conversion by Revenue Date",
    pinterestAttribution: "Unset",
    nonBrandTag: "NB",
    acqTag: "ACQ",
    rtnTag: "RTN",
    dontSeparateBrand: false,
    dontSeparateRetention: false,
    dontSeparateReactivation: false,
    excludeTestCampaigns: false,
    testKeyword: "",
    testStartsWith: "",
    testEndsWith: "",
    excludeTestFromRoas: true,
    cmReduceByAdSpend: true,
    cmIncludeShippingAsProfit: true,
    cogsAccrueReturnsByRate: false,
    dontUseShopifyCogs: false,
    giftCardMode: "Do not separate (default)",
    emailRevenueSource: "klaviyo",
    organicDefinition: "Calculated: Total Rev - iPaid - Email/SMS",
    churnAtRiskDays: 30,
    churnDays: 140,
    dio: 0,
    dso: 0,
    dpo: 0,
    tiktokReferralFeePct: 0,
    tiktokGmvSharePct: 0,
    tiktokGmvCommissionPct: 0,
    catalogKeywords: "catalog, dpa, daba",
  };
}

/** Settings for a client that has none saved yet. */
export function defaultSettings(clientId: string): ClientSettings {
  return {
    clientId,
    multipliers: { ...DEFAULT_MULTIPLIERS },
    otherVariablePct: 0,
    cogsFallbackPct: 0,
    cogsFlatRate: false,
    excludedOrderTags: [],
    extra: defaultExtra(),
    deliveryCostPerOrder: 0,
    monthlyFixedCosts: 0,
    attributionWindow: "7d_click",
    revenueDefinition: "order_revenue",
    brandCampaignKeyword: "brand",
    excludeBrandFromAmer: false,
    excludeMetaReturningFromAmer: false,
    dtcChannels: ["Online Store", "Shop"],
  };
}

import type { ChannelKey } from "./types";

/** Each publisher has an acquisition channel and a non-acquisition (returning / brand) channel. */
export interface Platform {
  id: string;
  /** Name shown in the incrementality list. */
  publisher: string;
  /** Short name used on dashboard tiles. */
  label: string;
  acquisition: ChannelKey;
  nonAcquisition: ChannelKey;
  nonAcquisitionLabel: string;
  /** Icon key for BrandIcon. */
  icon: string;
}

export const PLATFORMS: Platform[] = [
  { id: "meta", publisher: "Facebook", label: "Meta", acquisition: "meta_acquisition", nonAcquisition: "meta_returning", nonAcquisitionLabel: "Meta Returning", icon: "facebook" },
  { id: "google", publisher: "GoogleAds", label: "Google", acquisition: "google_nonbrand", nonAcquisition: "google_brand", nonAcquisitionLabel: "Google Brand", icon: "google_ads" },
  { id: "pinterest", publisher: "Pinterest", label: "Pinterest", acquisition: "pinterest", nonAcquisition: "pinterest_returning", nonAcquisitionLabel: "Pinterest Returning", icon: "pinterest" },
  { id: "youtube", publisher: "YouTube", label: "YouTube", acquisition: "youtube", nonAcquisition: "youtube_returning", nonAcquisitionLabel: "YouTube Returning", icon: "youtube" },
  { id: "bing", publisher: "Bing Ads", label: "Bing", acquisition: "bing", nonAcquisition: "bing_returning", nonAcquisitionLabel: "Bing Returning", icon: "bing" },
  { id: "applovin", publisher: "AppLovin", label: "AppLovin", acquisition: "applovin", nonAcquisition: "applovin_returning", nonAcquisitionLabel: "AppLovin Returning", icon: "applovin" },
  { id: "tiktok", publisher: "TikTok", label: "TikTok", acquisition: "tiktok", nonAcquisition: "tiktok_returning", nonAcquisitionLabel: "TikTok Returning", icon: "tiktok" },
  { id: "snapchat", publisher: "Snapchat", label: "Snapchat", acquisition: "snapchat", nonAcquisition: "snapchat_returning", nonAcquisitionLabel: "Snapchat Returning", icon: "snapchat" },
];

export function platformOf(key: ChannelKey): { platform: Platform; kind: "Acquisition" | "NON-Acquisition" } {
  for (const p of PLATFORMS) {
    if (p.acquisition === key) return { platform: p, kind: "Acquisition" };
    if (p.nonAcquisition === key) return { platform: p, kind: "NON-Acquisition" };
  }
  throw new Error(`Unknown channel ${key}`);
}

/** Channels that are never hidden on the dashboard, even with zero spend. */
export const CORE_CHANNELS: ChannelKey[] = ["google_nonbrand", "google_brand", "meta_acquisition", "meta_returning"];

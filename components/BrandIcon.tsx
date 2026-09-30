import { siFacebook, siGoogleads, siGoogleanalytics, siInstagram, siPinterest, siShopify, siSnapchat, siTiktok, siYoutube } from "simple-icons";

interface Brand {
  path: string;
  hex: string;
}

// Logos come from the open "simple-icons" set. Brands not in it (e.g. Klaviyo, Postscript) fall back to a lettered badge.
const ICONS: Record<string, Brand> = {
  shopify: siShopify,
  meta: siFacebook,
  facebook: siFacebook,
  instagram: siInstagram,
  google_ads: siGoogleads,
  ga4: siGoogleanalytics,
  pinterest: siPinterest,
  tiktok: siTiktok,
  snapchat: siSnapchat,
  youtube: siYoutube,
};

const FALLBACK_COLOR: Record<string, string> = { klaviyo: "#3ad823", postscript: "#7c5cff", omnisend: "#00b894", applovin: "#2b7cff", bing: "#00a4ef" };

/** Dark logos (TikTok) would vanish on the black background, so near-black brands render white. */
function visibleColor(hex: string): string {
  const n = parseInt(hex, 16);
  const luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance < 0.2 ? "#ffffff" : `#${hex}`;
}

export function BrandIcon({ provider, size = 20, title }: { provider: string; size?: number; title?: string }) {
  const key = provider.toLowerCase();
  const brand = ICONS[key];
  if (brand) {
    return (
      <svg role="img" aria-label={title ?? provider} width={size} height={size} viewBox="0 0 24 24" fill={visibleColor(brand.hex)} className="shrink-0">
        <title>{title ?? provider}</title>
        <path d={brand.path} />
      </svg>
    );
  }
  const color = FALLBACK_COLOR[key] ?? "#6b6b6b";
  return (
    <span aria-label={title ?? provider} className="inline-flex shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-black" style={{ width: size, height: size, background: color }}>
      {(title ?? provider).trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Icon for a Shopify sales channel name. */
export function channelProvider(channel: string): string {
  const c = channel.toLowerCase();
  if (c.includes("tiktok")) return "tiktok";
  if (c.includes("instagram") || c.includes("facebook")) return "facebook";
  if (c === "online store" || c === "shop" || c === "point of sale" || c === "draft orders") return "shopify";
  return c;
}

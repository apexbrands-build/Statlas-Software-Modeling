import { describe, expect, it } from "vitest";
import { launchedAd } from "./fixtures";
import { formatEvidence, formatGroup, splitFormats, videoShare } from "./format";
import type { AdFormat, LaunchedAd } from "./types";

const AS_OF = "2026-09-30";
const ads = (n: number, format: AdFormat, spendTotal: number, prefix: string): LaunchedAd[] =>
  Array.from({ length: n }, (_, i) => launchedAd({ adId: `${prefix}${i}`, launchDate: "2026-06-01", format, spendTotal, revenueTotal: spendTotal * 2 }));

// 25 videos: 5 winners at 120 (600); 25 images (incl. carousels): 4 winners at 100 (400). Mean = 1,000 / 50 = 20.
const evidenceAds = [
  ...ads(5, "video", 120, "vw"),
  ...ads(20, "video", 0, "v0"),
  ...ads(2, "image", 100, "iw"),
  ...ads(2, "carousel", 100, "cw"),
  ...ads(21, "image", 0, "i0"),
  launchedAd({ adId: "cat", launchDate: "2026-06-01", format: "video", isCatalog: true, spendTotal: 99_999 }),
  launchedAd({ adId: "old", launchDate: "2025-09-30", format: "video", spendTotal: 99_999 }),
];

describe("formatGroup", () => {
  it("carousel and other count as images", () => {
    expect(formatGroup("carousel")).toBe("image");
    expect(formatGroup("other")).toBe("image");
    expect(formatGroup("image")).toBe("image");
    expect(formatGroup("video")).toBe("video");
  });
});

describe("formatEvidence", () => {
  it("non-catalog ads of the last 365 days; zero-spend ads count but are never winners", () => {
    const ev = formatEvidence(evidenceAds, AS_OF);
    expect(ev.video).toEqual({ count: 25, spend: 600, revenue: 1200, roas: 2, winners: 5, winnerSpend: 600 });
    expect(ev.image).toEqual({ count: 25, spend: 400, revenue: 800, roas: 2, winners: 4, winnerSpend: 400 });
  });
  it("no ads: zero counts and null ROAS", () => {
    const ev = formatEvidence([], AS_OF);
    expect(ev.video).toEqual({ count: 0, spend: 0, revenue: 0, roas: null, winners: 0, winnerSpend: 0 });
  });
});

describe("videoShare", () => {
  it("50% winner spend share + 50% production mix", () => {
    expect(videoShare(formatEvidence(evidenceAds, AS_OF))).toEqual({ share: 0.55, reason: "evidence" });
  });
  it("under 20 ads of a format gives 50/50", () => {
    const few = evidenceAds.filter((a) => a.adId !== "v00" && a.adId !== "v01" && a.adId !== "v02" && a.adId !== "v03" && a.adId !== "v04" && a.adId !== "v05");
    const ev = formatEvidence(few, AS_OF);
    expect(ev.video.count).toBe(19);
    expect(videoShare(ev)).toEqual({ share: 0.5, reason: "few_ads" });
  });
  it("no ads gives 0.5", () => {
    expect(videoShare(formatEvidence([], AS_OF))).toEqual({ share: 0.5, reason: "few_ads" });
  });
});

describe("splitFormats", () => {
  it("remainder goes to the larger share, tie to video", () => {
    expect(splitFormats(10, 0.5)).toEqual({ video: 5, image: 5 });
    expect(splitFormats(5, 0.5)).toEqual({ video: 3, image: 2 });
    expect(splitFormats(7, 0.3)).toEqual({ video: 2, image: 5 });
    expect(splitFormats(7, 0.7)).toEqual({ video: 5, image: 2 });
    expect(splitFormats(0, 0.6)).toEqual({ video: 0, image: 0 });
  });
});

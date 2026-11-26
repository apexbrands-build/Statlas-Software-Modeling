import { readDate, readNumber, splitLine, type DateFormat, type NumberFormat } from "./import";
import { CATALOG, type Platform } from "./metrics";

/**
 * Reading the platforms' own export files. A file is one of a few known kinds per platform (recognised by its columns), or a plain
 * file. Each kind says which column goes to which number. A row holds only what its file gave: a number the file has no column for is
 * `null` ("not given"), so saving it merges into the day and leaves the rest of the day alone.
 */

export interface ChannelSaleInput {
  date: string;
  channel: string;
  retailer: string;
  revenue: number | null;
  orders: number | null;
  units: number | null;
  adSpend: number | null;
  metrics: Record<string, number>;
  source: "import";
}

export interface FileKind {
  id: string;
  label: string;
  platform: Platform;
  /** Several rows for a day are added together (a row per campaign); otherwise a second row for a day is a mistake. */
  sumRows: boolean;
  /** Column name (lower case, punctuation removed) -> "date", "retailer", "revenue", "orders", "units", "adSpend", or a stored metric. */
  targets: Record<string, string>;
  /** Columns that must be there for the file to be recognised as this kind. */
  needs: string[];
}

export interface ColumnRead {
  header: string;
  target: string | null;
}

export interface FileImport {
  kind: string;
  rows: ChannelSaleInput[];
  errors: { line: number; message: string }[];
  from: string | null;
  to: string | null;
  columns: ColumnRead[];
  /** What the rows add up to, per target, for the preview. */
  totals: Record<string, number>;
}

/** A column name as files write it, reduced to lower-case words: "Sessions - Total" -> "sessions total". */
export const normHeader = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** Amazon gives the Buy Box as a percentage; it is turned into page views that showed the offer, so a period can weight it. */
const BUY_BOX_PCT = "buy_box_pct";
/** A cell that says "no value": a dash of any kind, or n/a. */
const NO_VALUE = /^(-+|–|—|n\/a)$/i;
const CORE = ["revenue", "orders", "units", "adSpend"] as const;
type Core = (typeof CORE)[number];
const isCore = (t: string): t is Core => (CORE as readonly string[]).includes(t);

const adsKind = (type: "sp" | "sb" | "sd", label: string, days: 7 | 14, needs: string[]): FileKind => ({
  id: `amazon_ads_${type}`,
  label,
  platform: "amazon",
  sumRows: true,
  targets: {
    date: "date",
    "start date": "date",
    spend: `${type}_spend`,
    cost: `${type}_spend`,
    sales: `${type}_sales`,
    [`${days} day total sales`]: `${type}_sales`,
    orders: `${type}_orders`,
    [`${days} day total orders`]: `${type}_orders`,
    clicks: `${type}_clicks`,
    impressions: `${type}_impressions`,
    ...(type === "sp" ? {} : { "14 day new to brand orders": `${type}_ntb_orders`, "14 day new to brand sales": `${type}_ntb_sales`, "new to brand orders": `${type}_ntb_orders`, "new to brand sales": `${type}_ntb_sales` }),
  },
  needs,
});

const KINDS: FileKind[] = [
  {
    id: "amazon_sales_traffic",
    label: "Amazon: Sales and Traffic by date (Business Reports)",
    platform: "amazon",
    sumRows: false,
    targets: {
      date: "date",
      "ordered product sales": "revenue",
      "units ordered": "units",
      "total order items": "orders",
      "sessions total": "sessions",
      sessions: "sessions",
      "page views total": "page_views",
      "page views": "page_views",
      "featured offer buy box percentage": BUY_BOX_PCT,
      "buy box percentage": BUY_BOX_PCT,
      "featured offer percentage": BUY_BOX_PCT,
      "units refunded": "units_refunded",
    },
    needs: ["ordered product sales"],
  },
  adsKind("sp", "Amazon Ads: Sponsored Products, by day", 7, ["7 day total sales"]),
  adsKind("sb", "Amazon Ads: Sponsored Brands, by day", 14, ["14 day total sales"]),
  // Sponsored Brands and Sponsored Display files share their columns (both can carry "Viewable Impressions"), so the columns cannot
  // tell them apart: a 14-day file is read as Brands, the first of the two, and the import screen asks the person to check.
  adsKind("sd", "Amazon Ads: Sponsored Display, by day", 14, ["14 day total sales"]),
  {
    id: "tiktok_overview",
    label: "TikTok Shop: shop analytics by day",
    platform: "tiktok_shop",
    sumRows: false,
    targets: {
      date: "date",
      gmv: "revenue",
      "gross merchandise value": "revenue",
      "sku orders": "orders",
      orders: "orders",
      "items sold": "units",
      customers: "buyers",
      buyers: "buyers",
      "est customers": "buyers",
      refunds: "refunds",
      visitors: "visitors",
      "avg visitors": "visitors",
      "page views": "page_views",
      "product page views": "page_views",
      "product clicks": "page_views",
      "add to cart count": "add_to_carts",
      live: "live_gmv",
      "live gmv": "live_gmv",
      "gmv from live": "live_gmv",
      video: "video_gmv",
      "video gmv": "video_gmv",
      "gmv from video": "video_gmv",
      "product card": "card_gmv",
      "product card gmv": "card_gmv",
      "gmv from product card": "card_gmv",
      affiliate: "affiliate_gmv",
      "affiliate gmv": "affiliate_gmv",
      seller: "seller_gmv",
      "seller gmv": "seller_gmv",
    },
    needs: ["gmv"],
  },
  {
    id: "tiktok_ads",
    label: "TikTok Shop: shop ads (GMV Max), by day",
    platform: "tiktok_shop",
    sumRows: true,
    targets: { date: "date", cost: "adSpend", spend: "adSpend", "gross revenue": "ads_gmv", orders: "ads_orders", "sku orders": "ads_orders" },
    needs: ["gross revenue"],
  },
  {
    id: "tiktok_affiliate",
    label: "TikTok Shop: affiliates, by day",
    platform: "tiktok_shop",
    sumRows: true,
    targets: {
      date: "date",
      gmv: "affiliate_gmv",
      "affiliate gmv": "affiliate_gmv",
      "creators with sales": "creators_with_sales",
      videos: "videos_posted",
      "new video count": "videos_posted",
      lives: "lives_held",
      "new live count": "lives_held",
      "shipped samples": "samples_shipped",
      "est commission": "affiliate_commission",
      "actual commission": "affiliate_commission",
      commission: "affiliate_commission",
      "affiliate commission": "affiliate_commission",
    },
    needs: ["affiliate gmv"],
  },
];

/** The plain kind of a platform: date, retailer, the four core numbers and every stored metric, each under the names in the catalog. */
function genericKind(platform: Platform): FileKind {
  const c = CATALOG[platform];
  const targets: Record<string, string> = { date: "date", day: "date", retailer: "retailer", store: "retailer" };
  for (const core of CORE) for (const a of c.coreAliases[core]) targets[a] = core;
  for (const m of c.stored) for (const a of m.aliases) targets[a] = m.key;
  if (platform === "amazon") for (const a of ["buy box %", "buy box percentage", "featured offer buy box percentage"]) targets[a] = BUY_BOX_PCT;
  return { id: "generic", label: "Another file: one row per day, columns named plainly", platform, sumRows: false, targets, needs: [] };
}

/** The kinds a platform's file can be, the plain one last. */
export function fileKinds(platform: Platform): FileKind[] {
  return [...KINDS.filter((k) => k.platform === platform), genericKind(platform)];
}

/** The kind whose required columns are all there; the one that asks for more wins, then the one that reads more columns. */
export function detectKind(headers: string[], platform: Platform): string {
  const names = new Set(headers.map(normHeader));
  let best: { id: string; needs: number; hits: number } | null = null;
  for (const k of KINDS) {
    if (k.platform !== platform || !k.needs.every((n) => names.has(n))) continue;
    const hits = [...names].filter((n) => n in k.targets).length;
    if (!best || k.needs.length > best.needs || (k.needs.length === best.needs && hits > best.hits)) best = { id: k.id, needs: k.needs.length, hits };
  }
  return best ? best.id : "generic";
}

/**
 * Reads a file of one channel. `kind` is detected from the columns unless given. `mapping` (column name in lower-case words -> target,
 * or null for "do not use") is applied over the kind's own reading. Lines that cannot be read are reported and left out.
 */
export function parseChannelFile(
  text: string,
  channel: string,
  opts: { platform: Platform; kind?: string; dateFormat?: DateFormat; numberFormat?: NumberFormat; mapping?: Record<string, string | null> },
): FileImport {
  const dateFormat = opts.dateFormat ?? "ymd";
  const numberFormat = opts.numberFormat ?? "us";
  const out: FileImport = { kind: "generic", rows: [], errors: [], from: null, to: null, columns: [], totals: {} };
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  if (lines.every((l) => l.trim() === "")) {
    out.errors.push({ line: 1, message: "The file is empty." });
    return out;
  }
  const header = lines[0];
  const count = (d: string) => splitLine(header, d).length;
  const delim = [",", ";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ",");
  const headerCells = splitLine(header, delim);
  const names = headerCells.map(normHeader);
  const kinds = fileKinds(opts.platform);
  const kind = kinds.find((k) => k.id === (opts.kind ?? detectKind(headerCells, opts.platform))) ?? kinds[kinds.length - 1];
  out.kind = kind.id;

  // What each column is. A hand mapping wins over the kind; the first column that claims a target keeps it.
  const taken = new Set<string>();
  const targets = names.map((n) => {
    const t = opts.mapping && n in opts.mapping ? opts.mapping[n] : (kind.targets[n] ?? null);
    if (!t || taken.has(t)) return null;
    taken.add(t);
    return t;
  });
  out.columns = headerCells.map((h, i) => ({ header: h, target: targets[i] })).filter((c) => c.header !== "");
  const dateAt = targets.indexOf("date");
  if (dateAt < 0) {
    out.errors.push({ line: 1, message: "The file needs a date column." });
    return out;
  }
  const retailerAt = targets.indexOf("retailer");
  const numeric = targets.map((t, i) => ({ t, i })).filter((x): x is { t: string; i: number } => x.t !== null && x.t !== "date" && x.t !== "retailer");
  if (!numeric.length) {
    out.errors.push({ line: 1, message: "No column of this file was recognised besides the date. Say what each column is." });
    return out;
  }
  const labelOf = (t: string) => (t === "adSpend" ? "ad spend" : t.replace(/_/g, " "));

  const byDay = new Map<string, ChannelSaleInput>();
  let any = false;
  lines.slice(1).forEach((raw, idx) => {
    if (raw.trim() === "") return;
    any = true;
    const line = idx + 2;
    const cells = splitLine(raw, delim);
    const date = readDate(cells[dateAt] ?? "", dateFormat);
    if (!date) {
      out.errors.push({ line, message: `Could not read the date "${cells[dateAt] ?? ""}".` });
      return;
    }
    const values: Record<string, number> = {};
    let problem: string | null = null;
    let buyBoxInPercent = false;
    for (const { t, i } of numeric) {
      const cell = (cells[i] ?? "").trim();
      // The platforms write a dash, or "n/a", where a day has no value.
      if (NO_VALUE.test(cell)) continue;
      const r = readNumber(cell.replace(/%$/, ""), numberFormat);
      if (r === "empty") continue;
      if (t === BUY_BOX_PCT) buyBoxInPercent = cell.endsWith("%");
      if (r === "format") problem = `Could not read the ${labelOf(t)} "${cell}" in this number format. Check how numbers are written, above.`;
      else if (r === "bad") problem = `Could not read the ${labelOf(t)} on this line.`;
      else if (r.value < 0) problem = `The ${labelOf(t)} is negative.`;
      else if (!kind.sumRows && (t === "orders" || t === "units") && !Number.isInteger(r.value)) problem = `The ${labelOf(t)} must be a whole number.`;
      else values[t] = r.value;
      if (problem) break;
    }
    if (problem) {
      out.errors.push({ line, message: problem });
      return;
    }
    // The Buy Box % becomes page views that showed the offer; without page views on the row it cannot be weighted and is dropped.
    // A cell written with "%" is a percentage whatever its size (0.50% is half a percent); a bare number up to 1 is a share.
    if (BUY_BOX_PCT in values) {
      const pct = values[BUY_BOX_PCT];
      delete values[BUY_BOX_PCT];
      if (typeof values.page_views === "number") values.buy_box_views = values.page_views * (buyBoxInPercent || pct > 1 ? pct / 100 : pct);
    }
    if (!Object.keys(values).length) {
      out.errors.push({ line, message: "Nothing to read on this line." });
      return;
    }
    const retailer = retailerAt >= 0 ? (cells[retailerAt] ?? "").trim() : "";
    const id = `${date}|${retailer}`;
    const have = byDay.get(id);
    if (have && !kind.sumRows) {
      out.errors.push({ line, message: `A second row for ${date}${retailer ? ` (${retailer})` : ""}. Only the first one is kept.` });
      return;
    }
    const row: ChannelSaleInput = have ?? { date, channel, retailer, revenue: null, orders: null, units: null, adSpend: null, metrics: {}, source: "import" };
    for (const [t, v] of Object.entries(values)) {
      if (isCore(t)) row[t] = (row[t] ?? 0) + v;
      else row.metrics[t] = (row.metrics[t] ?? 0) + v;
    }
    byDay.set(id, row);
  });
  if (!any) out.errors.push({ line: 1, message: "The file has a header but no rows." });
  out.rows = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.retailer < b.retailer ? -1 : a.retailer > b.retailer ? 1 : 0));
  for (const r of out.rows) {
    if (out.from === null || r.date < out.from) out.from = r.date;
    if (out.to === null || r.date > out.to) out.to = r.date;
    for (const core of CORE) if (r[core] !== null) out.totals[core] = (out.totals[core] ?? 0) + (r[core] as number);
    for (const [k, v] of Object.entries(r.metrics)) out.totals[k] = (out.totals[k] ?? 0) + v;
  }
  return out;
}

import type { ChannelSale } from "./types";

/** How the file writes its dates. Year-first dates (2027-03-04) are always understood. */
export type DateFormat = "ymd" | "mdy" | "dmy";

export interface ImportResult {
  rows: ChannelSale[];
  /** What could not be read, with the line of the file (1 = the header). */
  errors: { line: number; message: string }[];
  from: string | null;
  to: string | null;
  revenue: number;
  adSpend: number;
  /** The columns that were read ("date", "revenue", "orders", "units", "ad spend", "retailer") and the header cells that were not used. */
  columns: string[];
  ignored: string[];
}

const COLUMNS: Record<"date" | "revenue" | "orders" | "units" | "adSpend" | "retailer", string[]> = {
  date: ["date"],
  revenue: ["revenue", "sales", "net sales", "gmv"],
  orders: ["orders"],
  units: ["units"],
  adSpend: ["ad spend", "adspend", "spend"],
  retailer: ["retailer", "store"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, " ");

/** Splits one line on the delimiter, keeping delimiters inside double quotes ("" is a quote inside a quoted field). */
export function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const pad = (n: number) => String(n).padStart(2, "0");

export function readDate(raw: string, format: DateFormat): string | null {
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const other = format === "ymd" ? null : /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(raw);
    if (!other) return null;
    const a = Number(other[1]);
    const b = Number(other[2]);
    y = other[3].length === 2 ? 2000 + Number(other[3]) : Number(other[3]);
    [m, d] = format === "mdy" ? [a, b] : [b, a];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** How the file writes numbers: "us" = 1,234.56 (comma for thousands), "eu" = 1.234,56 (dot for thousands). */
export type NumberFormat = "us" | "eu";

export type Read = { value: number } | "empty" | "format" | "bad";

/**
 * A number as a spreadsheet writes it, in the chosen format; currency signs and spaces are allowed. A value that only makes sense in the
 * other format ("12.345" with a comma for thousands, "1,234.56" with a dot for thousands) is refused as "format" rather than read as a
 * thousandth or a thousand times what was meant.
 */
export function readNumber(raw: string, format: NumberFormat): Read {
  const s = raw.replace(/[$£€\s]/g, "");
  if (s === "") return "empty";
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  let text: string | null = null;
  if (format === "us") {
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)) text = body.replace(/,/g, "");
    else if (/^\d{1,3}(\.\d{3})+$/.test(body)) return "format";
    else if (/^\d+(\.\d+)?$/.test(body)) text = body;
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(body)) text = body.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d+)?$/.test(body)) text = body.replace(",", ".");
  if (text === null) return /^[\d.,]+$/.test(body) ? "format" : "bad";
  const value = Number(text) * (negative ? -1 : 1);
  return Number.isFinite(value) ? { value } : "bad";
}

/**
 * Reads a CSV of one channel's daily sales. The first line names the columns (any case): date; revenue (or sales, net sales, gmv);
 * and when known orders, units, ad spend (or spend) and retailer (or store). Comma, semicolon or tab between columns.
 * Lines that cannot be read are reported with their line number and left out; the rest load.
 */
export function parseChannelCsv(text: string, channel: string, dateFormat: DateFormat = "ymd", numberFormat: NumberFormat = "us"): ImportResult {
  const out: ImportResult = { rows: [], errors: [], from: null, to: null, revenue: 0, adSpend: 0, columns: [], ignored: [] };
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  if (lines.every((l) => l.trim() === "")) {
    out.errors.push({ line: 1, message: "The file is empty." });
    return out;
  }
  const header = lines[0];
  const count = (d: string) => splitLine(header, d).length;
  const delim = [",", ";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ",");
  const headerCells = splitLine(header, delim);
  const names = headerCells.map(norm);
  const col = (k: keyof typeof COLUMNS) => names.findIndex((n) => COLUMNS[k].includes(n));
  const at = { date: col("date"), revenue: col("revenue"), orders: col("orders"), units: col("units"), adSpend: col("adSpend"), retailer: col("retailer") };
  const labels: [string, number][] = [["date", at.date], ["revenue", at.revenue], ["orders", at.orders], ["units", at.units], ["ad spend", at.adSpend], ["retailer", at.retailer]];
  out.columns = labels.filter(([, i]) => i >= 0).map(([l]) => l);
  out.ignored = headerCells.filter((c, i) => c !== "" && !labels.some(([, j]) => j === i));
  if (at.date < 0 || at.revenue < 0) {
    out.errors.push({ line: 1, message: "The file needs a date column and a revenue column." });
    return out;
  }
  const seen = new Set<string>();
  let any = false;
  lines.slice(1).forEach((raw, i) => {
    if (raw.trim() === "") return;
    any = true;
    const line = i + 2;
    const cells = splitLine(raw, delim);
    const cell = (idx: number) => (idx >= 0 ? (cells[idx] ?? "") : "");
    const date = readDate(cell(at.date), dateFormat);
    if (!date) {
      out.errors.push({ line, message: `Could not read the date "${cell(at.date)}".` });
      return;
    }
    // Revenue is needed; orders, units and ad spend count as zero when the column or the cell is empty. Orders and units are whole numbers.
    const fields: [string, number, boolean, boolean][] = [
      ["revenue", at.revenue, true, false],
      ["orders", at.orders, false, true],
      ["units", at.units, false, true],
      ["ad spend", at.adSpend, false, false],
    ];
    const values: Record<string, number> = {};
    let problem: string | null = null;
    for (const [label, idx, required, whole] of fields) {
      const raw = cell(idx);
      const r = idx >= 0 ? readNumber(raw, numberFormat) : "empty";
      if (r === "empty") {
        if (required) problem = "No revenue on this line.";
        else values[label] = 0;
      } else if (r === "format") problem = `Could not read the ${label} "${raw}" in this number format. Check how numbers are written, above.`;
      else if (r === "bad") problem = `Could not read the ${label} on this line.`;
      else if (r.value < 0) problem = `The ${label} is negative.`;
      else if (whole && !Number.isInteger(r.value)) problem = `The ${label} must be a whole number.`;
      else values[label] = r.value;
      if (problem) break;
    }
    if (problem) {
      out.errors.push({ line, message: problem });
      return;
    }
    const revenue = values.revenue;
    const retailer = cell(at.retailer);
    const id = `${date}|${retailer}`;
    if (seen.has(id)) {
      out.errors.push({ line, message: `A second row for ${date}${retailer ? ` (${retailer})` : ""}. Only the first one is kept.` });
      return;
    }
    seen.add(id);
    out.rows.push({ date, channel, retailer, revenue, orders: values.orders, units: values.units, adSpend: values["ad spend"], source: "import" });
  });
  if (!any) out.errors.push({ line: 1, message: "The file has a header but no rows." });
  for (const r of out.rows) {
    if (out.from === null || r.date < out.from) out.from = r.date;
    if (out.to === null || r.date > out.to) out.to = r.date;
    out.revenue += r.revenue;
    out.adSpend += r.adSpend;
  }
  return out;
}

/**
 * Days of synced Shopify orders (the `channel_sales_from_orders` database function) as sales rows of a channel. Shopify orders carry
 * no ad spend and no unit count here, so those stay zero. Days that cannot be read are left out.
 */
export function shopifyDaysToSales(channel: string, rows: { date: unknown; revenue: unknown; orders: unknown }[]): ChannelSale[] {
  const out: ChannelSale[] = [];
  for (const r of rows) {
    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : null;
    const revenue = Number(r.revenue);
    const orders = Number(r.orders);
    if (!date || !Number.isFinite(revenue) || revenue < 0) continue;
    out.push({ date, channel, retailer: "", revenue, orders: Number.isFinite(orders) && orders > 0 ? orders : 0, units: 0, adSpend: 0, source: "shopify" });
  }
  return out;
}

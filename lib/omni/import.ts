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
function splitLine(line: string, delim: string): string[] {
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

function readDate(raw: string, format: DateFormat): string | null {
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

/** A number as a spreadsheet writes it: currency signs, spaces and thousands commas allowed. Null = empty, NaN = unreadable. */
function readNumber(raw: string): number | null {
  let s = raw.replace(/[$£€\s]/g, "");
  if (s === "") return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

/**
 * Reads a CSV of one channel's daily sales. The first line names the columns (any case): date; revenue (or sales, net sales, gmv);
 * and when known orders, units, ad spend (or spend) and retailer (or store). Comma, semicolon or tab between columns.
 * Lines that cannot be read are reported with their line number and left out; the rest load.
 */
export function parseChannelCsv(text: string, channel: string, dateFormat: DateFormat = "ymd"): ImportResult {
  const out: ImportResult = { rows: [], errors: [], from: null, to: null, revenue: 0, adSpend: 0 };
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  if (lines.every((l) => l.trim() === "")) {
    out.errors.push({ line: 1, message: "The file is empty." });
    return out;
  }
  const header = lines[0];
  const count = (d: string) => splitLine(header, d).length;
  const delim = [",", ";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ",");
  const names = splitLine(header, delim).map(norm);
  const col = (k: keyof typeof COLUMNS) => names.findIndex((n) => COLUMNS[k].includes(n));
  const at = { date: col("date"), revenue: col("revenue"), orders: col("orders"), units: col("units"), adSpend: col("adSpend"), retailer: col("retailer") };
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
    const revenue = readNumber(cell(at.revenue));
    if (revenue === null) {
      out.errors.push({ line, message: "No revenue on this line." });
      return;
    }
    const optional: [string, number][] = [
      ["orders", at.orders],
      ["units", at.units],
      ["ad spend", at.adSpend],
    ];
    const values: Record<string, number> = { revenue };
    for (const [label, idx] of optional) values[label] = idx >= 0 ? (readNumber(cell(idx)) ?? 0) : 0;
    const bad = Object.entries(values).find(([, v]) => Number.isNaN(v) || v < 0);
    if (bad) {
      out.errors.push({ line, message: Number.isNaN(bad[1]) ? `Could not read the ${bad[0]} on this line.` : `The ${bad[0]} is negative.` });
      return;
    }
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

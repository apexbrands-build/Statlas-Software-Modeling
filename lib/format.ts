import type { Currency } from "./types";

export type Format = "currency0" | "currency2" | "number" | "ratio2" | "percent1";

export function formatValue(v: number | null | undefined, f: Format, currency: Currency): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  switch (f) {
    case "currency0":
      return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
    case "currency2":
      return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    case "number":
      return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(v);
    case "ratio2":
      return v.toFixed(2);
    case "percent1":
      return `${(v * 100).toFixed(1)}%`;
  }
}

export function formatDiff(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "";
  const s = pct >= 0 ? "+" : "";
  return `${s}${(pct * 100).toFixed(1)}%`;
}

export function compactCurrency(v: number, currency: Currency): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
}

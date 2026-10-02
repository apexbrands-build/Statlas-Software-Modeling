/** Product by First Product: what customers do after a first order containing each product. */

export interface FirstProductRow {
  product: string;
  /** Orders by sequence: 1st, 2nd, 3rd, 4th and later. */
  orders: [number, number, number, number];
  /** Order Revenue of those orders. */
  sales: [number, number, number, number];
  refundOrders: number;
  refundAmount: number;
}

export type FpVariation = "count" | "total" | "aov" | "pct";
export const FP_VARIATIONS: { id: FpVariation; label: string }[] = [
  { id: "count", label: "Order Count" },
  { id: "total", label: "Order Total (Sales)" },
  { id: "aov", label: "Order AOV" },
  { id: "pct", label: "Percent of First Order" },
];

export type FpFormat = "number" | "currency0" | "currency2" | "percent1";
export const FP_COLUMNS = ["Total", "1st order", "2nd order", "3rd order", "4th+ order", "Additional orders", "Additional order rate", "Refunds", "% refunded"] as const;

export interface FpOut {
  product: string;
  values: (number | null)[];
  formats: FpFormat[];
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

function line(label: string, o: number[], s: number[], refundOrders: number, refundAmount: number, v: FpVariation): FpOut {
  const totalOrders = sum(o);
  const addOrders = o[1] + o[2] + o[3];
  const rate = div(addOrders, o[0]);
  const refundPct = div(refundOrders, totalOrders);
  switch (v) {
    case "count":
      return { product: label, values: [totalOrders, ...o, addOrders, rate, refundOrders, refundPct], formats: ["number", "number", "number", "number", "number", "number", "percent1", "number", "percent1"] };
    case "total":
      return {
        product: label,
        values: [sum(s), ...s, s[1] + s[2] + s[3], rate, refundAmount, div(refundAmount, sum(s))],
        formats: ["currency0", "currency0", "currency0", "currency0", "currency0", "currency0", "percent1", "currency0", "percent1"],
      };
    case "aov":
      return {
        product: label,
        values: [div(sum(s), totalOrders), ...o.map((n, i) => div(s[i], n)), div(s[1] + s[2] + s[3], addOrders), rate, div(refundAmount, refundOrders), refundPct],
        formats: ["currency2", "currency2", "currency2", "currency2", "currency2", "currency2", "percent1", "currency2", "percent1"],
      };
    case "pct":
      return {
        product: label,
        values: [div(totalOrders, o[0]), ...o.map((n) => div(n, o[0])), div(addOrders, o[0]), rate, div(refundOrders, o[0]), refundPct],
        formats: Array(9).fill("percent1") as FpFormat[],
      };
  }
}

/** Rows sorted by first orders (most first). The total row is null for AOV, which cannot be summed. */
export function buildFirstProduct(rows: FirstProductRow[], v: FpVariation): { rows: FpOut[]; total: FpOut | null } {
  const sorted = [...rows].sort((a, b) => b.orders[0] - a.orders[0]);
  const out = sorted.map((r) => line(r.product, r.orders, r.sales, r.refundOrders, r.refundAmount, v));
  // Products share customers, so totals add up above the real customer count (documented in the report footer).
  const t = rows.reduce(
    (acc, r) => {
      r.orders.forEach((n, i) => (acc.o[i] += n));
      r.sales.forEach((n, i) => (acc.s[i] += n));
      acc.ro += r.refundOrders;
      acc.ra += r.refundAmount;
      return acc;
    },
    { o: [0, 0, 0, 0], s: [0, 0, 0, 0], ro: 0, ra: 0 },
  );
  return { rows: out, total: v === "aov" ? null : line("Total", t.o, t.s, t.ro, t.ra, v) };
}

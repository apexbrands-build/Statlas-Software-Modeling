import { describe, expect, it } from "vitest";
import { buildFirstProduct, type FirstProductRow } from "./first-product";

const rows: FirstProductRow[] = [
  { product: "A", orders: [10, 4, 2, 1], sales: [1000, 400, 200, 100], refundOrders: 1, refundAmount: 50 },
  { product: "B", orders: [20, 2, 0, 0], sales: [1600, 160, 0, 0], refundOrders: 0, refundAmount: 0 },
];

describe("buildFirstProduct", () => {
  it("sorts by first orders and computes the additional order rate", () => {
    const r = buildFirstProduct(rows, "count");
    expect(r.rows.map((x) => x.product)).toEqual(["B", "A"]);
    const a = r.rows[1].values;
    expect(a[0]).toBe(17); // total orders
    expect(a[5]).toBe(7); // additional orders
    expect(a[6]).toBeCloseTo(0.7); // (4+2+1)/10
    expect(a[8]).toBeCloseTo(1 / 17);
  });
  it("shows sales, AOV (no total row) and percent of first order", () => {
    expect(buildFirstProduct(rows, "total").rows[1].values[0]).toBe(1700);
    const aov = buildFirstProduct(rows, "aov");
    expect(aov.total).toBeNull();
    expect(aov.rows[1].values[1]).toBe(100);
    expect(buildFirstProduct(rows, "pct").rows[1].values[2]).toBeCloseTo(0.4);
  });
  it("sums the total row and guards zero divisions", () => {
    const t = buildFirstProduct(rows, "count").total!;
    expect(t.values[1]).toBe(30);
    expect(buildFirstProduct([{ product: "Z", orders: [0, 0, 0, 0], sales: [0, 0, 0, 0], refundOrders: 0, refundAmount: 0 }], "count").rows[0].values[6]).toBeNull();
  });
});

"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Loading, ReportFrame, selectClass, useReportRange } from "./ReportFrame";
import { ReportTable, type Column, type Row } from "./ReportTable";
import { useApp } from "@/lib/app-context";
import { formatValue } from "@/lib/format";
import { buildFirstProduct, FP_COLUMNS, FP_VARIATIONS, type FirstProductRow, type FpOut, type FpVariation } from "@/lib/reports/first-product";
import { getRepository } from "@/lib/repository";

const COLUMNS: Column[] = FP_COLUMNS.map((label) => ({ label }));

export function FirstProductReport() {
  const { client } = useApp();
  const { range, setRange } = useReportRange();
  const [variation, setVariation] = useState<FpVariation>("count");
  const [loaded, setLoaded] = useState<{ key: string; rows: FirstProductRow[] | null } | null>(null);
  const key = client && range ? `${client.id}|${range.from}|${range.to}` : null;

  useEffect(() => {
    if (!client || !range || !key) return;
    let cancel = false;
    getRepository()
      .getFirstProducts(client.id, range.from, range.to)
      .then((rows) => !cancel && setLoaded({ key, rows }));
    return () => {
      cancel = true;
    };
  }, [client, range, key]);

  const built = useMemo(() => {
    if (!client || !loaded || loaded.key !== key || !loaded.rows) return null;
    const res = buildFirstProduct(loaded.rows, variation);
    const toRow = (r: FpOut, k: string): Row => ({ key: k, label: r.product, cells: r.values.map((v, i) => ({ text: formatValue(v, r.formats[i], client.currency) })) });
    return { rows: res.rows.map((r) => toRow(r, r.product)), total: res.total ? toRow(res.total, "total") : undefined };
  }, [client, loaded, key, variation]);

  return (
    <ReportFrame
      slug="first-product"
      range={range}
      setRange={setRange}
      controls={
        <label className="flex items-center gap-2 text-sm text-text-muted">
          Show
          <select aria-label="Variation" className={selectClass} value={variation} onChange={(e) => setVariation(e.target.value as FpVariation)}>
            {FP_VARIATIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {!loaded || loaded.key !== key ? (
        <Loading />
      ) : loaded.rows === null ? (
        <Empty>Order line items are not stored yet. Apply database migration 0006 (order_lines), then re-run the Shopify history load to fill them.</Empty>
      ) : !built || built.rows.length === 0 ? (
        <Empty>No first orders with product data in this range. If this is a new setup, re-run the Shopify history load to store line items.</Empty>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            Customers are grouped by their first paid order. Every product in that order is credited with the customer&apos;s whole later behaviour, so totals can be higher than the real number of customers.
            Orders are DTC orders with revenue above zero; refunds are those on the same orders. Use 6 to 12 months to see real repeat behaviour. Top 1,000 products.
          </p>
          <ReportTable columns={COLUMNS} rows={built.rows} total={built.total} firstLabel="First product" filename={`first-product-${range?.from}-${range?.to}`} />
        </>
      )}
    </ReportFrame>
  );
}

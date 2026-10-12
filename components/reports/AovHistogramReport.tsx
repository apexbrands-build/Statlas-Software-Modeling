"use client";

import { useEffect, useMemo, useState } from "react";
import { DailyChart } from "@/components/DailyChart";
import { Empty, Loading, ReportFrame, selectClass, useReportRange } from "./ReportFrame";
import { ReportTable, type Column, type Row } from "./ReportTable";
import { useApp } from "@/lib/app-context";
import { formatValue } from "@/lib/format";
import { AOV_STEPS, buildAovRows, type AovData, type AovMode } from "@/lib/reports/aov";
import { getRepository } from "@/lib/repository";
import { theme } from "@/theme/theme";

const COLUMNS: Column[] = [{ label: "AOV Range" }, { label: "Order Count" }, { label: "%" }, { label: "Order Revenue" }, { label: "%" }];

/** The Group By choice: Dynamic Ranges, Complete Range, or a fixed increment. */
type Choice = "dynamic" | "complete" | `${number}`;

export function AovHistogramReport() {
  const { client } = useApp();
  const { range, setRange } = useReportRange();
  const [choice, setChoice] = useState<Choice>("dynamic");
  const [loaded, setLoaded] = useState<{ key: string; data: AovData | null } | null>(null);

  const mode: AovMode = choice === "dynamic" || choice === "complete" ? choice : "step";
  const step = choice === "dynamic" || choice === "complete" ? 25 : Number(choice);
  const key = client && range ? `${client.id}|${range.from}|${range.to}|${choice}` : null;

  useEffect(() => {
    if (!client || !range || !key) return;
    let cancel = false;
    (async () => {
      const data = await getRepository().getAovHistogram(client.id, range.from, range.to, mode, step);
      if (!cancel) setLoaded({ key, data });
    })();
    return () => {
      cancel = true;
    };
    // key encodes the client, the range and the Group By choice (mode and step derive from it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const currency = client?.currency ?? "GBP";
  const symbol = formatValue(0, "currency0", currency).replace(/[\d.,\s]/g, "");
  const data = loaded && loaded.key === key ? loaded.data : undefined;
  const built = useMemo(() => (data ? buildAovRows(data, mode, currency) : null), [data, mode, currency]);

  const controls = (
    <select className={selectClass} value={choice} onChange={(e) => setChoice(e.target.value as Choice)} aria-label="Group by">
      <option value="dynamic">Dynamic Ranges</option>
      {AOV_STEPS.map((s) => (
        <option key={s} value={String(s)}>
          {symbol}
          {s} Increments
        </option>
      ))}
      <option value="complete">Complete Range</option>
    </select>
  );

  let body;
  if (data === undefined || !client) body = <Loading />;
  else if (data === null) body = <Empty>AOV Histogram needs order data. It is not available in demo data or before the database update.</Empty>;
  else if (data.stats.orders === 0 || !built) body = <Empty>No orders in this range.</Empty>;
  else {
    const rows: Row[] = built.rows.map((r) => ({
      key: r.nth,
      label: r.nth,
      cells: [{ text: r.range }, { text: formatValue(r.orders, "number", currency) }, { text: formatValue(r.ordersPct, "percent1", currency) }, { text: formatValue(r.revenue, "currency0", currency) }, { text: formatValue(r.revenuePct, "percent1", currency) }],
    }));
    const cards: [string, number | null][] = [
      ["Mean", data.stats.mean],
      ["Median", data.stats.median],
      ["Mode", data.stats.mode],
    ];
    body = (
      <>
        <div className="rounded-xl border border-border bg-surface p-3">
          <DailyChart
            dates={built.rows.map((r) => r.nth)}
            labels={built.rows.map((r) => r.range)}
            series={[{ id: "orders", label: "Orders", kind: "bar", color: theme.colors.chartPrimary, values: built.rows.map((r) => r.orders) }]}
            formatValue={(v) => formatValue(v, "number", currency)}
            height={240}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-surface p-4 text-center">
              <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
              <div className="tabular mt-2 text-2xl font-semibold">{formatValue(value, "currency2", currency)}</div>
            </div>
          ))}
        </div>
        <ReportTable columns={COLUMNS} rows={rows} firstLabel="Nth bucket" filename="aov-histogram" />
        {built.footnote && <p className="text-xs text-text-muted">{built.footnote}</p>}
      </>
    );
  }

  return (
    <ReportFrame slug="aov-histogram" range={range} setRange={setRange} controls={controls}>
      <p className="text-xs text-text-muted">Histogram of average order value over the selected period · Channels: DTC orders</p>
      {body}
    </ReportFrame>
  );
}

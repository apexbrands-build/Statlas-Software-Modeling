"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MetricsTable } from "./MetricsTable";
import { Empty, Loading, ReportFrame, selectClass, useReportRange } from "./ReportFrame";
import { useApp } from "@/lib/app-context";
import { clipToLastData } from "@/lib/reports/bucket";
import { GROUP_LABELS, type GroupBy } from "@/lib/reports/grouping";
import type { NumTable } from "@/lib/reports/table-model";
import { getRepository } from "@/lib/repository";
import type { ClientSettings, Currency, DailyFact } from "@/lib/types";

const GROUPS = Object.keys(GROUP_LABELS) as GroupBy[];

/** Shared page for reports built from daily facts: date range, Group By, caption, optional chart, heat-mapped table. */
export function FactsReport({
  slug,
  caption,
  firstLabel,
  build,
  chart,
}: {
  slug: string;
  caption: string;
  firstLabel: string;
  build: (facts: DailyFact[], settings: ClientSettings, by: GroupBy) => NumTable;
  chart?: (table: NumTable, currency: Currency) => ReactNode;
}) {
  const { client, settings } = useApp();
  const { range, setRange } = useReportRange();
  const [by, setBy] = useState<GroupBy>("daily");
  const [loaded, setLoaded] = useState<{ key: string; facts: DailyFact[] } | null>(null);
  const key = client && range ? `${client.id}|${range.from}|${range.to}` : null;

  useEffect(() => {
    if (!client || !range || !key) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const [facts, lastData] = await Promise.all([repo.getFacts(client.id, range.from, range.to), repo.getLastDataDate(client.id)]);
      if (!cancel) setLoaded({ key, facts: clipToLastData(facts, lastData) });
    })();
    return () => {
      cancel = true;
    };
    // key encodes the client and the range
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const table = useMemo(() => (loaded && loaded.key === key && settings ? build(loaded.facts, settings, by) : null), [loaded, key, settings, by, build]);

  const controls = (
    <select className={selectClass} value={by} onChange={(e) => setBy(e.target.value as GroupBy)} aria-label="Group by">
      {GROUPS.map((g) => (
        <option key={g} value={g}>
          {GROUP_LABELS[g]}
        </option>
      ))}
    </select>
  );

  return (
    <ReportFrame slug={slug} range={range} setRange={setRange} controls={controls}>
      <p className="text-xs text-text-muted">
        {caption} · Channels: {settings?.dtcChannels.join(", ") || "None"}
      </p>
      {!table || !client ? (
        <Loading />
      ) : table.rows.length === 0 ? (
        <Empty>No data in this range.</Empty>
      ) : (
        <>
          {chart?.(table, client.currency)}
          <MetricsTable table={table} currency={client.currency} firstLabel={firstLabel} filename={slug} />
        </>
      )}
    </ReportFrame>
  );
}

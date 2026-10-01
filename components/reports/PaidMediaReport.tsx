"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Loading, ReportFrame, selectClass, useReportRange } from "./ReportFrame";
import { ReportTable, type Cell, type Column, type Row } from "./ReportTable";
import { useApp } from "@/lib/app-context";
import { PLATFORMS } from "@/lib/channels";
import { formatDiff, formatValue } from "@/lib/format";
import { compare } from "@/lib/metrics";
import { buildPaidMedia, canCompare, compareRange, filterCampaigns, PM_GROUP_LABELS, type PmGroup, type PmStats } from "@/lib/reports/paid-media";
import { getRepository } from "@/lib/repository";
import type { CampaignDay } from "@/lib/types";

type Cmp = "none" | "prev" | "yoy";
const GROUPS = Object.keys(PM_GROUP_LABELS) as PmGroup[];
const input = `${selectClass} w-48`;

export function PaidMediaReport() {
  const { client, settings } = useApp();
  const { range, setRange } = useReportRange();
  const [by, setBy] = useState<PmGroup>("campaign");
  const [platform, setPlatform] = useState("all");
  const [cmpMode, setCmpMode] = useState<Cmp>("none");
  const [nameContains, setNameContains] = useState("");
  const [removeText, setRemoveText] = useState("");
  const [excludeTests, setExcludeTests] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; cur: CampaignDay[]; cmp: CampaignDay[] | null } | null>(null);

  const cmpRange = range && cmpMode !== "none" ? compareRange(range, cmpMode) : null;
  const key = client && range ? `${client.id}|${range.from}|${range.to}|${cmpMode}` : null;

  useEffect(() => {
    if (!client || !range || !key) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const [cur, cmp] = await Promise.all([repo.getCampaignDays(client.id, range.from, range.to), cmpRange ? repo.getCampaignDays(client.id, cmpRange.from, cmpRange.to) : Promise.resolve(null)]);
      if (!cancel) setLoaded({ key, cur, cmp });
    })();
    return () => {
      cancel = true;
    };
    // cmpRange is derived from range + cmpMode (both in key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, range, key]);

  const built = useMemo(() => {
    if (!client || !settings || !loaded || loaded.key !== key) return null;
    const cur = client.currency;
    const filters = { platform, nameContains, removeNames: removeText.split(","), excludeTests: excludeTests ?? settings.extra.excludeTestCampaigns };
    const res = buildPaidMedia(filterCampaigns(loaded.cur, filters, settings), loaded.cmp ? filterCampaigns(loaded.cmp, filters, settings) : null, by, settings);
    const showCmp = loaded.cmp !== null && canCompare(by);
    const columns: Column[] = [
      ...(by === "campaign" ? [{ label: "Platform" }] : []),
      { label: "Spend" },
      { label: "% of spend" },
      { label: "Platform revenue" },
      { label: "Purchases" },
      { label: "ROAS" },
      { label: "iROAS" },
      { label: "iRevenue" },
      { label: "CPA" },
      { label: "iCPA" },
      { label: "AOV" },
      ...(showCmp ? [{ label: "Spend vs comparison", group: "Comparison" }, { label: "iROAS vs comparison", group: "Comparison" }, { label: "iCPA vs comparison", group: "Comparison" }] : []),
    ];
    const f = (v: number | null, fmt: Parameters<typeof formatValue>[1]) => formatValue(v, fmt, cur);
    const delta = (a: number | null, b: number | null | undefined, dir: "up" | "down"): Cell => {
      const c = compare(a, b ?? null, dir);
      return { text: c.diff === null ? "–" : formatDiff(c.diff), tone: c.tone };
    };
    const toRow = (r: (typeof res.rows)[number]): Row => {
      const c: PmStats | null = r.cmp;
      const roasTone = compare(r.iRoas, res.total.iRoas, "up").tone;
      const cpaTone = compare(r.iCpa, res.total.iCpa, "down").tone;
      return {
        key: r.key,
        label: r.label,
        cells: [
          ...(by === "campaign" ? [{ text: r.platform }] : []),
          { text: f(r.spend, "currency0") },
          { text: r.shareOfSpend === null ? "–" : f(r.shareOfSpend, "percent1") },
          { text: f(r.platformRevenue, "currency0") },
          { text: f(r.purchases, "number") },
          { text: f(r.roas, "ratio2") },
          { text: f(r.iRoas, "ratio2"), tone: roasTone },
          { text: f(r.iRevenue, "currency0") },
          { text: f(r.cpa, "currency2") },
          { text: f(r.iCpa, "currency2"), tone: cpaTone },
          { text: f(r.aov, "currency2") },
          ...(showCmp ? [delta(r.spend, c?.spend, "up"), delta(r.iRoas, c?.iRoas, "up"), delta(r.iCpa, c?.iCpa, "down")] : []),
        ],
      };
    };
    return { columns, rows: res.rows.map(toRow), total: toRow(res.total), count: res.rows.length };
  }, [client, settings, loaded, key, by, platform, nameContains, removeText, excludeTests]);

  const testsOn = excludeTests ?? settings?.extra.excludeTestCampaigns ?? false;
  return (
    <ReportFrame
      slug="ads"
      range={range}
      setRange={setRange}
      controls={
        <>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Group by
            <select aria-label="Group by" className={selectClass} value={by} onChange={(e) => setBy(e.target.value as PmGroup)}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {PM_GROUP_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Platform
            <select aria-label="Platform" className={selectClass} value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="all">All</option>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Compare
            <select aria-label="Compare" className={selectClass} value={cmpMode} onChange={(e) => setCmpMode(e.target.value as Cmp)}>
              <option value="none">None</option>
              <option value="prev">Previous period</option>
              <option value="yoy">Last year</option>
            </select>
          </label>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
        <input aria-label="Filter on campaign name" placeholder="Filter on campaign name" className={input} value={nameContains} onChange={(e) => setNameContains(e.target.value)} />
        <input aria-label="Remove campaign names" placeholder="Remove names (comma separated)" className={`${input} w-64`} value={removeText} onChange={(e) => setRemoveText(e.target.value)} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={testsOn} onChange={(e) => setExcludeTests(e.target.checked)} />
          Exclude tests
        </label>
        {by !== "campaign" && cmpMode !== "none" && !canCompare(by) && <span className="text-xs text-text-faint">Comparison applies to campaign, platform and channel-type grouping.</span>}
      </div>
      {!built ? (
        <Loading />
      ) : built.count === 0 ? (
        <Empty>No ad spend matches these filters in this range.</Empty>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            Platform numbers are 7-day click as reported by the ad platforms. iROAS, iRevenue and iCPA apply the incrementality multipliers from Store Settings. Cells are coloured against the blended total (±10% is neutral).
          </p>
          <ReportTable columns={built.columns} rows={built.rows} total={built.total} firstLabel={PM_GROUP_LABELS[by]} filename={`paid-media-${range?.from}-${range?.to}`} />
        </>
      )}
    </ReportFrame>
  );
}

import type { Format } from "../format";
import { aggregate, amerSpend, cmParts, div, METRICS, orderRevenue, orders, paidStats, totalSpend, type Totals } from "../metrics";
import type { ChannelKey, ClientSettings, DailyFact } from "../types";

export interface PnlRow {
  key: string;
  label: string;
  format: Format;
  /** One value per month (12) then the year total. null = nothing to show. */
  values: (number | null)[];
  bold?: boolean;
  /** Show the value as a % of operating revenue under the amount. */
  pctOfRevenue?: boolean;
}
/** How the revenue block is broken out. All three reconcile to the same Operating Revenue. */
export type RevenueBy = "simplified" | "newReturning" | "paidOrganic";
export const REVENUE_BY_LABELS: Record<RevenueBy, string> = {
  simplified: "Simplified",
  newReturning: "New vs Returning",
  paidOrganic: "Paid vs Organic",
};

/** Totals that carry their own cost settings (plan and forecast columns). */
export type PnlTotals = Totals & {
  cmSettings?: ClientSettings;
  /** Organic revenue the plan sets directly (planned share of order revenue); without it organic is what the dashboard's definition leaves. */
  organicRevenue?: number;
  /** Planned spend per channel that has no ROAS target (the returning audiences): kept out of the planned ROAS and CPA, which only the targeted spend explains. */
  untargetedSpend?: Partial<Record<ChannelKey, number>>;
};

const organicOf = (t: Totals, s: ClientSettings) => (t as PnlTotals).organicRevenue ?? METRICS.organicRevenue.value(t, s);

export interface PnlSection {
  title: string;
  rows: PnlRow[];
}

const SEARCH: ChannelKey[] = ["google_nonbrand", "google_brand", "bing", "bing_returning"];
const SOCIAL: ChannelKey[] = ["meta_acquisition", "meta_returning", "pinterest", "pinterest_returning", "tiktok", "tiktok_returning", "snapchat", "snapchat_returning"];
const OTHER_ADS: ChannelKey[] = ["youtube", "youtube_returning", "applovin", "applovin_returning"];
const META: ChannelKey[] = ["meta_acquisition", "meta_returning"];
const GOOGLE: ChannelKey[] = ["google_nonbrand", "google_brand"];
const PINTEREST: ChannelKey[] = ["pinterest", "pinterest_returning"];

const sp = (t: Totals, keys: ChannelKey[]) => keys.reduce((s, k) => s + t.channels[k].spend, 0);
const rv = (t: Totals, keys: ChannelKey[]) => keys.reduce((s, k) => s + t.channels[k].platformRevenue, 0);
const pu = (t: Totals, keys: ChannelKey[]) => keys.reduce((s, k) => s + t.channels[k].platformPurchases, 0);
/** Spend that platform revenue and conversions can be set against: all of it, less planned spend that has no ROAS target. */
const spReported = (t: Totals, keys: ChannelKey[]) => sp(t, keys) - keys.reduce((s, k) => s + ((t as PnlTotals).untargetedSpend?.[k] ?? 0), 0);

/** Months (0-11) of `year` that have at least one day of data. */
export function pnlTotals(facts: DailyFact[], year: number): (Totals | null)[] {
  const byMonth: DailyFact[][] = Array.from({ length: 12 }, () => []);
  for (const f of facts) if (f.date.startsWith(String(year))) byMonth[Number(f.date.slice(5, 7)) - 1].push(f);
  const months = byMonth.map((fs) => (fs.length ? aggregate(fs) : null));
  return [...months, aggregate(facts.filter((f) => f.date.startsWith(String(year))))];
}

type RowFn = (key: string, label: string, format: Format, f: (t: Totals) => number | null, extra?: Partial<PnlRow>) => PnlRow;

/**
 * Revenue block. Simplified: gross - discounts + shipping - refunds. The other two start from Order Revenue (gross - discounts +
 * shipping + tax, refunds not deducted), split by customer type or by source, then take off tax and refunds. Every view ends at the
 * same Operating Revenue.
 */
function revenueRows(row: RowFn, opRev: (t: Totals) => number, s: ClientSettings, by: RevenueBy): PnlRow[] {
  const operating = row("opRev", "Operating Revenue", "currency0", opRev, { bold: true });
  if (by === "simplified") {
    return [
      row("gross", "Gross Sales", "currency0", (t) => t.grossSales),
      row("discounts", "Discounts", "currency0", (t) => -t.discounts),
      row("shipping", "Shipping", "currency0", (t) => t.shippingCollected),
      row("refunds", "Refunds", "currency0", (t) => -t.refunds),
      operating,
    ];
  }
  const tail = [
    row("orderRevTotal", "Order Revenue", "currency0", (t) => orderRevenue(t), { bold: true }),
    row("tax", "Tax", "currency0", (t) => -t.tax),
    row("refunds", "Refunds", "currency0", (t) => -t.refunds),
    operating,
  ];
  if (by === "newReturning") {
    return [row("newRevenue", "New Customer Revenue", "currency0", (t) => t.newOrderRevenue), row("retRevenue", "Returning Customer Revenue", "currency0", (t) => t.returningOrderRevenue), ...tail];
  }
  return [
    row("paidRevenue", "Paid Revenue (incremental)", "currency0", (t) => paidStats(t, s).iRevenue),
    row("emailRevenueSplit", "Email Revenue", "currency0", (t) => t.emailRevenue),
    row("organicRevenueSplit", "Organic Revenue", "currency0", (t) => organicOf(t, s)),
    ...tail,
  ];
}

/**
 * Monthly P&L. Operating revenue = gross - discounts + shipping - refunds (= net sales + shipping), the same base the
 * dashboard's contribution margin uses. Fixed costs (SG&A) come from Store Settings and sit below the CM line.
 */
export function buildPnl(totals: (Totals | null)[], s: ClientSettings, revenueBy: RevenueBy = "simplified", fixedCosts?: (number | null)[]): PnlSection[] {
  // Plan columns carry their own cost settings (the plan's rates differ month to month).
  const cmOf = (t: Totals) => cmParts(t, (t as PnlTotals).cmSettings ?? s);
  const row = (key: string, label: string, format: Format, f: (t: Totals) => number | null, extra: Partial<PnlRow> = {}): PnlRow => ({
    key,
    label,
    format,
    values: totals.map((t) => {
      const v = t && t.days > 0 ? f(t) : null;
      return v === 0 ? 0 : v; // turns -0 into 0
    }),
    ...extra,
  });
  const opRev = (t: Totals) => t.netSales + t.shippingCollected;
  // Fixed costs are monthly: months with data x monthly amount (total column = sum of those months).
  const monthsWithData = totals.slice(0, 12).map((t) => (t && t.days > 0 ? 1 : 0));
  const monthlyFixed = monthsWithData.map((m, i) => (m ? (fixedCosts ? fixedCosts[i] ?? 0 : s.monthlyFixedCosts) : null));
  const sgaValues: (number | null)[] = [...monthlyFixed, monthlyFixed.reduce<number>((a, b) => a + (b ?? 0), 0) || null];
  const profitValues = totals.map((t, i) => (t && t.days > 0 ? cmOf(t).cm - (sgaValues[i] ?? 0) : null));
  const cmRow = row("cm", "Contribution Margin", "currency0", (t) => cmOf(t).cm, { bold: true, pctOfRevenue: true });

  return [
    { title: "Revenue", rows: revenueRows(row, opRev, s, revenueBy) },
    {
      title: "Cost of delivery",
      rows: [
        row("cogs", "COGS", "currency0", (t) => -cmOf(t).cogs),
        row("cod", "Other variable costs", "currency0", (t) => -cmOf(t).costOfDelivery),
        row("totalCod", "Total Cost of Delivery", "currency0", (t) => -(cmOf(t).cogs + cmOf(t).costOfDelivery), { bold: true }),
      ],
    },
    {
      title: "Advertising",
      rows: [
        row("search", "Search", "currency0", (t) => -sp(t, SEARCH)),
        row("social", "Social", "currency0", (t) => -sp(t, SOCIAL)),
        row("otherAds", "Other", "currency0", (t) => -(sp(t, OTHER_ADS) + t.unassignedSpend)),
        row("totalAds", "Total Advertising Spend", "currency0", (t) => -totalSpend(t), { bold: true }),
      ],
    },
    {
      title: "Profit",
      rows: [
        cmRow,
        { key: "sga", label: "SG&A (fixed costs)", format: "currency0", values: sgaValues.map((v) => (v === null ? null : -v)) },
        { key: "profit", label: "Profit", format: "currency0", values: profitValues, bold: true, pctOfRevenue: true },
      ],
    },
    {
      title: "4 Quarter Accounting (% of operating revenue)",
      rows: [
        row("codPct", "COD", "percent1", (t) => div(cmOf(t).cogs + cmOf(t).costOfDelivery, opRev(t))),
        row("adPct", "Ad Spend", "percent1", (t) => div(totalSpend(t), opRev(t))),
        row("opexPct", "Opex", "percent1", () => null),
        row("profitPct", "Profit", "percent1", (t) => div(cmOf(t).cm, opRev(t))),
      ],
    },
    {
      title: "Key performance metrics",
      rows: [
        row("orderRev", "Order Revenue", "currency0", (t) => orderRevenue(t)),
        row("newRev", "New Order Revenue", "currency0", (t) => t.newOrderRevenue),
        row("retRev", "Returning Order Revenue", "currency0", (t) => t.returningOrderRevenue),
        row("orders", "Total Orders", "number", (t) => orders(t)),
        row("newOrders", "New Orders", "number", (t) => t.newOrders),
        row("retOrders", "Returning Orders", "number", (t) => t.returningOrders),
        row("aov", "Total AOV", "currency2", (t) => div(orderRevenue(t), orders(t))),
        row("newAov", "New AOV", "currency2", (t) => div(t.newOrderRevenue, t.newOrders)),
        row("retAov", "Returning AOV", "currency2", (t) => div(t.returningOrderRevenue, t.returningOrders)),
        row("repeat", "Repeat Rate", "percent1", (t) => div(t.returningOrders, orders(t))),
        row("refundRate", "Refund Rate", "percent1", (t) => div(t.refunds, t.netSales + t.refunds)),
        row("cogsRate", "COGS Rate", "percent1", (t) => div(cmOf(t).cogs, opRev(t))),
        row("mer", "MER", "ratio2", (t) => div(orderRevenue(t), totalSpend(t))),
        row("amer", "aMER", "ratio2", (t) => div(t.newOrderRevenue, amerSpend(t, s))),
        row("acqSpend", "Acquisition Spend", "currency0", (t) => amerSpend(t, s)),
        row("cac", "Weighted CAC", "currency2", (t) => div(totalSpend(t), t.newOrders)),
      ],
    },
    {
      title: "Ad performance (platform-reported)",
      rows: [
        ...(
          [
            ["fb", "FB", META],
            ["g", "Google", GOOGLE],
            ["pin", "Pinterest", PINTEREST],
          ] as [string, string, ChannelKey[]][]
        ).flatMap(([k, name, keys]) => [
          row(`${k}Spend`, `${name} Spend`, "currency0", (t) => sp(t, keys)),
          row(`${k}Rev`, `${name} Revenue`, "currency0", (t) => rv(t, keys)),
          row(`${k}Roas`, `${name} ROAS`, "ratio2", (t) => div(rv(t, keys), spReported(t, keys))),
          row(`${k}Conv`, `${name} Conversions`, "number", (t) => pu(t, keys)),
          row(`${k}Aov`, `${name} AOV`, "currency2", (t) => div(rv(t, keys), pu(t, keys))),
          row(`${k}Cpa`, `${name} CPA`, "currency2", (t) => div(spReported(t, keys), pu(t, keys))),
        ]),
        row("organic", "Organic Revenue", "currency0", (t) => organicOf(t, s)),
      ],
    },
    {
      title: "Other metrics",
      rows: [row("email", "Email Revenue", "currency0", (t) => t.emailRevenue), row("sms", "SMS Revenue", "currency0", (t) => t.smsRevenue)],
    },
  ];
}

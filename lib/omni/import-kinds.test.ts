import { describe, expect, it } from "vitest";
import { parseChannelCsv } from "./import";
import { detectKind, fileKinds, parseChannelFile } from "./import-kinds";

const csv = (...lines: string[]) => lines.join("\n");

const BUSINESS = csv(
  "Date,Ordered Product Sales,Ordered Product Sales - B2B,Units Ordered,Total Order Items,Sessions - Total,Page Views - Total,Featured Offer (Buy Box) Percentage,Unit Session Percentage,Units Refunded",
  '2026-11-20,"$7,671.50",$120.00,283,202,1400,1800,98.50%,20.21%,3',
  "2026-11-21,$8292.25,$0.00,306,218,1500,2000,97%,20.4%,4",
);

const ADS_SP = csv(
  "Date,Campaign Name,Impressions,Clicks,Click-Thru Rate (CTR),Spend,7 Day Total Sales ,7 Day Total Orders (#),Total Advertising Cost of Sales (ACOS) ",
  "2026-11-20,Brand | Exact,10000,120,1.2%,$150.00,$900.00,24,16.67%",
  "2026-11-20,Category | Broad,30000,200,0.67%,$250.50,$700.00,18,35.79%",
  "2026-11-21,Brand | Exact,9000,100,1.11%,$140.00,$800.00,20,17.5%",
);

describe("detectKind", () => {
  const head = (text: string) => text.split("\n")[0].split(",");
  it("recognises Amazon's business report and its ads reports by their columns", () => {
    expect(detectKind(head(BUSINESS), "amazon")).toBe("amazon_sales_traffic");
    expect(detectKind(head(ADS_SP), "amazon")).toBe("amazon_ads_sp");
    expect(detectKind(["Date", "Spend", "14 Day Total Sales", "14 Day New-to-brand Sales"], "amazon")).toBe("amazon_ads_sb");
    // Sponsored Brands and Sponsored Display files share their columns: the app reads them as Brands and the person confirms.
    expect(detectKind(["Date", "Spend", "14 Day Total Sales", "Viewable Impressions"], "amazon")).toBe("amazon_ads_sb");
  });
  it("recognises TikTok Shop files, and falls back to the generic kind", () => {
    expect(detectKind(["Date", "GMV", "SKU orders", "Items sold", "Customers"], "tiktok_shop")).toBe("tiktok_overview");
    expect(detectKind(["Date", "Cost", "Gross revenue", "ROI"], "tiktok_shop")).toBe("tiktok_ads");
    expect(detectKind(["date", "revenue", "orders"], "amazon")).toBe("generic");
    expect(detectKind(head(BUSINESS), "other")).toBe("generic");
  });
  it("always offers the generic kind last", () => {
    for (const p of ["amazon", "tiktok_shop", "retail", "other"] as const) {
      const kinds = fileKinds(p);
      expect(kinds[kinds.length - 1].id).toBe("generic");
    }
  });
});

describe("parseChannelFile", () => {
  it("reads Amazon's business report: sales, units, order items and traffic, and leaves ad spend alone", () => {
    const r = parseChannelFile(BUSINESS, "amazon", { platform: "amazon" });
    expect(r.kind).toBe("amazon_sales_traffic");
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    const d = r.rows[0];
    expect(d).toMatchObject({ date: "2026-11-20", channel: "amazon", retailer: "", revenue: 7671.5, units: 283, orders: 202, adSpend: null, source: "import" });
    expect(d.metrics.sessions).toBe(1400);
    expect(d.metrics.page_views).toBe(1800);
    expect(d.metrics.buy_box_views).toBeCloseTo(1773);
    expect(d.metrics.units_refunded).toBe(3);
    expect(d.metrics.buy_box_pct).toBeUndefined();
    expect(r.from).toBe("2026-11-20");
    expect(r.to).toBe("2026-11-21");
    expect(r.totals.revenue).toBeCloseTo(15963.75);
    // The B2B column and the ready-made percentage are shown as not used.
    expect(r.columns.find((c) => c.header === "Ordered Product Sales - B2B")?.target).toBeNull();
    expect(r.columns.find((c) => c.header === "Unit Session Percentage")?.target).toBeNull();
  });

  it("adds the campaigns of a day together in an ads report, and leaves sales alone", () => {
    const r = parseChannelFile(ADS_SP, "amazon", { platform: "amazon" });
    expect(r.kind).toBe("amazon_ads_sp");
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: "2026-11-20", revenue: null, orders: null, units: null, adSpend: null });
    expect(r.rows[0].metrics).toEqual({ sp_impressions: 40000, sp_clicks: 320, sp_spend: 400.5, sp_sales: 1600, sp_orders: 42 });
    expect(r.rows[1].metrics.sp_spend).toBe(140);
  });

  it("reads the same file as Sponsored Brands when told to", () => {
    const sb = csv("Date,Spend,14 Day Total Sales,14 Day Total Orders (#),14 Day New-to-brand Sales", "2026-11-20,100,500,10,300");
    const r = parseChannelFile(sb, "amazon", { platform: "amazon" });
    expect(r.kind).toBe("amazon_ads_sb");
    expect(r.rows[0].metrics).toEqual({ sb_spend: 100, sb_sales: 500, sb_orders: 10, sb_ntb_sales: 300 });
    const sd = parseChannelFile(sb, "amazon", { platform: "amazon", kind: "amazon_ads_sd" });
    expect(sd.rows[0].metrics).toEqual({ sd_spend: 100, sd_sales: 500, sd_orders: 10, sd_ntb_sales: 300 });
  });

  it("reports a second row for a day in a file that has one row per day", () => {
    const twice = csv("Date,Ordered Product Sales,Units Ordered", "2026-11-20,100,5", "2026-11-20,50,2");
    const r = parseChannelFile(twice, "amazon", { platform: "amazon" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].revenue).toBe(100);
    expect(r.errors).toEqual([{ line: 3, message: "A second row for 2026-11-20. Only the first one is kept." }]);
  });

  it("lets a column the app does not know be mapped by hand, or switched off", () => {
    const file = csv("Day,GMV,Creator sales,Notes", "2026-11-20,2000,1200,hello");
    const plain = parseChannelFile(file, "tiktok_shop", { platform: "tiktok_shop", kind: "tiktok_overview" });
    expect(plain.errors[0].message).toBe("The file needs a date column.");
    const mapped = parseChannelFile(file, "tiktok_shop", { platform: "tiktok_shop", kind: "tiktok_overview", mapping: { day: "date", "creator sales": "affiliate_gmv" } });
    expect(mapped.errors).toEqual([]);
    expect(mapped.rows[0]).toMatchObject({ date: "2026-11-20", revenue: 2000 });
    expect(mapped.rows[0].metrics).toEqual({ affiliate_gmv: 1200 });
    expect(mapped.columns).toEqual([
      { header: "Day", target: "date" },
      { header: "GMV", target: "revenue" },
      { header: "Creator sales", target: "affiliate_gmv" },
      { header: "Notes", target: null },
    ]);
    const off = parseChannelFile(file, "tiktok_shop", { platform: "tiktok_shop", kind: "tiktok_overview", mapping: { day: "date", gmv: null, "creator sales": "affiliate_gmv" } });
    expect(off.rows[0].revenue).toBeNull();
  });

  it("reads a plain file the way the first importer did", () => {
    const file = csv("date,revenue,orders,units,ad spend,retailer", "2026-11-20,100.5,4,5,10,Target", "2026-11-21,200,8,10,,Target");
    const now = parseChannelFile(file, "retail", { platform: "retail" });
    const before = parseChannelCsv(file, "retail");
    expect(now.kind).toBe("generic");
    expect(now.errors).toEqual([]);
    expect(now.rows.map((r) => [r.date, r.retailer, r.revenue, r.orders, r.units])).toEqual(before.rows.map((r) => [r.date, r.retailer, r.revenue, r.orders, r.units]));
    expect(now.rows[0].adSpend).toBe(10);
    // An empty cell is "not given", so a later merge keeps what the day already has.
    expect(now.rows[1].adSpend).toBeNull();
  });

  it("reports what it cannot read with the line of the file", () => {
    const bad = csv("Date,Ordered Product Sales,Units Ordered", "11/20/2026,100,5", "2026-11-21,abc,5", "2026-11-22,-5,1", "2026-11-23,10,1.5", "2026-11-24,,");
    const r = parseChannelFile(bad, "amazon", { platform: "amazon" });
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(r.errors[0].message).toContain("date");
    expect(r.errors[4].message).toBe("Nothing to read on this line.");
    expect(parseChannelFile(bad, "amazon", { platform: "amazon", dateFormat: "mdy" }).rows).toHaveLength(1);
    expect(parseChannelFile("", "amazon", { platform: "amazon" }).errors[0].message).toBe("The file is empty.");
    expect(parseChannelFile("Foo,Bar\n1,2", "amazon", { platform: "amazon" }).errors[0].message).toBe("The file needs a date column.");
  });

  it("drops a Buy Box % that comes without page views, since it cannot be weighted", () => {
    const r = parseChannelFile(csv("Date,Ordered Product Sales,Featured Offer (Buy Box) Percentage", "2026-11-20,100,98%"), "amazon", { platform: "amazon" });
    expect(r.rows[0].metrics).toEqual({});
  });
});

describe("parseChannelFile, findings of the review", () => {
  it("reads a Buy Box below 1% as a percentage when the cell says %", () => {
    const r = parseChannelFile(csv("Date,Ordered Product Sales,Page Views - Total,Featured Offer (Buy Box) Percentage", "2026-11-20,100,1000,0.50%", "2026-11-21,100,1000,1.00%", "2026-11-22,100,1000,0.97"), "amazon", { platform: "amazon" });
    expect(r.rows.map((x) => x.metrics.buy_box_views)).toEqual([5, 10, 970]);
  });
  it("does not save a day that holds nothing but a Buy Box % it cannot weight", () => {
    const r = parseChannelFile(csv("Date,Featured Offer (Buy Box) Percentage,Ordered Product Sales", "2026-11-20,98%,"), "amazon", { platform: "amazon" });
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ line: 2, message: "Nothing to read on this line." }]);
  });
  it("reads a dash as an empty cell and keeps the rest of the line", () => {
    const r = parseChannelFile(csv("Date,GMV,Visitors,Refunds,Customers", "2026-11-20,2000,--,-,n/a"), "tiktok_shop", { platform: "tiktok_shop" });
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ revenue: 2000 });
    expect(r.rows[0].metrics).toEqual({});
  });
});

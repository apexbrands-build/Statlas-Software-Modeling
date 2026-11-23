import { describe, expect, it } from "vitest";
import { parseChannelCsv, shopifyDaysToSales } from "./import";

describe("parseChannelCsv: a plain file", () => {
  const text = "date,revenue,orders,units,ad spend\n2027-03-01,1200.50,40,55,150\n2027-03-02,900,30,41,120\n";
  const r = parseChannelCsv(text, "amazon");
  it("reads every row for the channel", () => {
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { date: "2027-03-01", channel: "amazon", retailer: "", revenue: 1200.5, orders: 40, units: 55, adSpend: 150, source: "import" },
      { date: "2027-03-02", channel: "amazon", retailer: "", revenue: 900, orders: 30, units: 41, adSpend: 120, source: "import" },
    ]);
  });
  it("reports the date range and the totals", () => {
    expect(r.from).toBe("2027-03-01");
    expect(r.to).toBe("2027-03-02");
    expect(r.revenue).toBeCloseTo(2100.5, 6);
    expect(r.adSpend).toBe(270);
  });
});

describe("parseChannelCsv: files as spreadsheets really export them", () => {
  it("reads a byte-order mark, Windows line ends, semicolons and quoted numbers with thousands commas", () => {
    const text = '﻿Date;Sales;Store\r\n2027-03-01;"$1,234.50";Target\r\n2027-03-01;"2,000";H-E-B\r\n';
    const r = parseChannelCsv(text, "retail");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.date, x.retailer, x.revenue])).toEqual([
      ["2027-03-01", "Target", 1234.5],
      ["2027-03-01", "H-E-B", 2000],
    ]);
  });
  it("reads tabs and other names for the columns, in any case", () => {
    const r = parseChannelCsv("DATE\tGMV\tSpend\tUnits\n2027-03-01\t500\t60\t12\n", "tiktok_shop");
    expect(r.rows[0]).toMatchObject({ revenue: 500, adSpend: 60, units: 12, orders: 0 });
  });
  it("reads a quoted field that holds the delimiter", () => {
    const r = parseChannelCsv('date,revenue,retailer\n2027-03-01,100,"Smith, Jones & Co"\n', "retail");
    expect(r.rows[0].retailer).toBe("Smith, Jones & Co");
  });
  it("skips blank lines", () => {
    expect(parseChannelCsv("date,revenue\n\n2027-03-01,100\n\n", "amazon").rows).toHaveLength(1);
  });
});

describe("parseChannelCsv: dates", () => {
  it("reads month first or day first when told", () => {
    expect(parseChannelCsv("date,revenue\n3/4/2027,100\n", "amazon", "mdy").rows[0].date).toBe("2027-03-04");
    expect(parseChannelCsv("date,revenue\n3/4/2027,100\n", "amazon", "dmy").rows[0].date).toBe("2027-04-03");
    expect(parseChannelCsv("date,revenue\n03-04-27,100\n", "amazon", "mdy").rows[0].date).toBe("2027-03-04");
  });
  it("reports a date that does not exist or does not fit the format", () => {
    const r = parseChannelCsv("date,revenue\n2027-02-30,100\nnot a date,100\n2027-03-01,100\n", "amazon");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
    expect(r.rows).toHaveLength(1);
  });
});

describe("parseChannelCsv: what it refuses, line by line", () => {
  it("needs a date column and a revenue column", () => {
    expect(parseChannelCsv("day,amount\n2027-03-01,100\n", "amazon").errors[0]).toEqual({ line: 1, message: "The file needs a date column and a revenue column." });
  });
  it("reports a number it cannot read or a negative one, and keeps the good rows", () => {
    const r = parseChannelCsv("date,revenue,orders\n2027-03-01,abc,1\n2027-03-02,-5,1\n2027-03-03,100,-2\n2027-03-04,100,3\n", "amazon");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(r.rows.map((x) => x.date)).toEqual(["2027-03-04"]);
  });
  it("reports a second row for the same day and retailer", () => {
    const r = parseChannelCsv("date,revenue\n2027-03-01,100\n2027-03-01,200\n", "amazon");
    expect(r.errors).toEqual([{ line: 3, message: "A second row for 2027-03-01. Only the first one is kept." }]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].revenue).toBe(100);
  });
  it("says so when the file has no rows", () => {
    expect(parseChannelCsv("", "amazon").errors[0].message).toBe("The file is empty.");
    const r = parseChannelCsv("date,revenue\n", "amazon");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toBe("The file has a header but no rows.");
    expect(r.from).toBeNull();
  });
  it("treats an empty optional number as zero, and an empty revenue as an error", () => {
    const r = parseChannelCsv("date,revenue,orders\n2027-03-01,100,\n2027-03-02,,4\n", "amazon");
    expect(r.rows[0].orders).toBe(0);
    expect(r.errors.map((e) => e.line)).toEqual([3]);
  });
});

describe("shopifyDaysToSales: a channel fed by synced Shopify orders", () => {
  it("turns each day of orders into a row for the channel, marked as coming from Shopify", () => {
    expect(shopifyDaysToSales("tiktok_shop", [{ date: "2027-03-01", revenue: "120.50", orders: 3 }, { date: "2027-03-02", revenue: 80, orders: "2" }])).toEqual([
      { date: "2027-03-01", channel: "tiktok_shop", retailer: "", revenue: 120.5, orders: 3, units: 0, adSpend: 0, source: "shopify" },
      { date: "2027-03-02", channel: "tiktok_shop", retailer: "", revenue: 80, orders: 2, units: 0, adSpend: 0, source: "shopify" },
    ]);
  });
  it("leaves out days it cannot read", () => {
    expect(shopifyDaysToSales("tiktok_shop", [{ date: null, revenue: 5, orders: 1 }, { date: "2027-03-01", revenue: "x", orders: 1 }])).toEqual([]);
  });
});

describe("parseChannelCsv: how the file writes numbers", () => {
  it("reads a dot for thousands and a comma for decimals when told", () => {
    const r = parseChannelCsv("Date;Revenue;Orders;Ad spend\n2027-03-01;12.345,50;1.234;1.200\n2027-03-02;€ 2.500;3;12,5\n", "amazon", "ymd", "eu");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ revenue: 12345.5, orders: 1234, adSpend: 1200 });
    expect(r.rows[1]).toMatchObject({ revenue: 2500, adSpend: 12.5 });
  });
  it("refuses a number that only makes sense the other way, instead of loading a thousandth of it", () => {
    const us = parseChannelCsv("Date;Revenue\n2027-03-01;12.345\n2027-03-02;1.234,56\n2027-03-03;12,5\n", "amazon");
    expect(us.rows).toEqual([]);
    expect(us.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(us.errors[0].message).toContain("how numbers are written");
    const eu = parseChannelCsv("Date;Revenue\n2027-03-01;1,234.56\n2027-03-02;12.5\n", "amazon", "ymd", "eu");
    expect(eu.rows).toEqual([]);
    expect(eu.errors.map((e) => e.line)).toEqual([2, 3]);
  });
  it("still reads ordinary decimals and thousands commas by default", () => {
    const r = parseChannelCsv('date,revenue\n2027-03-01,1234.5\n2027-03-02,"1,234.50"\n2027-03-03,12.34\n2027-03-04,1234.567\n', "amazon");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.revenue)).toEqual([1234.5, 1234.5, 12.34, 1234.567]);
  });
  it("needs whole numbers for orders and units", () => {
    const r = parseChannelCsv("date,revenue,orders,units\n2027-03-01,100,10.5,3\n2027-03-02,100,10,3.2\n2027-03-03,100,10,3\n", "amazon");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
    expect(r.rows).toHaveLength(1);
  });
  it("refuses a number too large to hold", () => {
    const r = parseChannelCsv(`date,revenue\n2027-03-01,${"9".repeat(400)}\n`, "amazon");
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });
});

describe("parseChannelCsv: which columns it used", () => {
  it("lists the columns it read and the ones it ignored, so a misnamed column is seen", () => {
    const r = parseChannelCsv("Date,Sales,Cost,Units Ordered\n2027-03-01,100,5,7\n", "amazon");
    expect(r.columns).toEqual(["date", "revenue"]);
    expect(r.ignored).toEqual(["Cost", "Units Ordered"]);
  });
  it("ignores nothing when every column is known", () => {
    const r = parseChannelCsv("date,revenue,orders,units,ad spend,retailer\n2027-03-01,100,1,1,1,Target\n", "retail");
    expect(r.columns).toEqual(["date", "revenue", "orders", "units", "ad spend", "retailer"]);
    expect(r.ignored).toEqual([]);
  });
});

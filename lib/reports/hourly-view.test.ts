import { describe, expect, it } from "vitest";
import { DEFAULT_HOURLY_COLS } from "./hourly-specs";
import { DEFAULT_HOURLY_VIEW, readHourlyView, resolveCompare, toggleColumn } from "./hourly-view";

describe("the hourly report's remembered view", () => {
  it("opens on the columns that have hourly actuals, against the plan when there is one, per hour, with revenue charted", () => {
    expect(DEFAULT_HOURLY_VIEW).toEqual({ cols: DEFAULT_HOURLY_COLS, graph: ["rev"], compare: "auto", shape: "auto", cumulative: false });
  });

  it("gives the defaults for nothing or damaged JSON", () => {
    expect(readHourlyView(null)).toEqual(DEFAULT_HOURLY_VIEW);
    expect(readHourlyView("{not json")).toEqual(DEFAULT_HOURLY_VIEW);
    expect(readHourlyView("[1,2]")).toEqual(DEFAULT_HOURLY_VIEW);
  });

  it("keeps what was saved, drops unknown columns and fills what is missing", () => {
    const s = readHourlyView(JSON.stringify({ cols: ["retRev", "gone", "spend", "rev"], graph: ["retRev", "spend", "nope"], compare: "lastWeek", shape: "weekdays", cumulative: true }));
    // columns come back in the report's own order; only columns with hourly actuals can be charted
    expect(s).toEqual({ cols: ["rev", "retRev", "spend"], graph: ["retRev"], compare: "lastWeek", shape: "weekdays", cumulative: true });
    expect(readHourlyView(JSON.stringify({ cols: ["gone"], compare: "nope", shape: 7 }))).toEqual(DEFAULT_HOURLY_VIEW);
  });

  it("allows an empty chart selection (the chart is then hidden)", () => {
    expect(readHourlyView(JSON.stringify({ graph: [] })).graph).toEqual([]);
  });
});

describe("resolveCompare", () => {
  it("is the plan when the day has a target, else the last four same weekdays", () => {
    expect(resolveCompare("auto", true)).toBe("plan");
    expect(resolveCompare("auto", false)).toBe("fourWeeks");
    expect(resolveCompare("plan", false)).toBe("fourWeeks");
    expect(resolveCompare("lastYear", true)).toBe("lastYear");
    expect(resolveCompare("lastWeek", false)).toBe("lastWeek");
  });
});

describe("toggleColumn", () => {
  it("adds and removes a column, keeping the report's own order", () => {
    expect(toggleColumn(["rev", "retRev"], "orders")).toEqual(["rev", "orders", "retRev"]);
    expect(toggleColumn(["rev", "orders", "retRev"], "orders")).toEqual(["rev", "retRev"]);
    expect(toggleColumn(["rev"], "unknown")).toEqual(["rev"]);
  });
});

import { describe, expect, it } from "vitest";
import type { MarketingEvent } from "../planning/events";
import { actionsByDay, eventActions, groupByType, metaLaunchActions, type MarketingAction } from "./calendar-actions";

const ev = (name: string, date: string, endDate = date): MarketingEvent => ({ id: name, clientId: "c1", date, endDate, type: "promotion", name, source: "manual" });
const range = { from: "2026-01-01", to: "2026-01-31" };

describe("eventActions", () => {
  it("spreads a 3-day event over its days and clips it to the range", () => {
    const out = eventActions([ev("Sale", "2026-01-30", "2026-02-01"), ev("Early", "2025-12-30", "2026-01-02")], range);
    expect(out.filter((a) => a.name === "Sale").map((a) => a.date)).toEqual(["2026-01-30", "2026-01-31"]);
    expect(out.filter((a) => a.name === "Early").map((a) => a.date)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(out.every((a) => a.type === "event")).toBe(true);
  });

  it("ignores an event entirely outside the range", () => {
    expect(eventActions([ev("Old", "2025-11-01", "2025-11-03")], range)).toEqual([]);
  });
});

describe("metaLaunchActions", () => {
  it("collapses two ads of one campaign on one day to one action", () => {
    const out = metaLaunchActions([
      { date: "2026-01-06", campaign: "UK12 | ABO | Creative testing" },
      { date: "2026-01-06", campaign: "UK12 | ABO | Creative testing" },
      { date: "2026-01-06", campaign: "US11 | ABO | Creative testing" },
    ]);
    expect(out).toEqual([
      { date: "2026-01-06", type: "meta", name: "UK12 | ABO | Creative testing" },
      { date: "2026-01-06", type: "meta", name: "US11 | ABO | Creative testing" },
    ]);
  });
});

describe("actionsByDay", () => {
  const list: MarketingAction[] = [
    { date: "2026-01-10", type: "meta", name: "UK12" },
    { date: "2026-01-10", type: "email", name: "Sale starts" },
    { date: "2026-01-10", type: "email", name: "Sale starts" },
    { date: "2026-01-10", type: "event", name: "Winter sale" },
    { date: "2026-01-11", type: "sms", name: "Reminder" },
  ];

  it("collapses identical type and name on a day and orders event, email, sms, meta", () => {
    const by = actionsByDay(list);
    expect(by.get("2026-01-10")!.map((a) => a.type)).toEqual(["event", "email", "meta"]);
    expect(by.get("2026-01-11")).toHaveLength(1);
    expect(by.get("2026-01-12")).toBeUndefined();
  });

  it("groupByType returns the names of each type, in the same order", () => {
    expect(groupByType(actionsByDay(list).get("2026-01-10")!)).toEqual([
      { type: "event", names: ["Winter sale"] },
      { type: "email", names: ["Sale starts"] },
      { type: "meta", names: ["UK12"] },
    ]);
  });
});

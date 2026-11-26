import { describe, expect, it } from "vitest";
import { normalizeSendTime, sendTimeForSave } from "../planning/events";
import { eventFromRow, eventSaveError, eventToRow } from "./event-row";

describe("normalizeSendTime", () => {
  it("keeps a clock time as HH:MM and drops anything else", () => {
    expect(normalizeSendTime("09:00")).toBe("09:00");
    expect(normalizeSendTime("09:00:00")).toBe("09:00");
    expect(normalizeSendTime("23:59:59.123")).toBe("23:59");
    expect(normalizeSendTime("9:05")).toBe("09:05");
    expect(normalizeSendTime("")).toBeUndefined();
    expect(normalizeSendTime(null)).toBeUndefined();
    expect(normalizeSendTime("24:00")).toBeUndefined();
    expect(normalizeSendTime("12:60")).toBeUndefined();
    expect(normalizeSendTime("noon")).toBeUndefined();
  });
});

describe("eventFromRow", () => {
  const row = { id: "e1", client_id: "c1", date: "2026-11-27", end_date: null, category: "email", title: "VIP early access", source: "manual", segment_size: null };

  it("reads the send time as HH:MM", () => {
    expect(eventFromRow({ ...row, send_time: "09:00:00" })).toMatchObject({ id: "e1", date: "2026-11-27", endDate: "2026-11-27", type: "email", name: "VIP early access", sendTime: "09:00" });
  });

  it("has no send time when the column is empty or not there yet (before migration 0023)", () => {
    expect("sendTime" in eventFromRow({ ...row, send_time: null })).toBe(false);
    expect("sendTime" in eventFromRow(row)).toBe(false);
  });
});

describe("eventToRow", () => {
  const base = { date: "2026-11-27", endDate: "2026-11-27", type: "email", name: "VIP early access", source: "manual" as const };

  it("does not mention the send time when none is typed, so saving works before migration 0023", () => {
    expect("send_time" in eventToRow("c1", base)).toBe(false);
  });

  it("sends a typed time", () => {
    expect(eventToRow("c1", { ...base, sendTime: "09:00" })).toMatchObject({ client_id: "c1", category: "email", title: "VIP early access", send_time: "09:00" });
  });

  it("clears the time when it is given as empty (an event that had one)", () => {
    const r = eventToRow("c1", { ...base, id: "e1", sendTime: "" });
    expect(r.send_time).toBeNull();
    expect(r.id).toBe("e1");
  });

  it("keeps the other columns as before", () => {
    expect(eventToRow("c1", { ...base, promo: "20% off", segmentSize: 1200 })).toEqual({ client_id: "c1", date: "2026-11-27", end_date: "2026-11-27", category: "email", title: "VIP early access", source: "manual", promo: "20% off", product: null, audience: null, segment_size: 1200, notes: null });
  });
});

describe("eventSaveError", () => {
  it("names migration 0023 when the send time column is missing", () => {
    expect(eventSaveError("Could not find the 'send_time' column of 'marketing_events' in the schema cache")).toMatch(/0023/);
  });

  it("keeps the 0008 message for the older columns and passes other errors through", () => {
    expect(eventSaveError('column "promo" of relation "marketing_events" does not exist')).toMatch(/0008/);
    expect(eventSaveError("network down")).toBe("network down");
  });
});

describe("sendTimeForSave", () => {
  it("saves a typed time, clears a stored one that was emptied, and says nothing when there never was one", () => {
    expect(sendTimeForSave("09:30", undefined)).toEqual({ sendTime: "09:30" });
    expect(sendTimeForSave("10:00", "09:30")).toEqual({ sendTime: "10:00" });
    expect(sendTimeForSave("", "09:30")).toEqual({ sendTime: "" });
    expect(sendTimeForSave(undefined, "09:30")).toEqual({ sendTime: "" });
    expect(sendTimeForSave("", undefined)).toEqual({});
    expect(sendTimeForSave(undefined, undefined)).toEqual({});
  });
});

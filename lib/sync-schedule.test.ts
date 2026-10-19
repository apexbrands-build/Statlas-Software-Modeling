import { describe, expect, it } from "vitest";
import { dailySyncDue, localDate, localDayStart, validTimeZone, yesterdayLocal } from "./sync-schedule";

const at = (iso: string) => new Date(iso);

describe("store-local dates", () => {
  it("the same instant is a different calendar day in different time zones", () => {
    const now = at("2026-10-20T03:30:00Z"); // 23:30 Oct 19 in New York, 20:30 in Los Angeles, 13:30 Oct 20 in Sydney
    expect(localDate(now, "America/New_York")).toBe("2026-10-19");
    expect(localDate(now, "America/Los_Angeles")).toBe("2026-10-19");
    expect(localDate(now, "Australia/Sydney")).toBe("2026-10-20");
    expect(localDate(now, "UTC")).toBe("2026-10-20");
  });
  it("yesterday is the store's previous day", () => {
    expect(yesterdayLocal(at("2026-10-20T03:30:00Z"), "America/New_York")).toBe("2026-10-18");
    expect(yesterdayLocal(at("2026-10-20T03:30:00Z"), "Australia/Sydney")).toBe("2026-10-19");
    expect(yesterdayLocal(at("2026-03-01T12:00:00Z"), "Europe/London")).toBe("2026-02-28");
  });
  it("the local day starts at local midnight", () => {
    expect(localDayStart(at("2026-10-19T18:00:00Z"), "America/New_York").toISOString()).toBe("2026-10-19T04:00:00.000Z"); // EDT, UTC-4
    expect(localDayStart(at("2026-12-19T18:00:00Z"), "America/New_York").toISOString()).toBe("2026-12-19T05:00:00.000Z"); // EST, UTC-5
    expect(localDayStart(at("2026-10-19T18:00:00Z"), "Australia/Sydney").toISOString()).toBe("2026-10-19T13:00:00.000Z"); // AEDT, UTC+11, Oct 20 starts at 13:00Z on the 19th
  });
  it("an unknown or empty zone falls back to UTC", () => {
    expect(validTimeZone("Mars/Olympus")).toBe("UTC");
    expect(validTimeZone("")).toBe("UTC");
    expect(validTimeZone(null)).toBe("UTC");
    expect(localDate(at("2026-10-19T23:59:00Z"), "Mars/Olympus")).toBe("2026-10-19");
  });
});

describe("dailySyncDue", () => {
  const ny = "America/New_York"; // midnight Oct 20 = 04:00Z
  it("not due before the store's day has rolled over and settled", () => {
    const doneToday = [{ createdAt: at("2026-10-19T05:00:00Z"), status: "done" as const }]; // the 19th's daily job, 01:00 local
    expect(dailySyncDue(at("2026-10-20T03:59:00Z"), ny, doneToday)).toBe(false); // 23:59 on the 19th: nothing new to load yet
    expect(dailySyncDue(at("2026-10-20T04:10:00Z"), ny, doneToday)).toBe(false); // 00:10 on the 20th, inside the 15-minute settle window
    expect(dailySyncDue(at("2026-10-20T04:20:00Z"), ny, doneToday)).toBe(true); // 00:20: the 19th is complete, load it
  });
  it("due on the first tick after it, once, for each time zone at its own midnight", () => {
    expect(dailySyncDue(at("2026-10-20T04:20:00Z"), ny, [])).toBe(true); // never synced today: catch up
    // Los Angeles: its own midnight is 07:00Z, so a job started at 00:20 local on the 19th (07:20Z) already covers the 19th and the 04:20Z tick leaves it alone
    expect(dailySyncDue(at("2026-10-20T04:20:00Z"), "America/Los_Angeles", [{ createdAt: at("2026-10-19T07:20:00Z"), status: "done" }])).toBe(false);
    expect(dailySyncDue(at("2026-10-20T07:20:00Z"), "America/Los_Angeles", [])).toBe(true); // 00:20 on the 20th
    expect(dailySyncDue(at("2026-10-19T13:20:00Z"), "Australia/Sydney", [])).toBe(true); // 00:20 on the 20th in Sydney
  });
  it("a daily job already started since local midnight means it is not due again", () => {
    const now = at("2026-10-20T09:00:00Z");
    for (const status of ["queued", "running", "done", "cancelled"] as const) expect(dailySyncDue(now, ny, [{ createdAt: at("2026-10-20T05:00:00Z"), status }])).toBe(false);
  });
  it("yesterday's job (before local midnight) does not count", () => {
    expect(dailySyncDue(at("2026-10-20T05:00:00Z"), ny, [{ createdAt: at("2026-10-20T03:30:00Z"), status: "done" }])).toBe(true);
  });
  it("a failed job is retried after three hours, not on every tick", () => {
    const failed = [{ createdAt: at("2026-10-20T05:00:00Z"), status: "error" as const }];
    expect(dailySyncDue(at("2026-10-20T06:00:00Z"), ny, failed)).toBe(false);
    expect(dailySyncDue(at("2026-10-20T08:01:00Z"), ny, failed)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { afterChunk, chunkWindow, failureCount, MAX_PARALLEL_JOBS, onChunkError, selectToKick, shouldCountFailure, type JobRow } from "./job-plan";

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: "j1",
  kind: "history",
  from_date: "2026-01-01",
  to_date: "2026-03-31",
  cursor_end: "2026-03-31",
  chunk_days: 14,
  total_days: 100,
  done_days: 20,
  attempts: 0,
  ...over,
});

describe("chunkWindow", () => {
  it("takes chunk_days ending at the cursor", () => {
    expect(chunkWindow({ cursor_end: "2026-03-31", chunk_days: 14, from_date: "2026-01-01" })).toEqual({ from: "2026-03-18", to: "2026-03-31" });
  });
  it("never starts before the job's from_date", () => {
    expect(chunkWindow({ cursor_end: "2026-01-05", chunk_days: 14, from_date: "2026-01-01" })).toEqual({ from: "2026-01-01", to: "2026-01-05" });
  });
});

describe("afterChunk", () => {
  it("moves the cursor back and counts the loaded days when more remain", () => {
    expect(afterChunk(job(), { from: "2026-03-18", to: "2026-03-31" })).toEqual({
      finished: false,
      cursorEnd: "2026-03-17",
      doneDays: 34,
      message: "Loaded 2026-03-18 → 2026-03-31",
    });
  });
  it("finishes on the first day and caps done days at the total", () => {
    const r = afterChunk(job({ cursor_end: "2026-01-10", done_days: 90 }), { from: "2026-01-01", to: "2026-01-10" });
    expect(r).toEqual({ finished: true, cursorEnd: "2026-01-01", doneDays: 100, message: "Done" });
  });
});

describe("onChunkError", () => {
  const window = { from: "2026-03-18", to: "2026-03-31" };
  it("halves the chunk and retries", () => {
    const r = onChunkError({ chunk_days: 14, attempts: 0 }, "timeout", window);
    expect(r).toMatchObject({ retry: true, chunkDays: 7, attempts: 1 });
    expect(r.message.startsWith("Retrying 2026-03-18 → 2026-03-31 in smaller pieces (")).toBe(true);
  });
  it("gives up at a one-day chunk", () => {
    expect(onChunkError({ chunk_days: 1, attempts: 0 }, "boom", window)).toEqual({ retry: false, message: "boom" });
  });
  it("gives up after 8 attempts", () => {
    expect(onChunkError({ chunk_days: 14, attempts: 8 }, "boom", window).retry).toBe(false);
  });
  it("cuts a long final message to 300 characters", () => {
    expect(onChunkError({ chunk_days: 1, attempts: 0 }, "x".repeat(400), window).message).toHaveLength(300);
  });
});

describe("failure counter", () => {
  it("adds one on error and resets on success", () => {
    expect(failureCount(null, "ok")).toBe(0);
    expect(failureCount(undefined, "error")).toBe(1);
    expect(failureCount(1, "error")).toBe(2);
    expect(failureCount(3, "ok")).toBe(0);
  });
  it("counts only recent (daily) jobs, never history loads", () => {
    expect(shouldCountFailure("recent")).toBe(true);
    expect(shouldCountFailure("history")).toBe(false);
  });
});

describe("selectToKick", () => {
  it("fills only the free slots", () => {
    expect(selectToKick(["a", "b", "c"], 8, 10)).toEqual(["a", "b"]);
  });
  it("kicks nothing when running jobs are at or above the cap", () => {
    expect(selectToKick(["a", "b"], 10, 10)).toEqual([]);
    expect(selectToKick(["a", "b"], 12, 10)).toEqual([]);
  });
  it("handles an empty queue and a zero cap", () => {
    expect(selectToKick([], 0)).toEqual([]);
    expect(selectToKick(["a"], 0, 0)).toEqual([]);
  });
  it("defaults the cap to MAX_PARALLEL_JOBS", () => {
    expect(MAX_PARALLEL_JOBS).toBe(10);
    const waiting = Array.from({ length: 12 }, (_, i) => `j${i}`);
    expect(selectToKick(waiting, 0)).toHaveLength(10);
  });
});

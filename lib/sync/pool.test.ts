import { describe, expect, it } from "vitest";
import { mapPool } from "./pool";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapPool", () => {
  it("keeps the order of the items in the result", async () => {
    const r = await mapPool([30, 5, 15], 3, async (ms, i) => (await sleep(ms), i));
    expect(r).toEqual([0, 1, 2]);
  });

  it("never runs more than `limit` calls at once, and starts them in order", async () => {
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];
    await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight -= 1;
    });
    expect(peak).toBe(2);
    expect(started).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects on the first failure and does not start the items after it", async () => {
    const started: number[] = [];
    const err = await mapPool([1, 2, 3, 4, 5], 1, async (n) => {
      started.push(n);
      if (n === 2) throw new Error("boom");
    }).catch((e) => e);
    expect(err.message).toBe("boom");
    expect(started).toEqual([1, 2]);
  });

  it("handles an empty list", async () => {
    expect(await mapPool([], 3, async () => 1)).toEqual([]);
  });
});

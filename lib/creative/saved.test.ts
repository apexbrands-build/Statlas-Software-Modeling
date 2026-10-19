import { describe, expect, it } from "vitest";
import type { CreativeMonth } from "./plan";
import { adPlanResults, readSavedBlocks } from "./saved";

const block = (over: Partial<CreativeMonth> = {}): CreativeMonth => ({
  needed: 10, evergreen: 8, moments: 2, split: { evergreen: { video: 4, image: 4 }, moments: { video: 1, image: 1 } },
  basis: { metaSpend: 1000, targetSpend: 1000, currentSpend: 0, currentSource: "actual", modelNeeded: 10, carryRate: 0.7, spendPerAd: 300, momentsShare: 0.2, videoShare: 0.5, source: "defaults", reason: "ok" },
  overrides: {}, locked: false, computedAt: "2026-10-13T00:00:00.000Z", ...over,
});

describe("adPlanResults and readSavedBlocks", () => {
  it("what was saved reads back as the same blocks, with the score snapshot beside them", () => {
    const months = { "2026-10-01": block(), "2026-11-01": block({ needed: 40, locked: true, overrides: { needed: 40 } }) };
    const saved = adPlanResults({ asOf: "2026-10-13", score: { score: 64, parts: { zeroRevenue: 100, concentration: 0, roasDegradation: 31, spendDegradation: 89, evergreenShare: 100 }, mode: "provisional" }, metrics: { zeroRevenue: 0.1, concentration: 0.5, roasDegradation: -0.1, spendDegradation: -0.04, evergreenShare: 0.5 }, months });
    expect(readSavedBlocks(JSON.parse(JSON.stringify(saved)))).toEqual(months);
    expect(saved).toMatchObject({ asOf: "2026-10-13", score: 64, mode: "provisional" });
  });

  it("reads nothing from results saved before blocks were stored here, from null, or from rubbish", () => {
    expect(readSavedBlocks(null)).toEqual({});
    expect(readSavedBlocks(undefined)).toEqual({});
    expect(readSavedBlocks("oops")).toEqual({});
    expect(readSavedBlocks({ asOf: "2026-10-13", score: 64 })).toEqual({});
    expect(readSavedBlocks({ months: "no" })).toEqual({});
    expect(readSavedBlocks({ months: [block()] })).toEqual({});
  });

  it("drops a block that is damaged but keeps the good ones", () => {
    const good = block();
    const out = readSavedBlocks({ months: { "2026-01-01": good, "2026-02-01": { needed: "ten" }, "2026-03-01": null, "2026-04-01": { ...good, basis: null }, "2026-05-01": { ...good, split: undefined } } });
    expect(Object.keys(out)).toEqual(["2026-01-01"]);
  });

  it("fills a missing locked flag or overrides object so the screen can rely on them", () => {
    const { locked: _l, overrides: _o, ...rest } = block();
    void _l;
    void _o;
    const out = readSavedBlocks({ months: { "2026-01-01": rest } });
    expect(out["2026-01-01"].locked).toBe(false);
    expect(out["2026-01-01"].overrides).toEqual({});
  });

  it("a null score and no metrics are saved as nulls", () => {
    const saved = adPlanResults({ asOf: "2026-10-13", score: null, metrics: null, months: {} });
    expect(saved).toMatchObject({ score: null, parts: null, mode: null, metrics: null, months: {} });
  });
});

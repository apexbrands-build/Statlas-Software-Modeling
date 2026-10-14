import { describe, expect, it } from "vitest";
import { DEFAULT_MULTIPLIERS } from "../defaults";
import { settingsFromRow } from "./settings-row";

const row = (over: Record<string, unknown> = {}) => ({ client_id: "c1", multipliers: { ...DEFAULT_MULTIPLIERS }, other_variable_pct: 3, cogs_fallback_pct: 30, ...over });

describe("settingsFromRow: incrementality factors", () => {
  it("keeps a factor the strategist deleted deleted, instead of bringing the default back on every load", () => {
    const without = { ...DEFAULT_MULTIPLIERS };
    delete without.pinterest;
    const s = settingsFromRow("c1", row({ multipliers: without }));
    expect(s.multipliers.pinterest).toBeUndefined();
    expect(s.multipliers.meta_acquisition).toBe(DEFAULT_MULTIPLIERS.meta_acquisition);
  });

  it("keeps an empty list empty (every factor deleted means every channel is treated as platform-reported)", () => {
    expect(settingsFromRow("c1", row({ multipliers: {} })).multipliers).toEqual({});
  });

  it("uses the defaults only when the row has no usable list at all", () => {
    expect(settingsFromRow("c1", row({ multipliers: null })).multipliers).toEqual(DEFAULT_MULTIPLIERS);
    expect(settingsFromRow("c1", row({ multipliers: "oops" })).multipliers).toEqual(DEFAULT_MULTIPLIERS);
  });

  it("keeps saved factors exactly as saved", () => {
    expect(settingsFromRow("c1", row({ multipliers: { meta_acquisition: 0.9, tiktok: 0.5 } })).multipliers).toEqual({ meta_acquisition: 0.9, tiktok: 0.5 });
  });

  it("still maps the rest of the row", () => {
    const s = settingsFromRow("c1", row({ exclude_brand_from_amer: true }));
    expect(s).toMatchObject({ clientId: "c1", otherVariablePct: 3, cogsFallbackPct: 30, excludeBrandFromAmer: true });
  });
});

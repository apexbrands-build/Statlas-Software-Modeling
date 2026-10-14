import { describe, expect, it } from "vitest";
import { defaultExtra } from "./defaults";

describe("defaultExtra", () => {
  it("flags catalog ads by the keywords catalog, dpa and daba until the client changes them", () => {
    expect(defaultExtra().catalogKeywords).toBe("catalog, dpa, daba");
  });
});

import { describe, expect, it } from "vitest";
import { channelOptions } from "./order-channels";

describe("channelOptions", () => {
  it("lists the channels found on the orders, most orders first", () => {
    const out = channelOptions([{ channel: "Draft Orders", orders: 4 }, { channel: "Matrixify App", orders: 60 }], []);
    expect(out.map((c) => c.channel)).toEqual(["Matrixify App", "Draft Orders"]);
  });

  it("keeps switched-on channels that have no orders yet, after the found ones", () => {
    const out = channelOptions([{ channel: "Matrixify App", orders: 60 }], ["Online Store", "Shop"]);
    expect(out).toEqual([
      { channel: "Matrixify App", orders: 60 },
      { channel: "Online Store", orders: 0 },
      { channel: "Shop", orders: 0 },
    ]);
  });

  it("matches names case-insensitively and keeps the spelling from the orders", () => {
    const out = channelOptions([{ channel: "Online Store", orders: 12 }], ["online store"]);
    expect(out).toEqual([{ channel: "Online Store", orders: 12 }]);
  });

  it("shows only the switched-on channels for a store without orders", () => {
    expect(channelOptions([], ["Online Store", "Shop"]).map((c) => c.channel)).toEqual(["Online Store", "Shop"]);
  });
});

import { describe, expect, it } from "vitest";
import { aggregate, cmParts } from "../metrics";
import { SeedRepository } from "../repository/seed";
import { FLAT_SEASONALITY, generateMonth } from "./generate";
import { inputsFromFacts } from "./history";

/** A plan filled from a month's actuals must give back that month's real numbers (same CM formula as the dashboard). */
describe("plan round trip", () => {
  it("reproduces revenue, spend and CM of the month it was filled from", async () => {
    const repo = new SeedRepository();
    const [client] = await repo.listClients();
    const settings = { ...(await repo.getSettings(client.id)), otherVariablePct: 7, deliveryCostPerOrder: 1.5 };
    const facts = await repo.getFacts(client.id, "2025-09-01", "2025-09-30");
    const t = aggregate(facts);
    const inputs = inputsFromFacts(facts, 1, settings, "last_year")!;
    const rows = generateMonth({ planId: "p", clientId: client.id, month: "2026-09-01", inputs, seasonality: FLAT_SEASONALITY, deliveryCostPerOrder: settings.deliveryCostPerOrder, excludeBrandFromAmer: settings.excludeBrandFromAmer, excludeMetaReturningFromAmer: settings.excludeMetaReturningFromAmer });
    const sum = (k: "orderRevenue" | "spend" | "cm" | "newRevenue" | "returningRevenue") => rows.reduce((a, r) => a + r[k], 0);
    const near = (a: number, b: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(0.01);
    near(sum("orderRevenue"), t.newOrderRevenue + t.returningOrderRevenue);
    near(sum("spend"), Object.values(t.channels).reduce((a, c) => a + c.spend, 0));
    near(sum("cm"), cmParts(t, settings).cm);
  });
});

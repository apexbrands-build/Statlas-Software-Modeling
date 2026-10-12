import { describe, expect, it } from "vitest";
import { selectIntegrations } from "./integrations-query";

type Result = { data: unknown[] | null; error: unknown };

describe("selectIntegrations", () => {
  it("reads the failure counter in one query when the database has it", async () => {
    const calls: string[] = [];
    const rows = await selectIntegrations(async (columns) => {
      calls.push(columns);
      return { data: [{ id: "a", consecutive_failures: 2 }], error: null } as Result;
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("consecutive_failures");
    expect(rows).toEqual([{ id: "a", consecutive_failures: 2 }]);
  });

  it("falls back to the columns without the counter when migration 0009 is not applied yet, so the table never goes blank", async () => {
    const calls: string[] = [];
    const rows = await selectIntegrations(async (columns) => {
      calls.push(columns);
      return columns.includes("consecutive_failures") ? ({ data: null, error: { code: "42703" } } as Result) : ({ data: [{ id: "a" }], error: null } as Result);
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain("consecutive_failures");
    expect(rows).toEqual([{ id: "a" }]);
  });

  it("returns no rows when both queries fail", async () => {
    expect(await selectIntegrations(async () => ({ data: null, error: { message: "down" } }) as Result)).toEqual([]);
  });
});

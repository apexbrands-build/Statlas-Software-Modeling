import { describe, expect, it, vi } from "vitest";

type Row = { integration_id: string; ciphertext: string; updated_at: string };
const rows = vi.hoisted(() => new Map<string, Row>());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getAdminClient: () => ({
    from(table: string) {
      if (table !== "integration_secrets") throw new Error(`unexpected table ${table}`);
      return {
        async upsert(row: Row) {
          if (row.integration_id === "broken") return { error: { message: "db down" } };
          rows.set(row.integration_id, row);
          return { error: null };
        },
        select: () => ({
          eq: (_column: string, id: string) => ({
            single: async () => (rows.has(id) ? { data: rows.get(id), error: null } : { data: null, error: { message: "no rows" } }),
          }),
        }),
      };
    },
  }),
}));

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
const { readApiKey, saveApiKey } = await import("./integration-secrets");

describe("client API key storage", () => {
  it("stores the key encrypted and reads it back", async () => {
    await saveApiKey("i1", "sk-secret-123");
    expect(rows.get("i1")!.ciphertext).toBeTruthy();
    expect(rows.get("i1")!.ciphertext).not.toContain("sk-secret-123");
    expect(await readApiKey("i1")).toBe("sk-secret-123");
  });

  it("replaces the key instead of adding a second row", async () => {
    await saveApiKey("i2", "old-key");
    await saveApiKey("i2", "new-key");
    expect([...rows.keys()].filter((k) => k === "i2")).toHaveLength(1);
    expect(await readApiKey("i2")).toBe("new-key");
  });

  it("says to reconnect when no key is saved", async () => {
    await expect(readApiKey("missing")).rejects.toThrow(/reconnect/i);
  });

  it("throws a message without the key when the database write fails", async () => {
    const attempt = saveApiKey("broken", "sk-leaky-999");
    await expect(attempt).rejects.toThrow(/could not save/i);
    await expect(attempt).rejects.not.toThrow(/sk-leaky-999/);
  });
});

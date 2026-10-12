import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Anything that marks a connection "connected" (a successful sync, a connect or reconnect) must also clear
// integrations.consecutive_failures, or "Needs attention" stays on after the user has fixed the problem.

const root = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test."))
    .map((e) => path.join(e.parentPath, e.name));
}

describe("writes that mark an integration connected", () => {
  const writes = [...sourceFiles("app"), ...sourceFiles("lib")].flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((text, i) => ({ where: `${path.relative(root, file)}:${i + 1}`, text }))
      .filter((l) => l.text.includes('status: "connected"')),
  );

  it("finds the known writes (so this test cannot pass by finding nothing)", () => {
    expect(writes.length).toBeGreaterThanOrEqual(7);
  });

  it("clears the failure counter in every one of them", () => {
    const missing = writes.filter((w) => !w.text.includes("consecutive_failures: 0")).map((w) => w.where);
    expect(missing).toEqual([]);
  });
});

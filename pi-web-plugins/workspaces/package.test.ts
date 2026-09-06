import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The live-deployment defect this pins: without `runs: "web"` the bundled
 * workspaces package belongs to the daemon alone, so the web process never
 * activates its server routes and never publishes its browser module - every
 * picker, the add-project dialog, and the file endpoints silently vanish in a
 * real install while unit tests stay green.
 */
describe("workspaces package manifest", () => {
  const parsed: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "package.json"), "utf8"));

  it("runs on the web process", () => {
    const plugins = fieldOf(fieldOf(parsed, "piWeb"), "plugins");
    expect(Array.isArray(plugins) ? plugins[0] : {}).toMatchObject({ runs: "web" });
  });

  it("is an ES module package so its server entry loads under the web runtime", () => {
    expect(fieldOf(parsed, "type")).toBe("module");
  });

  function recordOf(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value));
  }

  function fieldOf(value: unknown, field: string): unknown {
    return recordOf(value)[field];
  }
});

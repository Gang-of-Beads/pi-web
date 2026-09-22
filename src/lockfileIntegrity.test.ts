import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Nix refuses a lockfile whose registry entries have no integrity hash
 * ("non-git dependencies should have associated integrity"), and npm has
 * omitted them from nested copies on every pi bump so far. Without this guard
 * the break first appears in the release build, long after the JavaScript
 * checks went green - which is exactly how 2.202609.7 shipped a broken nix
 * build. `npm run fill-lockfile-integrity` repairs it.
 */
describe("the lockfile", () => {
  it("carries an integrity hash for every registry entry", async () => {
    const lock: unknown = JSON.parse(await readFile("package-lock.json", "utf-8"));
    const packages: unknown = typeof lock === "object" && lock !== null ? Reflect.get(lock, "packages") : undefined;
    if (typeof packages !== "object" || packages === null) throw new Error("the lockfile has no packages map");
    const missing: string[] = [];
    for (const [name, entry] of Object.entries(packages)) {
      if (name === "" || typeof entry !== "object" || entry === null) continue;
      if (Reflect.get(entry, "link") === true) continue;
      const resolved: unknown = Reflect.get(entry, "resolved");
      if (typeof resolved !== "string" || !resolved.startsWith("https://registry.npmjs.org/")) continue;
      if (typeof Reflect.get(entry, "integrity") !== "string") missing.push(name);
    }

    expect(missing, "run `npm run fill-lockfile-integrity`").toEqual([]);
  });
});

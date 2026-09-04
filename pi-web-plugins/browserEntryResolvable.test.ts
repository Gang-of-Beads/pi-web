import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A browser plugin entry is served raw and loaded by the page. There is no
 * import map and no bundler in between, so a bare specifier that survives the
 * build is a module the browser cannot resolve: the plugin simply never
 * activates, and the surface it contributed is missing with nothing to say
 * why. The build bundles any entry whose graph reaches a package; this pins
 * that the shipped entries carry nothing unresolvable.
 */

const distRoot = resolve("dist", "pi-web-plugins");
const bareImport = /(?:^|\n)\s*(?:import|export)\s[^;]*from\s+"(?!\.)([^"]+)"/gu;

async function browserEntries(): Promise<string[]> {
  const entries: string[] = [];
  for (const directory of await readdir(distRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    let metadata: unknown;
    try {
      metadata = JSON.parse(await readFile(join(distRoot, directory.name, "package.json"), "utf8"));
    } catch {
      continue;
    }
    for (const declaration of declaredPlugins(metadata)) {
      const modulePath = declaration["module"];
      if (typeof modulePath === "string") entries.push(join(distRoot, directory.name, modulePath));
    }
  }
  return entries;
}

function declaredPlugins(metadata: unknown): Record<string, unknown>[] {
  if (typeof metadata !== "object" || metadata === null) return [];
  const piWeb: unknown = Reflect.get(metadata, "piWeb");
  if (typeof piWeb !== "object" || piWeb === null) return [];
  const plugins: unknown = Reflect.get(piWeb, "plugins");
  if (!Array.isArray(plugins)) return [];
  return plugins.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
}

describe("shipped browser plugin entries", () => {
  it("carry no specifier a browser could not resolve", { timeout: 120_000 }, async () => {
    execFileSync("npm", ["run", "build:plugins"], { stdio: "ignore" });

    const entries = await browserEntries();
    expect(entries.length).toBeGreaterThan(0);

    const unresolvable: string[] = [];
    for (const entry of entries) {
      const source = await readFile(entry, "utf8");
      for (const match of source.matchAll(bareImport)) {
        const specifier = match[1] ?? "";
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) unresolvable.push(`${entry}: ${specifier}`);
      }
    }

    expect(unresolvable).toEqual([]);
  });
});

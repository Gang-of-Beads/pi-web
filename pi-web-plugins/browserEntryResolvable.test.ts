import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRelativeSpecifier, moduleSpecifiers, staticModuleSpecifiers } from "../scripts/pluginModuleSpecifiers.mjs";

/**
 * npm on this platform. Windows ships it as the npm.cmd shim, and since Node 20 spawning a .cmd
 * without a shell is refused with EINVAL, so the command and the shell flag travel together.
 */
const npm = process.platform === "win32" ? { command: "npm.cmd", shell: true } : { command: "npm", shell: false };

/**
 * A browser plugin entry is served raw and loaded by the page. There is no
 * import map and no bundler in between, so a bare specifier that survives the
 * build is a module the browser cannot resolve: the plugin simply never
 * activates, and the surface it contributed is missing with nothing to say
 * why. The build bundles every entry (P7 slice a); this pins
 * that the shipped entries carry nothing unresolvable - walking the whole
 * graph, because an extensionless relative import resolves for a bundler and
 * 404s for a browser, which is how the voice plugin shipped unloadable. Side-effect
 * imports count too: `import "./element.js"` pulling in "lit" left the background-runs
 * entry unbundled, and the plugin never activated while this test passed.
 */

/**
 * The entries are built in the repository's ignored test-results, where their packages and the
 * package's own plugin API resolve as they do from dist, and not into dist/pi-web-plugins: rebuilding that under a running stack made a plugin that runs in both
 * processes read as stale, and the web withheld it from the page until the daemon restarted.
 */
const resultsRoot = resolve("test-results");
mkdirSync(resultsRoot, { recursive: true });
const distRoot = mkdtempSync(join(resultsRoot, "pi-web-browser-entries-"));

/** Every declared browser entry under the built plugins, at any depth, as the build finds them. */
async function browserEntries(directory = distRoot): Promise<string[]> {
  const entries: string[] = [];
  let metadata: unknown;
  try {
    metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  } catch {
    metadata = undefined;
  }
  for (const declaration of declaredPlugins(metadata)) {
    const modulePath = declaration["module"];
    if (typeof modulePath === "string") entries.push(join(directory, modulePath));
  }
  for (const child of await readdir(directory, { withFileTypes: true })) {
    if (child.isDirectory() && child.name !== "node_modules") entries.push(...await browserEntries(join(directory, child.name)));
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
  beforeAll(() => {
    execFileSync(npm.command, ["run", "build:plugin-api"], { stdio: "ignore", shell: npm.shell });
    execFileSync(process.execPath, ["scripts/build-plugins.mjs", "--out", distRoot], { stdio: "ignore" });
  }, 120_000);

  afterAll(async () => {
    await rm(distRoot, { recursive: true, force: true });
  });

  it("carry no specifier a browser could not resolve", async () => {
    const entries = await browserEntries();
    expect(entries.length).toBeGreaterThan(0);

    const unresolvable: string[] = [];
    const pending = [...entries];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || visited.has(file)) continue;
      visited.add(file);
      let source: string;
      try {
        source = await readFile(file, "utf8");
      } catch {
        unresolvable.push(`${file}: missing module`);
        continue;
      }
      for (const specifier of moduleSpecifiers(source)) {
        if (!isRelativeSpecifier(specifier)) {
          unresolvable.push(`${file}: ${specifier}`);
          continue;
        }
        pending.push(resolve(file, "..", specifier));
      }
    }

    expect(unresolvable).toEqual([]);
  });

  it("are each one module: nothing loads before an entry runs (P7 slice a)", async () => {
    const entries = await browserEntries();
    const importing: string[] = [];
    for (const entry of entries) {
      const imports = staticModuleSpecifiers(await readFile(entry, "utf8"));
      if (imports.length > 0) importing.push(`${entry.slice(distRoot.length + 1)}: ${imports.join(", ")}`);
    }

    expect({ entries: entries.length > 0, importing }).toEqual({ entries: true, importing: [] });
  });
});

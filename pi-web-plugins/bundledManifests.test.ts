import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A manifest without an explicit `runs` resolves to "daemon", so a plugin
 * whose server module contributes HTTP routes would ship with those routes
 * dead in every built stack: the web process filters it out before
 * activation, the daemon mounts no route contributions, and nothing else
 * registers the paths. The workspaces plugin shipped exactly that way - the
 * routes worked in dev and in the manually-mounted unit tests while every
 * built deployment 404'd. This pins the discipline at the manifest level:
 * any bundled serverModule whose source contributes routes must say where it
 * runs.
 */

const pluginsRoot = resolve("pi-web-plugins");
const routeMarkers = ["routes:", "routeContributions"];

describe("bundled plugin manifests", () => {
  it("declares runs for every server module that contributes routes", async () => {
    const findings: string[] = [];
    for (const directory of await readdir(pluginsRoot, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const manifestPath = join(pluginsRoot, directory.name, "package.json");
      let manifest: unknown;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      } catch {
        continue;
      }
      for (const declaration of declaredPlugins(manifest)) {
        const serverModule = declaration["serverModule"];
        if (typeof serverModule !== "string") continue;
        const runs = declaration["runs"];
        const source = await readFile(join(pluginsRoot, directory.name, serverModule.replace(/\.js$/u, ".ts")), "utf8");
        const contributesRoutes = routeMarkers.some((marker) => source.includes(marker));
        if (!contributesRoutes) continue;
        if (runs !== "web" && runs !== "both") {
          findings.push(`${directory.name}: server module contributes routes but runs is ${JSON.stringify(runs ?? null)}`);
        }
      }
    }
    expect(findings).toEqual([]);
  });
});

function declaredPlugins(manifest: unknown): Record<string, unknown>[] {
  const piWeb = recordOf(manifest)["piWeb"];
  const plugins = recordOf(piWeb)["plugins"];
  if (!Array.isArray(plugins)) return [];
  return plugins.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { PiWebPluginCatalog } from "../piWebPluginCatalog";

/**
 * A plugin has to be installable as a package, not only readable from this
 * repository's own directory. The split repositories are only useful if
 * pi-web can load what they publish, so this builds one plugin into a real
 * tarball, installs it the way pi installs a package, and asks the catalog
 * what it found - a directory root is deliberately not offered, so a pass
 * cannot come from the bundled copy.
 */

/**
 * The themes plugin bundles its own copy of lit, so the tarball carries one
 * self-contained ESM file - built here rather than read out of `dist`, which
 * a fresh checkout does not have when the test suite runs.
 */
async function bundleThemesPlugin(): Promise<string> {
  const source = resolve("pi-web-plugins", "themes", "pi-web-plugin.ts");
  const staging = mkdtempSync(join(tmpdir(), "pi-web-themes-build-"));
  const outfile = join(staging, "pi-web-plugin.js");
  await build({ entryPoints: [source], bundle: true, format: "esm", outfile, logLevel: "silent" });
  return outfile;
}

async function packagedPluginRoot(): Promise<string> {
  const built = await bundleThemesPlugin();
  const staging = mkdtempSync(join(tmpdir(), "pi-web-plugin-package-"));
  const packageDir = join(staging, "package");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "pi-web-plugin.js"), readFileSync(built), "utf8");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({
    name: "@gang-of-beads/pi-web-themes",
    version: "0.0.1",
    type: "module",
    files: ["pi-web-plugin.js"],
    piWeb: { plugins: [{ id: "themes", browserRoot: ".", module: "pi-web-plugin.js" }] },
  }), "utf8");
  const tarball = execFileSync("npm", ["pack", "--silent"], { cwd: packageDir, encoding: "utf8" }).trim();

  const agentDir = join(staging, "agent");
  mkdirSync(join(agentDir, "npm"), { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:@gang-of-beads/pi-web-themes"] }), "utf8");
  execFileSync("npm", ["init", "-y", "--silent"], { cwd: join(agentDir, "npm"), stdio: "ignore" });
  execFileSync("npm", ["install", "--silent", "--no-audit", "--no-fund", join(packageDir, tarball)], { cwd: join(agentDir, "npm"), stdio: "ignore" });
  return agentDir;
}

describe("a plugin installed as a package", () => {
  it("is discovered from node_modules rather than from a repository directory", { timeout: 180_000 }, async () => {
    const agentDir = await packagedPluginRoot();
    const catalog = new PiWebPluginCatalog({ cwd: agentDir, agentDir, roots: [], configProvider: () => ({}) });

    const snapshot = await catalog.snapshot();
    const themes = snapshot.plugins.find((plugin) => plugin.id === "themes");

    expect(themes?.packageRoot).toContain(join("node_modules", "@gang-of-beads", "pi-web-themes"));
    expect(themes?.browserModule?.path).toBe("pi-web-plugin.js");
    expect(snapshot.diagnostics).toEqual([]);
  });
});

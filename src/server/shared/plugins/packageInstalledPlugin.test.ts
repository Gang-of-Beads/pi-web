import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function packagedPluginRoot(): string {
  const built = resolve("dist", "pi-web-plugins", "themes", "pi-web-plugin.js");
  const staging = mkdtempSync(join(tmpdir(), "pi-web-plugin-package-"));
  const packageDir = join(staging, "package");
  mkdirSync(packageDir, { recursive: true });
  cpSync(built, join(packageDir, "pi-web-plugin.js"));
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
    const agentDir = packagedPluginRoot();
    const catalog = new PiWebPluginCatalog({ cwd: agentDir, agentDir, roots: [], configProvider: () => ({}) });

    const snapshot = await catalog.snapshot();
    const themes = snapshot.plugins.find((plugin) => plugin.id === "themes");

    expect(themes?.packageRoot).toContain(join("node_modules", "@gang-of-beads", "pi-web-themes"));
    expect(themes?.browserModule?.path).toBe("pi-web-plugin.js");
    expect(snapshot.diagnostics).toEqual([]);
  });
});

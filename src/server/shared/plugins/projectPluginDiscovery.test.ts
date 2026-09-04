import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiWebPluginCatalog } from "../piWebPluginCatalog";
import { projectPluginDirectory, resolveProjectPluginRoot } from "./projectPluginVerdict";

async function workspaceWithPlugin(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "pi-web-project-plugins-"));
  const pluginDir = join(projectPluginDirectory(workspace), "hello");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "package.json"), JSON.stringify({
    name: "hello-plugin",
    piWeb: { plugins: [{ id: "hello", browserRoot: ".", module: "pi-web-plugin.js" }] },
  }), "utf8");
  await writeFile(join(pluginDir, "pi-web-plugin.js"), "export default { apiVersion: 2, name: 'Hello', activate: () => ({ contributions: {} }) };\n", "utf8");
  return workspace;
}

function catalogFor(workspace: string, trusted: boolean): PiWebPluginCatalog {
  return new PiWebPluginCatalog({
    roots: [],
    packageProvider: false,
    configProvider: () => ({}),
    projectPlugins: () => [resolveProjectPluginRoot(workspace, { trusted, directoryExists: true })],
  });
}

describe("a project's own plugin directory", () => {
  it("is discovered when the project is trusted", async () => {
    const workspace = await workspaceWithPlugin();

    const snapshot = await catalogFor(workspace, true).snapshot();

    expect(snapshot.plugins.map((plugin) => plugin.id)).toEqual(["hello"]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("is withheld from an untrusted project, and says so instead of reporting none", async () => {
    const workspace = await workspaceWithPlugin();

    const snapshot = await catalogFor(workspace, false).snapshot();

    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]?.code).toBe("withheld-untrusted");
    expect(snapshot.diagnostics[0]?.source).toBe(projectPluginDirectory(workspace));
    expect(snapshot.diagnostics[0]?.message).toContain("not trusted");
  });

  it("says nothing when the project has no plugin directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-web-project-plugins-"));
    const catalog = new PiWebPluginCatalog({
      roots: [],
      packageProvider: false,
      configProvider: () => ({}),
      projectPlugins: () => [resolveProjectPluginRoot(workspace, { trusted: true, directoryExists: false })],
    });

    const snapshot = await catalog.snapshot();

    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
  });
});

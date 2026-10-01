// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * A page loads every plugin module once more for each remote machine on its roster, under the
 * remote's own URL, and hides the duplicate only after the import (B51). A module that defines a
 * custom element without checking whether the name is taken throws on that second import, so a
 * remote machine had no Goals page, terminal or workspaces plugin beside the gateway's copy. This
 * imports each bundled plugin's browser module twice, the way a second machine does, and each file
 * that defines an element on its own: a test transform drops an import used only as a type, which
 * the bundle keeps (the workspaces entry reaches `WorkspaceList` that way).
 */
const pluginsRoot = import.meta.dirname;

function browserModules(): string[] {
  return readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const manifestPath = join(pluginsRoot, entry.name, "package.json");
      let manifest: unknown;
      try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { return []; }
      const plugins: unknown = typeof manifest === "object" && manifest !== null && "piWeb" in manifest && typeof manifest.piWeb === "object" && manifest.piWeb !== null && "plugins" in manifest.piWeb ? manifest.piWeb.plugins : [];
      if (!Array.isArray(plugins)) return [];
      return plugins.flatMap((plugin: unknown) => {
        if (typeof plugin !== "object" || plugin === null || !("module" in plugin) || typeof plugin.module !== "string") return [];
        return [join(pluginsRoot, entry.name, plugin.module.replace(/\.js$/u, ".ts"))];
      });
    });
}

function elementModules(): string[] {
  return readdirSync(pluginsRoot, { recursive: true, encoding: "utf8" })
    .filter((relative) => relative.endsWith(".ts") && !relative.endsWith(".test.ts") && !relative.includes("node_modules"))
    .map((relative) => join(pluginsRoot, relative))
    .filter((file) => readFileSync(file, "utf8").includes("customElements.define("));
}

describe("a second machine's copy of a plugin loads beside the first (B51)", () => {
  const modules = [...new Set([...browserModules(), ...elementModules()])];

  it("finds the bundled plugins' browser modules and the files that define their elements", () => {
    expect({ entries: browserModules().length > 10, elements: elementModules().length >= 16 }).toEqual({ entries: true, elements: true });
  });

  it.each(modules.map((module) => [module.slice(pluginsRoot.length + 1)]))("imports %s twice", async (relative) => {
    const module = join(pluginsRoot, relative);
    await import(module);
    vi.resetModules();
    await expect(import(`${module}?second-machine`)).resolves.toBeDefined();
  });
});

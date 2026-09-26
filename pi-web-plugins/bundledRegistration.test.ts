// @vitest-environment happy-dom

import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import { html, svg } from "lit";
import { PluginRegistry } from "../src/client/src/plugins/registry.js";
import { createPluginRuntimeContext } from "../src/client/src/plugins/pluginRuntimeContextTestSupport.js";
import type { PiWebPlugin } from "../src/client/src/plugins/types.js";

/**
 * Every bundled plugin must register and activate against the real registry.
 *
 * A plugin is written once and then loaded by two different hosts (the app and
 * the daemon's catalogue), so "it compiles" is not the guarantee that matters:
 * a contribution id with a character the registry rejects, an `activate` that
 * throws, an unknown panel kind - each of those is a plugin that ships and then
 * does nothing at runtime. Registering them all here turns that into a test
 * failure with the plugin's own name in it.
 */
const pluginsRoot = resolve("pi-web-plugins");

async function browserPluginDirectories(): Promise<string[]> {
  const directories: string[] = [];
  for (const entry of await readdir(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(join(pluginsRoot, entry.name)).catch(() => []);
    if (files.some((name) => name === "pi-web-plugin.ts")) directories.push(entry.name);
  }
  return directories.sort();
}

function isBrowserPlugin(value: unknown): value is { default: PiWebPlugin } {
  if (value === null || typeof value !== "object" || !("default" in value)) return false;
  const plugin: unknown = value.default;
  return plugin !== null && typeof plugin === "object" && "activate" in plugin && "apiVersion" in plugin;
}

describe("bundled plugins register and activate", () => {
  it("registers every browser plugin into the real registry", async () => {
    const directories = await browserPluginDirectories();
    expect(directories.length).toBeGreaterThan(5);

    const failures: string[] = [];
    for (const directory of directories) {
      const loaded: unknown = await import(`./${directory}/pi-web-plugin`);
      const plugin = isBrowserPlugin(loaded) ? loaded.default : undefined;
      if (plugin === undefined) {
        failures.push(`${directory}: no default export`);
        continue;
      }
      const registry = new PluginRegistry();
      try {
        registry.register({ id: directory, plugin });
      } catch (error) {
        failures.push(`${directory}: register threw ${String(error)}`);
        continue;
      }
      // Activation is what the host actually calls, with the host's own template
      // tags; a plugin whose activate throws would load and contribute nothing.
      const context = createPluginRuntimeContext().context;
      plugin.activate(Object.freeze({ ...context, apiVersion: 2, pluginId: directory, runtimePluginId: directory, html, svg }));
    }
    expect(failures).toEqual([]);
  });

  it("gives every bundled plugin an id the registry accepts", async () => {
    const directories = await browserPluginDirectories();
    for (const directory of directories) expect(directory).toMatch(/^[a-z][a-z0-9-]*$/u);
  });
});

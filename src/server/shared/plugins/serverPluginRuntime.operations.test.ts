import { describe, expect, it, vi } from "vitest";
import type { PiWebServerPlugin, ServerPluginActivation } from "../../../server-plugin-api.js";
import type { PiWebPluginCatalogEntry, PiWebPluginCatalogSnapshot } from "../piWebPluginCatalog.js";
import { createServerPluginRuntime, type ServerPluginModuleImporter } from "./serverPluginRuntime.js";
import { UnknownPluginOperationError } from "./pluginOperations.js";

function entry(id: string): PiWebPluginCatalogEntry {
  return {
    id,
    packageRoot: `/plugins/${id}`,
    serverModule: { path: "server.js", filePath: `/plugins/${id}/server.js`, revision: "1" },
    source: "fixture",
    scope: "local",
    machineSpecific: false,
    enabled: true,
    settings: {},
    settingsRevision: "settings-1",
  };
}

function snapshot(plugins: PiWebPluginCatalogEntry[]): PiWebPluginCatalogSnapshot {
  return { plugins, diagnostics: [] };
}

function pluginWith(activation: ServerPluginActivation): { default: PiWebServerPlugin } {
  return { default: { apiVersion: 1, name: "Voice", activate: () => activation } };
}

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function runtimeWith(activation: ServerPluginActivation) {
  const importer: ServerPluginModuleImporter = () => Promise.resolve(pluginWith(activation));
  return await createServerPluginRuntime({
    catalog: { snapshot: () => Promise.resolve(snapshot([entry("voice")])) },
    importer,
    logger: logger(),
  });
}

describe("calling a declared plugin operation", () => {
  it("routes the call to the plugin's own handler", async () => {
    const runtime = await runtimeWith({ operations: { "speech.token": (input) => ({ echoed: JSON.stringify(input) }) } });

    const result = await runtime.callOperation("voice", "speech.token", { want: "token" }, new AbortController().signal);

    expect(result).toEqual({ echoed: JSON.stringify({ want: "token" }) });
    await runtime.stop();
  });

  it("refuses an operation the plugin never declared", async () => {
    const runtime = await runtimeWith({ operations: { "speech.token": () => null } });

    await expect(runtime.callOperation("voice", "speech.other", null, new AbortController().signal)).rejects.toBeInstanceOf(UnknownPluginOperationError);
    await runtime.stop();
  });

  it("refuses a call to a plugin that is not active", async () => {
    const runtime = await runtimeWith({ operations: { "speech.token": () => null } });

    await expect(runtime.callOperation("absent", "speech.token", null, new AbortController().signal)).rejects.toBeInstanceOf(UnknownPluginOperationError);
    await runtime.stop();
  });

  it("refuses every call to a plugin that declared no operations", async () => {
    const runtime = await runtimeWith({});

    await expect(runtime.callOperation("voice", "speech.token", null, new AbortController().signal)).rejects.toBeInstanceOf(UnknownPluginOperationError);
    await runtime.stop();
  });

  it("passes the caller's signal through to the handler", async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    const runtime = await runtimeWith({ operations: { "speech.token": (_input, context) => { seen.push(context.signal); return null; } } });

    await runtime.callOperation("voice", "speech.token", null, controller.signal);

    expect(seen[0]).toBe(controller.signal);
    await runtime.stop();
  });
});

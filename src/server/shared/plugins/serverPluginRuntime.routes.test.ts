import { describe, expect, it, vi } from "vitest";
import type { PiWebServerPlugin, ServerPluginActivation, ServerPluginReply, ServerPluginRequest, ServerPluginRouteContribution } from "../../../server-plugin-api.js";
import type { PiWebPluginCatalogEntry, PiWebPluginCatalogSnapshot } from "../piWebPluginCatalog.js";
import { createServerPluginRuntime, type ServerPluginModuleImporter } from "./serverPluginRuntime.js";

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

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function runtimeWith(
  activation: ServerPluginActivation | Record<string, unknown>,
  options: { hostPorts?: Parameters<typeof createServerPluginRuntime>[0]["hostPorts"] } = {},
) {
  const importer: ServerPluginModuleImporter = () => Promise.resolve({ default: { apiVersion: 1, name: "Files", activate: () => activation } satisfies PiWebServerPlugin });
  const log = logger();
  const runtime = await createServerPluginRuntime({
    catalog: { snapshot: () => Promise.resolve(snapshot([entry("workspaces")])) },
    importer,
    logger: log,
    ...(options.hostPorts === undefined ? {} : { hostPorts: options.hostPorts }),
  });
  return { runtime, log };
}

function previewRoute(): ServerPluginRouteContribution {
  return {
    method: "GET",
    path: "/projects/:projectId/workspaces/:workspaceId/file/preview",
    handle: async (_request: ServerPluginRequest, reply: ServerPluginReply) => {
      await reply.code(200).header("Content-Type", "text/plain").send("preview");
    },
  };
}

describe("route contributions", () => {
  it("freeze a declared route behind the contract shape and expose it to the host", async () => {
    const { runtime } = await runtimeWith({ routes: [previewRoute()] });

    const contributed = runtime.routeContributions();
    expect(contributed).toHaveLength(1);
    expect(contributed[0]?.pluginId).toBe("workspaces");
    expect(contributed[0]?.route.method).toBe("GET");
    expect(contributed[0]?.route.path).toBe("/projects/:projectId/workspaces/:workspaceId/file/preview");
    await runtime.stop();
  });

  it("answers through the bounded reply surface", async () => {
    const { runtime } = await runtimeWith({ routes: [previewRoute()] });
    const contributed = runtime.routeContributions()[0];
    if (contributed === undefined) throw new Error("route contribution missing");

    const reply = {
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockResolvedValue(undefined),
    };
    await contributed.route.handle({ params: {}, query: {}, headers: {} }, reply, { signal: new AbortController().signal });

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.header).toHaveBeenCalledWith("Content-Type", "text/plain");
    expect(reply.send).toHaveBeenCalledWith("preview");
    await runtime.stop();
  });

  it("refuses a route whose handle is not a function", async () => {
    const { runtime, log } = await runtimeWith({ routes: [{ method: "GET", path: "/x", handle: undefined }] });
    expect(log.warn).toHaveBeenCalled();
    expect(runtime.healthRecords().find((record) => record.pluginId === "workspaces")?.state).toBe("incompatible");
  });

  it("refuses a route whose method is not one of the mounted verbs", async () => {
    const { runtime, log } = await runtimeWith({ routes: [{ method: "PATCH", path: "/x", handle: async () => {} }] });
    expect(log.warn).toHaveBeenCalled();
    expect(runtime.healthRecords().find((record) => record.pluginId === "workspaces")?.state).toBe("incompatible");
  });

  it("warns about activation fields this host does not implement, and still activates", async () => {
    const { runtime, log } = await runtimeWith({ operations: {}, futureSurface: { v: 1 } });

    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "workspaces", key: "futureSurface" }), expect.stringContaining("unknown field"));
    expect(runtime.healthRecords().find((record) => record.pluginId === "workspaces")?.state).toBe("active");
    await runtime.stop();
  });
});

describe("host ports", () => {
  it("arrive frozen on the activation context", async () => {
    let observed: unknown;
    const importer: ServerPluginModuleImporter = () => Promise.resolve({
      default: {
        apiVersion: 1,
        name: "Files",
        activate: (context) => {
          observed = context.ports;
          return {};
        },
      } satisfies PiWebServerPlugin,
    });
    const workspaceCatalog = { resolveWorkspace: async () => undefined };
    const piWebConfig = { readPathAccess: async () => undefined };
    const runtime = await createServerPluginRuntime({
      catalog: { snapshot: () => Promise.resolve(snapshot([entry("workspaces")])) },
      importer,
      logger: logger(),
      hostPorts: { workspaceCatalog, piWebConfig },
    });

    expect(observed).toEqual({ workspaceCatalog, piWebConfig });
    expect(Object.isFrozen(observed)).toBe(true);
    await runtime.stop();
  });

  it("stay absent when the host supplies none", async () => {
    let observed: unknown = "unset";
    const importer: ServerPluginModuleImporter = () => Promise.resolve({
      default: {
        apiVersion: 1,
        name: "Files",
        activate: (context) => {
          observed = context.ports;
          return {};
        },
      } satisfies PiWebServerPlugin,
    });
    const runtime = await createServerPluginRuntime({
      catalog: { snapshot: () => Promise.resolve(snapshot([entry("workspaces")])) },
      importer,
      logger: logger(),
    });

    expect(observed).toBeUndefined();
    await runtime.stop();
  });
});

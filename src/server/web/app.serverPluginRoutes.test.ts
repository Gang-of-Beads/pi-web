import { describe, expect, it, vi } from "vitest";
import type { PiWebPluginCatalogEntry } from "../shared/piWebPluginCatalog.js";
import { createServerPluginRuntime, type ServerPluginModuleImporter, type ServerPluginRuntime } from "../shared/plugins/serverPluginRuntime.js";
import type { PiWebServerPlugin, ServerPluginActivation, ServerPluginReply, ServerPluginRequest, ServerPluginRouteContribution } from "../../server-plugin-api.js";
import { buildApp } from "./app.js";
import type { PiWebConfigResponse } from "../../shared/apiTypes.js";
import type { PiWebConfigService } from "./configRoutes.js";

/**
 * The web process hosts the plugins addressed to it. An injected runtime
 * proves the mount: routes answer at both prefixes, the daemon-owned plugins
 * stay unmounted, and the app closes the runtime down with itself.
 */

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

function statusRoute(): ServerPluginRouteContribution {
  return {
    method: "GET",
    path: "/workspaces-served-by-plugin",
    handle: async (_request: ServerPluginRequest, reply: ServerPluginReply) => {
      await reply.code(200).header("Content-Type", "text/plain").send("served by the workspaces plugin");
    },
  };
}

async function runtimeWithRoutes(activation: ServerPluginActivation) {
  const importer: ServerPluginModuleImporter = () => Promise.resolve({
    default: { apiVersion: 1, name: "Workspaces", activate: () => activation } satisfies PiWebServerPlugin,
  });
  return await createServerPluginRuntime({
    catalog: { snapshot: () => Promise.resolve({ plugins: [entry("workspaces")], diagnostics: [] }) },
    importer,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
}

function emptyConfigService(): PiWebConfigService {
  const response: PiWebConfigResponse = {
    path: "/tmp/pi-web-plugin-routes-config.json",
    exists: false,
    config: {},
    effectiveConfig: {},
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false },
  };
  return { read: () => Promise.resolve(response), write: () => Promise.resolve(response) };
}

async function appWithRuntime(runtime: ServerPluginRuntime) {
  const app = await buildApp({
    config: emptyConfigService(),
    clientDist: false,
    logger: false,
    serverPluginRuntime: runtime,
  });
  return app;
}

describe("buildApp hosting the web-process plugin runtime", () => {
  it("serves a contributed route at both machine prefixes", async () => {
    const runtime = await runtimeWithRoutes({ routes: [statusRoute()] });
    const app = await appWithRuntime(runtime);
    try {
      for (const prefix of ["/api", "/api/machines/local"]) {
        const response = await app.inject({ method: "GET", url: `${prefix}/workspaces-served-by-plugin` });
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe("served by the workspaces plugin");
      }
    } finally {
      await app.close();
    }
  });

  it("stops the runtime when the app closes", async () => {
    const runtime = await runtimeWithRoutes({ routes: [statusRoute()] });
    const stopped = vi.spyOn(runtime, "stop");
    const app = await appWithRuntime(runtime);
    await app.close();
    expect(stopped).toHaveBeenCalled();
  });
});

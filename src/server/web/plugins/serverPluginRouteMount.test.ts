import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { PiWebServerPlugin, ServerPluginActivation } from "../../../server-plugin-api.js";
import type { PiWebPluginCatalogEntry } from "../../shared/piWebPluginCatalog.js";
import { createServerPluginRuntime, type ServerPluginModuleImporter } from "../../shared/plugins/serverPluginRuntime.js";
import { mountServerPluginRoutes } from "./serverPluginRouteMount.js";

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

function previewActivation(): ServerPluginActivation {
  return {
    routes: [{
      method: "GET",
      path: "/projects/:projectId/workspaces/:workspaceId/file/preview",
      handle: async (request, reply) => {
        await reply
          .code(200)
          .header("Content-Type", "text/plain")
          .header("X-Seen-Path", `${request.params["projectId"] ?? ""}/${request.params["workspaceId"] ?? ""}`)
          .header("X-Seen-Range", request.headers["range"] ?? "none")
          .send(`preview of ${request.query["path"] ?? ""}`);
      },
    }],
  };
}

async function appWithRoutes(activation: ServerPluginActivation) {
  const runtime = await runtimeWith(activation);
  const app = Fastify({ logger: false });
  mountServerPluginRoutes(app, runtime, "/api");
  mountServerPluginRoutes(app, runtime, "/api/machines/local");
  await app.ready();
  return { app, runtime };
}

async function runtimeWith(activation: ServerPluginActivation) {
  const importer: ServerPluginModuleImporter = () => Promise.resolve({
    default: { apiVersion: 1, name: "Files", activate: () => activation } satisfies PiWebServerPlugin,
  });
  return await createServerPluginRuntime({
    catalog: { snapshot: () => Promise.resolve({ plugins: [entry("workspaces")], diagnostics: [] }) },
    importer,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
}

describe("mounting plugin route contributions", () => {
  it("serves a contributed route under /api with narrowed request faces", async () => {
    const { app, runtime } = await appWithRoutes(previewActivation());
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/projects/p1/workspaces/w1/file/preview",
        query: { path: "src/index.ts" },
        headers: { range: "bytes=0-10" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("preview of src/index.ts");
      expect(response.headers["x-seen-path"]).toBe("p1/w1");
      expect(response.headers["x-seen-range"]).toBe("bytes=0-10");
    } finally {
      await app.close();
      await runtime.stop();
    }
  });

  it("mounts the same route under the local machine prefix", async () => {
    const { app, runtime } = await appWithRoutes(previewActivation());
    try {
      const response = await app.inject({ method: "GET", url: "/api/machines/local/projects/p1/workspaces/w1/file/preview" });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("preview of ");
    } finally {
      await app.close();
      await runtime.stop();
    }
  });

  it("streams an async iterable body as the response", async () => {
    const activation: ServerPluginActivation = {
      routes: [{
        method: "GET",
        path: "/stream",
        handle: async (_request, reply) => {
          async function* chunks(): AsyncIterable<Uint8Array> {
            const encoder = new TextEncoder();
            for (const part of ["first ", "second"]) {
              await Promise.resolve();
              yield encoder.encode(part);
            }
          }
          await reply.header("Content-Type", "text/plain").send(chunks());
        },
      }],
    };
    const { app, runtime } = await appWithRoutes(activation);
    try {
      const response = await app.inject({ method: "GET", url: "/api/stream" });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("first second");
    } finally {
      await app.close();
      await runtime.stop();
    }
  });

  it("refuses a colliding mount with a diagnostic and keeps the app serving", async () => {
    const runtime = await runtimeWith(previewActivation());
    const app = Fastify({ logger: false });
    const logError = vi.fn();
    Reflect.set(app.log, "error", logError);
    mountServerPluginRoutes(app, runtime, "/api");
    mountServerPluginRoutes(app, runtime, "/api");
    await app.ready();
    try {
      const response = await app.inject({ method: "GET", url: "/api/projects/p/workspaces/w/file/preview" });
      expect(response.statusCode).toBe(200);
      expect(logError).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "workspaces" }), expect.stringContaining("mount refused"));
    } finally {
      await app.close();
      await runtime.stop();
    }
  });
});

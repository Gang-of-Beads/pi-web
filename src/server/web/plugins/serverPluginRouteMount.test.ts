import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { once } from "node:events";
import { mkdtemp, open, rm, truncate, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
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

  it("streams a Node stream body as the response", async () => {
    const activation: ServerPluginActivation = {
      routes: [{
        method: "GET",
        path: "/stream",
        handle: async (_request, reply) => {
          await reply.header("Content-Type", "text/plain").send(Readable.from([Buffer.from("first "), Buffer.from("second")]));
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

  // Gang-of-Beads/pi-web#71: a file stream left undestroyed closes its FileHandle on GC, which Node 25 turns into a process-ending ERR_INVALID_STATE.
  it("destroys a body the answer never sends, whether the client left first or the reply was already sent", async () => {
    let source: Readable | undefined;
    let file: FileHandle | undefined;
    let answeredTwice: FileHandle | undefined;
    const root = await mkdtemp(join(tmpdir(), "pi-web-route-mount-"));
    const clip = join(root, "clip.mp4");
    await writeFile(clip, "");
    await truncate(clip, 64 * 1024 * 1024);
    const activation: ServerPluginActivation = {
      routes: [{
        method: "GET",
        path: "/abandoned",
        handle: async (_request, reply) => {
          source = new Readable({ read: () => undefined });
          await reply.header("Content-Type", "video/mp4").send(source);
        },
      }, {
        method: "GET",
        path: "/abandoned-file",
        handle: async (_request, reply) => {
          file = await open(clip, "r");
          await reply.header("Content-Type", "video/mp4").sendFile(file);
        },
      }, {
        method: "GET",
        path: "/answered-twice",
        handle: async (_request, reply) => {
          answeredTwice = await open(clip, "r");
          await reply.send("answered");
          await reply.sendFile(answeredTwice);
        },
      }],
    };
    const { app, runtime } = await appWithRoutes(activation);
    try {
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      if (address === null || typeof address === "string") throw new Error("no listening port");
      const controller = new AbortController();
      const response = fetch(`http://127.0.0.1:${String(address.port)}/api/abandoned`, { signal: controller.signal });
      await vi.waitFor(() => { expect(source).toBeDefined(); });
      controller.abort();
      await response.catch(() => undefined);
      const stream = source;
      if (stream === undefined) throw new Error("route never ran");
      if (!stream.destroyed) await once(stream, "close");
      expect(stream.destroyed).toBe(true);

      const fileController = new AbortController();
      const fileResponse = fetch(`http://127.0.0.1:${String(address.port)}/api/abandoned-file`, { signal: fileController.signal });
      await vi.waitFor(() => { expect(file).toBeDefined(); });
      fileController.abort();
      await fileResponse.catch(() => undefined);
      await vi.waitFor(() => { expect(file?.fd).toBe(-1); });

      const twice = await fetch(`http://127.0.0.1:${String(address.port)}/api/answered-twice`);
      expect(await twice.text()).toBe("answered");
      await vi.waitFor(() => { expect(answeredTwice?.fd).toBe(-1); });
    } finally {
      app.server.closeAllConnections();
      await app.close();
      await runtime.stop();
      await rm(root, { recursive: true, force: true });
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

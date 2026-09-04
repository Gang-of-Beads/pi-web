import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerPluginOperationProxyRoutes } from "./pluginOperationProxyRoutes";
import type { SessionDaemonRequestClient } from "../../shared/sessiondClient/sessionDaemonClient";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function daemonAnswering(request: SessionDaemonRequestClient["request"]): SessionDaemonRequestClient {
  return { request };
}

async function serve(daemon: SessionDaemonRequestClient): Promise<FastifyInstance> {
  const instance = Fastify();
  registerPluginOperationProxyRoutes(instance, daemon);
  await instance.ready();
  app = instance;
  return instance;
}

describe("the browser-facing half of a plugin operation", () => {
  it("forwards to the daemon path the plugin's name maps to", async () => {
    const seen: string[] = [];
    const server = await serve(daemonAnswering((_method, path) => {
      seen.push(path);
      return Promise.resolve({ statusCode: 200, headers: {}, body: JSON.stringify({ ok: true }) });
    }));

    const response = await server.inject({ method: "POST", url: "/api/plugins/voice/speech.token", payload: {} });

    expect(seen).toEqual(["/plugin-operations/voice/speech.token"]);
    expect(response.json()).toEqual({ ok: true });
  });

  it("hands the daemon a signal so a client that goes away can stop the work", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const server = await serve(daemonAnswering((_method, _path, _payload, options) => {
      seen.push(options?.signal);
      return Promise.resolve({ statusCode: 200, headers: {}, body: "null" });
    }));

    await server.inject({ method: "POST", url: "/api/plugins/voice/speech.token", payload: {} });

    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.aborted).toBe(false);
  });

  it("says the daemon was unreachable rather than presenting silence as an answer", async () => {
    const server = await serve(daemonAnswering(() => Promise.reject(new Error("socket refused"))));

    const response = await server.inject({ method: "POST", url: "/api/plugins/voice/speech.token", payload: {} });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "daemon-unavailable", pluginId: "voice" });
  });

  it("passes an empty daemon body through as null rather than as malformed json", async () => {
    const server = await serve(daemonAnswering(() => Promise.resolve({ statusCode: 200, headers: {}, body: "" })));

    const response = await server.inject({ method: "POST", url: "/api/plugins/voice/speech.token", payload: {} });

    expect(response.json()).toBeNull();
  });

  it("keeps the daemon's own refusal status instead of reporting success", async () => {
    const server = await serve(daemonAnswering(() => Promise.resolve({
      statusCode: 404,
      headers: {},
      body: JSON.stringify({ error: "No plugin operation named speech.other", code: "plugin-operation-refused" }),
    })));

    const response = await server.inject({ method: "POST", url: "/api/plugins/voice/speech.other", payload: {} });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "plugin-operation-refused" });
  });

  it("encodes the plugin and operation it was given", async () => {
    const seen: string[] = [];
    const server = await serve(daemonAnswering((_method, path) => {
      seen.push(path);
      return Promise.resolve({ statusCode: 200, headers: {}, body: "null" });
    }));

    await server.inject({ method: "POST", url: "/api/plugins/machine.remote.voice/speech.token", payload: {} });

    expect(seen).toEqual(["/plugin-operations/machine.remote.voice/speech.token"]);
  });
});

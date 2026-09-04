import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPluginOperationRoutes } from "./pluginOperationRoutes";
import { UnknownPluginOperationError } from "../../shared/plugins/pluginOperations";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(callOperation: (pluginId: string, operation: string, input: unknown, signal: AbortSignal) => Promise<unknown>): Promise<FastifyInstance> {
  const instance = Fastify();
  registerPluginOperationRoutes(instance, { callOperation });
  await instance.ready();
  app = instance;
  return instance;
}

describe("plugin operation routes", () => {
  it("dispatches a declared operation and returns its JSON", async () => {
    const server = await serve((pluginId, operation, input) => Promise.resolve({ pluginId, operation, input }));

    const response = await server.inject({ method: "POST", url: "/plugin-operations/voice/speech.token", payload: { want: true } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ pluginId: "voice", operation: "speech.token", input: { want: true } });
  });

  it("answers 404 naming the operation nobody declared", async () => {
    const server = await serve(() => Promise.reject(new UnknownPluginOperationError("No plugin operation named speech.other")));

    const response = await server.inject({ method: "POST", url: "/plugin-operations/voice/speech.other", payload: {} });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "plugin-operation-refused", operation: "speech.other" });
  });

  it("refuses an invalid plugin id before dispatching", async () => {
    const callOperation = vi.fn(() => Promise.resolve(null));
    const server = await serve(callOperation);

    const response = await server.inject({ method: "POST", url: "/plugin-operations/Voice%2F..%2Fetc/speech.token", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(callOperation).not.toHaveBeenCalled();
  });

  it("refuses an invalid operation name before dispatching", async () => {
    const callOperation = vi.fn(() => Promise.resolve(null));
    const server = await serve(callOperation);

    const response = await server.inject({ method: "POST", url: "/plugin-operations/voice/Speech%20Token", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(callOperation).not.toHaveBeenCalled();
  });

  it("reports a handler failure as a server error rather than a missing route", async () => {
    const server = await serve(() => Promise.reject(new Error("token service refused")));

    const response = await server.inject({ method: "POST", url: "/plugin-operations/voice/speech.token", payload: {} });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: "token service refused" });
  });

  it("sends null rather than an empty body when an operation answers nothing", async () => {
    const server = await serve(() => Promise.resolve(null));

    const response = await server.inject({ method: "POST", url: "/plugin-operations/voice/speech.token", payload: {} });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
  });
});

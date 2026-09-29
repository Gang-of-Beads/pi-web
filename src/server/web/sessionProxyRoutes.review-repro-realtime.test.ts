import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessionProxyRoutes";
import { SESSION_PROXY_DEADLINE_MS } from "./boundedDaemonRequest";

afterEach(() => { vi.useRealTimers(); });

describe("review-repro realtime: the web proxy cannot cancel or bound a daemon request", () => {
  it("hands the daemon request no abort signal, so neither a deadline nor a browser disconnect can end it", async () => {
    const seen: { path: string; signal: unknown }[] = [];
    const daemon: SessionProxyDaemon = {
      request: (_method, path, _body, options) => {
        seen.push({ path, signal: options?.signal });
        return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: "{}" });
      },
      connectWebSocket: () => { throw new Error("unused"); },
    };
    const app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    registerSessionProxyRoutes(app, daemon, "/api/machines/local");
    await app.inject({ method: "POST", url: "/api/machines/local/sessions/s1/prompt", payload: { cwd: "/repo", text: "hi" } });
    await app.close();
    expect(seen[0]?.path).toBe("/sessions/s1/prompt");
    expect(seen[0]?.signal, "the proxied call needs an AbortSignal tied to the client connection and a deadline").toBeInstanceOf(AbortSignal);
  });

  it("a daemon that never answers leaves the browser request open with no answer from the proxy", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const daemon: SessionProxyDaemon = {
      request: () => new Promise(() => undefined),
      connectWebSocket: (): WebSocket => { throw new Error("unused"); },
    };
    const app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    registerSessionProxyRoutes(app, daemon, "/api/machines/local");
    const answered = Promise.race([
      app.inject({ method: "GET", url: "/api/machines/local/sessions/s1/status?cwd=/repo" }).then((response) => `answered ${String(response.statusCode)}`),
      new Promise<string>((resolve) => { setTimeout(() => { resolve("no answer before the browser's 30s deadline"); }, 30_000); }),
    ]);
    await vi.advanceTimersByTimeAsync(SESSION_PROXY_DEADLINE_MS + 1);
    await vi.advanceTimersByTimeAsync(30_000 - SESSION_PROXY_DEADLINE_MS);
    const outcome = await answered;
    expect(outcome, "the proxy has no deadline of its own; only the browser 30s deadline ends this, and the upstream call is never cancelled").toMatch(/^answered 50[24]$/);
  }, 10_000);
});

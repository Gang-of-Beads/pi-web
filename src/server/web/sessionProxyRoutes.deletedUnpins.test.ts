import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessionProxyRoutes";

/**
 * A deleted session's pin goes with it (owner, 2026-10-01: "删掉了自动就没有了"). The web process owns
 * the pins and sees a deletion proven only in its daemon's answer to PI WEB's own delete and cleanup.
 * A board locate answering gone is not proof: it starts from the home directory and misses a
 * project's own session directory (review of 4caabf4e), so it unpins nothing.
 */

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function proxyApp(answer: (path: string) => { statusCode: number; body: unknown }, sessionsDeleted: (ids: readonly string[]) => Promise<void>): Promise<FastifyInstance> {
  const daemon: SessionProxyDaemon = {
    request: (_method, path) => {
      const { statusCode, body } = answer(path);
      return Promise.resolve({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    },
    connectWebSocket: (): WebSocket => { throw new Error("unused"); },
  };
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(fastifyWebsocket);
  registerSessionProxyRoutes(app, daemon, "/api/machines/local", { sessionsDeleted });
  return app;
}

describe("the session proxy unpins what the daemon deleted", () => {
  it("unpins the sessions a bulk delete and a cleanup answer as deleted, and relays both answers as they came", async () => {
    const unpinned: string[][] = [];
    const app = await proxyApp((path) => ({
      statusCode: 200,
      body: path === "/sessions/cleanup"
        ? { deletedSessionIds: ["old-2"], archivedSessionIds: ["kept-1"] }
        : { deleted: true, deletedSessionIds: ["gone-1"], failures: [{ sessionId: "busy-1", error: "busy" }] },
    }), (ids) => { unpinned.push([...ids]); return Promise.resolve(); });

    const deleted = await app.inject({ method: "POST", url: "/api/machines/local/sessions/bulk/delete-archived", payload: { sessions: [] } });
    const cleaned = await app.inject({ method: "POST", url: "/api/machines/local/sessions/cleanup", payload: {} });
    const deletedBody: unknown = deleted.json();
    const cleanedBody: unknown = cleaned.json();

    expect({ unpinned, deleted: [deleted.statusCode, deletedBody], cleaned: [cleaned.statusCode, cleanedBody] }).toEqual({
      unpinned: [["gone-1"], ["old-2"]],
      deleted: [200, { deleted: true, deletedSessionIds: ["gone-1"], failures: [{ sessionId: "busy-1", error: "busy" }] }],
      cleaned: [200, { deletedSessionIds: ["old-2"], archivedSessionIds: ["kept-1"] }],
    });
  });

  it("unpins nothing when the daemon refused the delete or deleted nothing, and still answers when unpinning fails", async () => {
    const unpinned: string[][] = [];
    let status = 409;
    const app = await proxyApp(() => ({ statusCode: status, body: status === 409 ? { error: "refused", deletedSessionIds: ["claimed-1"] } : { deleted: true, deletedSessionIds: status === 200 ? [] : ["gone-2"], failures: [] } }), (ids) => {
      unpinned.push([...ids]);
      return Promise.reject(new Error("pin store not writable"));
    });

    const refused = await app.inject({ method: "POST", url: "/api/machines/local/sessions/bulk/delete-archived", payload: {} });
    status = 200;
    await app.inject({ method: "POST", url: "/api/machines/local/sessions/bulk/delete-archived", payload: {} });
    status = 201;
    const unpinFailed = await app.inject({ method: "POST", url: "/api/machines/local/sessions/bulk/delete-archived", payload: {} });

    expect({ refused: refused.statusCode, unpinned, unpinFailed: unpinFailed.statusCode }).toEqual({ refused: 409, unpinned: [["gone-2"]], unpinFailed: 201 });
  });
});

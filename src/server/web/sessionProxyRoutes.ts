import type { FastifyInstance, FastifyReply } from "fastify";
import { WebSocket, type RawData } from "ws";
import {
  SessionDaemonClient,
  type SessionDaemonRequestOptions,
} from "../shared/sessiondClient/sessionDaemonClient.js";
import { boundDaemonRequest, SESSION_PROXY_DEADLINE_MS } from "./boundedDaemonRequest.js";

interface DaemonAnswer { statusCode: number; headers: Record<string, string>; body: string }

export interface SessionProxyDaemon {
  request(
    method: string,
    path: string,
    body?: unknown,
    options?: SessionDaemonRequestOptions,
  ): Promise<DaemonAnswer>;
  connectWebSocket(path: string): WebSocket;
}

/**
 * What the web process does when its daemon says sessions were deleted. The pins live here, so a
 * deleted session's pin goes with it (owner, 2026-10-01: "删掉了自动就没有了").
 */
export interface SessionProxyHooks {
  sessionsDeleted?: (sessionIds: readonly string[]) => Promise<void>;
}

/** The routes whose answer names the sessions the daemon deleted: the only proof of a deletion this process sees. */
const DELETING_ROUTES = ["/sessions/bulk/delete-archived", "/sessions/cleanup"] as const;

export function registerSessionProxyRoutes(app: FastifyInstance, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api", hooks: SessionProxyHooks = {}): void {
  const forward = async (reply: FastifyReply, method: string, url: string, body?: unknown): Promise<DaemonAnswer | undefined> => {
    const outcome = await boundDaemonRequest(reply.raw, (signal) => daemon.request(method, stripPrefix(url, prefix), body, { signal }));
    if (outcome.kind === "answered") return outcome.value;
    reply.code(504).send({ error: outcome.kind === "deadline" ? `Session daemon did not answer within ${String(SESSION_PROXY_DEADLINE_MS / 1000)}s` : "The browser closed the request" });
    return undefined;
  };

  const proxy = async (request: { method: string; url: string; body?: unknown }, reply: FastifyReply) => {
    try {
      const upstream = await forward(reply, request.method, request.url, request.body);
      if (upstream === undefined) return undefined;
      reply.code(upstream.statusCode);
      const contentType = upstream.headers["content-type"];
      if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
      return upstream.body !== "" ? parseJson(upstream.body) : undefined;
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  };

  const sessionsDeleted = hooks.sessionsDeleted;
  if (sessionsDeleted !== undefined) {
    for (const path of DELETING_ROUTES) {
      app.post(`${prefix}${path}`, async (request, reply) => {
        const answer = await proxy(request, reply);
        const deleted = reply.statusCode >= 200 && reply.statusCode < 300 ? deletedSessionIds(answer) : [];
        if (deleted.length > 0) await sessionsDeleted(deleted).catch((error: unknown) => { console.warn(`[pins] could not unpin deleted sessions: ${error instanceof Error ? error.message : String(error)}`); });
        return answer;
      });
    }
  }

  app.get(`${prefix}/sessiond/health`, (_request, reply) => proxy({ method: "GET", url: `${prefix}/health` }, reply));
  app.get(`${prefix}/sessiond/runtime`, (_request, reply) => proxy({ method: "GET", url: `${prefix}/runtime` }, reply));

  app.get<{ Params: { sessionId: string } }>(`${prefix}/sessions/:sessionId/events`, { websocket: true }, (socket, request) => {
    bridgeSockets(socket, daemon.connectWebSocket(stripPrefix(request.url, prefix)));
  });

  app.get(`${prefix}/sessions/events`, { websocket: true }, (socket) => {
    bridgeSockets(socket, daemon.connectWebSocket("/sessions/events"));
  });

  app.get(`${prefix}/events`, { websocket: true }, (socket) => {
    bridgeSockets(socket, daemon.connectWebSocket("/events"));
  });

  app.all(`${prefix}/status`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/auth`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/auth/*`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions`, (request, reply) => proxy(request, reply));
  app.get(`${prefix}/sessions/:sessionId/tool-results/:toolCallId/images/:index`, async (request, reply) => {
    try {
      const upstream = await forward(reply, "GET", request.url);
      if (upstream === undefined) return undefined;
      if (upstream.statusCode !== 200) {
        reply.code(upstream.statusCode);
        return upstream.body !== "" ? parseJson(upstream.body) : undefined;
      }
      const image = toolResultImageBlock(parseJson(upstream.body));
      if (image === undefined) {
        reply.code(502);
        return { error: "Session daemon answered with an unreadable image block" };
      }
      return await reply.header("cache-control", "private, max-age=31536000, immutable").header("x-content-type-options", "nosniff").type(servableImageType(image.mimeType)).send(Buffer.from(image.data, "base64"));
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });
  app.all(`${prefix}/sessions/*`, (request, reply) => proxy(request, reply));
}

function deletedSessionIds(answer: unknown): string[] {
  const ids: unknown = typeof answer === "object" && answer !== null ? Reflect.get(answer, "deletedSessionIds") : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id !== "") : [];
}

function stripPrefix(url: string, prefix: string): string {
  const path = url.split("?", 1)[0] ?? url;
  const query = url.slice(path.length);
  const stripped = path.startsWith(prefix) ? `${path.slice(prefix.length)}${query}` : url;
  return stripped === "" ? "/" : stripped;
}

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function requestFailed(reply: FastifyReply, error: unknown): void {
  reply.code(502).send({ error: `Session daemon unavailable: ${error instanceof Error ? error.message : String(error)}` });
}

function bridgeSockets(client: WebSocket, upstream: WebSocket): void {
  client.on("message", (data) => { sendIfOpen(upstream, data); });
  upstream.on("message", (data) => { sendIfOpen(client, data); });
  client.on("close", () => { upstream.close(); });
  upstream.on("close", () => { client.close(); });
  upstream.on("error", () => { client.close(); });
  client.on("error", () => { upstream.close(); });
}

function sendIfOpen(socket: WebSocket, data: RawData): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
}

function toolResultImageBlock(value: unknown): { mimeType: string; data: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const mimeType: unknown = Reflect.get(value, "mimeType");
  const data: unknown = Reflect.get(value, "data");
  return typeof mimeType === "string" && mimeType !== "" && typeof data === "string" ? { mimeType, data } : undefined;
}

/** Tool-controlled session data never dictates an active content type on the app origin. */
function servableImageType(mimeType: string): string {
  return /^image\/[a-z0-9.+-]+$/iu.test(mimeType) && !/svg/iu.test(mimeType) ? mimeType : "application/octet-stream";
}

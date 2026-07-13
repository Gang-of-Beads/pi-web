import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MessagePage, SessionBulkArchiveResponse, SessionBulkDeleteArchivedResponse, SessionBulkMutationRef, SessionCleanupExecuteResponse, SessionCleanupPreviewResponse } from "../../shared/apiTypes.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { PiSessionService, type PiSessionManagerGateway, type PiSessionRef } from "./piSessionService.js";
import { registerSessionRoutes } from "./sessionRoutes.js";
import type { NormalizedSessionCleanupRequest } from "./sessionCleanup.js";

let app: FastifyInstance;
let service: PiSessionService;
let sessionManager: RejectingSessionManager;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  sessionManager = new RejectingSessionManager();
  const eventHub = new SessionEventHub();
  service = new PiSessionService(eventHub, { sessionManager, heartbeatIntervalMs: 60_000 });
  registerSessionRoutes(app, service, eventHub);
});

afterEach(async () => {
  await service.dispose();
  await app.close();
});

describe("session routes", () => {
  it("rejects prompt payloads that omit text without opening a session", async () => {
    const response = await app.inject({ method: "POST", url: "/sessions/session-1/prompt", payload: { body: "Build the thing" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Prompt text is required" });
    expect(sessionManager.calls).toEqual({ create: 0, list: 0, listAll: 0, open: 0 });
  });

  it("keeps legacy per-session routes usable without cwd", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const statusResponse = await routeApp.inject({ method: "GET", url: "/sessions/session-1/status" });
      const promptResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/prompt", payload: { text: "hello" } });

      expect(statusResponse.statusCode).toBe(200);
      expect(promptResponse.statusCode).toBe(200);
      expect(routeService.calls).toEqual(["session-1", { lookup: "session-1", text: "hello" }]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("omits thinking signatures from browser history without mutating service messages", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    const thinkingBlock = { type: "thinking", thinking: "private chain", thinkingSignature: "opaque-provider-payload", redacted: true };
    const message = { role: "assistant", content: [thinkingBlock, { type: "text", text: "visible answer" }] };
    routeService.messagesResponse = { messages: [message], start: 0, total: 1 };
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const response = await routeApp.inject({ method: "GET", url: "/sessions/session-1/messages?limit=20" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "private chain", redacted: true }, { type: "text", text: "visible answer" }] }],
        start: 0,
        total: 1,
      });
      expect(thinkingBlock.thinkingSignature).toBe("opaque-provider-payload");
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("forwards prompt attachments and supports the save-attachments route", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    const attachments = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    try {
      const promptResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/prompt", payload: { text: "look", attachments } });
      expect(promptResponse.statusCode).toBe(200);
      expect(routeService.calls.at(-1)).toEqual({ lookup: "session-1", text: "look", attachments });

      const saveResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/attachments", payload: { attachments, folder: "uploads" } });
      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.json()).toEqual({ attachments: [{ path: "uploads/shot.png", mimeType: "image/png", size: 3 }] });
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("passes cwd when per-session routes include workspace context", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      // The route normalizes the request cwd, so the service sees the resolved
      // absolute path (drive-qualified on Windows).
      const requestCwd = resolve("/repo");
      const statusResponse = await routeApp.inject({ method: "GET", url: `/sessions/session-1/status?cwd=${encodeURIComponent(requestCwd)}` });
      const promptResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/prompt", payload: { cwd: requestCwd, text: "hello" } });

      expect(statusResponse.statusCode).toBe(200);
      expect(promptResponse.statusCode).toBe(200);
      expect(routeService.calls).toEqual([{ id: "session-1", cwd: requestCwd }, { lookup: { id: "session-1", cwd: requestCwd }, text: "hello" }]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("reloads a session through the reload route, forwarding workspace context", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const requestCwd = resolve("/repo");
      const reloadResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/reload", payload: { cwd: requestCwd } });

      expect(reloadResponse.statusCode).toBe(200);
      expect(reloadResponse.json()).toEqual({ reloaded: true });
      expect(routeService.reloadCalls).toEqual([{ id: "session-1", cwd: requestCwd }]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("maps reload failures to a mutation error status", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    routeService.reloadError = new Error("Stop current session activity before reloading");
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const reloadResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/reload", payload: {} });

      expect(reloadResponse.statusCode).toBe(400);
      expect(reloadResponse.json()).toEqual({ error: "Stop current session activity before reloading" });
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("normalizes cleanup requests for preview and execute routes", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const previewResponse = await routeApp.inject({ method: "POST", url: "/sessions/cleanup/preview", payload: { archiveIdleDays: 30, deleteArchivedDays: null, projectCwds: ["/repo-a", "/repo-a"] } });
      const executeResponse = await routeApp.inject({ method: "POST", url: "/sessions/cleanup", payload: { archiveIdleDays: null, deleteArchivedDays: 7, projectCwds: ["/repo-b"] } });

      expect(previewResponse.statusCode).toBe(200);
      expect(executeResponse.statusCode).toBe(200);
      expect(routeService.cleanupPreviewCalls).toEqual([{ thresholds: { archiveIdleDays: 30 }, projectCwds: ["/repo-a"] }]);
      expect(routeService.cleanupCalls).toEqual([{ thresholds: { deleteArchivedDays: 7 }, projectCwds: ["/repo-b"] }]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("rejects invalid cleanup thresholds before calling the service", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const response = await routeApp.inject({ method: "POST", url: "/sessions/cleanup", payload: { archiveIdleDays: -1 } });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "archiveIdleDays field must be a non-negative integer" });
      expect(routeService.cleanupCalls).toEqual([]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("routes bulk archive and delete requests with normalized session refs", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const requestCwd = resolve("/repo");
      const archiveResponse = await routeApp.inject({ method: "POST", url: "/sessions/bulk/archive", payload: { sessions: [{ id: "s1", cwd: requestCwd }, { id: "s2" }] } });
      const deleteResponse = await routeApp.inject({ method: "POST", url: "/sessions/bulk/delete-archived", payload: { sessions: [{ id: "s1", cwd: requestCwd }] } });

      expect(archiveResponse.statusCode).toBe(200);
      expect(archiveResponse.json()).toMatchObject({ archived: true, archivedSessionIds: ["s1", "s2"], failures: [] });
      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toMatchObject({ deleted: true, deletedSessionIds: ["s1"], failures: [] });
      expect(routeService.bulkArchiveCalls).toEqual([[{ id: "s1", cwd: requestCwd }, { id: "s2" }]]);
      expect(routeService.bulkDeleteCalls).toEqual([[{ id: "s1", cwd: requestCwd }]]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("rejects malformed bulk mutation bodies before calling the service", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const response = await routeApp.inject({ method: "POST", url: "/sessions/bulk/archive", payload: { sessions: [{ cwd: "/repo" }] } });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "id field must be a string" });
      expect(routeService.bulkArchiveCalls).toEqual([]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });
});

class CapturingRouteSessionService extends PiSessionService {
  readonly calls: unknown[] = [];
  readonly reloadCalls: (string | PiSessionRef)[] = [];
  messagesResponse: unknown[] | MessagePage = [];
  readonly cleanupPreviewCalls: NormalizedSessionCleanupRequest[] = [];
  readonly cleanupCalls: NormalizedSessionCleanupRequest[] = [];
  readonly bulkArchiveCalls: SessionBulkMutationRef[][] = [];
  readonly bulkDeleteCalls: SessionBulkMutationRef[][] = [];
  reloadError: Error | undefined;

  constructor(eventHub: SessionEventHub) {
    super(eventHub, { sessionManager: new RejectingSessionManager(), heartbeatIntervalMs: 60_000 });
  }

  override cleanupPreview(request: NormalizedSessionCleanupRequest): Promise<SessionCleanupPreviewResponse> {
    this.cleanupPreviewCalls.push(request);
    return Promise.resolve({ generatedAt: "2026-06-25T00:00:00.000Z", thresholds: request.thresholds, projects: [], totals: { archiveCount: 0, deleteCount: 0 } });
  }

  override cleanup(request: NormalizedSessionCleanupRequest): Promise<SessionCleanupExecuteResponse> {
    this.cleanupCalls.push(request);
    return Promise.resolve({ generatedAt: "2026-06-25T00:00:00.000Z", thresholds: request.thresholds, projects: [], totals: { archiveCount: 0, deleteCount: 0 }, archivedSessionIds: [], deletedSessionIds: [] });
  }

  override archiveMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkArchiveResponse> {
    this.bulkArchiveCalls.push([...refs]);
    return Promise.resolve({ archived: true, archivedSessionIds: refs.map((ref) => ref.id), failures: [], generatedAt: "2026-06-25T00:00:00.000Z" });
  }

  override deleteArchivedMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkDeleteArchivedResponse> {
    this.bulkDeleteCalls.push([...refs]);
    return Promise.resolve({ deleted: true, deletedSessionIds: refs.map((ref) => ref.id), failures: [], generatedAt: "2026-06-25T00:00:00.000Z" });
  }

  override reload(lookup: string | PiSessionRef): Promise<void> {
    this.reloadCalls.push(lookup);
    if (this.reloadError !== undefined) return Promise.reject(this.reloadError);
    return Promise.resolve();
  }

  override messages(): Promise<unknown[] | MessagePage> {
    return Promise.resolve(this.messagesResponse);
  }

  override status(lookup: string | PiSessionRef) {
    this.calls.push(lookup);
    return Promise.resolve({
      sessionId: sessionIdFromLookup(lookup),
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    });
  }

  override prompt(lookup: string | PiSessionRef, text: unknown, _streamingBehavior?: unknown, attachments?: unknown): Promise<void> {
    this.calls.push(attachments === undefined ? { lookup, text } : { lookup, text, attachments });
    return Promise.resolve();
  }

  override saveAttachments(_lookup: string | PiSessionRef, attachments: unknown, folder?: string) {
    const list = Array.isArray(attachments) ? attachments : [];
    return Promise.resolve(list.map((attachment: { mimeType: string; data: string; name?: string }) => ({
      path: `${folder ?? ".pi-web/attachments"}/${attachment.name ?? "file.png"}`,
      mimeType: attachment.mimeType,
      size: Buffer.from(attachment.data, "base64").byteLength,
    })));
  }
}

class RejectingSessionManager implements PiSessionManagerGateway {
  readonly calls = { create: 0, list: 0, listAll: 0, open: 0 };

  list() {
    this.calls.list += 1;
    return Promise.resolve([]);
  }

  create(): never {
    this.calls.create += 1;
    throw new Error("Session manager should not create sessions for invalid prompt payloads");
  }

  listAll() {
    this.calls.listAll += 1;
    return Promise.resolve([]);
  }

  open(): never {
    this.calls.open += 1;
    throw new Error("Session manager should not open sessions for invalid prompt payloads");
  }
}

function sessionIdFromLookup(lookup: string | PiSessionRef): string {
  return typeof lookup === "string" ? lookup : lookup.id;
}

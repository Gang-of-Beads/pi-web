import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { Project, Workspace, WorkspaceProviderResolution } from "../../shared/apiTypes.js";
import { daemonSessionListing, daemonSessionLocate, registerSessionBoardRoutes, type SessionBoardSources } from "./sessionBoardRoutes.js";

/**
 * The board is one read (P4 slice a; state-diagram D5, object model §4.4). The page used to make
 * 1 + P + W requests for a machine's board; the web process composes it from its own projects,
 * their workspaces and its daemon's listings, keeping every source that did not answer unknown.
 */

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

const project = (id: string): Project => ({ id, name: id, path: `/${id}`, createdAt: "now" });
const workspace = (projectId: string, path: string): Workspace => ({ id: path, projectId, path, label: path, isMain: true, effectiveConfig: {} });
const resolution = (projectId: string, workspaces: Workspace[]): WorkspaceProviderResolution => ({ status: "provider", projectId, workspaces, diagnostics: [] });

function boardApp(sources: SessionBoardSources, budgetMs?: number): FastifyInstance {
  const app = Fastify();
  apps.push(app);
  registerSessionBoardRoutes(app, sources, "/api", budgetMs);
  registerSessionBoardRoutes(app, sources, "/api/machines/local", budgetMs);
  return app;
}

describe("the session board route", () => {
  it("answers every project's workspaces and every workspace's sessions, keeping what did not answer unknown", async () => {
    const app = boardApp({
      projects: () => Promise.resolve([project("alpha"), project("beta")]),
      workspaces: (asked) => (asked.id === "alpha"
        ? Promise.resolve(resolution("alpha", [workspace("alpha", "/alpha"), workspace("alpha", "/alpha-wt"), workspace("alpha", "/alpha")]))
        : Promise.reject(new Error("provider down"))),
      sessions: (cwd) => (cwd === "/alpha" ? Promise.resolve([{ id: "a1", cwd }]) : Promise.reject(new Error("daemon unavailable"))),
    });

    const plain = await app.inject({ method: "GET", url: "/api/session-board" });
    const scoped = await app.inject({ method: "GET", url: "/api/machines/local/session-board" });

    const body: unknown = plain.json();
    expect({ status: plain.statusCode, body, scopedSame: scoped.body === plain.body }).toEqual({
      status: 200,
      body: {
        projects: [
          { projectId: "alpha", resolution: resolution("alpha", [workspace("alpha", "/alpha"), workspace("alpha", "/alpha-wt"), workspace("alpha", "/alpha")]) },
          { projectId: "beta", unknown: true },
        ],
        listings: [
          { cwd: "/alpha", sessions: [{ id: "a1", cwd: "/alpha" }] },
          { cwd: "/alpha-wt", unknown: true },
        ],
      },
      scopedSame: true,
    });
  });

  it("asks for every listing at once, so the daemon's scanner shares one pass over the store", async () => {
    let waiting = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const app = boardApp({
      projects: () => Promise.resolve([project("alpha")]),
      workspaces: () => Promise.resolve(resolution("alpha", ["/w1", "/w2", "/w3", "/w4", "/w5"].map((path) => workspace("alpha", path)))),
      sessions: (cwd) => new Promise((resolve) => {
        waiting += 1;
        peak = Math.max(peak, waiting);
        release.push(() => { resolve([{ id: cwd }]); });
        if (release.length === 5) for (const answer of release) answer();
      }),
    });

    const answer = await app.inject({ method: "GET", url: "/api/session-board" });

    expect({ status: answer.statusCode, peak }).toEqual({ status: 200, peak: 5 });
  });

  it("asks the daemon for a workspace's listing as the session proxy does, and gives up on it at the deadline", async () => {
    const asked: string[] = [];
    const listing = daemonSessionListing({
      request: (method, path, _body, options) => {
        asked.push(`${method} ${path}`);
        if (path.includes("slow")) return new Promise((_resolve, reject) => { options?.signal?.addEventListener("abort", () => { reject(new Error("aborted")); }); });
        if (path.includes("refused")) return Promise.resolve({ statusCode: 400, headers: {}, body: "{}" });
        return Promise.resolve({ statusCode: 200, headers: {}, body: JSON.stringify([{ id: "a1" }]) });
      },
    }, 20);

    const results = await Promise.allSettled([listing("/a b"), listing("/slow"), listing("/refused")]);

    expect({ asked, results: results.map((result) => (result.status === "fulfilled" ? result.value : "unknown")) }).toEqual({
      asked: ["GET /sessions?cwd=%2Fa%20b", "GET /sessions?cwd=%2Fslow", "GET /sessions?cwd=%2Frefused"],
      results: [[{ id: "a1" }], "unknown", "unknown"],
    });
  });

  it("answers by its budget, keeping a provider or a listing still unanswered unknown", async () => {
    const never = () => new Promise<never>(() => undefined);
    const app = boardApp({
      projects: () => Promise.resolve([project("alpha"), project("beta")]),
      workspaces: (asked) => (asked.id === "alpha" ? Promise.resolve(resolution("alpha", [workspace("alpha", "/alpha"), workspace("alpha", "/alpha-slow")])) : never()),
      sessions: (cwd) => (cwd === "/alpha" ? Promise.resolve([{ id: "a1" }]) : never()),
    }, 40);

    const answer = await app.inject({ method: "GET", url: "/api/session-board" });
    const body: unknown = answer.json();

    expect({ status: answer.statusCode, body }).toEqual({
      status: 200,
      body: {
        projects: [{ projectId: "alpha", resolution: resolution("alpha", [workspace("alpha", "/alpha"), workspace("alpha", "/alpha-slow")]) }, { projectId: "beta", unknown: true }],
        listings: [{ cwd: "/alpha", sessions: [{ id: "a1" }] }, { cwd: "/alpha-slow", unknown: true }],
      },
    });
  });

  it("locates each pinned session no listing holds, and says which are gone or unanswered (B49)", async () => {
    const located: string[] = [];
    const forgotten: string[] = [];
    const never = () => new Promise<never>(() => undefined);
    const app = boardApp({
      projects: () => Promise.resolve([project("alpha")]),
      workspaces: () => Promise.resolve(resolution("alpha", [workspace("alpha", "/alpha")])),
      sessions: () => Promise.resolve([{ id: "listed" }]),
      pinned: {
        ids: () => Promise.resolve(["listed", "closed-project", "deleted", "slow"]),
        locate: (sessionId) => {
          located.push(sessionId);
          if (sessionId === "closed-project") return Promise.resolve({ session: { id: "closed-project", cwd: "/closed" } });
          if (sessionId === "deleted") return Promise.resolve({ gone: true });
          return never();
        },
        forget: (sessionId) => {
          forgotten.push(sessionId);
          return Promise.resolve();
        },
      },
    }, 40);

    const answer = await app.inject({ method: "GET", url: "/api/session-board" });
    const body: unknown = answer.json();

    const pinned: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "pinned") : undefined;
    expect({ located, forgotten, pinned }).toEqual({
      located: ["closed-project", "deleted", "slow"],
      forgotten: ["deleted"],
      pinned: [
        { sessionId: "closed-project", session: { id: "closed-project", cwd: "/closed" } },
        { sessionId: "deleted", gone: true },
        { sessionId: "slow", unknown: true },
      ],
    });
  });

  it("answers no pinned entries when the pins cannot be read, rather than claiming there are none", async () => {
    const app = boardApp({
      projects: () => Promise.resolve([]),
      workspaces: () => Promise.reject(new Error("not asked")),
      sessions: () => Promise.reject(new Error("not asked")),
      pinned: { ids: () => Promise.reject(new Error("pin store unreadable")), locate: () => Promise.reject(new Error("not asked")), forget: () => Promise.reject(new Error("not asked")) },
    });

    const answer = await app.inject({ method: "GET", url: "/api/session-board" });
    const body: unknown = answer.json();

    expect({ status: answer.statusCode, body }).toEqual({ status: 200, body: { projects: [], listings: [] } });
  });

  it("locates a pinned session through the daemon, telling a deleted one from one that did not answer", async () => {
    const asked: string[] = [];
    const locate = daemonSessionLocate({
      request: (method, path) => {
        asked.push(`${method} ${path}`);
        if (path.startsWith("/sessions/found")) return Promise.resolve({ statusCode: 200, headers: {}, body: JSON.stringify({ id: "found" }) });
        if (path.startsWith("/sessions/deleted")) return Promise.resolve({ statusCode: 404, headers: {}, body: JSON.stringify({ error: "Session not found", code: "session-not-found" }) });
        return Promise.resolve({ statusCode: 404, headers: {}, body: JSON.stringify({ error: "Route not found" }) });
      },
    }, "/home/reader", 20);

    const results = await Promise.allSettled([locate("found"), locate("deleted"), locate("old-daemon")]);

    expect({ asked, results: results.map((result) => (result.status === "fulfilled" ? result.value : "unknown")) }).toEqual({
      asked: ["GET /sessions/found/locate?cwd=%2Fhome%2Freader", "GET /sessions/deleted/locate?cwd=%2Fhome%2Freader", "GET /sessions/old-daemon/locate?cwd=%2Fhome%2Freader"],
      results: [{ session: { id: "found" } }, { gone: true }, "unknown"],
    });
  });

  it("still answers a deleted pin as gone when unpinning it fails, and asks again at the next board", async () => {
    const forgetting: string[] = [];
    const app = boardApp({
      projects: () => Promise.resolve([]),
      workspaces: () => Promise.reject(new Error("not asked")),
      sessions: () => Promise.reject(new Error("not asked")),
      pinned: {
        ids: () => Promise.resolve(["deleted"]),
        locate: () => Promise.resolve({ gone: true }),
        forget: (sessionId) => {
          forgetting.push(sessionId);
          return Promise.reject(new Error("pin store not writable"));
        },
      },
    });

    const first = await app.inject({ method: "GET", url: "/api/session-board" });
    const second = await app.inject({ method: "GET", url: "/api/session-board" });

    const firstBody: unknown = first.json();
    const secondBody: unknown = second.json();
    expect({ first: firstBody, second: secondBody, forgetting }).toEqual({
      first: { projects: [], listings: [], pinned: [{ sessionId: "deleted", gone: true }] },
      second: { projects: [], listings: [], pinned: [{ sessionId: "deleted", gone: true }] },
      forgetting: ["deleted", "deleted"],
    });
  });

  it("is a miss of the whole board when the projects do not answer", async () => {
    const app = boardApp({
      projects: () => Promise.reject(new Error("project store unreadable")),
      workspaces: () => Promise.reject(new Error("not asked")),
      sessions: () => Promise.reject(new Error("not asked")),
    });

    const answer = await app.inject({ method: "GET", url: "/api/session-board" });

    const body: unknown = answer.json();
    expect({ status: answer.statusCode, body }).toEqual({ status: 500, body: { error: "project store unreadable" } });
  });
});

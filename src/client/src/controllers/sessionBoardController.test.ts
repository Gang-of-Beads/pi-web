import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, type Project, type SessionInfo, type Workspace } from "../api";
import { SessionBoardController } from "./sessionBoardController";

const alpha: Project = { id: "alpha", name: "alpha", path: "/alpha", createdAt: "now" };
const alphaMain: Workspace = { id: "w-alpha", projectId: "alpha", path: "/alpha", label: "alpha", isMain: true, effectiveConfig: {} };
const a1: SessionInfo = { id: "a1", cwd: "/alpha", path: "/alpha/a1.jsonl", created: "2026-09-01", modified: "2026-09-01", messageCount: 1, firstMessage: "a1" };

function fakeClock() {
  let now = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  return {
    clock: {
      now: () => now,
      setTimer: (run: () => void, delayMs: number) => {
        const timer = { at: now + delayMs, run, cancelled: false };
        timers.push(timer);
        return () => { timer.cancelled = true; };
      },
    },
    now: () => now,
    advance: (ms: number) => {
      now += ms;
      for (const timer of timers.filter((candidate) => !candidate.cancelled && candidate.at <= now)) { timer.cancelled = true; timer.run(); }
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * B48, found live on 8505: the board read the projects once, and a lost
 * answer left "No sessions yet." on a machine that has sessions. The board is
 * read again by itself until every source answered.
 */
describe("SessionBoardController", () => {
  it("reads a board the projects did not answer for again by itself, and lists it when they do", async () => {
    const time = fakeClock();
    let projectReads = 0;
    const boards = new SessionBoardController({
      sources: () => ({
        projects: () => { projectReads += 1; return projectReads === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve([alpha]); },
        workspaces: () => Promise.resolve([alphaMain]),
        sessions: () => Promise.resolve([a1]),
      }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("local");
    expect(boards.answer("local")).toBe("none");
    time.advance(1000);
    await flush();

    expect(boards.answer("local")).toBe("complete");
    expect(boards.board("local")?.sessions.map((session) => session.id)).toEqual(["a1"]);
    boards.dispose();
  });

  it("shows a partial board at once and completes it by itself", async () => {
    const time = fakeClock();
    let sessionReads = 0;
    const boards = new SessionBoardController({
      sources: () => ({
        projects: () => Promise.resolve([alpha]),
        workspaces: () => Promise.resolve([alphaMain, { ...alphaMain, id: "w-beta", path: "/beta" }]),
        sessions: (path) => {
          if (path === "/alpha") return Promise.resolve([a1]);
          sessionReads += 1;
          return sessionReads === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve([{ ...a1, id: "b1", cwd: "/beta" }]);
        },
      }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("local");
    expect({ answer: boards.answer("local"), ids: boards.board("local")?.sessions.map((session) => session.id) }).toEqual({ answer: "partial", ids: ["a1"] });
    time.advance(1000);
    await flush();

    expect(boards.answer("local")).toBe("complete");
    expect(boards.board("local")?.sessions.map((session) => session.id).sort()).toEqual(["a1", "b1"]);
    boards.dispose();
  });

  it("fills a partial board by asking only the source that did not answer", async () => {
    const time = fakeClock();
    const asked: string[] = [];
    let betaReads = 0;
    const boards = new SessionBoardController({
      sources: () => ({
        projects: () => { asked.push("projects"); return Promise.resolve([alpha]); },
        workspaces: () => { asked.push("workspaces"); return Promise.resolve([alphaMain, { ...alphaMain, id: "w-beta", path: "/beta" }]); },
        sessions: (path) => {
          asked.push(`sessions:${path}`);
          if (path === "/alpha") return Promise.resolve([a1]);
          betaReads += 1;
          return betaReads < 3 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve([{ ...a1, id: "b1", cwd: "/beta" }]);
        },
      }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("local");
    asked.length = 0;
    time.advance(1000);
    await flush();
    time.advance(2000);
    await flush();

    expect(asked).toEqual(["sessions:/beta", "sessions:/beta"]);
    expect(boards.answer("local")).toBe("complete");
    boards.dispose();
  });

  it("only fills the gaps of a partial board read moments ago when it is browsed again, and reads it whole once it is stale", async () => {
    const time = fakeClock();
    const asked: string[] = [];
    const boards = new SessionBoardController({
      sources: () => ({
        projects: () => { asked.push("projects"); return Promise.resolve([alpha]); },
        workspaces: () => Promise.resolve([alphaMain, { ...alphaMain, id: "w-beta", path: "/beta" }]),
        sessions: (path) => { asked.push(`sessions:${path}`); return path === "/beta" ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve([a1]); },
      }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("local");
    asked.length = 0;
    await boards.browse("local");
    await flush();
    expect(asked).toEqual(["sessions:/beta"]);

    asked.length = 0;
    time.advance(31_000);
    await flush();
    asked.length = 0;
    await boards.browse("local");
    expect(asked[0]).toBe("projects");
    boards.dispose();
  });

  it("reads the whole board again when the reader asks, even while it is partial", async () => {
    const time = fakeClock();
    const asked: string[] = [];
    const boards = new SessionBoardController({
      sources: () => ({
        projects: () => { asked.push("projects"); return Promise.resolve([alpha]); },
        workspaces: () => Promise.resolve([alphaMain, { ...alphaMain, id: "w-beta", path: "/beta" }]),
        sessions: (path) => path === "/beta" ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve([a1]),
      }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("local");
    await boards.browse("local", { force: true });

    expect(asked).toEqual(["projects", "projects"]);
    boards.dispose();
  });

  /** Found live on 8505: the board was asked for twice at boot, and the second read ran after the first, doubling a whole-store scan per workspace. */
  it("joins a read already in flight instead of reading again after it", async () => {
    const time = fakeClock();
    let reads = 0;
    let answer: (projects: Project[]) => void = () => undefined;
    const boards = new SessionBoardController({
      sources: () => ({ projects: () => { reads += 1; return new Promise<Project[]>((resolve) => { answer = resolve; }); }, workspaces: () => Promise.resolve([alphaMain]), sessions: () => Promise.resolve([a1]) }),
      clock: time.clock,
      now: time.now,
    });

    const first = boards.browse("local");
    const second = boards.browse("local");
    answer([alpha]);
    await Promise.all([first, second]);
    await flush();

    expect(reads).toBe(1);
    expect(boards.answer("local")).toBe("complete");
    boards.dispose();
  });

  it("stops reading a board once a source states a refusal, instead of asking it again forever", async () => {
    const time = fakeClock();
    let sessionReads = 0;
    const boards = new SessionBoardController({
      sources: () => ({
        projects: () => Promise.resolve([alpha]),
        workspaces: () => Promise.resolve([alphaMain]),
        sessions: () => { sessionReads += 1; return Promise.reject(new HttpError("Unauthorized", 401, "local")); },
      }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("local");
    time.advance(120_000);
    await flush();

    expect(sessionReads).toBe(1);
    boards.dispose();
  });

  it("keeps asking for a whole read when the one the reader asked for got no answer", async () => {
    const time = fakeClock();
    const asked: string[] = [];
    let projectReads = 0;
    let betaAnswers = false;
    const boards = new SessionBoardController({
      sources: () => ({
        projects: () => { projectReads += 1; asked.push("projects"); return projectReads === 2 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve([alpha]); },
        workspaces: () => Promise.resolve([alphaMain, { ...alphaMain, id: "w-beta", path: "/beta" }]),
        sessions: (path) => path === "/beta" && !betaAnswers ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve([a1]),
      }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("local");
    await boards.browse("local", { force: true });
    betaAnswers = true;
    time.advance(2000);
    await flush();

    expect(asked).toEqual(["projects", "projects", "projects"]);
    boards.dispose();
  });

  it("does not read a complete board again within its fresh window, unless forced", async () => {
    const time = fakeClock();
    let reads = 0;
    const boards = new SessionBoardController({
      sources: () => ({ projects: () => { reads += 1; return Promise.resolve([alpha]); }, workspaces: () => Promise.resolve([alphaMain]), sessions: () => Promise.resolve([a1]) }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("local");
    await boards.browse("local");
    time.advance(10_000);
    await boards.browse("local");
    await boards.browse("local", { force: true });
    time.advance(31_000);
    await boards.browse("local");

    expect(reads).toBe(3);
    boards.dispose();
  });

  it("stops reading a machine the reader no longer browses", async () => {
    const time = fakeClock();
    let remoteReads = 0;
    const boards = new SessionBoardController({
      sources: (machineId) => ({
        projects: () => {
          if (machineId === "remote") { remoteReads += 1; return Promise.reject(new TypeError("Failed to fetch")); }
          return Promise.resolve([]);
        },
        workspaces: () => Promise.resolve([]),
        sessions: () => Promise.resolve([]),
      }),
      clock: time.clock,
      now: time.now,
    });

    await boards.browse("remote");
    await boards.browse("local");
    time.advance(60_000);
    await flush();

    expect(remoteReads).toBe(1);
    boards.dispose();
  });
});

describe("SessionBoardController taking a machine's announcements", () => {
  it("keeps a rename announced while a read was on its way, over that read's older answer (I13)", async () => {
    const time = fakeClock();
    let answer: (sessions: SessionInfo[]) => void = () => undefined;
    let reads = 0;
    const boards = new SessionBoardController({
      sources: () => ({
        projects: () => Promise.resolve([alpha]),
        workspaces: () => Promise.resolve([alphaMain]),
        sessions: () => { reads += 1; return reads === 1 ? Promise.resolve([a1]) : new Promise<SessionInfo[]>((resolve) => { answer = resolve; }); },
      }),
      clock: time.clock,
      now: time.now,
    });
    await boards.browse("local");
    const reading = boards.browse("local", { force: true });
    await flush();
    boards.applyEvent("local", { type: "session.name", sessionId: "a1", name: "Renamed elsewhere" });
    const meanwhile = boards.board("local")?.sessions[0]?.name;
    answer([a1]);
    await reading;
    await flush();

    expect({ meanwhile, after: boards.board("local")?.sessions[0]?.name }).toEqual({ meanwhile: "Renamed elsewhere", after: "Renamed elsewhere" });
    boards.dispose();
  });
});

/**
 * P4 slice a: the board is one read of the machine's web process. A machine that predates the
 * route is read source by source, and is not asked for the board again on the same page.
 */
describe("SessionBoardController reading a machine's own API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function machineApi(boardAnswer: () => Response) {
    const asked: string[] = [];
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const path = url.pathname.replace(/^\/api\/machines\/[^/]+/u, "");
      asked.push(path);
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
      if (path === "/session-board") return Promise.resolve(boardAnswer());
      if (path === "/projects") return Promise.resolve(json([alpha]));
      if (path === "/projects/alpha/workspaces") return Promise.resolve(json({ status: "provider", projectId: "alpha", ownerPluginId: "git", workspaces: [alphaMain], diagnostics: [] }));
      if (path === "/sessions") return Promise.resolve(json([a1]));
      return Promise.resolve(new Response("{}", { status: 500 }));
    }));
    return asked;
  }

  it("reads the board with one request when the machine answers it", async () => {
    const asked = machineApi(() => new Response(JSON.stringify({
      projects: [{ projectId: "alpha", resolution: { status: "provider", projectId: "alpha", ownerPluginId: "git", workspaces: [alphaMain], diagnostics: [] } }],
      listings: [{ cwd: "/alpha", sessions: [a1] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const boards = new SessionBoardController({ now: () => 0 });

    await boards.browse("local");

    expect({ asked, ids: boards.board("local")?.sessions.map((entry) => entry.id), answer: boards.answer("local") }).toEqual({ asked: ["/session-board"], ids: ["a1"], answer: "complete" });
    boards.dispose();
  });

  it("reads a machine whose older web process answers the board's path with the app shell source by source", async () => {
    const asked = machineApi(() => new Response("<!doctype html><html><body></body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    const boards = new SessionBoardController({ now: () => 0 });

    await boards.browse("remote-a");

    expect({ asked, ids: boards.board("remote-a")?.sessions.map((entry) => entry.id), answer: boards.answer("remote-a") }).toEqual({
      asked: ["/session-board", "/projects", "/projects/alpha/workspaces", "/sessions"],
      ids: ["a1"],
      answer: "complete",
    });
    boards.dispose();
  });

  it("reads a machine without the route source by source, and does not ask it for the board again", async () => {
    const asked = machineApi(() => new Response(JSON.stringify({ error: "Route GET:/api/session-board not found" }), { status: 404, headers: { "content-type": "application/json" } }));
    let now = 0;
    const boards = new SessionBoardController({ now: () => now });

    await boards.browse("remote-a");
    now = 60_000;
    await boards.browse("remote-a", { force: true });

    expect({ asked, ids: boards.board("remote-a")?.sessions.map((entry) => entry.id) }).toEqual({
      asked: ["/session-board", "/projects", "/projects/alpha/workspaces", "/sessions", "/projects", "/projects/alpha/workspaces", "/sessions"],
      ids: ["a1"],
    });
    boards.dispose();
  });
});

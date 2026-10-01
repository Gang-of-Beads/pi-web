import { describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo, Workspace } from "../api";
import { HttpError } from "../api/http";
import { UnexpectedBoardAnswer, type SessionBoardAnswer } from "../api/parsers";
import { boardAnswer, boardRouteVerdict, completeSessionBoard, oneReadBoard, readSessionBoard, type SessionBoard } from "./sessionBoard";

const project = (id: string): Project => ({ id, name: id, path: `/${id}`, createdAt: "now" });
const workspace = (projectId: string, path: string): Workspace => ({ id: path, projectId, path, label: path, isMain: true, effectiveConfig: {} });
const session = (id: string, cwd: string, modified: string): SessionInfo => ({ id, cwd, path: `${cwd}/${id}.jsonl`, created: modified, modified, messageCount: 1, firstMessage: id });

const alpha = project("alpha");
const beta = project("beta");
const alphaMain = workspace("alpha", "/alpha");
const betaMain = workspace("beta", "/beta");
const lost = () => Promise.reject(new TypeError("Failed to fetch"));

/**
 * B48 and B8, P1 slice 5: the board is read from every project, workspace and
 * session listing of a machine. A source that did not answer is kept as
 * unknown rather than dropped - dropped, it read as "this workspace has no
 * sessions" - and the board says how much of it answered.
 */
describe("readSessionBoard", () => {
  it("lists every source's sessions, newest first, and is complete when every source answered", async () => {
    const board = await readSessionBoard({
      projects: () => Promise.resolve([alpha, beta]),
      workspaces: (projectId) => Promise.resolve(projectId === "alpha" ? [alphaMain] : [betaMain]),
      sessions: (path) => Promise.resolve(path === "/alpha" ? [session("a1", "/alpha", "2026-09-01")] : [session("b1", "/beta", "2026-09-02")]),
    });
    expect({ ids: board.sessions.map((entry) => entry.id), unknown: board.unknownSources, answer: boardAnswer(board) }).toEqual({ ids: ["b1", "a1"], unknown: [], answer: "complete" });
  });

  it("reads at most two listings of a machine at once, so the page keeps its connections (object model §4.5)", async () => {
    const paths = ["/w1", "/w2", "/w3", "/w4", "/w5", "/w6", "/w7"];
    let running = 0;
    let peak = 0;
    const board = await readSessionBoard({
      projects: () => Promise.resolve([alpha]),
      workspaces: () => Promise.resolve(paths.map((path) => workspace("alpha", path))),
      sessions: async (path) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running -= 1;
        return [session(path.slice(1), path, "2026-09-01")];
      },
    });

    expect({ listed: board.sessions.length, peak, answer: boardAnswer(board) }).toEqual({ listed: 7, peak: 2, answer: "complete" });
  });

  it("rejects the whole board when a listing states a refusal, even through the lanes", async () => {
    const reading = readSessionBoard({
      projects: () => Promise.resolve([alpha, beta]),
      workspaces: (projectId) => Promise.resolve(projectId === "alpha" ? [alphaMain] : [betaMain]),
      sessions: (path) => (path === "/beta" ? Promise.reject(new HttpError("Forbidden", 403, "local")) : Promise.resolve([session("a1", "/alpha", "2026-09-01")])),
    });

    await expect(reading).rejects.toBeInstanceOf(HttpError);
  });

  it("keeps a project whose workspaces did not answer as unknown, and still lists the others", async () => {
    const board = await readSessionBoard({
      projects: () => Promise.resolve([alpha, beta]),
      workspaces: (projectId) => projectId === "alpha" ? lost() : Promise.resolve([betaMain]),
      sessions: () => Promise.resolve([session("b1", "/beta", "2026-09-02")]),
    });
    expect({ ids: board.sessions.map((entry) => entry.id), unknown: board.unknownSources, answer: boardAnswer(board) }).toEqual({ ids: ["b1"], unknown: [{ kind: "project", projectId: "alpha" }], answer: "partial" });
  });

  it("keeps a workspace whose sessions did not answer as unknown", async () => {
    const board = await readSessionBoard({
      projects: () => Promise.resolve([alpha, beta]),
      workspaces: (projectId) => Promise.resolve(projectId === "alpha" ? [alphaMain] : [betaMain]),
      sessions: (path) => path === "/beta" ? lost() : Promise.resolve([session("a1", "/alpha", "2026-09-01")]),
    });
    expect({ ids: board.sessions.map((entry) => entry.id), unknown: board.unknownSources, workspaces: board.workspaces.map((entry) => entry.path) }).toEqual({ ids: ["a1"], unknown: [{ kind: "workspace", path: "/beta" }], workspaces: ["/alpha", "/beta"] });
  });

  it("is a miss, not an empty board, when the projects did not answer", async () => {
    await expect(readSessionBoard({ projects: lost, workspaces: () => Promise.resolve([]), sessions: () => Promise.resolve([]) })).rejects.toThrow("Failed to fetch");
  });

  it("is complete and empty for a machine with no projects", async () => {
    const board = await readSessionBoard({ projects: () => Promise.resolve([]), workspaces: () => Promise.resolve([]), sessions: () => Promise.resolve([]) });
    expect(boardAnswer(board)).toBe("complete");
  });
});

/**
 * On 8504 each sessions listing is a whole-store scan on the daemon, so a
 * partial board must not read every source again to fill one gap: only the
 * sources that did not answer are asked again.
 */
describe("completeSessionBoard", () => {
  const partial: SessionBoard = {
    sessions: [session("b1", "/beta", "2026-09-02")],
    workspaces: [betaMain],
    unknownSources: [{ kind: "project", projectId: "alpha" }, { kind: "workspace", path: "/gamma" }],
  };

  it("asks only the sources that did not answer, and keeps what the board already had", async () => {
    const asked: string[] = [];
    const board = await completeSessionBoard(partial, {
      projects: () => { asked.push("projects"); return Promise.resolve([alpha, beta]); },
      workspaces: (projectId) => { asked.push(`workspaces:${projectId}`); return Promise.resolve([alphaMain]); },
      sessions: (path) => { asked.push(`sessions:${path}`); return Promise.resolve(path === "/alpha" ? [session("a1", "/alpha", "2026-09-03")] : [session("g1", "/gamma", "2026-09-01")]); },
    });
    expect(asked.sort()).toEqual(["sessions:/alpha", "sessions:/gamma", "workspaces:alpha"]);
    expect({ ids: board.sessions.map((entry) => entry.id), workspaces: board.workspaces.map((entry) => entry.path), answer: boardAnswer(board) }).toEqual({ ids: ["a1", "b1", "g1"], workspaces: ["/beta", "/alpha"], answer: "complete" });
  });

  it("keeps a source that still does not answer unknown", async () => {
    const board = await completeSessionBoard(partial, {
      projects: () => Promise.resolve([]),
      workspaces: () => Promise.resolve([alphaMain]),
      sessions: (path) => path === "/gamma" ? lost() : Promise.resolve([]),
    });
    expect(board.unknownSources).toEqual([{ kind: "workspace", path: "/gamma" }]);
  });
});

/**
 * P4 slice a: the board is one read. A machine's web process answers every project's workspaces
 * and every workspace's sessions at once; a machine whose web process predates the route is read
 * source by source, as before.
 */
describe("the board in one read", () => {
  const unasked = () => Promise.reject(new Error("a source was asked although the board answered"));

  it("builds the board from the one answer, newest first, keeping its unknown sources, and asks no source", async () => {
    const answer: SessionBoardAnswer = {
      projects: [{ projectId: "alpha", workspaces: [alphaMain] }, { projectId: "beta", unknown: true }],
      listings: [{ cwd: "/alpha", sessions: [session("a1", "/alpha", "2026-09-01"), session("a2", "/alpha", "2026-09-03")] }, { cwd: "/alpha-wt", unknown: true }],
    };
    const board = await readSessionBoard({ board: () => Promise.resolve(answer), projects: unasked, workspaces: unasked, sessions: unasked });

    expect({ ids: board.sessions.map((entry) => entry.id), workspaces: board.workspaces.map((entry) => entry.path), unknown: board.unknownSources, answer: boardAnswer(board) }).toEqual({
      ids: ["a2", "a1"],
      workspaces: ["/alpha"],
      unknown: [{ kind: "project", projectId: "beta" }, { kind: "workspace", path: "/alpha-wt" }],
      answer: "partial",
    });
  });

  it("reads source by source when the machine cannot answer the board", async () => {
    const board = await readSessionBoard({
      board: () => Promise.resolve("unsupported"),
      projects: () => Promise.resolve([alpha]),
      workspaces: () => Promise.resolve([alphaMain]),
      sessions: () => Promise.resolve([session("a1", "/alpha", "2026-09-01")]),
    });

    expect({ ids: board.sessions.map((entry) => entry.id), answer: boardAnswer(board) }).toEqual({ ids: ["a1"], answer: "complete" });
  });

  it("is a miss, not a fallback, when the board read gets no answer", async () => {
    const reading = readSessionBoard({ board: lost, projects: unasked, workspaces: unasked, sessions: unasked });

    await expect(reading).rejects.toThrow("Failed to fetch");
  });

  it("tells a machine without the route from a read that failed", () => {
    const verdicts = [
      new HttpError("Route GET:/api/session-board not found", 404, "remote-a"),
      new SyntaxError("Unexpected token '<'"),
      new UnexpectedBoardAnswer(),
      new HttpError("Bad gateway", 502, "remote-a", "gateway"),
      new HttpError("Forbidden", 403, "local"),
      new HttpError("Internal error", 500, "local"),
      new TypeError("Failed to fetch"),
    ].map(boardRouteVerdict);

    expect(verdicts).toEqual(["unsupported", "unsupported", "unsupported", "error", "error", "error", "error"]);
  });

  it("stops asking a machine for the board once it showed it has no such route, and keeps asking after a failed read", async () => {
    const missing = vi.fn(() => Promise.reject(new HttpError("Route GET:/api/session-board not found", 404, "remote-a")));
    const readMissing = oneReadBoard(missing);
    const first = await readMissing();
    const second = await readMissing();
    const failing = vi.fn(() => Promise.reject(new HttpError("Bad gateway", 502, "remote-a", "gateway")));
    const readFailing = oneReadBoard(failing);
    await expect(readFailing()).rejects.toThrow("Bad gateway");
    await expect(readFailing()).rejects.toThrow("Bad gateway");

    expect({ first, second, missingAsked: missing.mock.calls.length, failingAsked: failing.mock.calls.length }).toEqual({ first: "unsupported", second: "unsupported", missingAsked: 1, failingAsked: 2 });
  });
});

describe("boardAnswer", () => {
  it("is none before any answer, partial with unknown sources, and complete otherwise", () => {
    const partial: SessionBoard = { sessions: [], workspaces: [], unknownSources: [{ kind: "project", projectId: "alpha" }] };
    const complete: SessionBoard = { sessions: [], workspaces: [], unknownSources: [] };
    expect([boardAnswer(undefined), boardAnswer(partial), boardAnswer(complete)]).toEqual(["none", "partial", "complete"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Project, SessionInfo, Workspace } from "../api";
import { HttpError } from "../api/http";
import { boardAnswer, completeSessionBoard, readSessionBoard, type SessionBoard } from "./sessionBoard";

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

describe("boardAnswer", () => {
  it("is none before any answer, partial with unknown sources, and complete otherwise", () => {
    const partial: SessionBoard = { sessions: [], workspaces: [], unknownSources: [{ kind: "project", projectId: "alpha" }] };
    const complete: SessionBoard = { sessions: [], workspaces: [], unknownSources: [] };
    expect([boardAnswer(undefined), boardAnswer(partial), boardAnswer(complete)]).toEqual(["none", "partial", "complete"]);
  });
});

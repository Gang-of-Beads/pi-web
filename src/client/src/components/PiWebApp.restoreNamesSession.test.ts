// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebApp, restoreOpenedUnnamedSession } from "./PiWebApp";
import type { Machine, Project, SessionInfo } from "../api";

/**
 * D8: a workspace link on the desktop opened the latest session while the URL kept naming only the
 * workspace, so the URL did not describe the chat on screen and a reload after a newer session
 * appeared opened a different one.
 */
describe("whether a restore names the session it opened", () => {
  const link = { projectId: "p1", workspaceId: "w1" };

  it("names one the route did not name while the URL still holds that route, and leaves the rest", () => {
    const cases: [string, Record<string, string>, Record<string, string>, string | undefined, boolean][] = [
      ["a workspace link that opened the latest session", link, link, "latest", true],
      ["a workspace link with an empty session parameter", { ...link, sessionId: "" }, link, "latest", true],
      ["the same link on the local machine, named or not", { ...link, machineId: "local" }, link, "latest", true],
      ["a link that named the session it opened", { ...link, sessionId: "named" }, { ...link, sessionId: "named" }, "named", false],
      ["a route that named its session while the URL holds only the workspace", { ...link, sessionId: "named" }, link, "named", false],
      ["a workspace link that opened nothing", link, link, undefined, false],
      ["a workspace link that opened nothing, by an empty id", link, link, "", false],
      ["a machine switch: the URL still holds the previous machine's place", { ...link, machineId: "remote" }, { projectId: "p0", workspaceId: "w0", sessionId: "s0" }, "latest", false],
      ["a terminal run in another workspace: the URL still holds the reader's chat", { projectId: "p1", workspaceId: "w2" }, { ...link, sessionId: "s1" }, "latest", false],
      ["a restore the reader has already moved past: the URL names another workspace", link, { projectId: "p1", workspaceId: "w2" }, "latest", false],
      ["the same place on another machine: the URL still holds this machine's", { ...link, machineId: "remote" }, link, "latest", false],
      ["a terminal run in the reader's own workspace: the URL names the reader's chat", link, { ...link, sessionId: "s1" }, "latest", false],
    ];

    expect(cases.map(([name, restored, inUrl, shown]) => [name, restoreOpenedUnnamedSession(restored, inUrl, shown)])).toEqual(cases.map(([name, , , , names]) => [name, names]));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const local: Machine = { id: "local", name: "local", baseUrl: "", kind: "local", createdAt: "", updatedAt: "" };
const project: Project = { id: "p1", name: "p1", path: "/w", createdAt: "" };

function sessionNamed(id: string): SessionInfo {
  const now = new Date().toISOString();
  return { id, path: `/w/${id}.jsonl`, name: id, cwd: "/w", created: now, modified: now, messageCount: 3, firstMessage: "hi" };
}

function replace(target: object, name: string, value: unknown): void {
  if (!Reflect.set(target, name, value)) throw new Error(`could not replace ${name}`);
}

function call(target: object, name: string, ...args: unknown[]): unknown {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== "function") throw new Error(`${name} was unavailable`);
  return Reflect.apply(value, target, args);
}

function member(target: object, name: string): object {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== "object" || value === null) throw new Error(`${name} was unavailable`);
  return value;
}

/** A desktop restore of the workspace link p1/w1 whose pick opens "latest", with the URL holding `urlSearch`. */
function restoringTheWorkspaceLink(urlSearch: string) {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
  window.history.replaceState(null, "", `/${urlSearch}`);
  const app = new PiWebApp();
  call(app, "setState", { machines: [local], selectedMachine: local, projects: [project], mainView: "chat" });
  const writes: unknown[] = [];
  replace(app, "updateUrl", (options: unknown) => { writes.push(options ?? {}); });
  replace(app, "restoreRouteMachine", () => Promise.resolve());
  replace(app, "loadPluginsForSelectedMachine", () => Promise.resolve());
  const toolRefreshed: { release?: () => void } = {};
  replace(app, "refreshRestoredWorkspaceTool", () => new Promise<void>((resolve) => { toolRefreshed.release = resolve; }));
  replace(member(app, "workspaces"), "selectProject", () => {
    call(app, "setState", { selectedProject: project, selectedSession: sessionNamed("latest") });
    return Promise.resolve(true);
  });
  const restoring = call(app, "restoreRouteFor", { machineId: undefined, projectId: "p1", workspaceId: "w1", sessionId: undefined, tool: undefined, view: undefined });
  const finish = async (): Promise<void> => {
    for (let i = 0; i < 20 && toolRefreshed.release === undefined; i += 1) await Promise.resolve();
    if (toolRefreshed.release === undefined) throw new Error("the restore never reached the tool refresh");
    toolRefreshed.release();
    await restoring;
  };
  return { app, writes, finish };
}

/** Review ca45d6ed: a placement corrects only an entry that names its session, so the session layer reads the address. */
describe("the address the session layer reads", () => {
  it("is the session the URL names, read when asked", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    window.history.replaceState(null, "", "/?project=p1&workspace=w1&session=named");
    const app = new PiWebApp();
    const read: unknown = Reflect.get(member(app, "sessions"), "urlSessionId");
    if (typeof read !== "function") throw new Error("the session layer was given no address");
    const first: unknown = Reflect.apply(read, undefined, []);
    window.history.replaceState(null, "", "/?project=p1&workspace=w1");
    const after: unknown = Reflect.apply(read, undefined, []);

    expect({ first, after }).toEqual({ first: "named", after: undefined });
  });
});

describe("a restore that opened a session its route did not name", () => {
  it("names it by replacing the entry that holds the link", async () => {
    const { writes, finish } = restoringTheWorkspaceLink("?project=p1&workspace=w1");
    await finish();

    expect(writes).toEqual([{ replace: true }]);
  });

  it("leaves the URL to its caller when the URL still holds the reader's previous place", async () => {
    const { writes, finish } = restoringTheWorkspaceLink("?project=p1&workspace=w0&session=s0");
    await finish();

    expect(writes).toEqual([]);
  });

  it("writes nothing once the reader has chosen something else while it finished", async () => {
    const { app, writes, finish } = restoringTheWorkspaceLink("?project=p1&workspace=w1");
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    call(app, "selectMainView", "navigation");
    writes.length = 0;
    await finish();

    expect(writes).toEqual([]);
  });
});

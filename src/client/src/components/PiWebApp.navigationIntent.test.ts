import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebApp } from "./PiWebApp";
import type { Machine, SessionInfo } from "../api";
import { HttpError } from "../api/http";

/**
 * D8 in docs/design/state-diagram.md, B29. Owner, 2026-09-30: "I tapped a page, but it hadn't
 * loaded. pi web hurried to switch pages; it switched but the content hadn't refreshed, I kept operating
 * on it, and later the content refreshed and pi web changed the page in place". The page moved before its content existed, and moved again later over
 * whatever the reader had gone on to do. The owner chose: stay in place, make the tap visible.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const local: Machine = { id: "local", name: "local", baseUrl: "", kind: "local", createdAt: "", updatedAt: "" };
const remote: Machine = { id: "remote-b", name: "remote-b", baseUrl: "https://remote-b.example.test", kind: "remote", createdAt: "", updatedAt: "" };

function sessionNamed(id: string): SessionInfo {
  const now = new Date().toISOString();
  return { id, path: `/w/${id}.jsonl`, name: id, cwd: "/w", created: now, modified: now, messageCount: 3, firstMessage: "hi" };
}

function createApp(search = ""): PiWebApp {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", { location: { search, href: `https://pi.example.test/${search}` }, localStorage: storage, setTimeout: () => 0, clearTimeout: () => undefined, history: { pushState: () => undefined, replaceState: () => undefined, state: null } });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  const app = new PiWebApp();
  replace(app, "updateUrl", () => undefined);
  replace(app, "ensureGatewayPluginsLoaded", () => Promise.resolve());
  replace(app, "loadPluginsForMachine", () => Promise.resolve());
  return app;
}

function replace(target: object, name: string, value: unknown): void {
  if (!Reflect.set(target, name, value)) throw new Error(`could not replace ${name}`);
}

function member(target: object, name: string): object {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== "object" || value === null) throw new Error(`${name} was unavailable`);
  return value;
}

function call(target: object, name: string, ...args: unknown[]): unknown {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== "function") throw new Error(`${name} was unavailable`);
  return Reflect.apply(value, target, args);
}

function state(app: PiWebApp): { selectedSessionId: string | undefined; mainView: string } {
  const value: unknown = Reflect.get(app, "state");
  if (typeof value !== "object" || value === null) throw new Error("state was unavailable");
  const selected: unknown = Reflect.get(value, "selectedSession");
  const id: unknown = typeof selected === "object" && selected !== null ? Reflect.get(selected, "id") : undefined;
  return { selectedSessionId: typeof id === "string" ? id : undefined, mainView: String(Reflect.get(value, "mainView")) };
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  const handles: { resolve?: () => void; reject?: (error: Error) => void } = {};
  const promise = new Promise<void>((settle, fail) => { handles.resolve = settle; handles.reject = fail; });
  return { promise, resolve: () => { handles.resolve?.(); }, reject: (error) => { handles.reject?.(error); } };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** A reader on the Sessions page with session "previous" open behind it, and a stubbed session layer. */
function readerOnTheSessionsPage(options: { cached: boolean; read: Promise<void> }) {
  const app = createApp();
  const previous = sessionNamed("previous");
  call(app, "setState", { machines: [local, remote], selectedMachine: local, selectedSession: previous, mainView: "navigation" });
  const selected: string[] = [];
  const reads: string[] = [];
  const moves: string[] = [];
  const sessions = member(app, "sessions");
  replace(sessions, "canOpenAtOnce", () => options.cached);
  replace(sessions, "readFirstPage", (session: SessionInfo, machineId: string) => { reads.push(`${machineId}:${session.id}`); return options.read; });
  replace(member(app, "machines"), "selectMachine", (machine: Machine) => { moves.push(machine.id); call(app, "setState", { selectedMachine: machine }); return Promise.resolve(); });
  replace(app, "loadQuickSwitcherData", () => Promise.resolve());
  replace(sessions, "selectSession", (session: SessionInfo) => {
    selected.push(session.id);
    call(app, "setState", { selectedSession: session });
    return Promise.resolve();
  });
  replace(app, "focusComposerAfterRender", () => Promise.resolve());
  replace(app, "quickSwitcherBrowseMachineId", "local");
  return { app, previous, selected, reads, moves };
}

describe("opening a session the reader tapped", () => {
  it("stays where the reader is until the session can be shown", async () => {
    const read = deferred();
    const { app, previous, selected } = readerOnTheSessionsPage({ cached: false, read: read.promise });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();

    expect({ selected, session: state(app).selectedSessionId, view: state(app).mainView }).toEqual({ selected: [], session: previous.id, view: "navigation" });
  });

  it("never takes the page once the reader has gone somewhere else", async () => {
    const read = deferred();
    const { app, previous, selected } = readerOnTheSessionsPage({ cached: false, read: read.promise });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();
    call(app, "selectMainView", "chat");
    read.resolve();
    await flush();

    expect({ selected, session: state(app).selectedSessionId, view: state(app).mainView }).toEqual({ selected: [], session: previous.id, view: "chat" });
  });

  it("switches the list, the header and the conversation together once it can", async () => {
    const read = deferred();
    const { app, selected } = readerOnTheSessionsPage({ cached: false, read: read.promise });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();
    read.resolve();
    await flush();

    expect({ selected, session: state(app).selectedSessionId, view: state(app).mainView }).toEqual({ selected: ["target"], session: "target", view: "chat" });
  });

  it("opens a session it can already show in the same moment as the tap", async () => {
    const { app, selected } = readerOnTheSessionsPage({ cached: true, read: new Promise<void>(() => undefined) });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();

    expect({ selected, view: state(app).mainView }).toEqual({ selected: ["target"], view: "chat" });
  });

  it("stays, and lets the tapped row say it could not open, when the read fails", async () => {
    const read = deferred();
    const { app, previous, selected } = readerOnTheSessionsPage({ cached: false, read: read.promise });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();
    read.reject(new Error("offline"));
    await flush();

    expect({ selected, session: state(app).selectedSessionId, view: state(app).mainView }).toEqual({ selected: [], session: previous.id, view: "navigation" });
    expect(call(member(app, "navigation"), "view")).toEqual({ key: "local:target", label: "target", phase: "failed" });
  });

  /** P2 slice b part 2 (G3): the session layer turns the code into the gone words; the tap does not fail. */
  it("goes on to the session, which says it is gone, when the read answers that the session no longer exists", async () => {
    const read = deferred();
    const { app, selected } = readerOnTheSessionsPage({ cached: false, read: read.promise });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();
    read.reject(new HttpError("Session not found", 404, "local", undefined, "session-not-found"));
    await flush();

    expect({ selected, view: state(app).mainView, pending: call(member(app, "navigation"), "view") }).toEqual({ selected: ["target"], view: "chat", pending: undefined });
  });
});

/**
 * D8, one intent adds at most one history entry. Seen 2026-10-03 at load 11 (probe-board-url): a tap
 * pushed the chat view before the selection and the selection pushed the session once its read
 * settled, so Back from the chat landed on "chat, no session".
 */
describe("the history entry a tap adds", () => {
  function recordingWrites(app: PiWebApp) {
    const writes: { machine: unknown; session: string | undefined; view: string; replace: boolean; newEntry: boolean }[] = [];
    replace(app, "updateUrl", (options?: { replace?: boolean; forcePush?: boolean }) => {
      const appState = member(app, "state");
      const machine: unknown = Reflect.get(appState, "selectedMachine");
      writes.push({ machine: typeof machine === "object" && machine !== null ? Reflect.get(machine, "id") : undefined, session: state(app).selectedSessionId, view: state(app).mainView, replace: options?.replace === true, newEntry: options?.forcePush === true });
    });
    const selectOptions: unknown[] = [];
    const machineOptions: unknown[] = [];
    const sessions = member(app, "sessions");
    replace(sessions, "selectSession", (session: SessionInfo, options?: unknown) => {
      selectOptions.push(options);
      call(app, "setState", { selectedSession: session });
      return Promise.resolve();
    });
    replace(member(app, "machines"), "selectMachine", (machine: Machine, options?: unknown) => {
      machineOptions.push(options);
      call(app, "setState", { selectedMachine: machine });
      return Promise.resolve();
    });
    return { writes, selectOptions, machineOptions };
  }

  it("is one entry naming the session in the chat it opened, written by the tap and not by its steps", async () => {
    const read = deferred();
    const { app } = readerOnTheSessionsPage({ cached: false, read: read.promise });
    const { writes, selectOptions } = recordingWrites(app);

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();
    read.resolve();
    await flush();

    expect({ writes, selectOptions }).toEqual({ writes: [{ machine: "local", session: "target", view: "chat", replace: false, newEntry: true }], selectOptions: [{ updateUrl: false }] });
  });

  it("is still one entry when the tap moves to the machine the row was read from", async () => {
    const read = deferred();
    const { app } = readerOnTheSessionsPage({ cached: false, read: read.promise });
    const { writes, machineOptions } = recordingWrites(app);

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"), "remote-b");
    await flush();
    read.resolve();
    await flush();

    expect({ writes, machineOptions }).toEqual({ writes: [{ machine: "remote-b", session: "target", view: "chat", replace: false, newEntry: true }], machineOptions: [{ updateUrl: false }] });
  });

  it("names the machine it moved to when the reader moves on while it was moving", async () => {
    const read = deferred();
    const { app } = readerOnTheSessionsPage({ cached: false, read: read.promise });
    const { writes } = recordingWrites(app);
    replace(member(app, "machines"), "selectMachine", (machine: Machine) => {
      call(app, "setState", { selectedMachine: machine });
      call(member(app, "navigation"), "begin");
      return Promise.resolve();
    });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"), "remote-b");
    await flush();
    read.resolve();
    await flush();

    expect(writes).toEqual([{ machine: "remote-b", session: undefined, view: "navigation", replace: false, newEntry: false }]);
  });

  it("writes once after the workspace pick, whether or not the pick wrote, naming the machine it moved to", async () => {
    const app = createApp();
    const project = { id: "p", name: "p", path: "/p", createdAt: "" };
    call(app, "setState", { machines: [local, remote], selectedMachine: local, projects: [project], mainView: "navigation" });
    replace(app, "quickSwitcherBrowseMachineId", "remote-b");
    const { writes, machineOptions } = recordingWrites(app);
    const picked: string[] = [];
    replace(member(app, "workspaces"), "selectProject", (chosen: { id: string }) => { picked.push(chosen.id); return Promise.resolve(true); });

    await call(app, "openWorkspaceFromQuickSwitcher", { id: "w", projectId: "p", path: "/p", label: "w", isMain: true, effectiveConfig: {} });

    expect({ machineOptions, picked, writes }).toEqual({ machineOptions: [{ updateUrl: false }], picked: ["p"], writes: [{ machine: "remote-b", session: undefined, view: "navigation", replace: false, newEntry: false }] });
  });

  it("names the machine it moved to when the workspace's project cannot be found there", async () => {
    const app = createApp();
    call(app, "setState", { machines: [local, remote], selectedMachine: local, projects: [], mainView: "navigation" });
    replace(app, "quickSwitcherBrowseMachineId", "remote-b");
    const { writes } = recordingWrites(app);
    replace(app, "locateRouteProject", () => Promise.resolve(undefined));

    await call(app, "openWorkspaceFromQuickSwitcher", { id: "w", projectId: "p", path: "/p", label: "w", isMain: true, effectiveConfig: {} });

    expect(writes).toEqual([{ machine: "remote-b", session: undefined, view: "navigation", replace: false, newEntry: false }]);
  });
});

/** A machine switch restores the view remembered for that machine, after the machine answers. */
/** Review run c336e7e7: the paths the first version left able to move the page late. */
describe("what supersedes an open still loading", () => {
  it.each<[string, (app: PiWebApp) => unknown]>([
    ["browsing another machine's tab", (app) => call(app, "browseQuickSwitcherMachine", "remote-b")],
    ["starting a new session from the desktop list, the chat already showing", (app) => { call(app, "setState", { mainView: "chat" }); replace(member(app, "sessions"), "startSession", () => Promise.resolve()); return call(app, "startSessionAndOpenChat"); }],
    ["choosing a project", (app) => { call(app, "setState", { projects: [{ id: "p", name: "p", path: "/p" }] }); replace(member(app, "workspaces"), "selectProject", () => Promise.resolve()); return call(app, "navigateChoose", "project", "p"); }],
  ])("%s", async (_name, act) => {
    const read = deferred();
    const { app, selected } = readerOnTheSessionsPage({ cached: false, read: read.promise });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();
    await act(app);
    read.resolve();
    await flush();

    expect(selected).toEqual([]);
  });

  it("reads the tapped row once however often it is tapped while opening", async () => {
    const read = deferred();
    const { app, reads } = readerOnTheSessionsPage({ cached: false, read: read.promise });

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();

    expect(reads).toEqual(["local:target"]);
  });

  it("opens on the machine the row was read from, whatever tab is showing when it lands", async () => {
    const read = deferred();
    const { app, reads, moves, selected } = readerOnTheSessionsPage({ cached: false, read: read.promise });
    replace(app, "quickSwitcherBrowseMachineId", "local");

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"), "remote-b");
    await flush();
    read.resolve();
    await flush();

    expect({ reads, moves, selected }).toEqual({ reads: ["remote-b:target"], moves: ["remote-b"], selected: ["target"] });
  });

  it("keeps the switcher open while the session loads and closes it with the commit", async () => {
    const read = deferred();
    const { app } = readerOnTheSessionsPage({ cached: false, read: read.promise });
    replace(app, "quickSwitcherOpen", true);

    void call(app, "openSessionFromQuickSwitcher", sessionNamed("target"));
    await flush();
    const whileLoading: unknown = Reflect.get(app, "quickSwitcherOpen");
    read.resolve();
    await flush();

    const after: unknown = Reflect.get(app, "quickSwitcherOpen");
    expect({ whileLoading, after }).toEqual({ whileLoading: true, after: false });
  });
});

describe("a terminal a run asked for", () => {
  it("does not open once the reader has moved on while its workspace was being restored", async () => {
    const app = createApp();
    call(app, "setState", { machines: [local, remote], selectedMachine: local, mainView: "chat" });
    const restored = deferred();
    replace(app, "restoreRouteFor", async () => { await restored.promise; call(app, "setState", { selectedMachine: remote }); });
    const opened: unknown[] = [];
    replace(app, "openTerminal", (options: unknown) => { opened.push(options); });

    const opening = call(app, "openRuntimeTerminal", "remote-b", undefined, { terminalId: "t1" });
    call(app, "selectMainView", "chat");
    restored.resolve();
    await opening;

    expect(opened).toEqual([]);
  });
});

describe("a boot restore deferred while a remote machine is unreachable", () => {
  it("keeps the intent it began with, so a tap made while it waited retires the retry", async () => {
    const app = createApp("?machine=remote-b");
    call(app, "setState", { machines: [local, remote], selectedMachine: local, mainView: "chat" });
    const listed = deferred();
    let wantedAfterTap: boolean | undefined;
    replace(member(app, "machines"), "loadMachines", () => { call(app, "setState", { machinesLoad: "loading" }); return Promise.resolve(); });
    replace(member(app, "machines"), "rosterAnswered", async (wanted: () => boolean) => { await listed.promise; wantedAfterTap = wanted(); return wantedAfterTap; });
    let restored = 0;
    replace(app, "restoreBootRoute", () => { restored += 1; return Promise.resolve(); });

    const booting = call(app, "loadProjectsAndRestoreRoute");
    await Promise.resolve();
    call(app, "selectMainView", "chat");
    listed.resolve();
    await booting;

    expect(wantedAfterTap).toBe(false);
    expect(restored).toBe(0);
  });
});

describe("a route restore the reader has overtaken", () => {
  it("moves nothing once the reader has chosen a view", async () => {
    const app = createApp();
    call(app, "setState", { machines: [local], selectedMachine: local, mainView: "chat", selectedSession: sessionNamed("reading") });
    const machineRestored = deferred();
    replace(app, "restoreRouteMachine", () => machineRestored.promise);
    replace(app, "loadPluginsForSelectedMachine", () => Promise.resolve());

    const restoring = call(app, "restoreRouteFor", { machineId: "local", projectId: undefined, workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined }, false, undefined, "navigation");
    call(app, "selectMainView", "chat");
    machineRestored.resolve();
    await restoring;

    expect(state(app).mainView).toBe("chat");
  });
});

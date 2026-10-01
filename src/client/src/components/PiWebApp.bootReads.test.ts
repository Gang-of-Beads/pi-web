import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, Project, TerminalCommandRun, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp boot reads (P6 slice a)", () => {
  it("leaves the unread set and the pins to a connecting socket's open, and reads each once there", async () => {
    const fetchMock = stubFetch();
    const timers = stubWindow();
    const app = new PiWebApp();
    enableUnread(app);
    const opens: (() => void)[] = [];
    const realtime = objectField(app, "realtime");
    Reflect.set(realtime, "connect", (_onEvent: unknown, onOpen: () => void) => { opens.push(onOpen); });
    let phase: unknown = { kind: "connecting", since: Date.now() };
    Reflect.set(realtime, "phaseFor", () => phase);
    setAppState(app, { ...initialAppState(), selectedMachine: machine("local") });

    call(app, "connectRealtime");
    setState(app, { machines: [machine("local")] });
    call(app, "pinnedSessionIdsFor", "local");
    await settle();
    const beforeOpen = { unread: reads(fetchMock, "/sessions/unread"), pins: reads(fetchMock, "/session-pins"), fallbacks: timers.length };

    phase = { kind: "open" };
    opens[0]?.();
    await settle();

    expect({ beforeOpen, afterOpen: { unread: reads(fetchMock, "/sessions/unread"), pins: reads(fetchMock, "/session-pins") } }).toEqual({
      beforeOpen: { unread: 0, pins: 0, fallbacks: 1 },
      afterOpen: { unread: 1, pins: 1 },
    });
  });

  it("costs one unread read when the roster arrives while the socket open's read is on its way", async () => {
    const answers: (() => void)[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const body = url.includes("/sessions/unread") ? { catalogId: "catalog-a", catalogRevision: 1, sessions: [] } : { pinnedSessionIds: [] };
      const response = new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      if (!url.includes("/sessions/unread")) return Promise.resolve(response);
      return new Promise<Response>((resolve) => { answers.push(() => { resolve(response); }); });
    });
    vi.stubGlobal("fetch", fetchMock);
    stubWindow();
    const app = new PiWebApp();
    enableUnread(app);
    const opens: (() => void)[] = [];
    const realtime = objectField(app, "realtime");
    Reflect.set(realtime, "connect", (_onEvent: unknown, onOpen: () => void) => { opens.push(onOpen); });
    Reflect.set(realtime, "phaseFor", () => ({ kind: "open" }));
    setAppState(app, { ...initialAppState(), selectedMachine: machine("local") });

    call(app, "connectRealtime");
    opens[0]?.();
    setState(app, { machines: [machine("local")] });
    for (const answer of answers.splice(0)) answer();
    await settle();
    for (const answer of answers.splice(0)) answer();
    await settle();

    expect(reads(fetchMock, "/sessions/unread")).toBe(1);
  });

  it("reads the unread set and the pins anyway once a connecting socket has not opened within the grace", async () => {
    const fetchMock = stubFetch();
    const timers = stubWindow();
    const app = new PiWebApp();
    enableUnread(app);
    const realtime = objectField(app, "realtime");
    const connectingSince = 50_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(connectingSince);
    Reflect.set(realtime, "phaseFor", () => ({ kind: "connecting", since: connectingSince }));
    setAppState(app, { ...initialAppState(), selectedMachine: machine("local") });

    setState(app, { machines: [machine("local")] });
    call(app, "pinnedSessionIdsFor", "local");
    await settle();
    const withinGrace = { unread: reads(fetchMock, "/sessions/unread"), pins: reads(fetchMock, "/session-pins"), fallbackDelays: timers.map((timer) => timer.delay) };

    clock.mockReturnValue(connectingSince + 1_500);
    timers[0]?.run();
    await settle();

    expect({ withinGrace, afterGrace: { unread: reads(fetchMock, "/sessions/unread"), pins: reads(fetchMock, "/session-pins") } }).toEqual({
      withinGrace: { unread: 0, pins: 0, fallbackDelays: [1_500] },
      afterGrace: { unread: 1, pins: 1 },
    });
  });

  it("reads nothing for a machine that left the roster before its grace was over (review 44fc106b)", async () => {
    const fetchMock = stubFetch();
    const timers = stubWindow();
    const app = new PiWebApp();
    enableUnread(app);
    const remote = { ...machine("remote-1"), kind: "remote" as const, baseUrl: "https://remote.example.test" };
    const connectingSince = 50_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(connectingSince);
    Reflect.set(objectField(app, "realtime"), "phaseFor", () => ({ kind: "absent" }));
    const activity = { phaseFor: () => ({ kind: "connecting", since: connectingSince }), close: () => undefined };
    objectMap(app, "machineRealtimeSockets").set("remote-1", activity);
    setAppState(app, { ...initialAppState(), selectedMachine: machine("local"), machines: [machine("local"), remote] });

    call(app, "ensureMachinePins", "remote-1");
    await settle();
    const armed = timers.length;
    setAppState(app, { ...appState(app), machines: [machine("local")] });
    clock.mockReturnValue(connectingSince + 1_500);
    timers[0]?.run();
    await settle();

    expect({ armed, remoteReads: fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes("/machines/remote-1/")).length }).toEqual({ armed: 1, remoteReads: 0 });
  });

  it("sends no deletion runs read for a project the reader left while an earlier read was on its way (review 44fc106b)", async () => {
    stubFetch();
    stubWindow();
    const app = new PiWebApp();
    const asked: unknown[] = [];
    const answers: (() => void)[] = [];
    stubDeletionRuns(app, (filter) => { asked.push(filter.projectId); return new Promise((resolve) => { answers.push(() => { resolve([]); }); }); });

    setState(app, { selectedProject: project("alpha"), selectedWorkspace: workspace("alpha", "main") });
    await settle();
    void call(app, "refreshWorkspaceDeletionRuns");
    setState(app, { selectedProject: project("beta"), selectedWorkspace: workspace("beta", "main") });
    await settle();
    for (const answer of answers.splice(0)) answer();
    await settle();

    expect(asked).toEqual(["alpha", "beta"]);
  });

  it("leaves a remote machine's unread set to its activity socket when the roster brings both at once (review 44fc106b)", async () => {
    const fetchMock = stubFetch();
    stubWindow();
    const sockets: { url: string; onopen: (() => void) | null }[] = [];
    vi.stubGlobal("WebSocket", class {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: unknown = null;
      onerror: unknown = null;
      onclose: unknown = null;
      constructor(readonly url: string) { sockets.push(this); }
      close(): void { this.readyState = 3; }
    });
    const app = new PiWebApp();
    enableUnread(app);
    Reflect.set(objectField(app, "realtime"), "phaseFor", () => ({ kind: "open" }));
    const remote: Machine = { ...machine("remote-1"), kind: "remote", baseUrl: "https://remote.example.test" };
    setAppState(app, { ...initialAppState(), selectedMachine: machine("local") });

    setState(app, { machines: [machine("local"), remote] });
    await settle();
    const remoteReads = () => fetchMock.mock.calls.filter(([input]) => requestUrl(input).endsWith("/machines/remote-1/sessions/unread")).length;
    const beforeOpen = remoteReads();
    sockets.find((socket) => socket.url.includes("/machines/remote-1/events"))?.onopen?.();
    await settle();

    expect({ sockets: sockets.length, beforeOpen, afterOpen: remoteReads() }).toEqual({ sockets: 1, beforeOpen: 0, afterOpen: 1 });
  });

  it("tries a failed deletion runs read again on the shared backoff while the project stays selected, and stops when it is left (review 44fc106b)", async () => {
    stubFetch();
    const timers = stubWindow();
    const app = new PiWebApp();
    const asked: unknown[] = [];
    let fail = true;
    stubDeletionRuns(app, (filter) => {
      asked.push(filter.projectId);
      return fail ? Promise.reject(new Error("machine not answering")) : Promise.resolve([deletionRun(filter.projectId ?? "", "w-1")]);
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    setState(app, { selectedProject: project("alpha"), selectedWorkspace: workspace("alpha", "main") });
    await settle();
    const firstRetry = timers.map((timer) => timer.delay);
    timers.splice(0)[0]?.run();
    await settle();
    const secondRetry = timers.map((timer) => timer.delay);
    fail = false;
    timers.splice(0)[0]?.run();
    await settle();
    const shown = Object.keys(appState(app).workspaceDeletionRuns);
    const afterAnswer = timers.length;
    fail = true;
    setState(app, { selectedProject: project("beta"), selectedWorkspace: workspace("beta", "main") });
    await settle();
    const betaRetry = timers.splice(0);
    setState(app, { selectedProject: project("gamma"), selectedWorkspace: workspace("gamma", "main") });
    await settle();
    const askedBeforeStale = asked.length;
    betaRetry[0]?.run();
    await settle();

    expect({ asked: asked.slice(0, askedBeforeStale), firstRetry, secondRetry, shown, afterAnswer, staleRetryReads: asked.length - askedBeforeStale }).toEqual({
      asked: ["alpha", "alpha", "alpha", "beta", "gamma"],
      firstRetry: [1000],
      secondRetry: [2000],
      shown: ["w-1"],
      afterAnswer: 0,
      staleRetryReads: 0,
    });
  });

  it("reads nothing on a first load's pageshow, and the unread set on a page restored from the back-forward cache", () => {
    stubFetch();
    stubWindow();
    const app = new PiWebApp();
    const unread = objectField(app, "sessionUnread");
    const refreshAll = vi.fn(() => Promise.resolve());
    Reflect.set(unread, "refreshAll", refreshAll);
    Reflect.set(objectField(app, "appShell"), "repairViewportPosition", () => undefined);
    Reflect.set(app, "retryPendingRemoteRouteRestoreSoon", () => undefined);
    const onPageShow: unknown = Reflect.get(app, "onPageShow");
    if (typeof onPageShow !== "function") throw new Error("no pageshow handler");

    onPageShow.call(app, { persisted: false });
    const firstLoad = refreshAll.mock.calls.length;
    onPageShow.call(app, { persisted: true });

    expect({ firstLoad, restored: refreshAll.mock.calls.length }).toEqual({ firstLoad: 0, restored: 1 });
  });

  it("reads a project's workspace deletion runs once when the project is selected, and not again when the workspace changes within it", async () => {
    stubFetch();
    stubWindow();
    const app = new PiWebApp();
    const asked: unknown[] = [];
    stubDeletionRuns(app, (filter) => { asked.push(filter.projectId); return Promise.resolve([]); });

    setState(app, { selectedProject: project("alpha"), selectedWorkspace: workspace("alpha", "main") });
    await settle();
    setState(app, { selectedWorkspace: workspace("alpha", "feature") });
    await settle();
    setState(app, { selectedProject: project("beta"), selectedWorkspace: workspace("beta", "main") });
    await settle();

    expect(asked).toEqual(["alpha", "beta"]);
  });

  it("applies a deletion runs answer only to the project it was read for, and reads a project selected during a read at once", async () => {
    stubFetch();
    stubWindow();
    const app = new PiWebApp();
    const answers = new Map<string, (runs: TerminalCommandRun[]) => void>();
    stubDeletionRuns(app, (filter) => new Promise((resolve) => { answers.set(filter.projectId ?? "", resolve); }));

    setState(app, { selectedProject: project("alpha"), selectedWorkspace: workspace("alpha", "main") });
    await settle();
    setState(app, { selectedProject: project("beta"), selectedWorkspace: workspace("beta", "main") });
    await settle();
    const askedWhileAlphaRead = [...answers.keys()];
    answers.get("beta")?.([deletionRun("beta", "beta-old")]);
    await settle();
    answers.get("alpha")?.([deletionRun("alpha", "alpha-old")]);
    await settle();

    expect({ askedWhileAlphaRead, shown: Object.keys(appState(app).workspaceDeletionRuns) }).toEqual({
      askedWhileAlphaRead: ["alpha", "beta"],
      shown: ["beta-old"],
    });
  });
});

interface FiredTimer { delay: number; run: () => void }

function stubWindow(): FiredTimer[] {
  const timers: FiredTimer[] = [];
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { search: "", href: "https://pi.example.test/" },
    history: { state: null, replaceState: () => undefined, pushState: () => undefined },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
    matchMedia: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: (run: () => void, delay: number) => { timers.push({ delay, run }); return timers.length; },
    clearTimeout: () => undefined,
  });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  return timers;
}

function stubFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = requestUrl(input);
    const body = url.includes("/session-pins") ? { pinnedSessionIds: [] } : url.includes("/sessions/unread") ? { catalogId: "catalog-a", catalogRevision: 1, sessions: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function reads(fetchMock: ReturnType<typeof stubFetch>, path: string): number {
  return fetchMock.mock.calls.filter(([input]) => requestUrl(input).endsWith(path)).length;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function stubDeletionRuns(app: PiWebApp, list: (filter: { projectId?: string }) => Promise<TerminalCommandRun[]>): void {
  Reflect.set(app, "terminalCommandRunsForOrigin", () => ({ listCommandRuns: list }));
}

function deletionRun(projectId: string, workspaceId: string): TerminalCommandRun {
  return {
    id: `run-${workspaceId}`,
    origin: "core",
    projectId,
    workspaceId,
    terminalId: "terminal-1",
    title: "Delete workspace",
    command: "true",
    status: "running",
    createdAt: "2026-10-01T00:00:00.000Z",
    metadata: { "pi.operation": "workspace.delete", "target.workspaceId": workspaceId },
  };
}

function machine(id: string): Machine {
  return { id, name: id, kind: "local", createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z" };
}

function project(id: string): Project {
  return { id, name: id, path: `/${id}`, createdAt: "2026-07-14T00:00:00.000Z" };
}

function workspace(projectId: string, id: string): Workspace {
  return { id: `${projectId}-${id}`, projectId, label: id, path: `/${projectId}/${id}`, isMain: id === "main", effectiveConfig: {} };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function objectField(app: PiWebApp, name: string): object {
  const value: unknown = Reflect.get(app, name);
  if (typeof value !== "object" || value === null) throw new Error(`PiWebApp.${name} is unavailable`);
  return value;
}

function call(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`PiWebApp.${name} is not callable`);
  const result: unknown = method.apply(app, args);
  return result;
}

function objectMap(app: PiWebApp, name: string): { set(key: string, value: unknown): unknown } {
  const value: unknown = Reflect.get(app, name);
  if (!(value instanceof Map)) throw new Error(`PiWebApp.${name} is not a map`);
  return { set: (key, entry) => value.set(key, entry) };
}

function enableUnread(app: PiWebApp): void {
  if (!Reflect.set(app, "unreadConnected", true)) throw new Error("Could not connect PiWebApp unread state");
}

function appState(app: PiWebApp): AppState {
  const state: unknown = Reflect.get(app, "state");
  if (!isAppState(state)) throw new Error("PiWebApp state is unavailable");
  return state;
}

function isAppState(value: unknown): value is AppState {
  return typeof value === "object" && value !== null && "workspaceDeletionRuns" in value;
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function setState(app: PiWebApp, patch: Partial<AppState>): void {
  call(app, "setState", patch);
}

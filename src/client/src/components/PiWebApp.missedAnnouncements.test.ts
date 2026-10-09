import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionPinsApi, type MachinePins } from "../api/clients";
import { RealtimeSocket } from "../sessionSocket";
import { PiWebApp } from "./PiWebApp";

/** A machine's pins answer with no project pins: what these tests are about is the global set. */
function pinAnswer(ids: string[]): MachinePins {
  return { global: ids, projects: undefined, pinnedProjects: undefined };
}

/**
 * A lost announcement is noticed (state-diagram D5, B28 slice H1). A machine's global socket can
 * stay open and lose a frame; the socket reports it, and the page reads again what that machine's
 * frames keep live - on the machine in use and on every other machine it follows.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("an open after the page heard the machine (B28 slice H2)", () => {
  it("reads again what the frames keep live on a reopen and on a handoff between the machine's sockets, and not on the page's first open", async () => {
    vi.spyOn(sessionPinsApi, "pins").mockResolvedValue(pinAnswer([]));
    const opens: { machineId: string; open: () => void }[] = [];
    vi.spyOn(RealtimeSocket.prototype, "connect").mockImplementation((_onEvent, onOpen, machineId = "local") => { if (onOpen !== undefined) opens.push({ machineId, open: onOpen }); });
    const app = createApp();
    const calls: string[] = [];
    spyOn(app, "sessionUnread", ["refresh"], calls);
    spyOn(app, "machineStatus", ["refresh"], calls);
    spyOn(app, "sessionBoards", ["missedAnnouncements"], calls);
    spyOn(app, "sessions", ["hydrateSessionStatuses", "refreshCurrentWorkspaceSessions"], calls);
    spyOn(app, "", ["invalidateWorkspacePanels", "refreshInterruptedRuns"], calls);
    const local = { id: "local", name: "Local", kind: "local" };
    const remote = { id: "remote-1", name: "Remote", kind: "remote", status: "online" };
    call(app, "setState", { machines: [local, remote], selectedMachine: local });
    call(app, "connectRealtime");
    call(app, "syncMachineActivitySubscriptions");
    const marks = (): string[] => calls.filter((entry) => entry.startsWith("sessionBoards.") || entry.startsWith("machineStatus."));
    const openFirst = (machineId: string): void => { opens.find((entry) => entry.machineId === machineId)?.open(); };

    openFirst("local");
    openFirst("remote-1");
    await flush();
    const firstOpens = marks();
    openFirst("local");
    await flush();
    const reopen = marks();
    const state: unknown = Reflect.get(app, "state");
    Reflect.set(app, "state", { ...Object(state), selectedMachine: remote });
    call(app, "syncMachineActivitySubscriptions");
    const handoff = opens.at(-1);
    handoff?.open();
    await flush();

    expect({ firstOpens, reopen, handoffMachine: handoff?.machineId, handoff: marks() }).toEqual({
      firstOpens: [],
      reopen: ["sessionBoards.missedAnnouncements(local)", "machineStatus.refresh(local)"],
      handoffMachine: "local",
      handoff: ["sessionBoards.missedAnnouncements(local)", "machineStatus.refresh(local)", "sessionBoards.missedAnnouncements(local)", "machineStatus.refresh(local)"],
    });
  });

  it("leaves the open workspace panels to the hidden tab's return, as a live workspace.changed does", async () => {
    vi.spyOn(sessionPinsApi, "pins").mockResolvedValue(pinAnswer([]));
    const missed = new Map<string, () => void>();
    vi.spyOn(RealtimeSocket.prototype, "connect").mockImplementation((_onEvent, _onOpen, machineId = "local", onMissed) => { if (onMissed !== undefined) missed.set(machineId, onMissed); });
    const app = createApp("hidden");
    const calls: string[] = [];
    spyOn(app, "sessionUnread", ["refresh"], calls);
    spyOn(app, "machineStatus", ["refresh"], calls);
    spyOn(app, "sessions", ["hydrateSessionStatuses", "refreshCurrentWorkspaceSessions"], calls);
    spyOn(app, "", ["invalidateWorkspacePanels", "refreshInterruptedRuns", "refreshActiveTerminals"], calls);
    const workspace = { id: "w1", projectId: "p1", path: "/repo", label: "repo", isMain: true, effectiveConfig: {} };
    call(app, "setState", { selectedWorkspace: workspace });
    call(app, "connectRealtime");

    missed.get("local")?.();
    await flush();

    expect({ panels: calls.filter((entry) => entry.startsWith("invalidateWorkspacePanels")), deferred: Reflect.get(app, "workspaceChangedWhileHidden") !== undefined }).toEqual({ panels: [], deferred: true });
  });
});

describe("a burst of lost announcements", () => {
  it("shares one pass of reads, and asks for at most one more after it", async () => {
    vi.spyOn(sessionPinsApi, "pins").mockResolvedValue(pinAnswer([]));
    const missed = new Map<string, () => void>();
    vi.spyOn(RealtimeSocket.prototype, "connect").mockImplementation((_onEvent, _onOpen, machineId = "local", onMissed) => { if (onMissed !== undefined) missed.set(machineId, onMissed); });
    const app = createApp();
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const unread: unknown = Reflect.get(app, "sessionUnread");
    if (typeof unread !== "object" || unread === null) throw new Error("no sessionUnread");
    Reflect.set(unread, "refresh", (machineId: string) => {
      calls.push(`sessionUnread.refresh(${machineId})`);
      return calls.length === 1 ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
    });
    spyOn(app, "machineStatus", ["refresh"], calls);
    spyOn(app, "sessionBoards", ["missedAnnouncements"], calls);
    spyOn(app, "sessions", ["hydrateSessionStatuses", "refreshCurrentWorkspaceSessions"], calls);
    spyOn(app, "", ["invalidateWorkspacePanels", "refreshInterruptedRuns"], calls);
    call(app, "connectRealtime");

    for (let loss = 0; loss < 5; loss += 1) missed.get("local")?.();
    await flush();
    const unreadReads = (): number => calls.filter((entry) => entry === "sessionUnread.refresh(local)").length;
    const burst = unreadReads();
    for (let loss = 0; loss < 5; loss += 1) missed.get("local")?.();
    release();
    for (let turn = 0; turn < 6; turn += 1) await flush();

    expect({ burst, afterMoreLosses: unreadReads() }).toEqual({ burst: 1, afterMoreLosses: 2 });
  });
});

function createApp(visibility: "visible" | "hidden" = "visible"): PiWebApp {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", {
    location: { search: "", href: "https://pi.example.test/" },
    history: { state: null, replaceState: () => undefined, pushState: () => undefined },
    localStorage: storage,
    matchMedia: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: visibility, hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
  return new PiWebApp();
}

function call(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`PiWebApp.${name} is not callable`);
  return Reflect.apply(method, app, args);
}

function spyOn(app: PiWebApp, owner: string, names: readonly string[], calls: string[]): void {
  const target: unknown = owner === "" ? app : Reflect.get(app, owner);
  if (typeof target !== "object" || target === null) throw new Error(`no ${owner}`);
  for (const name of names) Reflect.set(target, name, (...args: unknown[]) => { calls.push(`${owner === "" ? "" : `${owner}.`}${name}(${args.filter((arg) => typeof arg === "string").join(",")})`); return Promise.resolve(); });
}

const flush = async (): Promise<void> => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };

describe("a machine's socket that lost an announcement", () => {
  it("reads again, once, what the frames of the machine in use and of a followed machine keep live", async () => {
    const pins = vi.spyOn(sessionPinsApi, "pins").mockResolvedValue(pinAnswer([]));
    const missed = new Map<string, () => void>();
    vi.spyOn(RealtimeSocket.prototype, "connect").mockImplementation((_onEvent, _onOpen, machineId = "local", onMissed) => { if (onMissed !== undefined) missed.set(machineId, onMissed); });
    const app = createApp();
    const calls: string[] = [];
    spyOn(app, "sessionUnread", ["refresh"], calls);
    spyOn(app, "machineStatus", ["refresh"], calls);
    spyOn(app, "sessionBoards", ["missedAnnouncements"], calls);
    spyOn(app, "sessions", ["hydrateSessionStatuses", "refreshCurrentWorkspaceSessions"], calls);
    spyOn(app, "", ["invalidateWorkspacePanels", "refreshInterruptedRuns", "refreshActiveTerminals"], calls);
    const local = { id: "local", name: "Local", kind: "local" };
    const workspace = { id: "w1", projectId: "p1", path: "/repo", label: "repo", isMain: true, effectiveConfig: {} };
    call(app, "setState", { machines: [local, { id: "remote-1", name: "Remote", kind: "remote", status: "online" }], selectedMachine: local, selectedWorkspace: workspace });
    call(app, "connectRealtime");
    call(app, "syncMachineActivitySubscriptions");
    calls.length = 0;
    pins.mockClear();

    missed.get("local")?.();
    await flush();
    const inUse = [...calls].sort();
    const inUsePins = pins.mock.calls.map((args) => args[0]);
    calls.length = 0;
    pins.mockClear();
    missed.get("remote-1")?.();
    await flush();

    expect({ inUse, inUsePins, followed: [...calls].sort(), followedPins: pins.mock.calls.map((args) => args[0]) }).toEqual({
      inUse: ["invalidateWorkspacePanels()", "machineStatus.refresh(local)", "refreshActiveTerminals()", "sessionBoards.missedAnnouncements(local)", "sessionUnread.refresh(local)", "sessions.hydrateSessionStatuses(local)", "sessions.refreshCurrentWorkspaceSessions(local)"],
      inUsePins: ["local"],
      followed: ["machineStatus.refresh(remote-1)", "sessionBoards.missedAnnouncements(remote-1)", "sessionUnread.refresh(remote-1)"],
      followedPins: ["remote-1"],
    });
  });
});

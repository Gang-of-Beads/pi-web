import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionPinsApi } from "../api/clients";
import { RealtimeSocket } from "../sessionSocket";
import { PiWebApp } from "./PiWebApp";

/**
 * A lost announcement is noticed (state-diagram D5, B28 slice H1). A machine's global socket can
 * stay open and lose a frame; the socket reports it, and the page reads again what that machine's
 * frames keep live - on the machine in use and on every other machine it follows.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a machine's socket that reopened (B28 slice H2)", () => {
  it("marks the board stale and refreshes the open panels on a reopen, not on the first open", async () => {
    vi.spyOn(sessionPinsApi, "pins").mockResolvedValue([]);
    const opens = new Map<string, (reopened: boolean) => void>();
    vi.spyOn(RealtimeSocket.prototype, "connect").mockImplementation((_onEvent, onOpen, machineId = "local") => { if (onOpen !== undefined) opens.set(machineId, onOpen); });
    const app = createApp();
    const calls: string[] = [];
    spyOn(app, "sessionUnread", ["refresh"], calls);
    spyOn(app, "sessionBoards", ["missedAnnouncements"], calls);
    spyOn(app, "sessions", ["hydrateSessionStatuses", "refreshCurrentWorkspaceSessions"], calls);
    spyOn(app, "", ["invalidateWorkspacePanels", "refreshInterruptedRuns"], calls);
    const local = { id: "local", name: "Local", kind: "local" };
    call(app, "setState", { machines: [local, { id: "remote-1", name: "Remote", kind: "remote", status: "online" }], selectedMachine: local });
    call(app, "connectRealtime");
    call(app, "syncMachineActivitySubscriptions");
    const marks = (): string[] => calls.filter((entry) => entry.startsWith("sessionBoards.") || entry.startsWith("invalidateWorkspacePanels"));

    opens.get("local")?.(false);
    opens.get("remote-1")?.(false);
    await flush();
    const firstOpens = marks();
    opens.get("local")?.(true);
    opens.get("remote-1")?.(true);
    await flush();

    expect({ firstOpens, reopens: marks() }).toEqual({ firstOpens: [], reopens: ["sessionBoards.missedAnnouncements(local)", "invalidateWorkspacePanels()", "sessionBoards.missedAnnouncements(remote-1)"] });
  });
});

describe("a burst of lost announcements", () => {
  it("shares one pass of reads, and asks for at most one more after it", async () => {
    vi.spyOn(sessionPinsApi, "pins").mockResolvedValue([]);
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

function createApp(): PiWebApp {
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
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
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
    const pins = vi.spyOn(sessionPinsApi, "pins").mockResolvedValue([]);
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

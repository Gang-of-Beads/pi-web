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

function createApp(): PiWebApp {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", {
    location: { search: "" },
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
    spyOn(app, "", ["invalidateWorkspacePanels", "refreshInterruptedRuns"], calls);
    const local = { id: "local", name: "Local", kind: "local" };
    call(app, "setState", { machines: [local, { id: "remote-1", name: "Remote", kind: "remote", status: "online" }], selectedMachine: local });
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
      inUse: ["invalidateWorkspacePanels()", "machineStatus.refresh(local)", "sessionBoards.missedAnnouncements(local)", "sessionUnread.refresh(local)", "sessions.hydrateSessionStatuses(local)", "sessions.refreshCurrentWorkspaceSessions(local)"],
      inUsePins: ["local"],
      followed: ["machineStatus.refresh(remote-1)", "sessionBoards.missedAnnouncements(remote-1)", "sessionUnread.refresh(remote-1)"],
      followedPins: ["remote-1"],
    });
  });
});

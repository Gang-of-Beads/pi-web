import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionPinsApi } from "../api/clients";
import { RealtimeSocket, type BrowserRealtimeEvent } from "../sessionSocket";
import { PiWebApp } from "./PiWebApp";

/**
 * Pins are live from an event, not re-read on every render (P5 slice a; state-diagram D5).
 * `pinnedSessionIdsFor` runs while rendering; it used to re-read a machine's pins on any render
 * once the last answer was 2 s old, 7-8 reads a minute with the git panel open and nothing
 * happening.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

const flush = async (): Promise<void> => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };

function quietAll(owner: unknown, names: readonly string[]): void {
  if (typeof owner !== "object" || owner === null) throw new Error("nothing to quiet");
  for (const name of names) Reflect.set(owner, name, () => Promise.resolve());
}

describe("a machine's pins are read once, then on its word (P5 slice a)", () => {
  it("reads once across renders minutes apart, and once more on pins.changed, on each refresh, and after a failed read", async () => {
    vi.useFakeTimers();
    let answers = 0;
    const pins = vi.spyOn(sessionPinsApi, "pins").mockImplementation(() => {
      answers += 1;
      return answers === 4 ? Promise.reject(new Error("offline")) : Promise.resolve(["s1"]);
    });
    const app = createApp();
    const renderPins = () => call(app, "pinnedSessionIdsFor", "local");

    renderPins();
    await flush();
    for (let minute = 0; minute < 3; minute += 1) {
      vi.advanceTimersByTime(60_000);
      renderPins();
      await flush();
    }
    const acrossRenders = pins.mock.calls.length;

    const event: BrowserRealtimeEvent = { type: "pins.changed" };
    call(app, "handleRealtimeEvent", "local", event);
    await flush();
    const afterEvent = pins.mock.calls.length;

    call(app, "refreshMachinePins", "local");
    await flush();
    const afterRefresh = pins.mock.calls.length;

    call(app, "refreshMachinePins", "local");
    await flush();
    renderPins();
    await flush();

    expect({ acrossRenders, afterEvent, afterRefresh, afterFailureAndRender: pins.mock.calls.length }).toEqual({ acrossRenders: 1, afterEvent: 2, afterRefresh: 3, afterFailureAndRender: 5 });
  });

  it("reads another machine's pins again when that machine's activity socket says they changed", async () => {
    const pins = vi.spyOn(sessionPinsApi, "pins").mockResolvedValue([]);
    const app = createApp();
    call(app, "pinnedSessionIdsFor", "remote-1");
    await flush();

    call(app, "handleMachineActivityEvent", "remote-1", { type: "pins.changed" });
    await flush();

    expect(pins.mock.calls.map((args) => args[0])).toEqual(["remote-1", "remote-1"]);
  });

  it("reads once more after a read that was on its way when the machine said its pins changed", async () => {
    let answerFirst: (ids: string[]) => void = () => undefined;
    const pins = vi.spyOn(sessionPinsApi, "pins")
      .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValue(["s1", "s2"]);
    const app = createApp();
    call(app, "pinnedSessionIdsFor", "local");
    await flush();

    call(app, "handleRealtimeEvent", "local", { type: "pins.changed" });
    call(app, "handleRealtimeEvent", "local", { type: "pins.changed" });
    await flush();
    const whileOnItsWay = pins.mock.calls.length;
    answerFirst(["s1"]);
    await flush();
    await flush();
    const shown: unknown = call(app, "pinnedSessionIdsFor", "local");

    expect({ whileOnItsWay, total: pins.mock.calls.length, shown: shown instanceof Set ? [...shown] : shown }).toEqual({ whileOnItsWay: 1, total: 2, shown: ["s1", "s2"] });
  });

  it("reads a machine's pins when its activity socket reopens, and every answered machine's when the tab resumes", async () => {
    const pins = vi.spyOn(sessionPinsApi, "pins").mockResolvedValue([]);
    const opens: (() => void)[] = [];
    vi.spyOn(RealtimeSocket.prototype, "connect").mockImplementation((_onEvent, onOpen) => { if (onOpen !== undefined) opens.push(onOpen); });
    const app = createApp();
    quietAll(Reflect.get(app, "sessionUnread"), ["refresh", "refreshAll"]);
    const local = { id: "local", name: "Local", kind: "local" };
    call(app, "setState", { machines: [local, { id: "remote-1", name: "Remote", kind: "remote", status: "online" }], selectedMachine: local });
    call(app, "pinnedSessionIdsFor", "remote-1");
    await flush();
    call(app, "syncMachineActivitySubscriptions");
    for (const open of opens) open();
    await flush();
    const afterReopen = pins.mock.calls.map((args) => args[0]);

    pins.mockClear();
    quietAll(Reflect.get(app, "sessions"), ["refreshSelectedSession", "verifyUnansweredSends"]);
    quietAll(app, ["refreshMachineStatusSnapshots", "refreshWorkspaceDeletionRuns", "refreshCurrentWorkspaceSurface"]);
    quietAll(Reflect.get(app, "workspaces"), ["refreshSelectedProjectTopology"]);
    quietAll(Reflect.get(app, "projects"), ["loadProjects"]);
    await call(app, "refreshAfterBrowserResume");
    await flush();

    expect({ afterReopen, afterResume: pins.mock.calls.map((args) => args[0]) }).toEqual({ afterReopen: ["remote-1", "remote-1"], afterResume: ["remote-1"] });
  });
});

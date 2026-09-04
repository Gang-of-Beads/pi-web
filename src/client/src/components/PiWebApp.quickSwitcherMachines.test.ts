import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebApp } from "./PiWebApp";
import type { Machine, SessionInfo } from "../api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The quick switcher's machine tabs let the reader browse another machine's
 * sessions. The first attempt could browse but not open: selectSession ran
 * against the machine the app was on, asked it for a session it never had,
 * and failed. Opening a session that lives on another machine must move the
 * app to that machine first, then select - in that order.
 */
function machine(id: string): Machine {
  const now = new Date().toISOString();
  return { id, name: id, baseUrl: `https://${id}.example.test`, kind: "remote", createdAt: now, updatedAt: now };
}

function sessionOn(cwd: string): SessionInfo {
  const now = new Date().toISOString();
  return { id: "s-1", path: `${cwd}/s.jsonl`, name: "remote session", cwd, created: now, modified: now, messageCount: 3, firstMessage: "hi" };
}

function createApp(): PiWebApp {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage, setTimeout: () => 0, clearTimeout: () => undefined });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  return new PiWebApp();
}

function callable(app: PiWebApp, name: string): (...args: unknown[]) => Promise<void> {
  const value: unknown = Reflect.get(app, name);
  if (typeof value !== "function") throw new Error(`PiWebApp.${name} was unavailable`);
  return async (...args: unknown[]) => { await Reflect.apply(value, app, args); };
}

function applyState(app: PiWebApp, patch: Record<string, unknown>): void {
  const setState: unknown = Reflect.get(app, "setState");
  if (typeof setState !== "function") throw new Error("PiWebApp.setState was unavailable");
  Reflect.apply(setState, app, [patch]);
}

describe("opening a session from another machine's tab", () => {
  it("moves to that machine before selecting the session", async () => {
    const app = createApp();
    const local = machine("local");
    const remote = machine("remote-b");
    applyState(app, { machines: [local, remote], selectedMachine: local });

    const order: string[] = [];
    const machinesController: unknown = Reflect.get(app, "machines");
    if (typeof machinesController !== "object" || machinesController === null) throw new Error("MachineController was unavailable");
    if (!Reflect.set(machinesController, "selectMachine", (target: Machine) => { order.push(`machine:${target.id}`); return Promise.resolve(); })) {
      throw new Error("Could not replace selectMachine");
    }
    const sessionsController: unknown = Reflect.get(app, "sessions");
    if (typeof sessionsController !== "object" || sessionsController === null) throw new Error("SessionController was unavailable");
    if (!Reflect.set(sessionsController, "selectSession", () => { order.push("session"); return Promise.resolve(); })) {
      throw new Error("Could not replace selectSession");
    }
    if (!Reflect.set(app, "focusChatComposer", () => Promise.resolve())) throw new Error("Could not replace focusChatComposer");

    if (!Reflect.set(app, "quickSwitcherBrowseMachineId", "remote-b")) throw new Error("Could not set the browse machine");
    await callable(app, "openSessionFromQuickSwitcher")(sessionOn("/home/hxd/project"));

    expect(order).toEqual(["machine:remote-b", "session"]);
  });

  it("selects directly when the session lives on the current machine", async () => {
    const app = createApp();
    const local = machine("local");
    applyState(app, { machines: [local], selectedMachine: local });

    const order: string[] = [];
    const machinesController: unknown = Reflect.get(app, "machines");
    if (typeof machinesController !== "object" || machinesController === null) throw new Error("MachineController was unavailable");
    if (!Reflect.set(machinesController, "selectMachine", (target: Machine) => { order.push(`machine:${target.id}`); return Promise.resolve(); })) {
      throw new Error("Could not replace selectMachine");
    }
    const sessionsController: unknown = Reflect.get(app, "sessions");
    if (typeof sessionsController !== "object" || sessionsController === null) throw new Error("SessionController was unavailable");
    if (!Reflect.set(sessionsController, "selectSession", () => { order.push("session"); return Promise.resolve(); })) {
      throw new Error("Could not replace selectSession");
    }
    if (!Reflect.set(app, "focusChatComposer", () => Promise.resolve())) throw new Error("Could not replace focusChatComposer");

    if (!Reflect.set(app, "quickSwitcherBrowseMachineId", "local")) throw new Error("Could not set the browse machine");
    await callable(app, "openSessionFromQuickSwitcher")(sessionOn("/home/hxd/project"));

    expect(order).toEqual(["session"]);
  });
});

/** Review finding: the previous machine's rows must not sit under a new tab. */
describe("browsing another machine's tab", () => {
  it("clears the previous machine's rows the moment the tab changes", () => {
    const app = createApp();
    applyState(app, { machines: [machine("local"), machine("remote-b")], selectedMachine: machine("local") });
    if (!Reflect.set(app, "quickSwitcherSessions", [sessionOn("/somewhere")])) throw new Error("Could not seed sessions");
    if (!Reflect.set(app, "quickSwitcherBrowseMachineId", "local")) throw new Error("Could not set browse machine");
    if (!Reflect.set(app, "loadQuickSwitcherData", () => Promise.resolve())) throw new Error("Could not stub the load");
    const browse: unknown = Reflect.get(app, "browseQuickSwitcherMachine");
    if (typeof browse !== "function") throw new Error("browseQuickSwitcherMachine unavailable");
    Reflect.apply(browse, app, ["remote-b"]);
    expect(Reflect.get(app, "quickSwitcherSessions")).toEqual([]);
    expect(Reflect.get(app, "quickSwitcherWorkspaces")).toEqual([]);
  });

  it("clears rows loaded for another machine when the loader runs after a machine switch", async () => {
    // The qwen presence lane's P1: switch machines from the header, reopen the
    // switcher, and the cached rows of the OLD machine rendered under the new
    // one - with the new machine's badges - until the refresh landed. The
    // loader now refuses to keep rows whose machine is not the one it loads.
    const app = createApp();
    applyState(app, { machines: [machine("machine-a"), machine("machine-b")], selectedMachine: machine("machine-b") });
    if (!Reflect.set(app, "quickSwitcherSessions", [sessionOn("/from-a")])) throw new Error("Could not seed sessions");
    if (!Reflect.set(app, "quickSwitcherMachineId", "machine-a")) throw new Error("Could not set rows machine");
    if (!Reflect.set(app, "quickSwitcherBrowseMachineId", "machine-b")) throw new Error("Could not set browse machine");
    const load: unknown = Reflect.get(app, "loadQuickSwitcherData");
    if (typeof load !== "function") throw new Error("loadQuickSwitcherData unavailable");
    const loading: unknown = Reflect.apply(load, app, []);
    expect(Reflect.get(app, "quickSwitcherSessions")).toEqual([]);
    expect(Reflect.get(app, "quickSwitcherMachineId")).toBeUndefined();
    if (loading instanceof Promise) await loading.catch(() => undefined);
  });

  it("acts on the machine the displayed rows came from, not the requested tab", async () => {
    const app = createApp();
    applyState(app, { machines: [machine("machine-a"), machine("machine-b")], selectedMachine: machine("machine-b") });
    const selected: string[] = [];
    Reflect.set(app, "machines", { selectMachine: (target: Machine) => { selected.push(target.id); applyState(app, { selectedMachine: target }); return Promise.resolve(); } });
    if (!Reflect.set(app, "quickSwitcherMachineId", "machine-a")) throw new Error("Could not set rows machine");
    if (!Reflect.set(app, "quickSwitcherBrowseMachineId", "machine-b")) throw new Error("Could not set browse machine");
    const move: unknown = Reflect.get(app, "moveToBrowsedMachine");
    if (typeof move !== "function") throw new Error("moveToBrowsedMachine unavailable");
    const moved: unknown = await Promise.resolve(Reflect.apply(move, app, []));
    expect(moved).toBe(true);
    expect(selected).toEqual(["machine-a"]);
  });
});

/** Review finding: the badge-scope guarantee was claimed but unpinned. */
describe("badges while browsing elsewhere", () => {
  it("empties every status badge, pin and selection for another machine's rows", () => {
    const source = PiWebApp.prototype.render.toString();
    const emptied = source.match(/quickSwitcherBrowsingElsewhere\(\) \? EMPTY_ID_SET/g) ?? [];
    expect(emptied.length).toBeGreaterThanOrEqual(5);
    expect(source).toContain("quickSwitcherBrowsingElsewhere() ? EMPTY_STATE_MAP");
    expect(source).toContain("quickSwitcherBrowsingElsewhere() ? undefined : state.selectedSession");
    expect(source).toContain("quickSwitcherBrowsingElsewhere() ? [] : state.projects");
    expect(source).toContain("!this.quickSwitcherBrowsingElsewhere() && this.canStartSession()");
  });
});

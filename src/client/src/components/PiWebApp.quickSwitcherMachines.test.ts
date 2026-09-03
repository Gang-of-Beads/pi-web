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
  return { id, name: id, baseUrl: `https://${id}.example.test`, kind: "remote" } as unknown as Machine;
}

function sessionOn(cwd: string): SessionInfo {
  return { id: "s-1", name: "remote session", cwd, modified: new Date().toISOString(), messageCount: 3 } as unknown as SessionInfo;
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

function callable(app: PiWebApp, name: string): (...args: unknown[]) => unknown {
  const value: unknown = Reflect.get(app, name);
  if (typeof value !== "function") throw new Error(`PiWebApp.${name} was unavailable`);
  return value.bind(app) as (...args: unknown[]) => unknown;
}

describe("opening a session from another machine's tab", () => {
  it("moves to that machine before selecting the session", async () => {
    const app = createApp();
    const local = machine("local");
    const remote = machine("remote-b");
    const setState = Reflect.get(app, "setState");
    if (typeof setState !== "function") throw new Error("PiWebApp.setState was unavailable");
    (setState as (patch: unknown) => void).call(app, { machines: [local, remote], selectedMachine: local });

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
    const setState = Reflect.get(app, "setState");
    if (typeof setState !== "function") throw new Error("PiWebApp.setState was unavailable");
    (setState as (patch: unknown) => void).call(app, { machines: [local], selectedMachine: local });

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

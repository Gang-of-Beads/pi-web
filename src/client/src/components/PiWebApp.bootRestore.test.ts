import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Caught live: a phone reloads while the daemon is busy and the projects
 * listing fails once. The boot restored the route anyway, could not resolve
 * the project id against the empty list, gave up silently, and rewrote the
 * URL without the project — landing on "Select or start a session." with no
 * way back. A failed listing is a reason to retry the restore, not to
 * abandon it.
 */
describe("PiWebApp boot route restore with a failed projects listing", () => {
  it("defers the restore for retry instead of giving up", async () => {
    const app = createApp();
    const projectId = "93ebd97a-902f-4804-ba35-f9f6fcf2258a";
    const workspaceId = "0fc561d6efb4";
    stubWindowLocation(`?project=${projectId}&workspace=${workspaceId}`);

    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "loadMachines", () => Promise.resolve())) {
      throw new Error("Could not replace machines.loadMachines");
    }
    const projects: unknown = Reflect.get(app, "projects");
    if (typeof projects !== "object" || projects === null) throw new Error("PiWebApp ProjectController was unavailable");
    if (!Reflect.set(projects, "loadProjects", () => {
      const setState = unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState");
      setState.call(app, { projectsLoad: "loading" });
      return Promise.resolve(undefined);
    })) {
      throw new Error("Could not replace projects.loadProjects");
    }
    stubBackgroundRefreshes(app);
    if (!Reflect.set(app, "loadPluginsForSelectedMachine", () => Promise.resolve())) {
      throw new Error("Could not replace plugin loading");
    }
    if (!Reflect.set(app, "withChatScrollTransition", (task: () => Promise<void>) => task())) {
      throw new Error("Could not replace the chat scroll transition");
    }

    const restore = unknownFunction(Reflect.get(app, "loadProjectsAndRestoreRoute"), "PiWebApp.loadProjectsAndRestoreRoute");
    await restore.call(app);

    const pending: unknown = Reflect.get(app, "pendingRemoteRouteRestore");
    expect(pending).toBeDefined();
  });
});

/**
 * Caught live alongside the projects-listing failure above: the machines
 * roster failed on boot while the URL carried a remote machine's deep link.
 * The boot rewrote the route to the local machine, flattening the machine,
 * project and session out of the address bar. A roster without an answer is a
 * reason to wait for it, not to flatten the link - and, since B48, not a
 * reason to give up after five tries either: the boot waits for the roster
 * for as long as the deep link is still what the reader wants.
 */
describe("PiWebApp boot route restore while the machines roster has not answered", () => {
  it("waits for the roster on a remote deep link, and leaves the URL alone meanwhile", async () => {
    const boot = bootWithUnansweredRoster("?machine=remote-1&project=93ebd97a&workspace=0fc561d6");

    const booting = boot.run();
    await flushMicrotasks();

    expect(boot.rosterWaits()).toBe(1);
    expect(boot.restores()).toBe(0);
    expect(searchParams()).toContain("machine=remote-1");
    expect(searchParams()).toContain("project=93ebd97a");
    boot.answer(false);
    await booting;
  });

  it("restores the deep link once the roster answers", async () => {
    const boot = bootWithUnansweredRoster("?machine=remote-1&project=93ebd97a&workspace=0fc561d6");

    const booting = boot.run();
    await flushMicrotasks();
    boot.setState({ machinesLoad: "loaded", machines: [{ id: "remote-1", name: "remote-1", kind: "remote" }], selectedMachine: { id: "remote-1", name: "remote-1", kind: "remote" } });
    boot.answer(true);
    await booting;

    expect(boot.restores()).toBe(1);
    expect(searchParams()).toContain("machine=remote-1");
    expect(searchParams()).toContain("project=93ebd97a");
  });

  it("restores nothing, and leaves the URL alone, when the reader moved on before the roster answered", async () => {
    const boot = bootWithUnansweredRoster("?machine=remote-1&project=93ebd97a");

    const booting = boot.run();
    await flushMicrotasks();
    boot.answer(false);
    await booting;

    expect(boot.restores()).toBe(0);
    expect(searchParams()).toContain("machine=remote-1");
  });

  it("does not wait for the roster on a local route", async () => {
    const boot = bootWithUnansweredRoster("?project=93ebd97a");

    await boot.run();

    expect(boot.rosterWaits()).toBe(0);
    expect(boot.restores()).toBe(1);
    expect(searchParams()).toContain("project=93ebd97a");
  });
});

/** A boot whose roster read has not answered; the test says when, and whether, it does. */
function bootWithUnansweredRoster(search: string) {
  const app = createApp();
  stubWindowLocation(search);
  stubBackgroundRefreshes(app);
  const setState = (patch: object) => { unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, patch); };
  let rosterWaits = 0;
  let restores = 0;
  let answer: (answered: boolean) => void = () => undefined;
  const machines: unknown = Reflect.get(app, "machines");
  if (typeof machines !== "object" || machines === null) throw new Error("PiWebApp MachineController was unavailable");
  if (!Reflect.set(machines, "loadMachines", () => {
    setState({ machinesLoad: "loading" });
    return Promise.resolve();
  })) throw new Error("Could not replace machines.loadMachines");
  if (!Reflect.set(machines, "rosterAnswered", () => {
    rosterWaits += 1;
    return new Promise<boolean>((resolve) => { answer = resolve; });
  })) throw new Error("Could not replace machines.rosterAnswered");
  const projects: unknown = Reflect.get(app, "projects");
  if (typeof projects !== "object" || projects === null || !Reflect.set(projects, "loadProjects", () => {
    setState({ projectsLoad: "loaded" });
    return Promise.resolve(undefined);
  })) throw new Error("Could not replace projects.loadProjects");
  if (!Reflect.set(app, "loadPluginsForSelectedMachine", () => Promise.resolve())) throw new Error("Could not replace plugin loading");
  if (!Reflect.set(app, "withChatScrollTransition", (task: () => Promise<void>) => task())) throw new Error("Could not replace the chat scroll transition");
  if (!Reflect.set(app, "restoreRouteFor", () => {
    restores += 1;
    return Promise.resolve();
  })) throw new Error("Could not replace route restoration");
  const boot = unknownFunction(Reflect.get(app, "loadProjectsAndRestoreRoute"), "PiWebApp.loadProjectsAndRestoreRoute");
  return {
    run: async () => { await boot.call(app); },
    answer: (answered: boolean) => { answer(answered); },
    setState,
    rosterWaits: () => rosterWaits,
    restores: () => restores,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

/**
 * B48: a remote deep link used to stop after five tries with "is still
 * unavailable." and drop the restore. It keeps trying, on the shared backoff
 * capped at the quiet window, for as long as the route is current.
 */
describe("PiWebApp remote route restore while the machine does not answer", () => {
  it("keeps scheduling past the old fifth try, capped at 15 s, and never says it gave up", async () => {
    const app = createApp();
    stubWindowLocation("?machine=remote-1&project=93ebd97a");
    const remote = { id: "remote-1", name: "Remote one", kind: "remote" };
    unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, { machines: [remote], selectedMachine: remote });
    const delays: number[] = [];
    if (!Reflect.set(app, "schedulePendingRemoteRouteRestore", (delayMs?: number) => { delays.push(delayMs ?? -1); })) throw new Error("Could not replace the restore scheduler");
    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "refreshMachineHealth", () => answeredHealth(app, { machineId: "remote-1", ok: false, checkedAt: "now", status: "offline" }))) {
      throw new Error("Could not replace machines.refreshMachineHealth");
    }
    const route = { machineId: "remote-1", projectId: "93ebd97a" };
    unknownFunction(Reflect.get(app, "deferRemoteRouteRestore"), "PiWebApp.deferRemoteRouteRestore").call(app, route, unknownFunction(Reflect.get(Reflect.get(app, "navigation"), "latest"), "navigation.latest").call(Reflect.get(app, "navigation")));
    delays.length = 0;

    const retry = unknownFunction(Reflect.get(app, "retryPendingRemoteRouteRestore"), "PiWebApp.retryPendingRemoteRouteRestore");
    for (let attempt = 0; attempt < 8; attempt += 1) await retry.call(app);

    expect(Reflect.get(app, "pendingRemoteRouteRestore")).toBeDefined();
    expect(delays).toEqual([2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000]);
    const state: unknown = Reflect.get(app, "state");
    const error: unknown = typeof state === "object" && state !== null ? Reflect.get(state, "error") : undefined;
    expect(String(error)).not.toContain("still unavailable");
    expect(String(error)).toContain("Remote one is unavailable; reconnecting");
  });

  /** Review 6088e664: a notice the ladder raises again on every try brought a dismissed banner back every 15 s, for as long as the reader stayed. */
  it("does not raise the same notice again after the reader dismissed it", async () => {
    const app = createApp();
    stubWindowLocation("?machine=remote-1&project=93ebd97a");
    const remote = { id: "remote-1", name: "Remote one", kind: "remote" };
    const setState = unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState");
    setState.call(app, { machines: [remote], selectedMachine: remote });
    if (!Reflect.set(app, "schedulePendingRemoteRouteRestore", () => undefined)) throw new Error("Could not replace the restore scheduler");
    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "refreshMachineHealth", () => answeredHealth(app, { machineId: "remote-1", ok: false, checkedAt: "now", status: "offline", error: "timed out" }))) {
      throw new Error("Could not replace machines.refreshMachineHealth");
    }
    const navigation: unknown = Reflect.get(app, "navigation");
    if (typeof navigation !== "object" || navigation === null) throw new Error("PiWebApp navigation was unavailable");
    unknownFunction(Reflect.get(app, "deferRemoteRouteRestore"), "PiWebApp.deferRemoteRouteRestore").call(app, { machineId: "remote-1", projectId: "93ebd97a" }, unknownFunction(Reflect.get(navigation, "latest"), "navigation.latest").call(navigation));
    const retry = unknownFunction(Reflect.get(app, "retryPendingRemoteRouteRestore"), "PiWebApp.retryPendingRemoteRouteRestore");
    await retry.call(app);
    const errorNow = () => { const state: unknown = Reflect.get(app, "state"); return typeof state === "object" && state !== null ? String(Reflect.get(state, "error")) : ""; };
    expect(errorNow()).toContain("Remote one is unavailable; reconnecting");

    setState.call(app, { error: "", errorRetiredBy: undefined, errorMachineId: undefined });
    await retry.call(app);
    await retry.call(app);

    expect(errorNow()).toBe("");
  });
});

/**
 * Review 98e437b2: the ladder named the remote "unavailable" after any try
 * whose health was not ok - including a health read that failed on the way,
 * which says nothing about the remote. It names the machine only when the web
 * process answered that the remote is down.
 */
describe("PiWebApp remote route restore when the health read itself fails", () => {
  it("keeps trying without blaming the remote", async () => {
    const app = createApp();
    stubWindowLocation("?machine=remote-1&project=93ebd97a");
    const remote = { id: "remote-1", name: "Remote one", kind: "remote" };
    const setState = unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState");
    setState.call(app, { machines: [remote], selectedMachine: remote, machineStatuses: { "remote-1": { machineId: "remote-1", ok: false, checkedAt: "now", status: "unknown", error: "Failed to fetch" } } });
    const delays: number[] = [];
    if (!Reflect.set(app, "schedulePendingRemoteRouteRestore", (delayMs: number) => { delays.push(delayMs); })) throw new Error("Could not replace the restore scheduler");
    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "refreshMachineHealth", () => Promise.resolve(undefined))) {
      throw new Error("Could not replace machines.refreshMachineHealth");
    }
    const navigation: unknown = Reflect.get(app, "navigation");
    if (typeof navigation !== "object" || navigation === null) throw new Error("PiWebApp navigation was unavailable");
    unknownFunction(Reflect.get(app, "deferRemoteRouteRestore"), "PiWebApp.deferRemoteRouteRestore").call(app, { machineId: "remote-1", projectId: "93ebd97a" }, unknownFunction(Reflect.get(navigation, "latest"), "navigation.latest").call(navigation));
    await unknownFunction(Reflect.get(app, "retryPendingRemoteRouteRestore"), "PiWebApp.retryPendingRemoteRouteRestore").call(app);

    const state: unknown = Reflect.get(app, "state");
    const error = typeof state === "object" && state !== null ? String(Reflect.get(state, "error")) : "";
    expect(error).not.toContain("is unavailable");
    expect(Reflect.get(app, "pendingRemoteRouteRestore")).toBeDefined();
    expect(delays.length).toBe(2);
  });
});

/** Review 6088e664: Retry on the banner re-read the roster and moved a reader on a remote machine to the local one. */
describe("PiWebApp banner Retry", () => {
  it("re-reads the roster for the machine the reader is on", async () => {
    const app = createApp();
    const remote = { id: "remote-1", name: "Remote one", kind: "remote" };
    unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, { machines: [remote], selectedMachine: remote });
    const asked: unknown[] = [];
    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "loadMachines", (machineId: unknown) => { asked.push(machineId); return Promise.resolve(); })) {
      throw new Error("Could not replace machines.loadMachines");
    }

    await unknownFunction(Reflect.get(app, "retryAfterError"), "PiWebApp.retryAfterError").call(app);

    expect(asked).toEqual(["remote-1"]);
  });
});

/** A health read the web process answered, written to the state as the real read writes it. */
function answeredHealth(app: PiWebApp, health: { machineId: string; ok: boolean; checkedAt: string; status: string; error?: string }): Promise<typeof health> {
  unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, { machineStatuses: { [health.machineId]: health } });
  return Promise.resolve(health);
}

function searchParams(): string {
  const location: unknown = window.location;
  if (typeof location !== "object" || location === null) throw new Error("window.location was unavailable");
  const href: unknown = Reflect.get(location, "href");
  if (typeof href !== "string") throw new Error("window.location.href was unavailable");
  return new URL(href).search;
}

function isAppMethod(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function unknownFunction(value: unknown, label: string): (...args: unknown[]) => unknown {
  if (!isAppMethod(value)) throw new Error(`${label} was unavailable`);
  return value;
}

function createApp(): PiWebApp {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const location = { search: "", href: "https://pi.example.test/" };
  const history = {
    replaceState: (_state: unknown, _unused: string, url: string) => {
      location.href = new URL(url, "https://pi.example.test/").href;
      location.search = new URL(url, "https://pi.example.test/").search;
    },
  };
  vi.stubGlobal("window", {
    location,
    history,
    localStorage: storage,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  const app = new PiWebApp();
  if (!Reflect.set(app, "ensureGatewayPluginsLoaded", () => Promise.resolve())) throw new Error("Could not replace the gateway plugin load");
  if (!Reflect.set(app, "loadPluginsForMachine", () => Promise.resolve())) throw new Error("Could not replace a machine's plugin load");
  return app;
}

function stubWindowLocation(search: string): void {
  const location: unknown = Reflect.get(window, "location");
  if (typeof location === "object" && location !== null) {
    if (!Reflect.set(location, "search", search)) throw new Error("Could not set window.location.search");
    if (!Reflect.set(location, "href", `https://pi.example.test/${search}`)) throw new Error("Could not set window.location.href");
  }
}

function stubBackgroundRefreshes(app: PiWebApp): void {
  const result = () => Promise.resolve();
  const appRefreshes = [
    "refreshMachineStatusSnapshots",
    "refreshWorkspaceDeletionRuns",
    "refreshCurrentWorkspaceSurface",
  ];
  for (const name of appRefreshes) {
    if (!Reflect.set(app, name, result)) throw new Error(`Could not replace PiWebApp.${name}`);
  }
  const workspaces: unknown = Reflect.get(app, "workspaces");
  if (typeof workspaces !== "object" || workspaces === null || !Reflect.set(workspaces, "refreshSelectedProjectTopology", result)) {
    throw new Error("Could not replace the workspace topology refresh");
  }
  const sessions: unknown = Reflect.get(app, "sessions");
  if (typeof sessions !== "object" || sessions === null || !Reflect.set(sessions, "refreshSelectedSession", result)) {
    throw new Error("Could not replace the selected-session refresh");
  }
  const sessionUnread: unknown = Reflect.get(app, "sessionUnread");
  if (typeof sessionUnread !== "object" || sessionUnread === null || !Reflect.set(sessionUnread, "refreshAll", result)) {
    throw new Error("Could not replace the unread refresh");
  }
}

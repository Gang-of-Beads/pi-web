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
      setState.call(app, { projectsLoad: "failed" });
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
 * project and session out of the address bar. A failed roster is a reason to
 * retry the boot, not to flatten the link.
 */
describe("PiWebApp boot route restore with a failed machines roster", () => {
  it("defers a non-local deep link for retry instead of rewriting the URL", async () => {
    const app = createApp();
    stubWindowLocation("?machine=remote-1&project=93ebd97a&workspace=0fc561d6");
    stubBackgroundRefreshes(app);

    let loadMachinesCalls = 0;
    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "loadMachines", () => {
      loadMachinesCalls += 1;
      unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, { machinesLoad: "failed" });
      return Promise.resolve();
    })) {
      throw new Error("Could not replace machines.loadMachines");
    }

    const restore = unknownFunction(Reflect.get(app, "loadProjectsAndRestoreRoute"), "PiWebApp.loadProjectsAndRestoreRoute");
    await restore.call(app);

    const pending: unknown = Reflect.get(app, "pendingMachineLoadRestore");
    expect(pending).toBeDefined();
    expect(loadMachinesCalls).toBe(1);
    expect(searchParams()).toContain("machine=remote-1");
  });

  it("retries the roster and re-enters the boot restore once it loads", async () => {
    const app = createApp();
    stubWindowLocation("?machine=remote-1&project=93ebd97a&workspace=0fc561d6");
    stubBackgroundRefreshes(app);

    let loadMachinesCalls = 0;
    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "loadMachines", () => {
      loadMachinesCalls += 1;
      const setState = unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState");
      setState.call(app, loadMachinesCalls === 1
        ? { machinesLoad: "failed" }
        : { machinesLoad: "loaded", selectedMachine: { id: "remote-1", name: "remote-1", kind: "remote" } });
      return Promise.resolve();
    })) {
      throw new Error("Could not replace machines.loadMachines");
    }
    const projects: unknown = Reflect.get(app, "projects");
    if (typeof projects !== "object" || projects === null || !Reflect.set(projects, "loadProjects", () => {
      unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, { projectsLoad: "loaded" });
      return Promise.resolve(undefined);
    })) {
      throw new Error("Could not replace projects.loadProjects");
    }
    if (!Reflect.set(app, "loadPluginsForSelectedMachine", () => Promise.resolve())) {
      throw new Error("Could not replace plugin loading");
    }
    if (!Reflect.set(app, "withChatScrollTransition", (task: () => Promise<void>) => task())) {
      throw new Error("Could not replace the chat scroll transition");
    }
    if (!Reflect.set(app, "restoreRouteFor", () => Promise.resolve())) {
      throw new Error("Could not replace route restoration");
    }

    const boot = unknownFunction(Reflect.get(app, "loadProjectsAndRestoreRoute"), "PiWebApp.loadProjectsAndRestoreRoute");
    await boot.call(app);
    expect(Reflect.get(app, "pendingMachineLoadRestore")).toBeDefined();

    const retry = unknownFunction(Reflect.get(app, "retryMachineLoadRestore"), "PiWebApp.retryMachineLoadRestore");
    await retry.call(app);

    expect(loadMachinesCalls).toBe(2);
    expect(Reflect.get(app, "pendingMachineLoadRestore")).toBeUndefined();
    expect(searchParams()).toContain("machine=remote-1");
    expect(searchParams()).toContain("project=93ebd97a");
  });

  it("exhausts the ladder with the URL and the failed panel untouched", async () => {
    const app = createApp();
    stubWindowLocation("?machine=remote-1");
    stubBackgroundRefreshes(app);

    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "loadMachines", () => {
      unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, { machinesLoad: "failed" });
      return Promise.resolve();
    })) {
      throw new Error("Could not replace machines.loadMachines");
    }

    const boot = unknownFunction(Reflect.get(app, "loadProjectsAndRestoreRoute"), "PiWebApp.loadProjectsAndRestoreRoute");
    await boot.call(app);
    expect(Reflect.get(app, "pendingMachineLoadRestore")).toBeDefined();

    const retry = unknownFunction(Reflect.get(app, "retryMachineLoadRestore"), "PiWebApp.retryMachineLoadRestore");
    Reflect.set(app, "machineLoadRestoreAttempt", REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS_LENGTH - 1);
    await retry.call(app);

    expect(Reflect.get(app, "pendingMachineLoadRestore")).toBeUndefined();
    expect(searchParams()).toContain("machine=remote-1");
  });

  it("leaves a local-machine route alone when the roster fails", async () => {
    const app = createApp();
    stubWindowLocation("?project=93ebd97a");
    stubBackgroundRefreshes(app);
    const projects: unknown = Reflect.get(app, "projects");
    if (typeof projects !== "object" || projects === null || !Reflect.set(projects, "loadProjects", () => {
      unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, { projectsLoad: "loaded" });
      return Promise.resolve(undefined);
    })) {
      throw new Error("Could not replace projects.loadProjects");
    }
    if (!Reflect.set(app, "loadPluginsForSelectedMachine", () => Promise.resolve())) {
      throw new Error("Could not replace plugin loading");
    }
    if (!Reflect.set(app, "withChatScrollTransition", (task: () => Promise<void>) => task())) {
      throw new Error("Could not replace the chat scroll transition");
    }
    if (!Reflect.set(app, "restoreRouteFor", () => Promise.resolve())) {
      throw new Error("Could not replace route restoration");
    }

    const machines: unknown = Reflect.get(app, "machines");
    if (typeof machines !== "object" || machines === null || !Reflect.set(machines, "loadMachines", () => {
      unknownFunction(Reflect.get(app, "setState"), "PiWebApp.setState").call(app, { machinesLoad: "failed" });
      return Promise.resolve();
    })) {
      throw new Error("Could not replace machines.loadMachines");
    }

    const restore = unknownFunction(Reflect.get(app, "loadProjectsAndRestoreRoute"), "PiWebApp.loadProjectsAndRestoreRoute");
    await restore.call(app);

    expect(Reflect.get(app, "pendingMachineLoadRestore")).toBeUndefined();
    expect(searchParams()).toContain("project=93ebd97a");
  });
});

const REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS_LENGTH = 5;

function searchParams(): string {
  const location: unknown = window.location;
  if (typeof location !== "object" || location === null) throw new Error("window.location was unavailable");
  const search: unknown = Reflect.get(location, "search");
  if (typeof search !== "string") throw new Error("window.location.search was unavailable");
  return search;
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
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: storage,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  return new PiWebApp();
}

function stubWindowLocation(search: string): void {
  const location: unknown = Reflect.get(window, "location");
  if (typeof location === "object" && location !== null) {
    if (!Reflect.set(location, "search", search)) throw new Error("Could not set window.location.search");
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

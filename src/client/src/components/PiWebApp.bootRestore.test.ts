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

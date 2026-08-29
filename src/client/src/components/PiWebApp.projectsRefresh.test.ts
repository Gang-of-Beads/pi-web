import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectController } from "../controllers/projectController";
import { PiWebApp } from "./PiWebApp";

type RefreshCallback = () => void | Promise<void>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Coming back to the foreground is when a connection that died while the tab
 * was hidden gets noticed, and every other surface refetches what it missed —
 * except projects. A projects listing that failed while the browser slept
 * stayed failed until the reader reloaded by hand.
 */
describe("PiWebApp projects refresh wiring", () => {
  it("re-lists the projects on the browser-resume refresh", async () => {
    const app = createApp();
    stubBackgroundRefreshes(app);
    const loadProjects = spyOnLoadProjects(app);

    await browserResumeRefresh(app)();

    expect(loadProjects).toHaveBeenCalledOnce();
  });
});

function createApp(): PiWebApp {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage });
  return new PiWebApp();
}

/**
 * Replaces the sibling refreshes that already have their own coverage so this
 * test observes only whether the resume path includes projects.
 */
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

function spyOnLoadProjects(app: PiWebApp) {
  const controller: unknown = Reflect.get(app, "projects");
  if (!(controller instanceof ProjectController)) throw new Error("PiWebApp ProjectController was unavailable");
  return vi.spyOn(controller, "loadProjects").mockResolvedValue(undefined);
}

/** The exact callback `BrowserResumeController` invokes after a focus/visibility signal. */
function browserResumeRefresh(app: PiWebApp): RefreshCallback {
  const resume: unknown = Reflect.get(app, "browserResume");
  if (typeof resume !== "object" || resume === null) throw new Error("PiWebApp BrowserResumeController was unavailable");
  const callbacks: unknown = Reflect.get(resume, "callbacks");
  if (typeof callbacks !== "object" || callbacks === null) throw new Error("Browser resume callbacks were unavailable");
  const refresh: unknown = Reflect.get(callbacks, "refreshAfterResume");
  if (!isRefreshCallback(refresh)) throw new Error("The browser resume refresh callback was unavailable");
  return refresh;
}

function isRefreshCallback(value: unknown): value is RefreshCallback {
  return typeof value === "function";
}

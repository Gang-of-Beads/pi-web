import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceController } from "../controllers/workspaceController";
import { PiWebApp } from "./PiWebApp";

type RefreshCallback = () => void | Promise<void>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp workspace topology refresh wiring", () => {
  it("re-lists the selected project's workspaces on the browser-resume refresh", async () => {
    const app = createApp();
    stubBackgroundRefreshes(app);
    const refreshTopology = spyOnTopologyRefresh(app);
    const refreshSurface = replaceRefresh(app, "refreshCurrentWorkspaceSurface");

    await browserResumeRefresh(app)();

    expect(refreshTopology).toHaveBeenCalledOnce();
    expect(refreshSurface).toHaveBeenCalledOnce();
  });

  it("re-lists the selected project's workspaces on the plugin-facing app-data refresh", async () => {
    const app = createApp();
    stubBackgroundRefreshes(app);
    const refreshTopology = spyOnTopologyRefresh(app);
    const refreshSurface = replaceRefresh(app, "refreshCurrentWorkspaceSurface");

    await refreshAppData(app);

    expect(refreshTopology).toHaveBeenCalledOnce();
    expect(refreshSurface).toHaveBeenCalledOnce();
  });

  it("still re-lists workspaces when a sibling refresh in the same resume batch fails", async () => {
    const app = createApp();
    stubBackgroundRefreshes(app);
    failBackgroundRefresh(app, "refreshMachineStatusSnapshots", new Error("machine status unavailable"));
    const refreshTopology = spyOnTopologyRefresh(app);

    await expect(browserResumeRefresh(app)()).rejects.toThrow("machine status unavailable");
    expect(refreshTopology).toHaveBeenCalledOnce();
  });
});

/**
 * B48, review P2-4: a machine switch and a session opened from another project
 * write the selection directly, so the workspace listings are told about every
 * selection change here, not only through the controller's own entry points.
 * Without it, the project left behind kept being read forever.
 */
describe("PiWebApp tells the workspace listings where the reader is", () => {
  it("on a machine switch, a project change and a workspace change, and not on unrelated state", () => {
    const app = createApp();
    const controller: unknown = Reflect.get(app, "workspaces");
    if (!(controller instanceof WorkspaceController)) throw new Error("PiWebApp WorkspaceController was unavailable");
    const selectionChanged = vi.spyOn(controller, "selectionChanged").mockImplementation(() => undefined);
    const setState: unknown = Reflect.get(app, "setState");
    if (typeof setState !== "function") throw new Error("PiWebApp.setState is not callable");
    const apply = (patch: object) => { try { Reflect.apply(setState, app, [patch]); } catch { return; } };
    const project = { id: "p1", name: "p1", path: "/p1", createdAt: "now" };
    const workspace = { id: "w1", projectId: "p1", path: "/p1", label: "p1", isMain: true, effectiveConfig: {} };

    apply({ newerPendingCount: 3 });
    expect(selectionChanged).not.toHaveBeenCalled();
    apply({ selectedProject: project });
    apply({ selectedWorkspace: workspace });
    apply({ selectedMachine: { id: "remote", name: "remote", kind: "remote", createdAt: "now", updatedAt: "now" } });

    expect(selectionChanged).toHaveBeenCalledTimes(3);
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
 * Replaces the sibling refreshes that already have their own coverage so this test
 * observes only whether the resume/app-data paths include workspace topology.
 */
function stubBackgroundRefreshes(app: PiWebApp): void {
  const result = () => Promise.resolve();
  for (const name of [
    "refreshMachineStatusSnapshots",
    "refreshWorkspaceDeletionRuns",
    "loadClientConfig",
    "refreshCurrentWorkspaceSurface",
    "schedulePiWebStatusRefresh",
  ]) {
    if (!Reflect.set(app, name, result)) throw new Error(`Could not replace PiWebApp.${name}`);
  }
  const sessions: unknown = Reflect.get(app, "sessions");
  if (typeof sessions !== "object" || sessions === null || !Reflect.set(sessions, "refreshSelectedSession", result)) {
    throw new Error("Could not replace the selected-session refresh");
  }
}

function failBackgroundRefresh(app: PiWebApp, name: string, error: Error): void {
  if (!Reflect.set(app, name, () => Promise.reject(error))) throw new Error(`Could not fail PiWebApp.${name}`);
}

function replaceRefresh(app: PiWebApp, name: string) {
  const refresh = vi.fn<RefreshCallback>(() => Promise.resolve());
  if (!Reflect.set(app, name, refresh)) throw new Error(`Could not replace PiWebApp.${name}`);
  return refresh;
}

function spyOnTopologyRefresh(app: PiWebApp) {
  const controller: unknown = Reflect.get(app, "workspaces");
  if (!(controller instanceof WorkspaceController)) throw new Error("PiWebApp WorkspaceController was unavailable");
  return vi.spyOn(controller, "refreshSelectedProjectTopology").mockResolvedValue(undefined);
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

async function refreshAppData(app: PiWebApp): Promise<void> {
  const refresh: unknown = Reflect.get(app, "refreshAppData");
  if (!isRefreshCallback(refresh)) throw new Error("PiWebApp.refreshAppData is not callable");
  await refresh.call(app);
}

function isRefreshCallback(value: unknown): value is RefreshCallback {
  return typeof value === "function";
}

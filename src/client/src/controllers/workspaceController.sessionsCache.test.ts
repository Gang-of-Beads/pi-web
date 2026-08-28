import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../appState";
import { initialAppState } from "../appState";
import type { Project, SessionInfo, Workspace } from "../api";
import { clearWorkspaceSessionsCache } from "../workspaceSessionsCache";
import type { SessionController } from "./sessionController";
import { WorkspaceController } from "./workspaceController";

/**
 * The workspace switch reset the session list to `[]` before fetching, so the
 * list read as "known empty" while it was actually "not loaded yet", and a
 * revisited workspace redrew nothing until its listing came back. A
 * per-workspace cache seeds the previous list immediately, and the load state
 * distinguishes "switching, stale list retained" from "loaded empty".
 */
describe("WorkspaceController session loading discipline", () => {
  beforeEach(() => {
    // The cache is module state; each test starts from no known workspace.
    clearWorkspaceSessionsCache();
  });

  it("seeds a revisited workspace's previous list while the fresh listing is in flight", async () => {
    const { controller, state, sessionsApi } = harness();
    sessionsApi.mockResolvedValueOnce([session("/a", "a1")]);
    await controller.selectWorkspace(workspace("/a"));
    expect(state().sessions).toEqual([session("/a", "a1")]);

    const freshListing = deferred<SessionInfo[]>();
    sessionsApi.mockResolvedValueOnce([]);
    await controller.selectWorkspace(workspace("/b"));
    sessionsApi.mockImplementation(() => freshListing.promise);
    const revisit = controller.selectWorkspace(workspace("/a"));

    // The cache answers immediately: the previous list is on screen while the
    // fresh listing loads, and the state says loading rather than empty.
    expect(state().sessions).toEqual([session("/a", "a1")]);
    expect(state().sessionsLoad).toBe("loading");

    freshListing.resolve([]);
    await revisit;
    expect(state().sessionsLoad).toBe("loaded");
    expect(state().sessions).toEqual([]);
  });

  it("keeps the stale list and records a failure instead of claiming empty", async () => {
    const { controller, state, sessionsApi } = harness();
    sessionsApi.mockResolvedValueOnce([session("/a", "a1")]);
    await controller.selectWorkspace(workspace("/a"));

    sessionsApi.mockRejectedValueOnce(new Error("listing failed"));
    await controller.selectWorkspace(workspace("/a"));

    // The row stays on screen (the cache), the state is not "loaded" (so the
    // list cannot claim "No sessions yet"), and the banner carries the failure.
    expect(state().sessions).toEqual([session("/a", "a1")]);
    expect(state().sessionsLoad).toBe("unloaded");
    expect(state().error).toContain("listing failed");
  });

  it("loads a workspace it has never seen into a quiet loading state, then loaded-empty", async () => {
    const { controller, state, sessionsApi } = harness();
    const firstListing = deferred<SessionInfo[]>();
    sessionsApi.mockImplementation(() => firstListing.promise);
    const pending = controller.selectWorkspace(workspace("/cold"));

    expect(state().sessions).toEqual([]);
    expect(state().sessionsLoad).toBe("loading");

    firstListing.resolve([]);
    await pending;
    expect(state().sessionsLoad).toBe("loaded");
  });
});

function session(cwd: string, id: string): SessionInfo {
  return { id, cwd, path: `${cwd}/.sessions/${id}.jsonl`, created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
}

function workspace(path: string): Workspace {
  return { id: path, projectId: "p1", path, label: path, isMain: true, effectiveConfig: {} };
}

function project(): Project {
  return { id: "p1", name: "p1", path: "/repo", createdAt: "now" };
}

function harness() {
  let state: AppState = {
    ...initialAppState(),
    projects: [project()],
    selectedProject: project(),
  };
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
  const sessionsController: Pick<SessionController, "clearActiveSession" | "preferredSession" | "selectSession"> = {
    clearActiveSession: vi.fn(),
    preferredSession: vi.fn(),
    selectSession: vi.fn(),
  };
  const sessionsApi = vi.fn<(path: string, machineId?: string) => Promise<SessionInfo[]>>();
  const controller = new WorkspaceController(
    () => state,
    setState,
    vi.fn(),
    sessionsController,
    undefined,
    {
      api: {
        workspaces: vi.fn().mockResolvedValue([workspace("/a"), workspace("/b"), workspace("/cold")]),
        sessions: sessionsApi,
        workspaceGoals: vi.fn(() => Promise.resolve({ goals: [], directory: "/repo/.pi/goals", generatedAt: "now" })),
        archiveWorkspaceGoal: vi.fn(),
      },
    },
  );
  return { controller, state: () => state, sessionsApi };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

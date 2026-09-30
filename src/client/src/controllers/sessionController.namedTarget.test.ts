import { describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo } from "../api";
import { HttpError } from "../api/http";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, emptyPage, FakeSocket, oldSession, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";
import { WorkspaceController } from "./workspaceController";

const project: Project = { id: workspace.projectId, name: "repo", path: workspace.path, createdAt: "now" };

function harness(api: Partial<typeof defaultApi>) {
  let state: AppState = { ...initialAppState(), projects: [project], selectedProject: project };
  const getState = () => state;
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
  const sessions = new SessionController(getState, setState, () => undefined, undefined, {
    api: { ...defaultApi, messages: () => Promise.resolve(emptyPage), status: (session) => Promise.resolve(status(sessionLookupId(session))), ...api },
    socket: new FakeSocket(),
  });
  const workspaces = new WorkspaceController(getState, setState, vi.fn(), sessions, undefined, {
    api: { workspaces: () => Promise.resolve([workspace]), sessions: () => Promise.resolve([oldSession]) },
  });
  return { sessions, workspaces, state: () => state };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

describe("a link that names a session (P2 slice b, B31)", () => {
  it("never opens another session in place of one the daemon says is gone", async () => {
    const { workspaces, state } = harness({ locateSession: () => Promise.reject(new HttpError("Session not found", 404, "local", undefined, "session-not-found")) });

    await workspaces.selectWorkspace(workspace, { sessionId: "deleted-session", updateUrl: false });
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget }).toEqual({
      selected: undefined,
      target: { machineId: "local", workspaceId: workspace.id, cwd: workspace.path, sessionId: "deleted-session", target: { kind: "gone", sessionId: "deleted-session" } },
    });
  });

  it("opens a session the listing lacks once the daemon locates it, and the target goes with the selection", async () => {
    const located: SessionInfo = { ...oldSession, id: "in-subdirectory", cwd: `${workspace.path}/packages/app` };
    const { workspaces, state } = harness({ locateSession: () => Promise.resolve({ kind: "found", session: located }) });

    await workspaces.selectWorkspace(workspace, { sessionId: "in-subdirectory", updateUrl: false });
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget }).toEqual({ selected: "in-subdirectory", target: undefined });
  });

  it("keeps a new session the reader started while an earlier link was still being asked about", async () => {
    vi.useFakeTimers();
    try {
      let locates = 0;
      const { sessions, workspaces, state } = harness({
        locateSession: () => {
          locates += 1;
          return locates === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve({ kind: "found", session: { ...oldSession, id: "linked-late" } });
        },
        startSession: () => new Promise(() => undefined),
      });
      await workspaces.selectWorkspace(workspace, { sessionId: "linked-late", updateUrl: false });
      await settle();

      void sessions.startSession();
      await settle();
      const started = state().selectedSession?.id;
      await vi.advanceTimersByTimeAsync(20_000);

      expect({ startedSomething: started !== undefined, selected: state().selectedSession?.id, target: state().sessionTarget, locates }).toEqual({ startedSomething: true, selected: started, target: undefined, locates: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still opens the latest session when the workspace is opened without naming one", async () => {
    const locateSession = vi.fn(() => Promise.reject(new Error("nothing was named")));
    const { workspaces, state } = harness({ locateSession });

    await workspaces.selectWorkspace(workspace, { updateUrl: false });
    await settle();

    expect({ selected: state().selectedSession?.id, asked: locateSession.mock.calls.length }).toEqual({ selected: oldSession.id, asked: 0 });
  });
});

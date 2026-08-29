import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionController } from "./sessionController";
import { initialAppState } from "../appState";
import { defaultApi, EmitSocket, emptyPage, MemoryStorage, oldSession, status, workspace, type AppState } from "./sessionController.testSupport";
import type { Project, Workspace } from "../../../shared/apiTypes";

const elsewhere: Workspace = { ...workspace, id: "workspace-2", projectId: "project-2", path: "/elsewhere", label: "elsewhere" };
const here: Project = { id: "project-1", name: "repo", path: "/repo", createdAt: "2026-05-15T00:00:00.000Z" };
const there: Project = { id: "project-2", name: "elsewhere", path: "/elsewhere", createdAt: "2026-05-15T00:00:00.000Z" };
const sessionOverThere = { ...oldSession, id: "far-session", cwd: "/elsewhere" };

function api(): typeof defaultApi {
  return {
    ...defaultApi,
    messages: () => Promise.resolve(emptyPage),
    status: () => Promise.resolve(status(sessionOverThere.id)),
    streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
    thinkingLevels: () => Promise.resolve({ levels: [] }),
    sessions: (path: string) => Promise.resolve(path === "/elsewhere" ? [sessionOverThere] : [oldSession]),
  };
}

function controllerOver(patch: Partial<AppState>): { run: SessionController; read: () => AppState } {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedProject: here, ...patch };
  const run = new SessionController(
    () => state,
    (next) => { state = { ...state, ...next }; },
    () => undefined,
    undefined,
    { api: api(), socket: new EmitSocket() },
  );
  return { run, read: () => state };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

describe("choosing a session from another workspace", () => {
  /**
   * The switcher reaches any session on the machine. Choosing one set the
   * session and nothing else, so the conversation was the new one while the
   * Sessions list beside it still listed the workspace you came from.
   */
  it("takes the project and workspace with it", async () => {
    const { run, read } = controllerOver({ workspaces: [workspace, elsewhere], projects: [here, there] });

    await run.selectSession(sessionOverThere, { updateUrl: false });

    expect(read().selectedWorkspace?.id).toBe("workspace-2");
    expect(read().selectedProject?.id).toBe("project-2");
  });

  /**
   * An uncatalogued directory is not evidence that the current selection is
   * wrong.
   */
  it("keeps the selection when the directory is not catalogued", async () => {
    const { run, read } = controllerOver({ workspaces: [workspace], projects: [here] });

    await run.selectSession({ ...oldSession, id: "unknown", cwd: "/nowhere" }, { updateUrl: false });

    expect(read().selectedWorkspace?.id).toBe("workspace-1");
  });

  /**
   * The same move that takes the workspace with it must take the session list
   * with it: rows from the workspace you came from, rendered under the
   * workspace you chose, are another workspace's data on the wrong surface.
   */
  it("leaves the previous workspace's sessions behind", async () => {
    const { run, read } = controllerOver({
      workspaces: [workspace, elsewhere],
      projects: [here, there],
      sessions: [oldSession],
      sessionsLoad: "loaded",
    });

    await run.selectSession(sessionOverThere, { updateUrl: false });
    await vi.waitFor(() => {
      if (read().sessions.some((entry) => entry.cwd === "/repo")) throw new Error("the previous workspace's rows are still listed");
    });

    expect(read().sessions.every((entry) => entry.cwd === "/elsewhere" || entry.cwd === "")).toBe(true);
  });
});

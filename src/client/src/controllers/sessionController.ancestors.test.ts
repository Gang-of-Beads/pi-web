import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionController, type SessionControllerDependencies } from "./sessionController";
import * as ancestorLookup from "../sessionAncestorLookup";
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

function controllerOver(patch: Partial<AppState>, deps: Pick<SessionControllerDependencies, "catalogue"> = {}): { run: SessionController; read: () => AppState } {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedProject: here, ...patch };
  const run = new SessionController(
    () => state,
    (next) => { state = { ...state, ...next }; },
    () => undefined,
    undefined,
    { api: api(), socket: new EmitSocket(), ...deps },
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
    const { run, read } = controllerOver({
      workspaces: [workspace, elsewhere],
      projects: [here, there],
      sessions: [oldSession],
      sessionsLoad: "loaded",
    });

    await run.selectSession(sessionOverThere, { updateUrl: false });

    expect(read().selectedWorkspace?.id).toBe("workspace-2");
    expect(read().selectedProject?.id).toBe("project-2");
    expect(read().sessions).toEqual([]);
    expect(read().sessionsLoad).not.toBe("loaded");
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

  /**
   * A workspace lists its subdirectory sessions, so a project rooted at a
   * broad directory contains sessions that a deeper project also claims.
   * Choosing one must not hand the selection to the deeper claimant: the
   * Project chip flipped there while the session list kept answering for the
   * workspace the user chose (owner report, 2026-09-04).
   */
  it("keeps an explicit broad selection when it contains the session", async () => {
    const nested: Workspace = { ...workspace, id: "workspace-3", projectId: "project-3", path: "/repo/nested", label: "nested" };
    const deeper: Project = { id: "project-3", name: "nested", path: "/repo/nested", createdAt: "2026-05-15T00:00:00.000Z" };
    const locate = vi.spyOn(ancestorLookup, "locateSessionWorkspace").mockResolvedValue({ kind: "found", workspace: nested, project: deeper, workspaces: [nested] });
    try {
      const { run, read } = controllerOver({ workspaces: [workspace], projects: [here] });

      await run.selectSession({ ...oldSession, id: "contained", cwd: "/repo/nested" }, { updateUrl: false });
      await Promise.resolve();

      expect(locate).not.toHaveBeenCalled();
      expect(read().selectedWorkspace?.id).toBe("workspace-1");
      expect(read().selectedProject?.id).toBe("project-1");
    } finally {
      locate.mockRestore();
    }
  });

  /**
   * When the locator does move the selection - the session's directory is
   * outside the selected workspace - the session list must travel with the
   * chip, exactly as the exact-match path does. The chip flipping alone left
   * the list answering for the workspace being left.
   */
  it("carries the whole project and workspace scope when the locator moves the selection", async () => {
    const sibling = { ...elsewhere, id: "workspace-3", path: "/elsewhere/sibling", label: "sibling" };
    const locate = vi.spyOn(ancestorLookup, "locateSessionWorkspace").mockResolvedValue({ kind: "found", workspace: elsewhere, project: there, workspaces: [elsewhere, sibling] });
    try {
      const { run, read } = controllerOver({
        workspaces: [workspace],
        projects: [here],
        sessions: [oldSession],
        sessionsLoad: "loaded",
      });

      await run.selectSession(sessionOverThere, { updateUrl: false });
      await vi.waitFor(() => {
        if (read().selectedWorkspace?.id !== "workspace-2") throw new Error("the locator has not moved the selection yet");
      });

      expect(read().selectedProject?.id).toBe("project-2");
      expect(read().projects.some((project) => project.id === "project-2")).toBe(true);
      expect(read().workspaces.map((entry) => entry.id)).toEqual(["workspace-2", "workspace-3"]);
      expect(read().workspacesByProjectId["project-2"]?.map((entry) => entry.id)).toEqual(["workspace-2", "workspace-3"]);
      await vi.waitFor(() => {
        if (read().sessions.some((entry) => entry.cwd === "/repo")) throw new Error("the previous workspace's rows are still listed");
      });
      expect(read().sessions.every((entry) => entry.cwd === "/elsewhere" || entry.cwd === "")).toBe(true);
    } finally {
      locate.mockRestore();
    }
  });
});

describe("placing a session through the catalogue (B48)", () => {
  /**
   * The lookup read the projects and workspaces once and gave up on a lost
   * answer: a session opened from another project then left every workspace
   * panel answering for the project being left. It reads through the
   * catalogue now, which keeps reading until an answer comes.
   */
  it("places the session once the catalogue answers, however late", async () => {
    let answerProjects: ((projects: readonly Project[]) => void) | undefined;
    const catalogue = {
      projects: vi.fn(() => new Promise<readonly Project[] | undefined>((resolve) => { answerProjects = resolve; })),
      workspaces: vi.fn((...[, projectId]: [string, string, () => boolean]) => Promise.resolve(projectId === there.id ? [elsewhere] : [workspace])),
    };
    const { run, read } = controllerOver({ workspaces: [workspace], projects: [here] }, { catalogue });

    await run.selectSession(sessionOverThere, { updateUrl: false });
    expect(read().selectedWorkspace?.id).toBe("workspace-1");
    answerProjects?.([here, there]);

    await vi.waitFor(() => {
      if (read().selectedWorkspace?.id !== "workspace-2") throw new Error("the late answer has not placed the session yet");
    });
    expect(read().selectedProject?.id).toBe("project-2");
    expect(catalogue.projects).toHaveBeenCalledWith("local", expect.any(Function));
  });

  it("stops placing a session the reader has already left", async () => {
    let answer: (() => void) | undefined;
    let wantedWhenAnswered: boolean | undefined;
    const catalogue = {
      projects: vi.fn((...[, wanted]: [string, () => boolean]) => new Promise<readonly Project[] | undefined>((resolve) => {
        answer = () => {
          wantedWhenAnswered = wanted();
          resolve(wantedWhenAnswered ? [here, there] : undefined);
        };
      })),
      workspaces: vi.fn((...[, projectId]: [string, string, () => boolean]) => Promise.resolve(projectId === there.id ? [elsewhere] : [workspace])),
    };
    const { run, read } = controllerOver({ workspaces: [workspace], projects: [here] }, { catalogue });

    await run.selectSession(sessionOverThere, { updateUrl: false });
    await run.selectSession(oldSession, { updateUrl: false });
    answer?.();
    await Promise.resolve();

    expect(wantedWhenAnswered).toBe(false);
    expect(read().selectedWorkspace?.id).toBe("workspace-1");
    expect(catalogue.workspaces).not.toHaveBeenCalled();
  });

  /**
   * The catalogue answers only while the session is still the selected one. The placement used to
   * be asked before the selection named the session, so it found none selected and gave up at
   * once: a session opened from a project that was not loaded never took its project with it.
   */
  it("places a session from a project that was not loaded, through a catalogue that answers only while it is selected", async () => {
    const catalogue = {
      projects: (_machineId: string, wanted: () => boolean) => Promise.resolve(wanted() ? [here, there] : undefined),
      workspaces: (_machineId: string, projectId: string, wanted: () => boolean) => Promise.resolve(wanted() ? (projectId === there.id ? [elsewhere] : [workspace]) : undefined),
    };
    const { run, read } = controllerOver({ workspaces: [workspace], projects: [here], sessions: [oldSession], sessionsLoad: "loaded" }, { catalogue });

    await run.selectSession(sessionOverThere, { updateUrl: false });
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

    expect({ project: read().selectedProject?.id, workspace: read().selectedWorkspace?.id }).toEqual({ project: "project-2", workspace: "workspace-2" });
  });

  /**
   * B49: a pin outlives its project, and opening it does not reopen the project. The session
   * then sits outside every open project, and the page stopped naming the project the reader was
   * in only if it knew so: it kept that project, its workspace and its sessions under the session,
   * and wrote them into the URL. While a project has not answered, nothing moves.
   */
  it("leaves the project it was in for a session outside every open project, and keeps it while one has not answered", async () => {
    const closedSession = { ...oldSession, id: "closed-project-session", cwd: "/closed" };
    const answered = {
      projects: (_machineId: string, wanted: () => boolean) => Promise.resolve(wanted() ? [here, there] : undefined),
      workspaces: (_machineId: string, projectId: string, wanted: () => boolean) => Promise.resolve(wanted() ? (projectId === there.id ? [elsewhere] : [workspace]) : undefined),
    };
    const silent = {
      projects: (_machineId: string, wanted: () => boolean) => Promise.resolve(wanted() ? [here, there] : undefined),
      workspaces: (_machineId: string, projectId: string, wanted: () => boolean) => (projectId === there.id || !wanted() ? Promise.resolve(undefined) : Promise.resolve([workspace])),
    };
    const urls: number[] = [];
    let outsideState: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedProject: here, workspaces: [workspace], projects: [here], sessions: [oldSession], sessionsLoad: "loaded" };
    const outside = new SessionController(() => outsideState, (next) => { outsideState = { ...outsideState, ...next }; }, () => { urls.push(1); }, undefined, { api: api(), socket: new EmitSocket(), catalogue: answered });
    const unknown = controllerOver({ workspaces: [workspace], projects: [here], sessions: [oldSession], sessionsLoad: "loaded" }, { catalogue: silent });

    await outside.selectSession(closedSession, { updateUrl: false });
    await unknown.run.selectSession(closedSession, { updateUrl: false });
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

    expect({
      outside: { session: outsideState.selectedSession?.id, project: outsideState.selectedProject?.id, workspace: outsideState.selectedWorkspace?.id, sessions: outsideState.sessions.length, urlWritten: urls.length > 0 },
      unknown: { session: unknown.read().selectedSession?.id, project: unknown.read().selectedProject?.id, workspace: unknown.read().selectedWorkspace?.id },
    }).toEqual({
      outside: { session: "closed-project-session", project: undefined, workspace: undefined, sessions: 0, urlWritten: true },
      unknown: { session: "closed-project-session", project: "project-1", workspace: "workspace-1" },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../api/http";
import type { AppState } from "../appState";
import { initialAppState } from "../appState";
import type { Project, Workspace } from "../api";
import { addProjectFailureMessage, ProjectController } from "./projectController";

function project(id: string, path: string): Project {
  return { id, name: id, path, createdAt: "now" };
}

function workspace(projectId: string, path: string): Workspace {
  return { id: path, projectId, path, label: path, isMain: true, effectiveConfig: {} };
}

describe("ProjectController", () => {
  it("drops cached workspaces for projects a reload no longer lists", async () => {
    const currentProject = project("current", "/current");
    const removedProject = project("removed", "/removed");
    let state: AppState = {
      ...initialAppState(),
      projects: [removedProject],
      workspacesByProjectId: {
        [currentProject.id]: [workspace(currentProject.id, currentProject.path)],
        [removedProject.id]: [workspace(removedProject.id, removedProject.path)],
      },
    };
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject: vi.fn(), forgetProject: vi.fn(), clearSelection: vi.fn() },
      {
        api: {
          projects: vi.fn().mockResolvedValue([currentProject]),
          addProject: vi.fn(),
          reorderProjects: vi.fn(),
          closeProject: vi.fn(),
          setWorkspaceTrust: vi.fn(),
        },
      },
    );

    await controller.loadProjects();

    expect(state.projects).toEqual([currentProject]);
    expect(state.workspacesByProjectId).toEqual({
      [currentProject.id]: [workspace(currentProject.id, currentProject.path)],
    });
  });

  it("adds the project to app state before selecting it", async () => {
    const addedProject = project("added", "/added");
    let state: AppState = { ...initialAppState() };
    const selectProject = vi.fn((selected: Project): Promise<boolean> => {
      expect(selected).toBe(addedProject);
      expect(state.projects).toEqual([addedProject]);
      return Promise.resolve(true);
    });
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject, forgetProject: vi.fn(), clearSelection: vi.fn() },
      {
        api: {
          projects: vi.fn(),
          addProject: vi.fn().mockResolvedValue(addedProject),
          reorderProjects: vi.fn(),
          closeProject: vi.fn(),
          setWorkspaceTrust: vi.fn(),
        },
      },
    );

    await controller.addProject(" /added ");

    expect(selectProject).toHaveBeenCalledOnce();
  });

  it("pins a touched trust choice on the project's main workspace after adding it", async () => {
    const addedProject = project("added", "/added");
    const addedWorkspace = workspace(addedProject.id, addedProject.path);
    let state: AppState = { ...initialAppState() };
    const setWorkspaceTrust = vi.fn().mockResolvedValue({ path: "/added", decision: true, trusted: true });
    const selectProject = vi.fn((): Promise<boolean> => {
      state = { ...state, workspaces: [addedWorkspace] };
      return Promise.resolve(true);
    });
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject, forgetProject: vi.fn(), clearSelection: vi.fn() },
      {
        api: {
          projects: vi.fn(),
          addProject: vi.fn().mockResolvedValue(addedProject),
          reorderProjects: vi.fn(),
          closeProject: vi.fn(),
          setWorkspaceTrust,
        },
      },
    );

    await controller.addProject("/added", true, { trusted: true, changed: true });

    expect(setWorkspaceTrust).toHaveBeenCalledOnce();
    expect(setWorkspaceTrust).toHaveBeenCalledWith(addedProject.id, addedWorkspace.id, true, "local");
  });

  it("does not write trust when the dialog choice was not touched", async () => {
    const addedProject = project("added", "/added");
    let state: AppState = { ...initialAppState() };
    const setWorkspaceTrust = vi.fn();
    const selectProject = vi.fn((): Promise<boolean> => {
      state = { ...state, workspaces: [workspace(addedProject.id, addedProject.path)] };
      return Promise.resolve(true);
    });
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject, forgetProject: vi.fn(), clearSelection: vi.fn() },
      {
        api: {
          projects: vi.fn(),
          addProject: vi.fn().mockResolvedValue(addedProject),
          reorderProjects: vi.fn(),
          closeProject: vi.fn(),
          setWorkspaceTrust,
        },
      },
    );

    await controller.addProject("/added");
    await controller.addProject("/added", undefined, { trusted: true, changed: false });

    expect(setWorkspaceTrust).not.toHaveBeenCalled();
  });

  it("forgets a closed project's workspaces before clearing the selection it held", async () => {
    const closedProject = project("closed", "/closed");
    const remainingProject = project("remaining", "/remaining");
    let state: AppState = {
      ...initialAppState(),
      projects: [closedProject, remainingProject],
      selectedProject: closedProject,
      workspacesByProjectId: {
        [closedProject.id]: [workspace(closedProject.id, closedProject.path)],
        [remainingProject.id]: [workspace(remainingProject.id, remainingProject.path)],
      },
    };
    const events: string[] = [];
    const forgetProject = vi.fn((projectId: string) => {
      events.push("forget");
      state = {
        ...state,
        workspacesByProjectId: Object.fromEntries(Object.entries(state.workspacesByProjectId).filter(([id]) => id !== projectId)),
      };
    });
    const clearSelection = vi.fn(() => { events.push("clear"); });
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject: vi.fn(), forgetProject, clearSelection },
      {
        api: {
          projects: vi.fn(),
          addProject: vi.fn(),
          reorderProjects: vi.fn(),
          closeProject: vi.fn().mockResolvedValue(undefined),
          setWorkspaceTrust: vi.fn(),
        },
      },
    );

    await controller.closeProject(closedProject.id);

    expect(events).toEqual(["forget", "clear"]);
    expect(state.projects).toEqual([remainingProject]);
    expect(state.workspacesByProjectId[closedProject.id]).toBeUndefined();
    expect(clearSelection).toHaveBeenCalledOnce();
  });
});

describe("ProjectController.loadProjects", () => {
  it("never stops at a lost answer: it keeps the rows, writes no error, and retries by itself until the projects arrive (B48)", async () => {
    const kept = project("kept", "/kept");
    const listed = project("listed", "/listed");
    let state: AppState = { ...initialAppState(), projects: [kept] };
    const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
    let now = 0;
    const clock = {
      now: () => now,
      setTimer: (run: () => void, delayMs: number) => {
        const timer = { at: now + delayMs, run, cancelled: false };
        timers.push(timer);
        return () => { timer.cancelled = true; };
      },
    };
    const advance = (ms: number) => {
      now += ms;
      for (const timer of timers.filter((candidate) => !candidate.cancelled && candidate.at <= now)) { timer.cancelled = true; timer.run(); }
    };
    const projects = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce([listed]);
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject: vi.fn(), forgetProject: vi.fn(), clearSelection: vi.fn() },
      { api: { projects, addProject: vi.fn(), reorderProjects: vi.fn(), closeProject: vi.fn(), setWorkspaceTrust: vi.fn() }, clock },
    );

    await controller.loadProjects();

    expect({ projects: state.projects, load: state.projectsLoad, error: state.error }).toEqual({ projects: [kept], load: "loading", error: "" });
    advance(1000);
    await vi.waitFor(() => { expect(state.projectsLoad).toBe("loaded"); });
    expect(state.projects).toEqual([listed]);
    expect(projects).toHaveBeenCalledTimes(2);
  });

  it("says why the projects went unanswered, a server error in its own words, and still writes no error", async () => {
    let state: AppState = { ...initialAppState() };
    const projects = vi.fn().mockRejectedValue(new HttpError("Project store is locked", 500, "local"));
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject: vi.fn(), forgetProject: vi.fn(), clearSelection: vi.fn() },
      { api: { projects, addProject: vi.fn(), reorderProjects: vi.fn(), closeProject: vi.fn(), setWorkspaceTrust: vi.fn() }, clock: { now: () => 5, setTimer: () => () => undefined } },
    );

    await controller.loadProjects();

    expect(controller.unanswered()).toEqual({ since: 5, miss: { kind: "server-error", machineId: "local", reason: "Project store is locked" } });
    expect(state.error).toBe("");
    controller.dispose();
  });

  it("marks a completed listing loaded", async () => {
    const listed = project("listed", "/listed");
    let state: AppState = { ...initialAppState() };
    const controller = new ProjectController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { selectProject: vi.fn(), forgetProject: vi.fn(), clearSelection: vi.fn() },
      {
        api: {
          projects: vi.fn().mockResolvedValue([listed]),
          addProject: vi.fn(),
          reorderProjects: vi.fn(),
          closeProject: vi.fn(),
          setWorkspaceTrust: vi.fn(),
        },
      },
    );

    await controller.loadProjects();

    expect(state.projects).toEqual([listed]);
    expect(state.projectsLoad).toBe("loaded");
  });
});

describe("addProjectFailureMessage", () => {
  it("names the folder and the checkbox that would create it", () => {
    // The server reports this as "ENOENT ... realpath '/path'", which
    // describes a system call rather than the choice in front of the reader.
    expect(addProjectFailureMessage(new Error("ENOENT: no such file or directory, realpath '/x'")))
      .toMatch(/folder does not exist.*Create the folder/u);
  });

  it("distinguishes a file and a permission problem", () => {
    expect(addProjectFailureMessage(new Error("ENOTDIR: not a directory"))).toMatch(/file, not a folder/u);
    expect(addProjectFailureMessage(new Error("EACCES: permission denied"))).toMatch(/permissions/u);
  });

  it("passes anything else through without the Error prefix", () => {
    expect(addProjectFailureMessage(new Error("Machine is offline"))).toBe("Machine is offline");
  });
});

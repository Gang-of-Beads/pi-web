import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { Machine, Project, SessionInfo, Workspace } from "../api";
import { HttpError } from "../api/http";
import type { SessionController } from "./sessionController";
import { WorkspaceController } from "./workspaceController";

function machine(id: string): Machine {
  return { id, name: id, kind: id === "local" ? "local" : "remote", createdAt: "now", updatedAt: "now" };
}

function project(id: string, path: string): Project {
  return { id, name: id, path, createdAt: "now" };
}

function workspace(projectId: string, path: string, options: Partial<Workspace> = {}): Workspace {
  return {
    id: path,
    projectId,
    path,
    label: path,
    isMain: false,
    effectiveConfig: {},
    ...options,
  };
}

function session(cwd: string, id = "s1"): SessionInfo {
  return { id, cwd, path: `${cwd}/.sessions/${id}`, created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
}

function requireWorkspaceProvider(workspace: Workspace): NonNullable<Workspace["provider"]> {
  if (workspace.provider === undefined) throw new Error("Expected workspace provider");
  return workspace.provider;
}

type LoadWorkspaces = (projectId: string, machineId?: string) => Promise<Workspace[]>;

interface Harness {
  controller: WorkspaceController;
  state: () => AppState;
  clearActiveSession: ReturnType<typeof vi.fn>;
  updateUrl: ReturnType<typeof vi.fn>;
  setState: (patch: Partial<AppState>) => void;
}


function harness(
  initial: Partial<AppState>,
  loadWorkspaces: LoadWorkspaces,
  options: { topologyRefreshDebounceMs?: number } = {},
): Harness {
  let state: AppState = { ...initialAppState(), ...initial };
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
  const clearActiveSession = vi.fn();
  const sessions: Pick<SessionController, "clearActiveSession" | "preferredSession" | "selectSession" | "openNamedSession"> = {
    clearActiveSession,
    preferredSession: vi.fn(),
    selectSession: vi.fn(),
    openNamedSession: vi.fn(),
  };
  const updateUrl = vi.fn();
  const controller = new WorkspaceController(
    () => state,
    setState,
    updateUrl,
    sessions,
    undefined,
    {
      api: {
        workspaces: loadWorkspaces,
        sessions: vi.fn<(path: string, machineId?: string) => Promise<SessionInfo[]>>().mockResolvedValue([]),
      },
      topologyRefreshDebounceMs: options.topologyRefreshDebounceMs ?? 0,
    },
  );
  return { controller, state: () => state, clearActiveSession, updateUrl, setState };
}

afterEach(() => {
  vi.useRealTimers();
});

/**
 * D8: a workspace link with no session opened its latest session behind the phone's Sessions board,
 * reading its transcript for nobody, and on the desktop the URL never named the chat it opened.
 */
describe("a workspace chosen without a named session", () => {
  const build = (opensPreferredSession: (() => boolean) | undefined) => {
    const repo = project("p1", "/repo");
    let state: AppState = { ...initialAppState(), selectedMachine: machine("local"), projects: [repo], selectedProject: repo };
    const latest = session("/repo", "latest");
    const selectSession = vi.fn(() => Promise.resolve());
    const controller = new WorkspaceController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      vi.fn(),
      { clearActiveSession: vi.fn(), preferredSession: vi.fn(() => latest), selectSession, openNamedSession: vi.fn(() => Promise.resolve()) },
      undefined,
      {
        api: { workspaces: vi.fn(() => Promise.resolve([])), sessions: vi.fn(() => Promise.resolve([latest])) },
        ...(opensPreferredSession === undefined ? {} : { opensPreferredSession }),
      },
    );
    return { controller, selectSession };
  };

  it("opens the latest session where a chat is shown, and selects nothing where the board is", async () => {
    const desktop = build(undefined);
    const phone = build(() => false);

    await desktop.controller.selectWorkspace(workspace("p1", "/repo"));
    await phone.controller.selectWorkspace(workspace("p1", "/repo"));

    expect({ desktop: desktop.selectSession.mock.calls.length, phone: phone.selectSession.mock.calls.length }).toEqual({ desktop: 1, phone: 0 });
  });
});

describe("WorkspaceController.selectProject", () => {
  /**
   * B48: a lost answer used to paint the error banner and leave the project
   * with no workspace list and nothing that would read it again, so the panel
   * said "No workspaces found" for a project that has them.
   */
  it("keeps reading a project's workspaces until they answer, then opens the preferred one, and never reports the lost answer", async () => {
    vi.useFakeTimers();
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const loadWorkspaces = vi.fn<LoadWorkspaces>().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue([main]);
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, loadWorkspaces);

    const selecting = test.controller.selectProject(repo);
    await vi.advanceTimersByTimeAsync(0);

    expect(test.state().isLoadingWorkspaces).toBe(true);
    expect(test.state().workspaces).toEqual([]);
    expect(test.state().error).toBe("");

    await vi.advanceTimersByTimeAsync(1000);
    await selecting;

    expect(loadWorkspaces).toHaveBeenCalledTimes(2);
    expect(test.state().workspaces).toEqual([main]);
    expect(test.state().isLoadingWorkspaces).toBe(false);
    expect(test.state().selectedWorkspace?.id).toBe(main.id);
    expect(test.state().error).toBe("");
  });

  it("stops reading a project the reader left while its workspaces went unanswered", async () => {
    vi.useFakeTimers();
    const left = project("p1", "/repo");
    const chosen = project("p2", "/other");
    const loadWorkspaces = vi.fn<LoadWorkspaces>((projectId) => projectId === left.id ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve([workspace(chosen.id, chosen.path, { isMain: true })]));
    const test = harness({ selectedMachine: machine("local"), projects: [left, chosen] }, loadWorkspaces);

    const leaving = test.controller.selectProject(left);
    await vi.advanceTimersByTimeAsync(0);
    await test.controller.selectProject(chosen);
    await vi.advanceTimersByTimeAsync(60_000);
    await leaving;

    expect(loadWorkspaces.mock.calls.filter(([projectId]) => projectId === left.id)).toHaveLength(1);
    expect(test.state().selectedProject?.id).toBe(chosen.id);
    expect(test.state().selectedWorkspace?.projectId).toBe(chosen.id);
  });

  it("shows a refusal the machine stated as a notice, and does not claim the project has no workspaces", async () => {
    const repo = project("p1", "/repo");
    const loadWorkspaces = vi.fn<LoadWorkspaces>().mockRejectedValue(new HttpError("Forbidden", 403));
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, loadWorkspaces);

    await test.controller.selectProject(repo);

    expect(test.state().error).toContain("refused");
    expect(test.state().isLoadingWorkspaces).toBe(true);
    expect(loadWorkspaces).toHaveBeenCalledOnce();
  });

  it("keeps a list the machine already gave when it later refuses, and still opens a workspace", async () => {
    const repo = project("p1", "/repo");
    const other = project("p2", "/other");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const loadWorkspaces = vi.fn<LoadWorkspaces>((projectId) => projectId === other.id ? Promise.resolve([workspace(other.id, other.path, { isMain: true })]) : Promise.resolve([main]));
    const test = harness({ selectedMachine: machine("local"), projects: [repo, other] }, loadWorkspaces);
    await test.controller.selectProject(repo);
    await test.controller.selectProject(other);
    loadWorkspaces.mockImplementation(() => Promise.reject(new HttpError("Forbidden", 403)));

    const landed = await test.controller.selectProject(repo);

    expect(landed).toBe(true);
    expect(test.state().error).toContain("refused");
    expect(test.state().workspaces).toEqual([main]);
    expect(test.state().isLoadingWorkspaces).toBe(false);
    expect(test.state().selectedWorkspace?.id).toBe(main.id);
  });

  it("gives up a pending pick at once when the reader taps another project, and says it did not land", async () => {
    const left = project("p1", "/repo");
    const chosen = project("p2", "/other");
    const loadWorkspaces = vi.fn<LoadWorkspaces>((projectId) => projectId === left.id ? Promise.reject(new TypeError("Failed to fetch")) : new Promise<Workspace[]>(() => undefined));
    const test = harness({ selectedMachine: machine("local"), projects: [left, chosen] }, loadWorkspaces);

    let landed: boolean | undefined;
    void test.controller.selectProject(left).then((result) => { landed = result; });
    await Promise.resolve();
    await Promise.resolve();
    void test.controller.selectProject(chosen);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(landed).toBe(false);
  });

  it("yields a pending pick to a workspace the reader chose in the same project meanwhile", async () => {
    vi.useFakeTimers();
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const chosen = workspace(repo.id, "/repo-feature");
    const loadWorkspaces = vi.fn<LoadWorkspaces>().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue([main, chosen]);
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, loadWorkspaces);

    const selecting = test.controller.selectProject(repo);
    await vi.advanceTimersByTimeAsync(0);
    test.setState({ selectedWorkspace: chosen, selectedSession: session(chosen.path) });
    test.controller.selectionChanged();
    const clearsBefore = test.clearActiveSession.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);

    await expect(selecting).resolves.toBe(false);
    expect(test.state().selectedWorkspace?.id).toBe(chosen.id);
    expect(test.clearActiveSession.mock.calls.length).toBe(clearsBefore);
    expect(test.state().workspaces).toEqual([main, chosen]);
  });
});

describe("WorkspaceController follows the shown project", () => {
  it("stops reading a project left behind by a machine switch", async () => {
    vi.useFakeTimers();
    const repo = project("p1", "/repo");
    const loadWorkspaces = vi.fn<LoadWorkspaces>().mockRejectedValue(new TypeError("Failed to fetch"));
    const test = harness({ selectedMachine: machine("remote"), projects: [repo] }, loadWorkspaces);
    void test.controller.selectProject(repo);
    await vi.advanceTimersByTimeAsync(3000);
    const readsBefore = loadWorkspaces.mock.calls.length;

    test.setState({ selectedMachine: machine("local"), selectedProject: undefined, selectedWorkspace: undefined, workspaces: [] });
    test.controller.selectionChanged();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(readsBefore).toBeGreaterThan(1);
    expect(loadWorkspaces.mock.calls.length).toBe(readsBefore);
  });

  it("shows a refusal that lands on a background refresh of the shown project", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const loadWorkspaces = vi.fn<LoadWorkspaces>().mockResolvedValueOnce([main]).mockRejectedValue(new HttpError("Forbidden", 403));
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, loadWorkspaces);
    await test.controller.selectProject(repo);
    expect(test.state().error).toBe("");

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().error).toContain("refused");
    expect(test.state().workspaces).toEqual([main]);
  });

  it("will not hand a deletion flow a stale list after a lost read", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const gone = workspace(repo.id, "/repo-gone");
    const loadWorkspaces = vi.fn<LoadWorkspaces>().mockResolvedValueOnce([main, gone]).mockRejectedValue(new TypeError("Failed to fetch"));
    const test = harness({ selectedMachine: machine("local"), projects: [repo] }, loadWorkspaces);
    await test.controller.selectProject(repo);

    await expect(test.controller.refreshProjectWorkspaces(repo.id)).rejects.toThrow("not answered");
  });
});

describe("WorkspaceController.refreshSelectedProjectTopology", () => {
  it("surfaces a worktree created outside PI WEB in both the selected list and the per-project cache", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    const loadWorkspaces = vi.fn().mockResolvedValue([main, created]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(loadWorkspaces).toHaveBeenCalledWith(repo.id, "local");
    expect(test.state().workspaces).toEqual([main, created]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main, created]);
  });

  it("preserves the selection and workspace-scoped state when the selected workspace still exists", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = workspace(repo.id, "/repo-feature");
    const loadWorkspaces = vi.fn().mockResolvedValue([main, selected, workspace(repo.id, "/repo-other")]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
        selectedSession: session(selected.path),
        sessions: [session(selected.path)],
        selectedTerminalId: "t1",
      },
      loadWorkspaces,
    );
    const before = test.state();

    await test.controller.refreshSelectedProjectTopology();

    const after = test.state();
    expect(after.selectedWorkspace).toBe(selected);
    expect(after.selectedSession).toBe(before.selectedSession);
    expect(after.sessions).toBe(before.sessions);
    expect(after.selectedTerminalId).toBe("t1");
    expect(test.clearActiveSession).not.toHaveBeenCalled();
    expect(test.updateUrl).not.toHaveBeenCalled();
  });

  it("leaves the selection alone when the selected workspace disappeared", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const removed = workspace(repo.id, "/repo-gone");
    const loadWorkspaces = vi.fn().mockResolvedValue([main]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: removed,
        workspaces: [main, removed],
        workspacesByProjectId: { [repo.id]: [main, removed] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().selectedWorkspace).toBe(removed);
    expect(test.state().workspaces).toEqual([main]);
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it("discards a response for a project the user has since left", async () => {
    const repo = project("p1", "/repo");
    const other = project("p2", "/other");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    let resolveWorkspaces: ((workspaces: Workspace[]) => void) | undefined;
    const loadWorkspaces = vi.fn().mockReturnValue(new Promise<Workspace[]>((resolve) => { resolveWorkspaces = resolve; }));
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo, other],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const pending = test.controller.refreshSelectedProjectTopology();
    test.setState({ selectedProject: other, selectedWorkspace: undefined, workspaces: [] });
    resolveWorkspaces?.([main, created]);
    await pending;

    expect(test.state().workspaces).toEqual([]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main]);
  });

  it("discards a response after the selected machine changed", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    let resolveWorkspaces: ((workspaces: Workspace[]) => void) | undefined;
    const loadWorkspaces = vi.fn().mockReturnValue(new Promise<Workspace[]>((resolve) => { resolveWorkspaces = resolve; }));
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const pending = test.controller.refreshSelectedProjectTopology();
    test.setState({ selectedMachine: machine("remote") });
    resolveWorkspaces?.([main, workspace(repo.id, "/repo-feature")]);
    await pending;

    expect(test.state().workspaces).toEqual([main]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main]);
  });

  it("keeps the list through a lost refresh and reads again by itself until it answers, without painting an error", async () => {
    vi.useFakeTimers();
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    const loadWorkspaces = vi.fn<LoadWorkspaces>().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue([main, created]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const refreshing = test.controller.refreshSelectedProjectTopology();
    await vi.advanceTimersByTimeAsync(0);
    await refreshing;

    expect(test.state().error).toBe("");
    expect(test.state().workspaces).toEqual([main]);

    await vi.advanceTimersByTimeAsync(1000);

    expect(loadWorkspaces).toHaveBeenCalledTimes(2);
    expect(test.state().workspaces).toEqual([main, created]);
    expect(test.state().workspacesByProjectId[repo.id]).toEqual([main, created]);
    expect(test.state().error).toBe("");
  });

  it("re-points the selected workspace when its provider-authored label changed outside PI WEB", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = { ...workspace(repo.id, "/repo-feature"), label: "feature-a" };
    const switched = { ...selected, label: "feature-b" };
    const loadWorkspaces = vi.fn().mockResolvedValue([main, switched]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
        selectedSession: session(selected.path),
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    // Same workspace (same id/path), so the session must survive; only the stale label moves.
    expect(test.state().selectedWorkspace).toEqual(switched);
    expect(test.state().selectedWorkspace?.id).toBe(selected.id);
    expect(test.state().selectedSession).toBeDefined();
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it.each([
    {
      field: "provider id",
      refresh: (selected: Workspace): Workspace => ({
        ...selected,
        provider: { ...requireWorkspaceProvider(selected), pluginId: "replacement" },
      }),
    },
    {
      field: "provider request capability",
      refresh: (selected: Workspace): Workspace => ({
        ...selected,
        provider: {
          ...requireWorkspaceProvider(selected),
          capabilities: { ...requireWorkspaceProvider(selected).capabilities, request: true },
        },
      }),
    },
    {
      field: "provider remove capability",
      refresh: (selected: Workspace): Workspace => ({
        ...selected,
        provider: {
          ...requireWorkspaceProvider(selected),
          capabilities: { ...requireWorkspaceProvider(selected).capabilities, remove: true },
        },
      }),
    },
    {
      field: "provider public metadata",
      refresh: (selected: Workspace): Workspace => ({
        ...selected,
        provider: {
          ...requireWorkspaceProvider(selected),
          metadata: { nested: { marker: "current" }, list: [1, true] },
        },
      }),
    },
    {
      field: "effective config",
      refresh: (selected: Workspace): Workspace => ({
        ...selected,
        effectiveConfig: { uploads: { defaultFolder: "current-uploads" } },
      }),
    },
  ])("refreshes changed $field without resetting the selected session", async ({ refresh }) => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = workspace(repo.id, "/repo-feature", {
      provider: {
        pluginId: "owner",
        capabilities: { request: false, remove: false },
        metadata: { nested: { marker: "old" }, list: [1, true] },
      },
      effectiveConfig: { uploads: { defaultFolder: "old-uploads" } },
    });
    const refreshed = refresh(selected);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
        selectedSession: session(selected.path),
      },
      vi.fn().mockResolvedValue([main, refreshed]),
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().selectedWorkspace).toBe(refreshed);
    expect(test.state().selectedSession).toBeDefined();
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it("refreshes a changed removal precondition without resetting the selected session", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = workspace(repo.id, "/repo-feature", {
      removal: { actionLabel: "Disconnect", confirmation: "Disconnect old view?", precondition: "old-removal" },
    });
    const refreshed = {
      ...selected,
      removal: { actionLabel: "Disconnect", confirmation: "Disconnect old view?", precondition: "current-removal" },
    };
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
        selectedSession: session(selected.path),
      },
      vi.fn().mockResolvedValue([main, refreshed]),
    );

    await test.controller.refreshSelectedProjectTopology();

    expect(test.state().selectedWorkspace).toEqual(refreshed);
    expect(test.state().selectedSession).toBeDefined();
    expect(test.clearActiveSession).not.toHaveBeenCalled();
  });

  it("leaves the selected workspace object untouched when the refresh returns an identical snapshot", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const selected = workspace(repo.id, "/repo-feature", {
      provider: {
        pluginId: "owner",
        capabilities: { request: true, remove: true },
        metadata: { nested: [1, { ready: true }] },
      },
      removal: { actionLabel: "Disconnect", confirmation: "Disconnect?", precondition: "v1.current" },
      effectiveConfig: { uploads: { defaultFolder: "uploads" } },
    });
    // Fresh, deeply equal objects, exactly what a real HTTP response produces every resume.
    const equalSelected = workspace(repo.id, "/repo-feature", {
      provider: {
        pluginId: "owner",
        capabilities: { request: true, remove: true },
        metadata: { nested: [1, { ready: true }] },
      },
      removal: { actionLabel: "Disconnect", confirmation: "Disconnect?", precondition: "v1.current" },
      effectiveConfig: { uploads: { defaultFolder: "uploads" } },
    });
    const loadWorkspaces = vi.fn().mockResolvedValue([{ ...main }, equalSelected]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: selected,
        workspaces: [main, selected],
        workspacesByProjectId: { [repo.id]: [main, selected] },
      },
      loadWorkspaces,
    );

    await test.controller.refreshSelectedProjectTopology();

    // Identity preserved: an unchanged resume must not churn selected-workspace identity
    // into state, or every focus would re-render surfaces keyed on this object.
    expect(test.state().selectedWorkspace).toBe(selected);
  });

  it("debounces rapid topology refresh bursts before opening a request", async () => {
    vi.useFakeTimers();
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const loadWorkspaces = vi.fn().mockResolvedValue([main]);
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
      { topologyRefreshDebounceMs: 25 },
    );

    const resumeRefresh = test.controller.refreshSelectedProjectTopology();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);
    const appDataRefresh = test.controller.refreshSelectedProjectTopology();
    await vi.advanceTimersByTimeAsync(24);

    expect(loadWorkspaces).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([resumeRefresh, appDataRefresh]);

    expect(loadWorkspaces).toHaveBeenCalledOnce();
  });

  it("serializes overlapping refreshes so an earlier response cannot overwrite a newer list", async () => {
    const repo = project("p1", "/repo");
    const main = workspace(repo.id, repo.path, { isMain: true });
    const created = workspace(repo.id, "/repo-feature");
    const gates: ((workspaces: Workspace[]) => void)[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const loadWorkspaces = vi.fn(() => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<Workspace[]>((resolve) => {
        gates.push((workspaces) => { inFlight -= 1; resolve(workspaces); });
      });
    });
    const test = harness(
      {
        selectedMachine: machine("local"),
        projects: [repo],
        selectedProject: repo,
        selectedWorkspace: main,
        workspaces: [main],
        workspacesByProjectId: { [repo.id]: [main] },
      },
      loadWorkspaces,
    );

    const resumeRefresh = test.controller.refreshSelectedProjectTopology();
    await Promise.resolve();
    const appDataRefresh = test.controller.refreshSelectedProjectTopology();
    await Promise.resolve();

    // The second caller does not open its own request while the first is in flight; it gets
    // one trailing pass afterwards. Without this, two responses race and the slower-but-older
    // one can land last, making a just-created worktree disappear again.
    expect(maxInFlight).toBe(1);
    gates[0]?.([main]);
    await vi.waitFor(() => { expect(gates).toHaveLength(2); });
    gates[1]?.([main, created]);
    await Promise.all([resumeRefresh, appDataRefresh]);

    // The last response wins, so the newly created worktree stays visible.
    expect(test.state().workspaces).toEqual([main, created]);
  });

  it("does not request anything when no project is selected", async () => {
    const loadWorkspaces = vi.fn();
    const test = harness({ selectedMachine: machine("local") }, loadWorkspaces);

    await test.controller.refreshSelectedProjectTopology();

    expect(loadWorkspaces).not.toHaveBeenCalled();
  });
});




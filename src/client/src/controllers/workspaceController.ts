import { api as defaultApi, type GoalRecordSummary, type Project, type Workspace } from "../api";
import { resetWorkspaceScopedState, type AppState, type PanelLoad } from "../appState";
import { errorNoticePatch } from "../errorNotice";
import { describeError } from "../notice";
import { mergeCachedNewSessions } from "../cachedNewSessions";
import { machineProjectKey, machineWorkspaceKey } from "../machineKeys";
import { workspaceSelectionKey } from "../appState";
import { cachedSessionsFor, rememberWorkspaceSessions } from "../workspaceSessionsCache";
import { selectedMachineId, type GetState, type RouteTarget, type SetState, type UpdateUrl } from "./types";
import type { SessionController } from "./sessionController";
import { TrailingRefreshCoordinator } from "./trailingRefreshCoordinator";
import { InMemoryWorkspaceSelectionMemory, selectPreferredWorkspace, type WorkspaceSelectionMemory } from "./workspaceSelection";

const WORKSPACE_TOPOLOGY_REFRESH_DEBOUNCE_MS = 50;

export interface WorkspaceControllerDependencies {
  api?: Pick<typeof defaultApi, "sessions" | "workspaces" | "workspaceGoals" | "archiveWorkspaceGoal">;
  onBackgroundError?: (message: string, error: unknown) => void;
  topologyRefreshDebounceMs?: number;
}

export class WorkspaceController {
  private readonly api: Pick<typeof defaultApi, "sessions" | "workspaces" | "workspaceGoals" | "archiveWorkspaceGoal">;
  private readonly onBackgroundError: (message: string, error: unknown) => void;
  private readonly topologyRefreshes: TrailingRefreshCoordinator<string>;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly updateUrl: UpdateUrl,
    private readonly sessions: Pick<SessionController, "clearActiveSession" | "preferredSession" | "selectSession">,
    private readonly workspaceSelection: WorkspaceSelectionMemory = new InMemoryWorkspaceSelectionMemory(),
    deps: WorkspaceControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.onBackgroundError = deps.onBackgroundError ?? ((message, error) => { console.warn(message, error); });
    this.topologyRefreshes = new TrailingRefreshCoordinator(
      deps.topologyRefreshDebounceMs ?? WORKSPACE_TOPOLOGY_REFRESH_DEBOUNCE_MS,
    );
  }

  clearSelection(options?: { updateUrl?: boolean | undefined }) {
    this.sessions.clearActiveSession();
    this.setState({ selectedProject: undefined, selectedWorkspace: undefined, workspaces: [], isLoadingWorkspaces: false, ...resetWorkspaceScopedState() });
    if (options?.updateUrl !== false) this.updateUrl();
  }

  forgetProject(projectId: string): void {
    this.workspaceSelection.forgetProject(machineProjectKey(selectedMachineId(this.getState()), projectId));
    const workspacesByProjectId = Object.fromEntries(Object.entries(this.getState().workspacesByProjectId).filter(([candidate]) => candidate !== projectId));
    this.setState({ workspacesByProjectId });
  }

  async selectProject(project: Project, target?: RouteTarget) {
    const machineId = selectedMachineId(this.getState());
    this.sessions.clearActiveSession();
    this.setState({ selectedProject: project, selectedWorkspace: undefined, workspaces: [], isLoadingWorkspaces: true, ...resetWorkspaceScopedState() });
    try {
      const workspaces = await this.api.workspaces(project.id, machineId);
      if (selectedMachineId(this.getState()) !== machineId || this.getState().selectedProject?.id !== project.id) return;
      this.setState({ workspaces, workspacesByProjectId: { ...this.getState().workspacesByProjectId, [project.id]: workspaces }, isLoadingWorkspaces: false });
      const workspace = selectPreferredWorkspace(workspaces, { targetWorkspaceId: target?.workspaceId, latestWorkspaceId: this.workspaceSelection.latestWorkspaceId(machineProjectKey(machineId, project.id)) });
      if (workspace) await this.selectWorkspace(workspace, { sessionId: target?.sessionId, updateUrl: target?.updateUrl });
      else if (target?.updateUrl !== false) this.updateUrl();
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId && this.getState().selectedProject?.id === project.id) this.setState({ ...errorNoticePatch(error), isLoadingWorkspaces: false });
    }
  }

  async selectWorkspace(workspace: Workspace, target?: { sessionId?: string | undefined; updateUrl?: boolean | undefined }) {
    const machineId = selectedMachineId(this.getState());
    this.workspaceSelection.rememberWorkspace({ ...workspace, projectId: machineProjectKey(machineId, workspace.projectId) });
    this.sessions.clearActiveSession();
    // The cache answers before the listing does: a revisited workspace shows
    // its previous list immediately, and a first visit shows the loading state
    // the reset below leaves, never the empty claim.
    const cached = cachedSessionsFor(machineId, workspace.path);
    this.setState({ selectedWorkspace: workspace, isLoadingWorkspaces: false, ...resetWorkspaceScopedState(), sessions: cached === undefined ? [] : [...cached], sessionsLoad: "loading" });
    try {
      const sessions = mergeCachedNewSessions(workspace.path, await this.api.sessions(workspace.path, machineId), machineId);
      if (selectedMachineId(this.getState()) !== machineId || this.getState().selectedWorkspace?.id !== workspace.id || this.getState().selectedProject?.id !== workspace.projectId) return;
      rememberWorkspaceSessions(machineId, workspace.path, sessions);
      this.setState({ sessions, sessionsLoad: "loaded" });
      const session = this.sessions.preferredSession(workspace.path, sessions, target?.sessionId);
      if (session) await this.sessions.selectSession(session, { updateUrl: target?.updateUrl });
      else if (target?.updateUrl !== false) this.updateUrl();
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId && this.getState().selectedWorkspace?.id === workspace.id) {
        // The stale rows stay on screen and the state drops back to unloaded:
        // a failed listing is not evidence that the workspace is empty.
        this.setState({ ...errorNoticePatch(error), sessionsLoad: "unloaded" });
      }
    } finally {
      void this.refreshWorkspaceGoals(workspace, machineId);
    }
  }

  /**
   * Load the goals recorded under a workspace's `.pi/goals/` directory.
   *
   * Goals belong to the workspace, not to a session, so this is refreshed on
   * workspace selection rather than session selection. Failures are swallowed:
   * a workspace with no goal extension installed is the common case, and an
   * unreadable goal directory must not present as a workspace error.
   */
  async refreshWorkspaceGoals(
    workspace = this.getState().selectedWorkspace,
    machineId = selectedMachineId(this.getState()),
  ): Promise<void> {
    if (workspace === undefined) return;
    const key = machineWorkspaceKey(machineId, workspace.projectId, workspace.id);
    const previous = this.getState().workspaceGoalsLoad;
    // Rows this workspace already showed survive a re-read - loading and
    // failure keep them, so the panel never flashes empty mid-refresh. Rows
    // keyed to another workspace do not survive: they were never this
    // selection's, and presenting them here is how another project's goal
    // ended up on this panel with live controls.
    const retained = previous.key === key ? previous.data : [];
    this.setState({ workspaceGoalsLoad: { state: "loading", key, data: retained } });
    let load: PanelLoad<GoalRecordSummary[]>;
    try {
      load = { state: "loaded", key, data: (await this.api.workspaceGoals(workspace.projectId, workspace.id, machineId)).goals };
    } catch {
      // A failed read is not evidence that the goals are gone; blanking the
      // panel made "offline" and "no goals" look identical and dropped the
      // Goals tab. The previous rows stay until a read succeeds — but only the
      // rows that answer for THIS workspace: a list carried over from another
      // workspace must never present as this one's, with its actions live.
      load = { state: "failed", key, data: retained };
    }
    // Discard a response that lost its race with a newer selection.
    if (workspaceSelectionKey(this.getState()) !== key) return;
    this.setState({ workspaceGoalsLoad: load });
  }


  /**
   * Archive a goal, then re-read the directory so the panel reflects the file
   * system rather than an assumption.
   *
   * A running agent focused on that goal keeps its own copy until it reloads,
   * so the outcome says whether that is possible instead of pretending the
   * record is gone for good.
   */
  async archiveWorkspaceGoal(goalId: string, workspace = this.getState().selectedWorkspace): Promise<void> {
    if (workspace === undefined) return;
    const machineId = selectedMachineId(this.getState());
    try {
      const result = await this.api.archiveWorkspaceGoal(workspace.projectId, workspace.id, goalId, machineId);
      if (result.agentMayRecreate) {
        this.setState({ error: "Goal archived. A session already working it keeps its own copy until it reloads, so run /goal-refresh there if it comes back." });
      }
    } catch (error) {
      this.setState({ error: `Could not archive the goal: ${describeError(error)}` });
    }
    await this.refreshWorkspaceGoals(workspace, machineId);
  }

  async refreshProjectWorkspaces(projectId: string): Promise<Workspace[]> {
    const project = this.getState().projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new Error("Project not found");
    const workspaces = await this.api.workspaces(project.id, selectedMachineId(this.getState()));
    this.applyProjectWorkspaces(project.id, workspaces);
    return workspaces;
  }

  /**
   * Re-lists the selected project's workspaces so worktrees created or removed outside
   * PI WEB become visible, without disturbing the current selection.
   *
   * Deliberately never routes through `selectWorkspace`: that has no already-selected
   * guard, so re-picking the same workspace would still call `clearActiveSession()` and
   * `resetWorkspaceScopedState()`, closing the session socket and blanking chat, file
   * tree, plugin-owned panel state, and terminal selection. Callers run this on every browser resume,
   * so applying the list through `applyProjectWorkspaces` alone is the invariant.
   *
   * If the selected workspace disappeared, the selection is left alone: the user is
   * working there and the existing deletion path owns recovery.
   */
  async refreshSelectedProjectTopology(): Promise<void> {
    const state = this.getState();
    const project = state.selectedProject;
    if (project === undefined) return;
    const machineId = selectedMachineId(state);
    // Callers are independent (browser resume and the plugin-facing app refresh), so two
    // refreshes for the same machine+project can overlap. Sharing one request keeps a slow
    // earlier response from landing last and overwriting a newer list, which would make a
    // just-created worktree disappear again.
    await this.topologyRefreshes.request(machineProjectKey(machineId, project.id), async () => {
      try {
        const workspaces = await this.api.workspaces(project.id, machineId);
        const current = this.getState();
        if (selectedMachineId(current) !== machineId || current.selectedProject?.id !== project.id) return;
        this.applyProjectWorkspaces(project.id, workspaces);
      } catch (error) {
        this.onBackgroundError(`Failed to refresh workspaces for project ${project.id} on ${machineId}`, error);
      }
    });
  }

  async refreshAfterWorkspaceDeleted(projectId: string, workspaceId: string): Promise<void> {
    const workspaces = await this.refreshProjectWorkspaces(projectId);
    const state = this.getState();
    if (state.selectedProject?.id !== projectId || state.selectedWorkspace?.id !== workspaceId) return;

    const fallback = selectFallbackWorkspace(workspaces);
    if (fallback !== undefined) await this.selectWorkspace(fallback);
    else this.clearSelection();
  }

  private applyProjectWorkspaces(projectId: string, workspaces: Workspace[]): void {
    const state = this.getState();
    const workspacesByProjectId = { ...state.workspacesByProjectId, [projectId]: workspaces };
    if (state.selectedProject?.id !== projectId) {
      this.setState({ workspacesByProjectId });
      return;
    }
    this.setState({ workspaces, workspacesByProjectId, ...this.refreshedSelection(state.selectedWorkspace, workspaces) });
  }

  /**
   * Re-points `selectedWorkspace` at its refreshed entry when any browser-visible field changed
   * outside PI WEB (owner metadata, effective config, a branch switch, and so on), so the
   * workspace list and surfaces reading the selection cannot disagree. Keyed by id, so
   * this never changes *which* workspace is selected and never triggers the session/terminal
   * teardown in `handleWorkspaceChange`. Returns nothing when the entry is gone or unchanged,
   * so an unchanged refresh does not churn object identity into state.
   */
  private refreshedSelection(selected: Workspace | undefined, workspaces: Workspace[]): Pick<AppState, "selectedWorkspace"> | undefined {
    if (selected === undefined) return undefined;
    const refreshed = workspaces.find((candidate) => candidate.id === selected.id);
    if (refreshed === undefined || sameWorkspaceSnapshot(selected, refreshed)) return undefined;
    return { selectedWorkspace: refreshed };
  }
}

function selectFallbackWorkspace(workspaces: Workspace[]): Workspace | undefined {
  return workspaces.find((workspace) => workspace.isMain) ?? workspaces[0];
}

function sameWorkspaceSnapshot(left: Workspace, right: Workspace): boolean {
  return sameBrowserObservableValue(left, right);
}

/** Compare the complete parsed workspace payload, including future additive fields. */
function sameBrowserObservableValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameBrowserObservableValue(value, right[index]));
  }
  if (!isBrowserObservableRecord(left) || !isBrowserObservableRecord(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key)
      && sameBrowserObservableValue(left[key], right[key]));
}

function isBrowserObservableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


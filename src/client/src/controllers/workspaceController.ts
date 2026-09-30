import { api as defaultApi, type Project, type Workspace } from "../api";
import { resetWorkspaceScopedState, type AppState } from "../appState";
import { errorNoticePatch } from "../errorNotice";
import { QUIET_WINDOW_MS, type ReadFact } from "../sync/readPhase";
import { ScopedResource, type ResourceClock } from "../sync/scopedResource";
import { mergeCachedNewSessions } from "../cachedNewSessions";
import { machineProjectKey } from "../machineKeys";
import { cachedSessionsFor, rememberWorkspaceSessions } from "../workspaceSessionsCache";
import { selectedMachineId, type GetState, type RouteTarget, type SetState, type UpdateUrl } from "./types";
import type { SessionController } from "./sessionController";
import { TrailingRefreshCoordinator } from "./trailingRefreshCoordinator";
import { InMemoryWorkspaceSelectionMemory, selectPreferredWorkspace, type WorkspaceSelectionMemory } from "./workspaceSelection";

const WORKSPACE_TOPOLOGY_REFRESH_DEBOUNCE_MS = 50;

export interface WorkspaceControllerDependencies {
  api?: Pick<typeof defaultApi, "sessions" | "workspaces">;
  topologyRefreshDebounceMs?: number;
  clock?: ResourceClock;
}

/** One project's workspace listing on one machine. */
interface ProjectListingKey {
  readonly machineId: string;
  readonly projectId: string;
}


/** A refusal the machine stated, in the reader's words (object model §0). */
const FACT_WORDS = new Map<ReadFact["kind"], string>([
  ["signed-out", "This machine asked you to sign in before it lists this project's workspaces."],
  ["forbidden", "This machine refused to list this project's workspaces."],
]);

export class WorkspaceController {
  private readonly api: Pick<typeof defaultApi, "sessions" | "workspaces">;
  private readonly topologyRefreshes: TrailingRefreshCoordinator<string>;
  /**
   * Each project's workspaces, read until answered (B48). A lost answer is
   * read again by itself for as long as the project is the one shown; it is
   * never painted as an error, and never as "No workspaces found".
   */
  private readonly listings: ScopedResource<ProjectListingKey, Workspace[]>;
  private followed: { id: string; release: () => void } | undefined;
  /** The listing value the state shows for the followed project, so one answer is applied once. */
  private mirrored: Workspace[] | undefined;
  private noticedFact: ReadFact["kind"] = "none";
  private projectSelectionSeq = 0;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly updateUrl: UpdateUrl,
    private readonly sessions: Pick<SessionController, "clearActiveSession" | "preferredSession" | "selectSession" | "openNamedSession">,
    private readonly workspaceSelection: WorkspaceSelectionMemory = new InMemoryWorkspaceSelectionMemory(),
    deps: WorkspaceControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.topologyRefreshes = new TrailingRefreshCoordinator(
      deps.topologyRefreshDebounceMs ?? WORKSPACE_TOPOLOGY_REFRESH_DEBOUNCE_MS,
    );
    this.listings = new ScopedResource<ProjectListingKey, Workspace[]>({
      keyId: (key) => machineProjectKey(key.machineId, key.projectId),
      read: (key) => this.api.workspaces(key.projectId, key.machineId),
      retryCapMs: QUIET_WINDOW_MS,
      ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    });
    this.listings.subscribe(() => { this.mirror(); });
  }

  /**
   * The selection moved, by any writer: a project picked here, a session
   * opened from another project, a machine switch. The shown project's listing
   * is the one followed, so a project left behind stops being read, and every
   * wait for an answer checks at once whether its reader is still there.
   */
  selectionChanged(): void {
    const state = this.getState();
    const project = state.selectedProject;
    this.follow(project === undefined ? undefined : { machineId: selectedMachineId(state), projectId: project.id });
    this.listings.recheckWaiters();
  }

  /** A sign of life: retry a lost workspaces read now instead of waiting out the backoff. */
  wake(): void {
    this.listings.wake();
  }

  dispose(): void {
    this.listings.dispose();
  }

  /**
   * A project's workspaces once the machine answers, for a reader that needs
   * them before it can act (placing a session opened from another project).
   * Undefined when the reader stopped wanting them first, or the machine
   * refused.
   */
  async answeredWorkspaces(machineId: string, projectId: string, wanted: () => boolean): Promise<readonly Workspace[] | undefined> {
    const view = await this.listings.whenAnswered({ machineId, projectId }, wanted);
    return view?.data;
  }

  clearSelection(options?: { updateUrl?: boolean | undefined }) {
    this.follow(undefined);
    this.sessions.clearActiveSession();
    this.setState({ selectedProject: undefined, selectedWorkspace: undefined, workspaces: [], isLoadingWorkspaces: false, ...resetWorkspaceScopedState() });
    if (options?.updateUrl !== false) this.updateUrl();
  }

  forgetProject(projectId: string): void {
    this.workspaceSelection.forgetProject(machineProjectKey(selectedMachineId(this.getState()), projectId));
    const workspacesByProjectId = Object.fromEntries(Object.entries(this.getState().workspacesByProjectId).filter(([candidate]) => candidate !== projectId));
    this.setState({ workspacesByProjectId });
  }

  /**
   * Show a project and open its preferred workspace once its listing answers.
   * A lost answer is not an outcome: the listing is read again by itself and
   * the pick happens when it lands, unless the reader has moved on - another
   * project, another machine, or a workspace chosen meanwhile. Until then the
   * workspace list says nothing (B48). The answer itself reaches the state
   * through the mirror, the one place that applies listings.
   *
   * Resolves whether the pick landed, so a caller that continues after it
   * (a route restore) stops when the reader has moved on.
   */
  async selectProject(project: Project, target?: RouteTarget): Promise<boolean> {
    const machineId = selectedMachineId(this.getState());
    const seq = ++this.projectSelectionSeq;
    const key = { machineId, projectId: project.id };
    this.sessions.clearActiveSession();
    this.setState({ selectedProject: project, selectedWorkspace: undefined, workspaces: [], isLoadingWorkspaces: true, ...resetWorkspaceScopedState() });
    this.follow(key);
    this.mirrored = undefined;
    const stillChosen = () => {
      const state = this.getState();
      return seq === this.projectSelectionSeq && selectedMachineId(state) === machineId && state.selectedProject?.id === project.id && state.selectedWorkspace === undefined;
    };
    const view = await this.listings.whenAnswered(key, stillChosen);
    const workspaces = view?.data;
    if (workspaces === undefined || !stillChosen()) return false;
    const workspace = selectPreferredWorkspace(workspaces, { targetWorkspaceId: target?.workspaceId, latestWorkspaceId: this.workspaceSelection.latestWorkspaceId(machineProjectKey(machineId, project.id)) });
    if (workspace) await this.selectWorkspace(workspace, { sessionId: target?.sessionId, updateUrl: target?.updateUrl });
    else if (target?.updateUrl !== false) this.updateUrl();
    return true;
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
      const named = target?.sessionId;
      if (named !== undefined && named !== "") {
        await this.sessions.openNamedSession(named, workspace, sessions, { updateUrl: target?.updateUrl });
        if (target?.updateUrl !== false && this.getState().selectedSession === undefined) this.updateUrl();
        return;
      }
      const session = this.sessions.preferredSession(workspace.path, sessions);
      if (session) await this.sessions.selectSession(session, { updateUrl: target?.updateUrl });
      else if (target?.updateUrl !== false) this.updateUrl();
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId && this.getState().selectedWorkspace?.id === workspace.id) {
        // The stale rows stay on screen and the state drops back to unloaded:
        // a failed listing is not evidence that the workspace is empty.
        this.setState({ ...errorNoticePatch(error), sessionsLoad: "unloaded" });
      }
    }
  }

  /**
   * Read one project's workspaces now, for an action that needs them. It
   * throws when there is no answer to act on; the listing itself keeps being
   * read by itself while the project is shown.
   */
  async refreshProjectWorkspaces(projectId: string): Promise<Workspace[]> {
    const project = this.getState().projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new Error("Project not found");
    const machineId = selectedMachineId(this.getState());
    const key = { machineId, projectId: project.id };
    await this.listings.refresh(key);
    const entry = this.listings.entry(key);
    const workspaces = entry.data;
    if (entry.phase !== "live" || entry.fact.kind !== "none" || workspaces === undefined) throw new Error(`${project.name}'s workspaces have not answered yet.`);
    if (selectedMachineId(this.getState()) === machineId) this.applyProjectWorkspaces(project.id, workspaces);
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
   *
   * A lost answer keeps the list on screen and is read again by itself while the
   * project stays selected (B48); the answer, whenever it comes, is applied by the
   * listing's mirror for the selection it was read for.
   */
  async refreshSelectedProjectTopology(): Promise<void> {
    const state = this.getState();
    const project = state.selectedProject;
    if (project === undefined) return;
    const key = { machineId: selectedMachineId(state), projectId: project.id };
    this.follow(key);
    // Callers are independent (browser resume and the plugin-facing app refresh), so a
    // burst of refreshes is gathered into one read; a read asked for while one is in
    // flight runs once after it, so a slow earlier answer never lands last.
    await this.topologyRefreshes.request(machineProjectKey(key.machineId, key.projectId), () => this.listings.refresh(key));
  }

  async refreshAfterWorkspaceDeleted(projectId: string, workspaceId: string): Promise<void> {
    const workspaces = await this.refreshProjectWorkspaces(projectId);
    const state = this.getState();
    if (state.selectedProject?.id !== projectId || state.selectedWorkspace?.id !== workspaceId) return;

    const fallback = selectFallbackWorkspace(workspaces);
    if (fallback !== undefined) await this.selectWorkspace(fallback);
    else this.clearSelection();
  }

  /**
   * Keep the shown project's listing watched, so its lost reads retry; a
   * project left behind stops being read, and whoever waited on it is told.
   */
  private follow(key: ProjectListingKey | undefined): void {
    const id = key === undefined ? undefined : machineProjectKey(key.machineId, key.projectId);
    if (this.followed?.id === id) return;
    this.followed?.release();
    this.followed = key === undefined || id === undefined ? undefined : { id, release: this.listings.watch(key) };
    this.mirrored = undefined;
    this.noticedFact = "none";
    this.listings.recheckWaiters();
  }

  /**
   * Show the followed project's listing as it stands: its rows once they are
   * known (kept through a lost read or a refusal), and a refusal the machine
   * stated as a notice in its own words. Only the selection's own key is
   * applied, and each value once.
   */
  private mirror(): void {
    const state = this.getState();
    const project = state.selectedProject;
    if (project === undefined) return;
    const machineId = selectedMachineId(state);
    if (this.followed?.id !== machineProjectKey(machineId, project.id)) return;
    const entry = this.listings.entry({ machineId, projectId: project.id });
    this.noticeFact(entry.fact.kind);
    const workspaces = entry.data;
    if (workspaces === undefined || workspaces === this.mirrored) return;
    this.mirrored = workspaces;
    this.applyProjectWorkspaces(project.id, workspaces);
  }

  private noticeFact(kind: ReadFact["kind"]): void {
    if (kind === this.noticedFact) return;
    this.noticedFact = kind;
    const words = FACT_WORDS.get(kind);
    if (words !== undefined) this.setState(errorNoticePatch(new Error(words)));
  }

  private applyProjectWorkspaces(projectId: string, workspaces: Workspace[]): void {
    const state = this.getState();
    const workspacesByProjectId = { ...state.workspacesByProjectId, [projectId]: workspaces };
    if (state.selectedProject?.id !== projectId) {
      this.setState({ workspacesByProjectId });
      return;
    }
    this.setState({ workspaces, workspacesByProjectId, isLoadingWorkspaces: false, ...this.refreshedSelection(state.selectedWorkspace, workspaces) });
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


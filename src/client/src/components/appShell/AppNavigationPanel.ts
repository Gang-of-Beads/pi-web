import { LitElement, css, html } from "lit";
import { focusedContextName } from "../../contextName";
import { customElement, property, query } from "lit/decorators.js";
import type { GoalRecordSummary, Machine, MachineHealth, Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import type { WorkspaceLabelItem } from "../../plugins/types";
import { selectedMachineId } from "../../controllers/types";
import type { NavigationSection } from "../../appShell/navigationState";
import { NAVIGATION_SECTION_ORDER } from "../../appShell/navigationState";
import type { KeyboardNavigableSection } from "../navigationFocus";
import "../MachineList";
import "./AppContextSwitcher";
import "../MachineSwitcher";
import "../ProjectList";
import "../WorkspaceList";
import "../SessionList";
import "../GoalPanel";

export type NavigationFocusTarget = NavigationSection | "chat";

@customElement("app-navigation-panel")
export class AppNavigationPanel extends LitElement {
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selectedMachine?: Machine;
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) machineStatusSnapshots: Record<string, MachineStatusSnapshot> = {};
  @property({ attribute: false }) projects: Project[] = [];
  /** Four-state load discipline threaded from app state; see ProjectList. */
  @property({ attribute: false }) projectsLoad: "unloaded" | "loading" | "loaded" | "failed" = "unloaded";
  @property({ attribute: false }) onRetryProjectsLoad?: () => void;
  @property({ attribute: false }) selectedProject?: Project;
  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  @property({ attribute: false }) sessions: SessionInfo[] = [];
  /** Three-state load discipline threaded from app state; see SessionList. */
  @property({ attribute: false }) sessionsLoad: "unloaded" | "loading" | "loaded" = "unloaded";
  @property({ attribute: false }) selectedSession?: SessionInfo;
  @property({ attribute: false }) sessionActivities: Record<string, SessionActivity> = {};
  @property({ attribute: false }) sessionStatuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) sendingPrompts: Record<string, true> = {};
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) deletingWorkspaceIds: string[] = [];
  @property({ attribute: false }) workspaceLabelItems: (workspace: Workspace) => WorkspaceLabelItem[] = () => [];
  @property({ attribute: false }) refreshControl: unknown;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) compact = false;
  @property({ type: Boolean }) machinesCollapsed = false;
  @property({ type: Boolean }) projectsCollapsed = false;
  @property({ type: Boolean }) workspacesCollapsed = false;
  @property({ type: Boolean }) sessionsCollapsed = false;
  @property({ type: Number }) startingSessionCount = 0;
  @property({ type: Boolean }) canStartSession = false;
  @property({ attribute: false }) onShowActions?: () => void;
  @property({ attribute: false }) onOpenSettings?: () => void;
  @property({ attribute: false }) onAddMachine?: () => void;
  @property({ attribute: false }) onOpenSessionTree?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onRefreshMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onRenameMachine?: (machine: Machine, name: string) => void | Promise<void>;
  @property({ attribute: false }) onOpenMachine?: (machine: Machine) => void;
  @property({ attribute: false }) onQuickSwitch?: () => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onToggleMachines?: () => void;
  @property({ attribute: false }) onToggleProjects?: () => void;
  @property({ attribute: false }) onToggleWorkspaces?: () => void;
  @property({ attribute: false }) onToggleSessions?: () => void;
  @property({ attribute: false }) onSelectProject?: (project: Project) => void | Promise<void>;
  @property({ attribute: false }) onCloseProject?: (project: Project) => void | Promise<void>;
  @property({ attribute: false }) onSelectWorkspace?: (workspace: Workspace) => void | Promise<void>;
  @property({ attribute: false }) onDeleteWorkspace?: (workspace: Workspace) => void | Promise<void>;
  @property({ attribute: false }) onStartSession?: () => void | Promise<void>;
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSessionWithDescendants?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSessions?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onRestoreSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteCachedNewSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteArchivedSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteArchivedSessions?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onDetachParentSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onRenameSession?: (session: SessionInfo, name: string) => void | Promise<void>;
  @property({ attribute: false }) goals: GoalRecordSummary[] = [];
  @property({ type: Boolean }) goalsLoading = false;
  /** The last goals read failed; the section stays with a failure line. */
  @property({ type: Boolean }) goalsFailed = false;
  /** Whether acting on the listed goals is allowed. Withheld when the goals
   * state answers for a different workspace than the one selected: a stale
   * render must be inert, not merely unlikely. */
  @property({ type: Boolean }) canRunGoalCommands = true;
  @property({ attribute: false }) onRefreshGoals?: () => void | Promise<void>;
  @property({ attribute: false }) onArchiveGoal?: (goal: GoalRecordSummary) => void | Promise<void>;
  @property({ attribute: false }) onRunGoalCommand?: (goal: GoalRecordSummary, command: string) => void | Promise<void>;
  @property({ attribute: false }) onMarkSessionRead?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onMarkSessionsRead?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onReloadSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onCleanupSessions?: () => void | Promise<void>;
  @property({ attribute: false }) onArchivedCollapsed?: () => void | Promise<void>;
  @property({ attribute: false }) onSelectMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onRemoveMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onFocusNavigationTarget?: (target: NavigationFocusTarget) => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;

  @query("machine-list") private machineList?: KeyboardNavigableSection;
  @query("machine-switcher") private machineSwitcher?: KeyboardNavigableSection;
  @query("project-list") private projectList?: KeyboardNavigableSection;
  @query("workspace-list") private workspaceList?: KeyboardNavigableSection;
  @query("session-list") private sessionList?: KeyboardNavigableSection;

  async focusSection(section: NavigationSection): Promise<boolean> {
    await this.updateComplete;
    switch (section) {
      case "machines": return await this.focusNavigableSection(this.compact ? this.machineList : this.machineSwitcher);
      case "projects": return await this.focusNavigableSection(this.projectList);
      case "workspaces": return await this.focusNavigableSection(this.workspaceList);
      case "sessions": return await this.focusNavigableSection(this.sessionList);
    }
  }

  /**
   * The panel header names the focused context. "PI WEB" is what the reader
   * already knows: the app is on screen. Which machine, project, workspace or
   * session is in focus is what the header can add.
   */
  private headerName(): string {
    return focusedContextName({
      mainView: this.selectedSession === undefined ? "navigation" : "chat",
      selectedMachine: this.selectedMachine,
      selectedProject: this.selectedProject,
      selectedWorkspace: this.selectedWorkspace,
      selectedSession: this.selectedSession,
    });
  }

  override render() {
    if (this.compact) return this.renderCompact();
    // One body at a time: the context row above says where you are and opens
    // each picker, so the session list keeps the panel instead of sharing it
    // with three lists that are read far more often than they are changed.
    const visible = this.compactVisibleSection();
    return html`
      <header>
        <strong title=${this.headerName()}>${this.headerName()}</strong>
        <div class="header-actions">
          ${this.refreshControl}
          <button title="Open settings" aria-label="Open settings" @click=${() => { this.onOpenSettings?.(); }}>⚙</button>
          <button title="Show Actions" aria-label="Show Actions" @click=${() => { this.onShowActions?.(); }}>Actions</button>
        </div>
      </header>
      <app-context-switcher
        .machines=${this.machines}
        .selectedMachine=${this.selectedMachine}
        .selectedProject=${this.selectedProject}
        .selectedWorkspace=${this.selectedWorkspace}
        .openSection=${visible === "sessions" ? undefined : visible}
        .onOpenSection=${(section: NavigationSection) => { this.openSection(section); }}
        .onAddMachine=${() => { this.onAddMachine?.(); }}
        .onAddProject=${() => { this.runMaybeAsync(this.onAddProject); }}
      ></app-context-switcher>
      ${this.renderMachineList(false, visible !== "machines")}
      ${this.renderProjectList(false, visible !== "projects")}
      ${this.renderWorkspaceList(false, visible !== "workspaces")}
      ${this.renderSessionList(false, visible !== "sessions")}
      ${visible === "sessions" ? this.renderGoalPanel() : null}
    `;
  }

  private renderCompact() {
    return html`
      <div class="compact-shell">
        ${shouldShowMachinesSection(this.machines) ? html`
          <machine-switcher
            hidden
            .machines=${this.machines}
            .selected=${this.selectedMachine}
            .statuses=${this.machineStatuses}
            .statusSnapshots=${this.machineStatusSnapshots}
            .onSelect=${(machine: Machine) => this.onSelectMachine?.(machine)}
            .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
            .onFocusNextSection=${() => { this.focusNextFrom("machines"); }}
            .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
          ></machine-switcher>
        ` : null}
        <!-- No quick-action bar here. It stacked a third bar above the list -
             a fifth of a phone screen before any content - and duplicated
             controls that already exist: the context bar opens sessions, the
             session list starts one, and "Add project" now lives in the
             Projects heading, where it stays reachable on a machine you have
             just switched to instead of vanishing whenever no session could be
             started. -->
        ${this.renderCompactPrimaryList()}
      </div>
    `;
  }

  /**
   * Mobile shows one primary list at a time instead of stacking every section.
   * The context bar chips above this panel already act as a breadcrumb for
   * jumping backwards, so the body should focus on the next useful decision.
   */
  private renderCompactPrimaryList() {
    const visible = this.compactVisibleSection();
    return html`
      ${this.renderMachineList(false, visible !== "machines")}
      <!-- The create control belongs to the heading here and only here: the
           desktop layout above has a context switcher whose Project step
           already carries one, and two of them in one viewport is the clutter
           that switcher was built to remove. -->
      ${this.renderProjectList(false, visible !== "projects", true)}
      ${this.renderWorkspaceList(false, visible !== "workspaces")}
      ${this.renderSessionList(false, visible !== "sessions")}
      ${visible === "sessions" ? this.renderGoalPanel() : null}
    `;
  }

  /**
   * Open a picker from the context row, or close it by choosing it again.
   *
   * This reuses the accordion's own toggle rather than a second piece of state,
   * so the desktop context row and the mobile accordion cannot disagree about
   * which step is showing.
   */
  private openSection(section: NavigationSection): void {
    if (section === "machines") this.onToggleMachines?.();
    else if (section === "projects") this.onToggleProjects?.();
    else if (section === "workspaces") this.onToggleWorkspaces?.();
    else this.onToggleSessions?.();
  }

  private compactVisibleSection(): NavigationSection {
    if (shouldShowMachinesSection(this.machines) && !this.machinesCollapsed) return "machines";
    if (!this.projectsCollapsed) return "projects";
    if (!this.workspacesCollapsed) return "workspaces";
    if (!this.sessionsCollapsed) return "sessions";
    if (this.selectedWorkspace !== undefined) return "sessions";
    if (this.selectedProject !== undefined) return "workspaces";
    return "projects";
  }

  private renderMachineList(collapsible: boolean, hidden = false) {
    if (!shouldShowMachinesSection(this.machines)) return null;
    return html`
      <machine-list
        ?hidden=${hidden}
        .machines=${this.machines}
        .selected=${this.selectedMachine}
        .statuses=${this.machineStatuses}
        .statusSnapshots=${this.machineStatusSnapshots}
        .collapsible=${collapsible && this.collapsible}
        .collapsed=${collapsible ? this.machinesCollapsed : false}
        .onToggleCollapsed=${() => { this.onToggleMachines?.(); }}
        .onSelect=${(machine: Machine) => this.onSelectMachine?.(machine)}
        .onAdd=${() => { this.onAddMachine?.(); }}
        .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
        .onRename=${(machine: Machine, name: string) => this.onRenameMachine?.(machine, name)}
        .onRefresh=${(machine: Machine) => this.onRefreshMachine?.(machine)}
        .onOpen=${(machine: Machine) => { this.onOpenMachine?.(machine); }}
        .onFocusNextSection=${() => { this.focusNextFrom("machines"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
      ></machine-list>
    `;
  }

  private renderProjectList(collapsible: boolean, hidden = false, withCreate = false) {
    return html`
      <project-list
        ?hidden=${hidden}
        .projects=${this.projects}
        .projectsLoad=${this.projectsLoad}
        .onRetryLoad=${() => { this.runMaybeAsync(this.onRetryProjectsLoad); }}
        .selected=${this.selectedProject}
        .statusSnapshot=${this.selectedMachineStatusSnapshot()}
        .collapsible=${collapsible && this.collapsible}
        .collapsed=${collapsible ? this.projectsCollapsed : false}
        .onToggleCollapsed=${() => { this.onToggleProjects?.(); }}
        .onAdd=${withCreate && this.onAddProject !== undefined ? () => { this.runMaybeAsync(this.onAddProject); } : undefined}
        .onSelect=${(project: Project) => this.onSelectProject?.(project)}
        .onClose=${(project: Project) => this.onCloseProject?.(project)}
        .onFocusPreviousSection=${() => { this.focusPreviousFrom("projects"); }}
        .onFocusNextSection=${() => { this.focusNextFrom("projects"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
        .tiles=${true}
      ></project-list>
    `;
  }

  private renderWorkspaceList(collapsible: boolean, hidden = false) {
    return html`
      <workspace-list
        ?hidden=${hidden}
        .workspaces=${this.workspaces}
        .selected=${this.selectedWorkspace}
        .machineId=${this.selectedMachine?.id ?? "local"}
        .statusSnapshot=${this.selectedMachineStatusSnapshot()}
        .deletingWorkspaceIds=${this.deletingWorkspaceIds}
        .collapsible=${collapsible && this.collapsible}
        .collapsed=${collapsible ? this.workspacesCollapsed : false}
        .workspaceLabelItems=${this.workspaceLabelItems}
        .onToggleCollapsed=${() => { this.onToggleWorkspaces?.(); }}
        .onSelect=${(workspace: Workspace) => this.onSelectWorkspace?.(workspace)}
        .onDelete=${(workspace: Workspace) => this.onDeleteWorkspace?.(workspace)}
        .onFocusPreviousSection=${() => { this.focusPreviousFrom("workspaces"); }}
        .onFocusNextSection=${() => { this.focusNextFrom("workspaces"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
        .tiles=${true}
      ></workspace-list>
    `;
  }

  /**
   * Goals are workspace context rather than a navigation step: they sit with
   * the sessions of the workspace they belong to instead of taking an
   * accordion slot of their own. Omitted entirely until a workspace is
   * selected and there is something to report.
   */
  private renderGoalPanel() {
    if (this.selectedWorkspace === undefined) return null;
    if (this.goals.length === 0 && !this.goalsLoading && !this.goalsFailed) return null;
    return html`
      <goal-panel
        .goals=${this.goals}
        .loading=${this.goalsLoading}
        .loadFailed=${this.goalsFailed}
        .canRunCommands=${this.selectedSession !== undefined && this.canRunGoalCommands}
        .onRunCommand=${(goal: GoalRecordSummary, command: string) => this.onRunGoalCommand?.(goal, command)}
        .onRefresh=${() => this.onRefreshGoals?.()}
        .onArchive=${(goal: GoalRecordSummary) => this.onArchiveGoal?.(goal)}
      ></goal-panel>
    `;
  }

  private renderSessionList(collapsible: boolean, hidden = false) {
    return html`
      <session-list
        ?hidden=${hidden}
        .sessions=${this.sessions}
        .sessionsLoad=${this.sessionsLoad}
        .statuses=${this.sessionStatuses}
        .activities=${this.sessionActivities}
        .sending=${this.sendingPrompts}
        .unreadSessionIds=${this.unreadSessionIds}
        .selected=${this.selectedSession}
        .startingCount=${this.startingSessionCount}
        .canStart=${this.canStartSession}
        .collapsible=${collapsible && this.collapsible}
        .collapsed=${collapsible ? this.sessionsCollapsed : false}
        .onToggleCollapsed=${() => { this.onToggleSessions?.(); }}
        .onArchivedCollapsed=${() => this.onArchivedCollapsed?.()}
        .onStart=${() => this.onStartSession?.()}
        .onSelect=${(session: SessionInfo) => this.onSelectSession?.(session)}
        .onArchive=${(session: SessionInfo) => this.onArchiveSession?.(session)}
        .onArchiveWithDescendants=${(session: SessionInfo) => this.onArchiveSessionWithDescendants?.(session)}
        .onArchiveMany=${(sessions: SessionInfo[]) => this.onArchiveSessions?.(sessions)}
        .onRestore=${(session: SessionInfo) => this.onRestoreSession?.(session)}
        .onDelete=${(session: SessionInfo) => this.onDeleteCachedNewSession?.(session)}
        .onDeleteArchived=${(session: SessionInfo) => this.onDeleteArchivedSession?.(session)}
        .onDeleteArchivedMany=${(sessions: SessionInfo[]) => this.onDeleteArchivedSessions?.(sessions)}
        .onDetachParent=${(session: SessionInfo) => this.onDetachParentSession?.(session)}
        .onRename=${(session: SessionInfo, name: string) => this.onRenameSession?.(session, name)}
        .onMarkRead=${(session: SessionInfo) => this.onMarkSessionRead?.(session)}
        .onMarkReadMany=${(sessions: SessionInfo[]) => this.onMarkSessionsRead?.(sessions)}
        .onReload=${(session: SessionInfo) => this.onReloadSession?.(session)}
        .onOpenTree=${(session: SessionInfo) => this.onOpenSessionTree?.(session)}
        .onCleanup=${() => this.onCleanupSessions?.()}
        .onFocusPreviousSection=${() => { this.focusPreviousFrom("sessions"); }}
        .onFocusNextSection=${() => { this.focusNextFrom("sessions"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
      ></session-list>
    `;
  }

  /**
   * Project and workspace rows always belong to the selected machine, resolved
   * exactly as the rest of the app resolves it — including its local-machine
   * default, which is the key snapshots arrive under before a machine has been
   * selected. Diverging here would blank every row's indicator while a snapshot
   * is in fact loaded.
   */
  private selectedMachineStatusSnapshot(): MachineStatusSnapshot | undefined {
    return this.machineStatusSnapshots[selectedMachineId({ selectedMachine: this.selectedMachine })];
  }

  private async focusNavigableSection(section: KeyboardNavigableSection | undefined): Promise<boolean> {
    if (section === undefined) return false;
    return await section.focusSelectedOrFirst();
  }

  private runMaybeAsync(action: (() => void | Promise<void>) | undefined): void {
    const result = action?.();
    if (result instanceof Promise) void result;
  }

  private focusPreviousFrom(section: NavigationSection): void {
    const target = previousVisibleNavigationTarget(section, this.machines);
    if (target !== undefined) void this.onFocusNavigationTarget?.(target);
  }

  private focusNextFrom(section: NavigationSection): void {
    void this.onFocusNavigationTarget?.(nextVisibleNavigationTarget(section, this.machines));
  }

  private cancelKeyboardNavigation(): void {
    void this.onCancelKeyboardNavigation?.();
  }

  static override styles = css`

    /* Shell styles do not cross a shadow boundary, so the tap-highlight
       suppression is repeated for components that define their own. */
    button, [role="button"], a, summary, label, input { -webkit-tap-highlight-color: transparent; }
    /* This panel defines its own styles rather than adopting the shared list
       block, so the tap rule has to be repeated: shell styles do not cross a
       component's shadow boundary. */
    button, [role="button"], input, select, summary { touch-action: manipulation; }

    :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    :host([compact]) { flex: 1 1 auto; }
    header { flex: 0 0 auto; box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: 0 var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
    header button { box-sizing: border-box; height: var(--pi-panel-header-control-height); padding: 0 var(--pi-space-4); font-size: var(--pi-text-xs); }
    .compact-shell { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    header strong { flex: 0 0 auto; }
    machine-switcher { flex: 1 1 auto; min-width: 0; }
    :host([compact]) header { display: none; }
    .header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
    /* One section owns the body at a time, on every width. The context row
       above names the machine, project and workspace, so those pickers only
       appear while they are being changed - which is what frees the whole panel
       for the session list, the one surface that is actually worked in. */
    machine-list, project-list, workspace-list, session-list { flex: 1 1 auto; min-height: 0; overflow: hidden; }
    machine-list[collapsed],
    project-list[collapsed],
    workspace-list[collapsed],
    session-list[collapsed] { flex: 0 0 auto; min-height: auto; overflow: hidden; }
    /* Goals are workspace context under the session list: capped so a long
       task list cannot push the sessions it belongs to off-screen. */
    goal-panel { flex: 0 1 auto; min-height: 0; max-height: var(--pi-nav-goals-max-height, 26vh); overflow: auto; border-top: 1px solid var(--pi-border-muted); }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  `;
}

/**
 * The machines section is shown as soon as there is a machine to show.
 *
 * It used to appear only with a second machine, on the grounds that a
 * single-machine install has no choice to make. That also hid the only place
 * outside Settings where the local machine can be renamed or another machine
 * added, so a single-machine user could not find "devices" at all.
 */
export function shouldShowMachinesSection(machines: readonly Machine[]): boolean {
  return machines.length > 0;
}

function previousVisibleNavigationTarget(section: NavigationSection, machines: readonly Machine[]): NavigationSection | undefined {
  const sections = visibleNavigationSections(machines);
  return sections[sections.indexOf(section) - 1];
}

function nextVisibleNavigationTarget(section: NavigationSection, machines: readonly Machine[]): NavigationFocusTarget {
  const sections = visibleNavigationSections(machines);
  return sections[sections.indexOf(section) + 1] ?? "chat";
}

function visibleNavigationSections(machines: readonly Machine[]): NavigationSection[] {
  return NAVIGATION_SECTION_ORDER.filter((section) => section !== "machines" || shouldShowMachinesSection(machines));
}

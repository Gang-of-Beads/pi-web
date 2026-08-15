import { LitElement, css, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { Machine, MachineHealth, Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import type { WorkspaceLabelItem } from "../../plugins/types";
import { selectedMachineId } from "../../controllers/types";
import type { NavigationSection } from "../../appShell/navigationState";
import { NAVIGATION_SECTION_ORDER } from "../../appShell/navigationState";
import type { KeyboardNavigableSection } from "../navigationFocus";
import "../MachineList";
import "../MachineSwitcher";
import "../ProjectList";
import "../WorkspaceList";
import "../SessionList";

export type NavigationFocusTarget = NavigationSection | "chat";

@customElement("app-navigation-panel")
export class AppNavigationPanel extends LitElement {
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selectedMachine?: Machine;
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) machineStatusSnapshots: Record<string, MachineStatusSnapshot> = {};
  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) selectedProject?: Project;
  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  @property({ attribute: false }) sessions: SessionInfo[] = [];
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

  override render() {
    if (this.compact) return this.renderCompact();
    return html`
      <header>
        <strong>PI WEB</strong>
        ${shouldShowMachinesSection(this.machines) ? html`
          <machine-switcher
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
        <div class="header-actions">
          ${this.refreshControl}
          <button title="Show Actions" aria-label="Show Actions" @click=${() => { this.onShowActions?.(); }}>Actions</button>
        </div>
      </header>
      ${this.renderMachineList(false)}
      ${this.renderProjectList(true)}
      ${this.renderWorkspaceList(true)}
      ${this.renderSessionList(true)}
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
        <div class="mobile-quick-actions">
          <button class="quick-action primary" ?disabled=${this.onAddProject === undefined} @click=${() => { this.runMaybeAsync(this.onAddProject); }}>Add project</button>
          <button class="quick-action" ?disabled=${this.onQuickSwitch === undefined} @click=${() => { this.onQuickSwitch?.(); }}>Open session</button>
          <button class="quick-action" ?disabled=${!this.canStartSession} @click=${() => { this.runMaybeAsync(this.onStartSession); }}>New session</button>
        </div>
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
      ${this.renderProjectList(false, visible !== "projects")}
      ${this.renderWorkspaceList(false, visible !== "workspaces")}
      ${this.renderSessionList(false, visible !== "sessions")}
    `;
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
        .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
        .onFocusNextSection=${() => { this.focusNextFrom("machines"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
      ></machine-list>
    `;
  }

  private renderProjectList(collapsible: boolean, hidden = false) {
    return html`
      <project-list
        ?hidden=${hidden}
        .projects=${this.projects}
        .selected=${this.selectedProject}
        .statusSnapshot=${this.selectedMachineStatusSnapshot()}
        .collapsible=${collapsible && this.collapsible}
        .collapsed=${collapsible ? this.projectsCollapsed : false}
        .onToggleCollapsed=${() => { this.onToggleProjects?.(); }}
        .onSelect=${(project: Project) => this.onSelectProject?.(project)}
        .onClose=${(project: Project) => this.onCloseProject?.(project)}
        .onFocusPreviousSection=${() => { this.focusPreviousFrom("projects"); }}
        .onFocusNextSection=${() => { this.focusNextFrom("projects"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
      ></project-list>
    `;
  }

  private renderWorkspaceList(collapsible: boolean, hidden = false) {
    return html`
      <workspace-list
        ?hidden=${hidden}
        .workspaces=${this.workspaces}
        .selected=${this.selectedWorkspace}
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
      ></workspace-list>
    `;
  }

  private renderSessionList(collapsible: boolean, hidden = false) {
    return html`
      <session-list
        ?hidden=${hidden}
        .sessions=${this.sessions}
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
    :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    :host([compact]) { flex: 1 1 auto; }
    header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
    .compact-shell { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .mobile-quick-actions { flex: 0 0 auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 10px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
    .quick-action { min-height: 44px; }
    .quick-action.primary { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    header strong { flex: 0 0 auto; }
    machine-switcher { flex: 1 1 auto; min-width: 0; }
    :host([compact]) header { display: none; }
    .header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
    /* Expanded sections share the panel height equally, so collapsing one
       section distributes its space to every remaining section, not just the
       session list. Collapsed sections keep only their heading height. */
    machine-list, project-list, workspace-list, session-list { flex: 1 1 0px; min-height: 0; overflow: hidden; border-bottom: 1px solid var(--pi-border-muted); }
    :host([compact]) machine-list,
    :host([compact]) project-list,
    :host([compact]) workspace-list,
    :host([compact]) session-list { flex: 1 1 auto; }    machine-list[collapsed],
    project-list[collapsed],
    workspace-list[collapsed],
    session-list[collapsed] { flex: 0 0 auto; min-height: auto; overflow: hidden; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  `;
}

export function shouldShowMachinesSection(machines: readonly Machine[]): boolean {
  return machines.length > 1;
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

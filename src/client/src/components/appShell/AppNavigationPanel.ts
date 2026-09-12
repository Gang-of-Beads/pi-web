import { LitElement, css, html, nothing, svg, type TemplateResult } from "lit";
import { focusedContextName } from "../../contextName";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Machine, Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "../../api";
import { sessionLabel } from "../../sessionLabels";
import type { DrawerSectionContext, QualifiedDrawerSectionContribution, MachineSectionContext, QualifiedMachineSectionContribution, NavSectionContext, QualifiedNavSectionContribution } from "../../plugins/types";
import type { NavigationSection } from "../../appShell/navigationState";
import { NAVIGATION_SECTION_ORDER } from "../../appShell/navigationState";
import type { KeyboardNavigableSection } from "../navigationFocus";
import "./AppContextSwitcher";
import "../SessionList";

export type NavigationFocusTarget = NavigationSection | "chat";

/** The settings gear in the house stroke style: a text glyph rides font
 *  baselines and never sits in the center of its button, so both headers draw
 *  this icon instead. */
function renderGearIcon(): TemplateResult {
  return svg`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  `;
}

/** One workspace view card in the panel's tools section: the single entry. */
export interface ShellToolTab {
  id: string;
  label: string;
  /** The contributing panel's icon; the card renders it before the label. */
  icon?: TemplateResult | undefined;
  /** Text-safe badge only: the row renders it inline, no rich template. */
  badge?: string | number;
  badgeLabel?: string | undefined;
  selected?: boolean;
}

@customElement("app-navigation-panel")
export class AppNavigationPanel extends LitElement {
  /** Secondary header actions live behind the fold; the bar itself stays one row. */
  @state() private compactActionsOpen = false;
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selectedMachine?: Machine;
  @property({ attribute: false }) selectedProject?: Project;
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  @property({ attribute: false }) sessions: SessionInfo[] = [];
  /** Three-state load discipline threaded from app state; see SessionList. */
  @property({ attribute: false }) sessionsLoad: "unloaded" | "loading" | "loaded" = "unloaded";
  @property({ attribute: false }) selectedSession?: SessionInfo;
  @property({ attribute: false }) sessionActivities: Record<string, SessionActivity> = {};
  @property({ attribute: false }) sessionStatuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) sendingPrompts: Record<string, true> = {};
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
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
  @property({ attribute: false }) onOpenContextSheet?: () => void;
  @property({ attribute: false }) onRequestSection?: (section: NavigationSection) => void;
  @property({ attribute: false }) onAddMachine?: () => void;
  @property({ attribute: false }) onOpenSessionTree?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onToggleMachines?: () => void;
  @property({ attribute: false }) onToggleProjects?: () => void;
  @property({ attribute: false }) onToggleWorkspaces?: () => void;
  @property({ attribute: false }) onToggleSessions?: () => void;
  @property({ attribute: false }) onStartSession?: () => void | Promise<void>;
  @property({ attribute: false }) onPrefetchSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) session?: SessionInfo;
  /** Whether that session has work in progress. */
  @property({ type: Boolean }) isWorking = false;
  /** Opens the quick switcher: the one-tap path to another session. */
  @property({ attribute: false }) onQuickSwitch?: () => void;
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
  /** Sections plugins contribute, drawn beside the session list. */
  @property({ attribute: false }) drawerSections: readonly QualifiedDrawerSectionContribution[] = [];
  /** Contributed context-navigation section bodies, slotted by reserved id. */
  @property({ attribute: false }) navSections: readonly QualifiedNavSectionContribution[] = [];
  /** The host-built snapshot and actions the contributed sections render. */
  @property({ attribute: false }) navSectionContext?: NavSectionContext;
  /** Contributed machines section bodies; the `machines` slot renders them. */
  @property({ attribute: false }) machineSections: readonly QualifiedMachineSectionContribution[] = [];
  /** The host-built snapshot and actions a contributed machines section renders. */
  @property({ attribute: false }) machineSectionContext?: MachineSectionContext;
  @property() sectionMachineId = "local";
  @property({ attribute: false }) onRunSectionCommand?: (command: string) => Promise<void>;
  @property({ attribute: false }) onMarkSessionRead?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onMarkSessionsRead?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onReloadSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onCleanupSessions?: () => void | Promise<void>;
  @property({ attribute: false }) onArchivedCollapsed?: () => void | Promise<void>;
  /** Workspace views as named rows; the one entry, retired the sheet and the second strip. */
  @property({ attribute: false }) toolTabs: readonly ShellToolTab[] = [];
  @property({ attribute: false }) onSelectTool?: (id: string) => void;
  @property({ attribute: false }) onFocusNavigationTarget?: (target: NavigationFocusTarget) => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;

  @query("machine-list") private machineList?: KeyboardNavigableSection;
  @query("session-list") private sessionList?: KeyboardNavigableSection;

  async focusSection(section: NavigationSection): Promise<boolean> {
    await this.updateComplete;
    switch (section) {
      case "machines": return await this.focusNavigableSection(this.machineList);
      case "projects": return await this.focusContributedNavSection("projects");
      case "workspaces": return await this.focusContributedNavSection("workspaces");
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
          <button class="header-icon-action" title="Open settings" aria-label="Open settings" @click=${() => { this.onOpenSettings?.(); }}>${renderGearIcon()}</button>
          <button title="Show Actions" aria-label="Show Actions" @click=${() => { this.onShowActions?.(); }}>Actions</button>
        </div>
      </header>
      <app-context-switcher
        .machines=${this.machines}
        .machineStepAvailable=${this.machinesSectionContributed()}
        .selectedMachine=${this.selectedMachine}
        .selectedProject=${this.selectedProject}
        .selectedWorkspace=${this.selectedWorkspace}
        .openSection=${visible === "sessions" ? undefined : visible}
        .onOpenSection=${(section: NavigationSection) => { this.openSection(section); }}
        .onAddMachine=${() => { this.onAddMachine?.(); }}
        .onAddProject=${() => { this.runMaybeAsync(this.onAddProject); }}
      ></app-context-switcher>
      ${this.renderMachineSectionSlot(visible !== "machines")}
      ${this.renderNavSectionSlot("projects", visible !== "projects")}
      ${this.renderNavSectionSlot("workspaces", visible !== "workspaces")}
      ${this.renderSessionList(false, visible !== "sessions")}
      ${visible === "sessions" ? this.renderContributedSections() : null}
      ${this.renderToolsSection()}
    `;
  }

  private renderCompact() {
    return html`
      <div class="compact-shell">
        <div class="compact-header">
          <button class="compact-scope" @click=${() => { this.onOpenContextSheet?.(); }} aria-label="Change machine, project or workspace">
            <span class="compact-scope-name" dir="auto">${this.compactScopeLabel()}</span>
          </button>
          <button class="compact-session${this.selectedSession === undefined ? " empty" : ""}" @click=${() => { this.onQuickSwitch?.(); }} aria-label="Open session selection">
            <span class="compact-session-name" dir="auto">${this.selectedSession === undefined ? "Sessions" : sessionLabel(this.selectedSession)}</span>
          </button>
          <span class="compact-working" role="status" aria-label="Session is working" ?hidden=${!this.isWorking}><span class="compact-working-dot"></span><span class="compact-working-dot"></span><span class="compact-working-dot"></span></span>
          ${this.refreshControl}
          <button class="compact-header-action compact-fold" title=${this.compactActionsOpen ? "Fewer actions" : "More actions"} aria-label=${this.compactActionsOpen ? "Fewer actions" : "More actions"} aria-expanded=${this.compactActionsOpen ? "true" : "false"} @click=${() => { this.compactActionsOpen = !this.compactActionsOpen; }}>
            <svg class="compact-fold-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d=${this.compactActionsOpen ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"}></path></svg>
          </button>
        </div>
        ${this.compactActionsOpen ? html`
        <div class="compact-actions-row">
          <button class="compact-header-action" title="Open settings" aria-label="Open settings" @click=${() => { this.onOpenSettings?.(); }}>Settings</button>
          <button class="compact-header-action" title="Show Actions" aria-label="Show Actions" @click=${() => { this.onShowActions?.(); }}>Actions</button>
        </div>` : null}
        <!-- No quick-action bar here. It stacked a third bar above the list -
             a fifth of a phone screen before any content - and duplicated
             controls that already exist: the resident row opens the panel, the
             session list starts one, and "Add project" lives in the Projects
             heading, where it stays reachable on a machine you have just
             switched to instead of vanishing whenever no session could be
             started. -->
        ${this.renderCompactPrimaryList()}
        ${this.compactVisibleSection() === "sessions" ? this.renderToolsSection() : null}
      </div>
    `;
  }

  /**
   * The phone panel shows no context chips, so the header chip names the scope
   * the lists below belong to - machine by project by workspace - and opens the
   * context sheet, where every level is listed and the current one is marked.
   */
  private compactScopeLabel(): string {
    if (this.selectedProject === undefined) return "PI WEB";
    const workspaceName = this.selectedWorkspace === undefined ? undefined : this.selectedWorkspace.path.split("/").filter(Boolean).pop();
    // A workspace named after its project read as "pi-web · pi-web" - the
    // repetition is noise; the name is said once.
    if (workspaceName === undefined || workspaceName === this.selectedProject.name) return this.selectedProject.name;
    return `${this.selectedProject.name} · ${workspaceName}`;
  }

  /**
   * Mobile shows one primary list at a time instead of stacking every section.
   * The context sheet owns level switching, so the body should focus on the
   * section the user is working in; the tools grid follows the sessions
   * section, because its cards act on the workspace that section belongs to.
   */
  private renderCompactPrimaryList() {
    const visible = this.compactVisibleSection();
    return html`
      ${this.renderMachineSectionSlot(visible !== "machines")}
      <!-- The create control belongs to the heading here and only here: the
           desktop layout above has a context switcher whose Project step
           already carries one, and two of them in one viewport is the clutter
           that switcher was built to remove. -->
      ${this.renderNavSectionSlot("projects", visible !== "projects", true)}
      ${this.renderNavSectionSlot("workspaces", visible !== "workspaces")}
      ${this.renderSessionList(false, visible !== "sessions")}
      ${visible === "sessions" ? this.renderContributedSections() : null}
    `;
  }

  /**
   * Open a picker section as a request: the requested section becomes the
   * visible one regardless of what the fallback order would have shown.
   */
  private openSection(section: NavigationSection): void {
    this.onRequestSection?.(section);
  }

  private machinesSectionContributed(): boolean {
    return this.machineSections.some((candidate) => candidate.localId === "machines") && this.machineSectionContext !== undefined;
  }

  private machinesVisibleForNavigation(): boolean {
    return this.machinesSectionContributed() && shouldShowMachinesSection(this.machines);
  }

  private compactVisibleSection(): NavigationSection {
    if (this.machinesSectionContributed() && shouldShowMachinesSection(this.machines) && !this.machinesCollapsed) return "machines";
    if (!this.projectsCollapsed) return "projects";
    if (!this.workspacesCollapsed) return "workspaces";
    if (!this.sessionsCollapsed) return "sessions";
    if (this.selectedWorkspace !== undefined) return "sessions";
    if (this.selectedProject !== undefined) return "workspaces";
    return "projects";
  }

  private renderMachineSectionSlot(hidden: boolean): unknown {
    const section = this.machineSections.find((candidate) => candidate.localId === "machines");
    if (section === undefined || this.machineSectionContext === undefined) return nothing;
    const context: MachineSectionContext = {
      ...this.machineSectionContext,
      display: { hidden, collapsible: false, collapsed: false, tiles: false, withCreate: false },
      toggleCollapsed: () => { this.onToggleMachines?.(); },
      focusPreviousSection: () => { this.focusPreviousFrom("machines"); },
      focusNextSection: () => { this.focusNextFrom("machines"); },
      cancelKeyboardNavigation: () => { this.cancelKeyboardNavigation(); },
    };
    return section.render(context);
  }

  private renderNavSectionSlot(localId: "projects" | "workspaces", hidden: boolean, withCreate = false): unknown {
    const section = this.navSections.find((candidate) => candidate.localId === localId);
    if (section === undefined || this.navSectionContext === undefined) return nothing;
    const { addProject, ...base } = this.navSectionContext;
    const context: NavSectionContext = {
      ...base,
      display: { hidden, collapsible: false, collapsed: false, tiles: true, withCreate },
      ...(withCreate && addProject !== undefined ? { addProject } : {}),
      toggleCollapsed: () => { (localId === "projects" ? this.onToggleProjects : this.onToggleWorkspaces)?.(); },
      focusPreviousSection: () => { this.focusPreviousFrom(localId); },
      focusNextSection: () => { this.focusNextFrom(localId); },
      cancelKeyboardNavigation: () => { this.cancelKeyboardNavigation(); },
    };
    return section.render(context);
  }

  private async focusContributedNavSection(localId: "projects" | "workspaces"): Promise<boolean> {
    await this.updateComplete;
    const section = this.navSections.find((candidate) => candidate.localId === localId);
    if (section?.focus === undefined) return false;
    return await section.focus();
  }

  /**
   * Sections a plugin contributes, drawn here as well as in the chat drawer:
   * the navigation panel is where a workspace's side channels live when the
   * chat is not on screen, and a section that only appeared in one of the two
   * would be missing exactly when the reader went looking for it.
   */
  private renderContributedSections() {
    const context = this.sectionContext();
    if (context === undefined) return null;
    // The contributed rows paint full-bleed without this: the host's list
    // sections carry the reading edge via their own section padding, and the
    // plugin rows assumed that same inset was theirs.
    return html`<div class="contributed-sections">${this.drawerSections.map((section) => section.available?.(context) === false ? null : section.render(context))}</div>`;
  }

  /**
   * Workspace views as named rows: the one entrance on every layout. Opening
   * one hands the id back; the shell resolves it against its typed view set.
   */
  private renderToolsSection() {
    if (this.toolTabs.length === 0) return null;
    return html`
      <div class="tools-section" role="group" aria-label="Workspace views">
        ${this.toolTabs.map((tab) => html`
          <button
            type="button"
            class=${tab.selected === true ? "tool-row selected" : "tool-row"}
            aria-current=${tab.selected === true ? "true" : undefined}
            @click=${() => { this.onSelectTool?.(tab.id); }}
          >
            <span class="tool-icon" aria-hidden="true">${tab.icon ?? null}</span>
            <span class="tool-label">${tab.label}</span>
            ${tab.badge === undefined ? null : html`<span class="tool-badge" aria-label=${tab.badgeLabel ?? String(tab.badge)}>${tab.badge}</span>`}
          </button>
        `)}
      </div>
    `;
  }

  private sectionContext(): DrawerSectionContext | undefined {
    const session = this.selectedSession;
    if (session === undefined) return undefined;
    const runSectionCommand = this.onRunSectionCommand;
    return {
      sessionId: session.id,
      machineId: this.sectionMachineId,
      workspacePath: this.selectedWorkspace?.path,
      sessionCwd: session.cwd,
      requestUpdate: () => { this.requestUpdate(); },
      runCommand: runSectionCommand === undefined ? undefined : (command) => runSectionCommand(command),
    };
  }


  private renderSessionList(collapsible: boolean, hidden = false) {
    return html`
      <session-list
        ?hidden=${hidden}
        .workspaceGone=${this.selectedWorkspace?.cwdMissing === true}
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
        .onPrefetch=${(session: SessionInfo) => this.onPrefetchSession?.(session)}
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

  private async focusNavigableSection(section: KeyboardNavigableSection | undefined): Promise<boolean> {
    if (section === undefined) return false;
    return await section.focusSelectedOrFirst();
  }

  private runMaybeAsync(action: (() => void | Promise<void>) | undefined): void {
    const result = action?.();
    if (result instanceof Promise) void result;
  }

  private focusPreviousFrom(section: NavigationSection): void {
    const target = previousVisibleNavigationTarget(section, this.machinesVisibleForNavigation());
    if (target !== undefined) void this.onFocusNavigationTarget?.(target);
  }

  private focusNextFrom(section: NavigationSection): void {
    void this.onFocusNavigationTarget?.(nextVisibleNavigationTarget(section, this.machinesVisibleForNavigation()));
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
    /* Control chrome, not content: buttons and labels here are not copy targets. (T1/T3) */
    :host, :host * { -webkit-user-select: none; user-select: none; }
    :host textarea, :host input, :host [contenteditable] { -webkit-user-select: text; user-select: text; }
    :host([compact]) { flex: 1 1 auto; }
    .contributed-sections { padding-inline: var(--pi-reading-edge); }
    header { flex: 0 0 auto; box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-1) var(--pi-reading-edge); border-bottom: 1px solid var(--pi-border); }
    header button { box-sizing: border-box; height: var(--pi-panel-header-control-height); padding: 0 var(--pi-space-4); font-size: var(--pi-text-xs); }
    .header-icon-action:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    .header-icon-action { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); }
    .header-icon-action svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .compact-shell { --pi-focus-ring-offset: var(--pi-focus-ring-offset-inset); flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    /* The phone header is a row of 44px controls; its own padding made it 53
       where the desktop rail measures 45. Same rule, same height. */
    /* The compact row speaks the header radius token; a control that renders itself follows the
       row it is in rather than carrying the rail's corner into it. */
    .compact-header { --pi-header-control-radius: var(--pi-radius-md); flex: 0 0 auto; box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; justify-content: flex-start; gap: var(--pi-space-3); padding: var(--pi-space-1) var(--pi-reading-edge); border-bottom: 1px solid var(--pi-border); }
    .compact-session { flex: 1 1 auto; min-width: 0; min-height: var(--pi-control-height-touch); display: inline-flex; align-items: center; box-sizing: border-box; border: 0; background: none; color: var(--pi-text); font: inherit; font-size: var(--pi-text-sm); text-align: start; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .compact-session-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .compact-session.empty { color: var(--pi-muted); font-weight: var(--pi-weight-medium); }
    .compact-session:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .compact-working { box-sizing: border-box; flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-1); min-height: var(--pi-control-height-touch); padding: 0 var(--pi-space-2); }
    .compact-working[hidden] { display: none; }
    .compact-working-dot { width: var(--pi-dot-xs); height: var(--pi-dot-xs); border-radius: 50%; background: var(--pi-accent); animation: compact-working-bounce 1.2s ease-in-out infinite; }
    .compact-working-dot:nth-child(2) { animation-delay: .2s; }
    .compact-working-dot:nth-child(3) { animation-delay: .4s; }
    @keyframes compact-working-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .55; } 30% { transform: translateY(-3px); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .compact-working-dot { animation: none; opacity: .8; } }
    .compact-fold { box-sizing: border-box; width: var(--pi-panel-header-control-height); }
    .compact-fold-icon { width: var(--pi-dot-md); height: var(--pi-dot-md); pointer-events: none; }
    .compact-actions-row { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-4); box-sizing: border-box; min-height: var(--pi-control-height-touch); padding: var(--pi-space-2) var(--pi-reading-edge); border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    @media (pointer: coarse) { .compact-scope:active, .compact-session:active, .compact-header-action:active { background: var(--pi-surface-hover); } }
    .compact-actions-row .compact-header-action { flex: 1 1 auto; }
    .compact-header-action { font-size: var(--pi-text-xs); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: var(--pi-control-height-touch); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-header-control-radius, var(--pi-radius-md)); background: var(--pi-surface); color: var(--pi-text); }
    /* Squared, glyph-only: the shared action rule above pads both sides, and
       without this higher-specificity override the fold button rendered as an
       8px glyph in a 24px pill. */
    .compact-header-action.compact-fold { padding: 0; }
    .compact-header-action:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    /* Coarse pointers get the comfort floor: the glyph is small but the hit
       box carries the row's tap weight in the phone header. */
    @media (pointer: coarse) { .compact-header-action { min-width: var(--pi-control-height-touch, 44px); min-height: var(--pi-control-height-touch, 44px); } }
    @media (hover: hover) { .compact-header-action:hover { background: var(--pi-surface-hover); } }
    .tools-section { flex: 0 0 auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--pi-space-4); padding: var(--pi-reading-edge) var(--pi-reading-edge) calc(var(--pi-reading-edge) + env(safe-area-inset-bottom)); border-top: 1px solid var(--pi-border-muted); }
    .tool-row:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .tool-row { display: flex; align-items: center; gap: var(--pi-space-3); box-sizing: border-box; min-height: calc(var(--pi-control-height-touch) + var(--pi-space-4)); padding: var(--pi-space-2) var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); font: inherit; text-align: start; }
    .tool-row:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    @media (hover: hover) { .tool-row:hover { background: var(--pi-surface-hover); } }
    .tool-row.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-accent); font-weight: var(--pi-weight-semibold); }
    .tool-icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; color: var(--pi-muted); }
    .tool-row.selected .tool-icon { color: var(--pi-accent); }
    .tool-icon svg { width: 100%; height: 100%; }
    .tool-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tool-badge { flex: 0 0 auto; display: inline-flex; align-items: center; box-sizing: border-box; min-width: 14px; max-width: 45%; line-height: 16px; padding: 0 var(--pi-space-2); border-radius: var(--pi-radius-pill); background: var(--pi-selection-bg); color: var(--pi-text-bright); font-size: var(--pi-text-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .compact-scope { box-sizing: border-box; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; min-height: var(--pi-control-height-touch); border: 0; background: none; padding: 0; font: inherit; font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); color: var(--pi-text); text-align: start; cursor: pointer; }
    .compact-scope:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); border-radius: var(--pi-radius-md); }
    .compact-scope-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* An unnamed session falls back to its whole first message, so a header
       title that refuses to shrink pushed the settings and Actions buttons
       out of the panel entirely. */
    header strong { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :host([compact]) header { display: none; }
    .header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-4); }
    /* One section owns the body at a time, on every width. The context row
       above names the machine, project and workspace, so those pickers only
       appear while they are being changed - which is what frees the whole panel
       for the session list, the one surface that is actually worked in. */
    machine-list, project-list, workspace-list, session-list { flex: 1 1 auto; min-height: 0; overflow: hidden; }
    button { font: inherit; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
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

function previousVisibleNavigationTarget(section: NavigationSection, machinesVisible: boolean): NavigationSection | undefined {
  const sections = visibleNavigationSections(machinesVisible);
  return sections[sections.indexOf(section) - 1];
}

function nextVisibleNavigationTarget(section: NavigationSection, machinesVisible: boolean): NavigationFocusTarget {
  const sections = visibleNavigationSections(machinesVisible);
  return sections[sections.indexOf(section) + 1] ?? "chat";
}

function visibleNavigationSections(machinesVisible: boolean): NavigationSection[] {
  return NAVIGATION_SECTION_ORDER.filter((section) => section !== "machines" || machinesVisible);
}

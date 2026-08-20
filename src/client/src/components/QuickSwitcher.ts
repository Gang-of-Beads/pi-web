import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Project, SessionInfo, Workspace } from "../api";
import { quickSwitcherFilterActive, quickSwitcherFilterSessions, quickSwitcherModel, quickSwitcherSessionSubtitle, quickSwitcherWorkspaces, type QuickSwitcherFilter, type QuickSwitcherGroup } from "../quickSwitcher";
import { LongPressTracker } from "../longPress";
import { renderSessionStateBadge, type SessionStateBadgeKind } from "./activityBadge";
import { sessionStateBadgeStyles } from "./sessionStateBadgeStyles";
import { sessionLabel } from "../sessionLabels";
import { keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import "./ModalSurface";
import { scrollWhenSelected } from "./scrollWhenSelected";

/**
 * One-surface session switcher for touch layouts.
 *
 * Creating and opening are the two things done constantly on a phone, and both
 * previously required walking the navigation accordion one section at a time.
 * This sheet puts the create action, a search field, the recent sessions, and
 * the sibling workspaces on a single scrollable surface, so neither task needs
 * a drill-down.
 */
@customElement("quick-switcher")
export class QuickSwitcher extends LitElement {
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) sessions: readonly SessionInfo[] = [];
  @property({ attribute: false }) workspaces: readonly Workspace[] = [];
  @property({ attribute: false }) selectedSession?: SessionInfo;
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  @property({ attribute: false }) activeSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) waitingSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  /** Sessions the daemon reported as cut off by a restart. */
  @property({ attribute: false }) interruptedSessionIds: ReadonlySet<string> = new Set();
  /** Sessions whose agent stopped on an error; listed above everything else. */
  @property({ attribute: false }) errorSessionIds: ReadonlySet<string> = new Set();
  /** Sessions the user pinned on this device. */
  @property({ attribute: false }) pinnedSessionIds: ReadonlySet<string> = new Set();
  /** Projects offered as context filters. */
  @property({ attribute: false }) projects: readonly Project[] = [];
  /** Four-state session badge per session, computed upstream. */
  @property({ attribute: false }) sessionStates: ReadonlyMap<string, SessionStateBadgeKind> = new Map();
  @property({ type: Boolean }) canStartSession = false;
  @property({ attribute: false }) onCreateSession?: () => void;
  @property({ attribute: false }) onOpenSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onSelectWorkspace?: (workspace: Workspace) => void;
  @property({ attribute: false }) onBrowse?: () => void;
  @property({ attribute: false }) onClose?: () => void;
  @property({ attribute: false }) onTogglePin?: (session: SessionInfo) => void;
  @property({ attribute: false }) onRenameSession?: (session: SessionInfo, name: string) => void | Promise<void>;

  @state() private query = "";
  @state() private filter: QuickSwitcherFilter = {};
  @state() private openMenuSessionId: string | undefined;
  @state() private renamingSessionId: string | undefined;
  private renameDraft = "";
  private heldSession: SessionInfo | undefined;
  private readonly longPress = new LongPressTracker({
    onLongPress: () => { this.openMenuSessionId = this.heldSession?.id; },
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => { window.clearTimeout(handle); },
  });

  override render() {
    const model = this.model();
    const workspaces = quickSwitcherWorkspaces(this.workspaces, this.query);
    const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== this.selectedWorkspace?.id);

    return html`
      <modal-surface
        .onClose=${() => this.onClose?.()}
        .initialFocus=${"input"}
        .label=${"Sessions"}
        @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}
      >
        <header>
          <input
            type="search"
            inputmode="search"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            enterkeyhint="search"
            aria-label="Search sessions and workspaces"
            placeholder="Search sessions"
            .value=${this.query}
            @input=${(event: Event) => { this.onQueryInput(event); }}
          >
          <button class="close" title="Close" aria-label="Close" @click=${() => this.onClose?.()}>×</button>
        </header>
        ${this.renderFilters()}
        <div class="body">
          ${this.renderCreateRow()}
          ${model.groups.map((group) => this.renderGroup(group))}
          ${this.loading
            ? html`<p class="empty">Loading sessions…</p>`
            : model.matchCount === 0
              ? html`<p class="empty">${this.query.trim() === "" ? "No sessions yet." : `No sessions match “${this.query.trim()}”.`}</p>`
              : null}
          ${otherWorkspaces.length === 0 ? null : html`
            <h3>Workspaces</h3>
            <div class="rows">
              ${otherWorkspaces.map((workspace) => html`
                <button class="row workspace-row" @click=${() => { this.selectWorkspace(workspace); }}>
                  <span class="row-title">${workspace.label}${workspace.isMain ? " · main" : ""}</span>
                  <span class="row-subtitle">${workspace.path}</span>
                </button>
              `)}
            </div>
          `}
        </div>
        <footer>
          <button @click=${() => { this.browse(); }}>Browse machines and projects</button>
        </footer>
      </modal-surface>
    `;
  }

  private renderCreateRow() {
    const workspaceLabel = this.selectedWorkspace?.label;
    const subtitle = workspaceLabel === undefined
      ? "Select a workspace first"
      : `In ${workspaceLabel}`;
    return html`
      <button
        class="row create-row"
        ?disabled=${!this.canStartSession}
        title=${this.canStartSession ? "Start a new session" : "Select a workspace to start a session"}
        @click=${() => { this.createSession(); }}
      >
        <span class="row-title">＋ New session</span>
        <span class="row-subtitle">${subtitle}</span>
      </button>
    `;
  }

  private renderGroup(group: QuickSwitcherGroup) {
    return html`
      <h3>${group.title}</h3>
      <div class="rows">
        ${group.sessions.map((session) => this.renderSessionRow(session))}
      </div>
    `;
  }

  private renderSessionRow(session: SessionInfo) {
    if (this.renamingSessionId === session.id) return this.renderRenameRow(session);
    const selected = this.selectedSession?.id === session.id;
    const unread = this.unreadSessionIds.has(session.id);
    const pinned = this.pinnedSessionIds.has(session.id);
    const rawStateKind = this.sessionStates.get(session.id) ?? (this.activeSessionIds.has(session.id) ? "working" : undefined);
    // An interrupted run's marker replaces any idle-state dot: being cut off by
    // a restart is more informative than being briefly quiet, and two marks in
    // the same corner read as noise. The moment the session works again the
    // marker yields to the live state (three dots / green / amber / red).
    const interrupted = this.interruptedSessionIds.has(session.id) && rawStateKind !== "working";
    const stateKind = interrupted ? undefined : rawStateKind;
    return html`
      <div class="row-wrap">
        <button
          class=${`row session-row ${selected ? "selected" : ""} ${unread ? "unread" : ""}`}
          aria-current=${selected ? "true" : nothing}
          ${scrollWhenSelected(selected, session.id)}
          @click=${() => { this.openSession(session); }}
          @contextmenu=${(event: MouseEvent) => { event.preventDefault(); this.openMenuSessionId = session.id; }}
          @pointerdown=${(event: PointerEvent) => { this.heldSession = session; this.longPress.start(event); }}
          @pointermove=${(event: PointerEvent) => { this.longPress.move(event); }}
          @pointerup=${() => { this.longPress.cancel(); }}
          @pointercancel=${() => { this.longPress.cancel(); }}
        >
          <span class="row-title" dir="auto">${pinned ? html`<span class="pin-mark" title="Pinned" aria-label="Pinned">${"\u2691"}</span> ` : nothing}${sessionLabel(session)}</span>
          <span class="row-subtitle">${quickSwitcherSessionSubtitle(session, this.workspaces)}</span>
          <span class="row-state">${renderSessionStateBadge(stateKind, unread && stateKind === undefined ? "Unread activity" : undefined)}</span>
          ${interrupted ? html`<span class="row-flag interrupted" title="A restart interrupted this run" aria-label="A restart interrupted this run"></span>` : null}
          ${stateKind === undefined && !interrupted && unread ? html`<span class="row-flag unread" title="Unread activity" aria-label="Unread activity"></span>` : null}
        </button>
        <button
          class="row-menu-toggle"
          title="Session actions"
          aria-label=${`Actions for ${sessionLabel(session)}`}
          aria-haspopup="menu"
          aria-expanded=${this.openMenuSessionId === session.id ? "true" : "false"}
          @click=${() => { this.openMenuSessionId = this.openMenuSessionId === session.id ? undefined : session.id; }}
        >⋯</button>
        ${this.openMenuSessionId === session.id ? this.renderRowMenu(session) : nothing}
      </div>
    `;
  }

  private renderRowMenu(session: SessionInfo) {
    const pinned = this.pinnedSessionIds.has(session.id);
    return html`
      <div class="row-menu" role="menu">
        <button role="menuitem" @click=${() => { this.openSession(session); }}>Open</button>
        <button role="menuitem" @click=${() => { this.togglePin(session); }}>${pinned ? "Unpin" : "Pin to top"}</button>
        <button role="menuitem" ?disabled=${this.onRenameSession === undefined} @click=${() => { this.startRename(session); }}>Rename</button>
      </div>
    `;
  }

  private renderRenameRow(session: SessionInfo) {
    return html`
      <form class="row rename-row" @submit=${(event: Event) => { event.preventDefault(); void this.confirmRename(session); }}>
        <input
          class="rename-input"
          aria-label=${`Rename ${sessionLabel(session)}`}
          .value=${this.renameDraft}
          @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.renameDraft = event.target.value; }}
          @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); this.renamingSessionId = undefined; } }}
        >
        <div class="rename-actions">
          <button type="submit" title="Save name" aria-label="Save name">${"\u2713"}</button>
          <button type="button" title="Cancel rename" aria-label="Cancel rename" @click=${() => { this.renamingSessionId = undefined; }}>${"\u00d7"}</button>
        </div>
      </form>
    `;
  }

  private togglePin(session: SessionInfo): void {
    this.openMenuSessionId = undefined;
    this.onTogglePin?.(session);
  }

  private startRename(session: SessionInfo): void {
    this.openMenuSessionId = undefined;
    this.renameDraft = sessionLabel(session);
    this.renamingSessionId = session.id;
  }

  private async confirmRename(session: SessionInfo): Promise<void> {
    const name = this.renameDraft.trim();
    this.renamingSessionId = undefined;
    if (name === "" || name === sessionLabel(session)) return;
    await this.onRenameSession?.(session, name);
  }

  // Escape is owned by the modal surface. Enter on the search field opens the
  // single remaining match, which is what makes "type two letters, hit go" work
  // on a phone keyboard without reaching for the list.
  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || keyboardEventOriginatesFromNativeActivationControl(event)) return;
    const first = this.model().groups[0]?.sessions[0];
    if (first === undefined) return;
    event.preventDefault();
    this.openSession(first);
  }

  /**
   * One model for rendering and for Enter-to-open, so the row the keyboard
   * opens is always the row the eye sees first.
   */
  private model() {
    return quickSwitcherModel({
      sessions: quickSwitcherFilterSessions(this.sessions, this.filter, this.workspaces),
      activeSessionIds: this.activeSessionIds,
      errorSessionIds: this.errorSessionIds,
      waitingSessionIds: this.waitingSessionIds,
      unreadSessionIds: this.unreadSessionIds,
      interruptedSessionIds: this.interruptedSessionIds,
      pinnedSessionIds: this.pinnedSessionIds,
      query: this.query,
      now: Date.now(),
    });
  }

  /**
   * Context filters. Nothing selected is focus mode - every session this
   * browser loaded, across every workspace - so the default answers "what needs
   * me anywhere" and narrowing is a deliberate act.
   */
  private renderFilters() {
    const projects = this.projects.filter((project) => this.workspaces.some((workspace) => workspace.projectId === project.id));
    if (projects.length === 0 && this.workspaces.length < 2) return nothing;
    const active = quickSwitcherFilterActive(this.filter);
    return html`
      <div class="filters" role="group" aria-label="Filter sessions by context">
        <button
          type="button"
          class=${active ? "chip" : "chip on"}
          aria-pressed=${active ? "false" : "true"}
          title="Show sessions from every project and workspace"
          @click=${() => { this.filter = {}; }}
        >All</button>
        ${projects.map((project) => html`
          <button
            type="button"
            class=${this.filter.projectId === project.id ? "chip on" : "chip"}
            aria-pressed=${this.filter.projectId === project.id ? "true" : "false"}
            @click=${() => { this.toggleFilter({ projectId: project.id }); }}
          >${project.name}</button>
        `)}
        ${this.filterWorkspaces(projects).map((workspace) => html`
          <button
            type="button"
            class=${this.filter.workspacePath === workspace.path ? "chip on nested" : "chip nested"}
            aria-pressed=${this.filter.workspacePath === workspace.path ? "true" : "false"}
            @click=${() => { this.toggleFilter({ workspacePath: workspace.path }); }}
          >${workspace.label}</button>
        `)}
      </div>
    `;
  }

  /**
   * Workspace chips appear only where they say something a project chip does
   * not: inside a chosen project with more than one workspace, or when there
   * are no projects to group by. A project whose single workspace shares its
   * name would otherwise print the same word twice.
   */
  private filterWorkspaces(projects: readonly Project[]): readonly Workspace[] {
    if (this.filter.projectId !== undefined) {
      const inProject = this.workspaces.filter((workspace) => workspace.projectId === this.filter.projectId);
      return inProject.length > 1 ? inProject : [];
    }
    return projects.length === 0 ? this.workspaces : [];
  }

  /** Tapping the active filter clears it, so one control both narrows and widens. */
  private toggleFilter(next: QuickSwitcherFilter): void {
    const same = (next.projectId !== undefined && next.projectId === this.filter.projectId)
      || (next.workspacePath !== undefined && next.workspacePath === this.filter.workspacePath);
    this.filter = same ? {} : next;
  }

  private onQueryInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.query = event.target.value;
  }

  private createSession(): void {
    if (!this.canStartSession) return;
    this.onCreateSession?.();
    this.onClose?.();
  }

  private openSession(session: SessionInfo): void {
    this.onOpenSession?.(session);
    this.onClose?.();
  }

  private selectWorkspace(workspace: Workspace): void {
    this.onSelectWorkspace?.(workspace);
    // The sheet stays open so the workspace's own sessions can be picked
    // immediately; only choosing a session or creating one dismisses it.
    this.query = "";
  }

  private browse(): void {
    this.onBrowse?.();
    this.onClose?.();
  }

  static override styles = [sessionStateBadgeStyles, css`
    :host { position: fixed; inset: 0; z-index: 25; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    modal-surface {
      --modal-surface-place-items: end center;
      --modal-surface-backdrop-padding: 0;
      --modal-surface-width: min(560px, 100vw);
      --modal-surface-max-height: min(88dvh, 760px);
    }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-4); align-items: center; padding: var(--pi-space-5); border-bottom: 1px solid var(--pi-border); }
    input { box-sizing: border-box; min-width: 0; height: 40px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-bg); color: var(--pi-text); padding: 0 var(--pi-space-5); font: var(--pi-text-lg) var(--pi-font-ui); }
    input::-webkit-search-cancel-button { display: none; }
    input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
    .close { border: 0; background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); line-height: 1; padding: 0 var(--pi-space-4); cursor: pointer; }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: var(--pi-space-5); overscroll-behavior: contain; }
    h3 { margin: var(--pi-space-7) var(--pi-space-2) var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: 600; text-transform: uppercase; }
    .rows { display: grid; gap: var(--pi-space-3); }
    .row { position: relative; display: grid; gap: var(--pi-space-1); width: 100%; min-height: 52px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-5) 34px var(--pi-space-5) var(--pi-space-6); text-align: left; cursor: pointer; }
    .row:hover:not(:disabled) { background: var(--pi-surface-hover); }
    .row:disabled { opacity: .55; cursor: not-allowed; }
    .row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--pi-text-md); }
    .row-subtitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .create-row { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .create-row .row-title { font-weight: 650; }
    .session-row.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .session-row.unread .row-title { color: var(--pi-text-bright); font-weight: 650; }
    .row-flag, .row-state { position: absolute; top: 50%; right: 12px; transform: translateY(-50%); }
    .row-state { display: inline-flex; align-items: center; }
    .row-flag { width: 8px; height: 8px; border-radius: 50%; }
    .row-flag.unread { background: var(--pi-accent); }
    /* Hollow rather than filled: this one marks work that stopped, so it should
       not read as another kind of activity at a glance. */
    .row-flag.interrupted { background: transparent; border: 2px solid var(--pi-warning, var(--pi-accent)); }
    /* Filters scroll sideways rather than wrapping into a wall of chips; the
       row keeps one line so it never competes with the list for height. */
    .filters { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-3); padding: var(--pi-space-4) var(--pi-space-5); border-bottom: 1px solid var(--pi-border-muted); overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; }
    .filters::-webkit-scrollbar { display: none; }
    .chip { flex: 0 0 auto; min-height: 32px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-text-secondary); padding: var(--pi-space-2) var(--pi-space-6); font: inherit; font-size: var(--pi-text-sm); white-space: nowrap; cursor: pointer; }
    .chip.on { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-text-bright); }
    /* Nested chips read as a second level, not as peers of the projects. */
    .chip.nested { border-style: dashed; font-size: var(--pi-text-xs); }
    .chip:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
    .row-wrap { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-3); }
    /* A long press must not race the platform's own text callout. */
    .row-wrap .session-row { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
    .row-menu-toggle { flex: 0 0 auto; width: 40px; min-height: 52px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-muted); font-size: var(--pi-text-lg); line-height: 1; cursor: pointer; }
    .row-menu-toggle:hover, .row-menu-toggle:focus-visible { color: var(--pi-text); border-color: var(--pi-accent); }
    .row-menu { position: absolute; top: calc(100% - 4px); right: 0; z-index: 3; display: grid; gap: var(--pi-space-1); min-width: 160px; padding: var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); box-shadow: 0 10px 26px var(--pi-shadow); }
    .row-menu button { min-height: 40px; border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text); padding: 0 var(--pi-space-5); font: inherit; text-align: left; cursor: pointer; }
    .row-menu button:hover:not(:disabled), .row-menu button:focus-visible:not(:disabled) { background: var(--pi-selection-bg); }
    .row-menu button:disabled { opacity: .5; cursor: not-allowed; }
    .pin-mark { color: var(--pi-accent); }
    .rename-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-5); }
    .rename-input { box-sizing: border-box; width: 100%; min-height: 40px; border: 1px solid var(--pi-accent); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding: 0 var(--pi-space-5); font: var(--pi-text-lg) var(--pi-font-ui); }
    .rename-actions { display: flex; gap: var(--pi-space-3); }
    .rename-actions button { width: 40px; min-height: 40px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .empty { margin: var(--pi-space-7) var(--pi-space-2); color: var(--pi-muted); }
    footer { flex: 0 0 auto; padding: var(--pi-space-5); padding-bottom: max(10px, env(safe-area-inset-bottom)); border-top: 1px solid var(--pi-border); }
    footer button { width: 100%; min-height: 44px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "quick-switcher": QuickSwitcher;
  }
}

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { renderCheckIcon, renderChevronRightIcon, renderCrossIcon, renderPinIcon, uiIconStyle } from "./uiIcons.js";
import { quickSwitcherFilterProjects } from "../quickSwitcher";
import { reconcileBreadcrumbFilter, switcherBreadcrumb, type BreadcrumbLevel } from "../switcherBreadcrumb";
import { switcherEmptyMeaning, switcherScopeNotice } from "../switcherEmptyMeaning";
import { switcherInitialFocus, touchPrimaryPointer } from "../keyboardDismissal";
import { customElement, property, state } from "lit/decorators.js";
import type { Machine, Project, SessionInfo, Workspace } from "../api";
import { quickSwitcherFilterSessions, quickSwitcherModel, quickSwitcherSessionSubtitle, quickSwitcherWorkspaces, type QuickSwitcherFilter, type QuickSwitcherGroup } from "../quickSwitcher";
import { LongPressTracker } from "../longPress";
import { renderSessionRowIndicator, sessionRowIndicator } from "./sessionRowIndicator";
import type { SessionStateBadgeKind } from "./activityBadge";
import { sessionStateBadgeStyles } from "./sessionStateBadgeStyles";
import { sessionLabel } from "../sessionLabels";
import { keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import "./ModalSurface";
import { scrollWhenSelected } from "./scrollWhenSelected";
import { interactiveSurfaceStyles } from "./shared";
import { actionMenuPanelStyle } from "./actionMenu.js";

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
  @property({ attribute: false }) machines: readonly Machine[] = [];
  @property({ attribute: false }) browseMachineId = "";
  @property({ attribute: false }) onSelectMachine?: (machineId: string) => void;
  @property({ attribute: false }) loadError?: string;
  @property({ type: Boolean }) browsingElsewhere = false;

  protected override willUpdate(changed: Map<string, unknown>): void {
    // A filter chosen on one machine's tab must not judge another machine's
    // rows: a leftover workspace path renders a false "No sessions yet."
    if (changed.has("browseMachineId") && changed.get("browseMachineId") !== undefined) this.filter = {};
  }
  /** Four-state session badge per session, computed upstream. */
  @property({ attribute: false }) sessionStates: ReadonlyMap<string, SessionStateBadgeKind> = new Map();
  @property({ type: Boolean }) canStartSession = false;
  @property({ attribute: false }) onCreateSession?: () => void;
  @property({ attribute: false }) onOpenSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onSelectWorkspace?: (workspace: Workspace) => void;
  @property({ attribute: false }) onBrowse?: () => void;
  /** Opens settings from the menu, so the phone's one menu key reaches it. */
  @property({ attribute: false }) onOpenSettings?: () => void;
  @property({ attribute: false }) onClose?: () => void;
  @property({ attribute: false }) onTogglePin?: (session: SessionInfo) => void;
  @property({ attribute: false }) onRenameSession?: (session: SessionInfo, name: string) => void | Promise<void>;

  @state() private query = "";
  @state() private filter: QuickSwitcherFilter = {};
  @state() private openMenuSessionId: string | undefined;
  @state() private menuStyle = "";
  /** Which breadcrumb level has its options open, if any. */
  @state() private openLevel: BreadcrumbLevel | undefined;
  @state() private renamingSessionId: string | undefined;
  private renameDraft = "";
  private heldSession: SessionInfo | undefined;
  private readonly longPress = new LongPressTracker({
    onLongPress: () => { this.openRowMenu(this.heldSession?.id, this.heldSessionButton()); },
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
        .initialFocus=${switcherInitialFocus({ touchPrimary: touchPrimaryPointer() })}
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
          <button class="close" title="Close" aria-label="Close" @click=${() => this.onClose?.()}>${renderCrossIcon()}</button>
        </header>
        ${this.renderBreadcrumb()}
        <div class="body">
          ${this.renderCreateRow()}
          ${model.groups.map((group) => this.renderGroup(group))}
          ${this.renderScopeNotice()}
          ${this.renderEmptyMeaning(model.matchCount)}
          ${otherWorkspaces.length === 0 ? null : html`
            <h3>Workspaces</h3>
            <div class="rows">
              ${otherWorkspaces.map((workspace) => html`
                <button class="row workspace-row" @click=${() => { this.selectWorkspace(workspace); }}>
                  <span class="row-title-line"><span class="row-title">${workspace.label}</span>${workspace.isMain ? html`<span class="row-tag" title="Main workspace" aria-label="Main workspace">main</span>` : nothing}</span>
                  <span class="row-subtitle">${workspace.path}</span>
                </button>
              `)}
            </div>
          `}
        </div>
        <footer>
          <button @click=${() => { this.browse(); }}>Browse machines and projects</button>
          ${this.onOpenSettings === undefined ? nothing : html`<button @click=${() => { this.openSettings(); }}>Settings</button>`}
        </footer>
      </modal-surface>
    `;
  }

  /**
   * One tab per machine, browsing that machine's sessions without leaving
   * the switcher. The tabs only exist when there is a choice to make.
   */
  /**
   * The context path: machine (only where there is a choice), project, folder.
   * Tapping a level opens its own options; the list below narrows to whatever
   * the path says, so the reader never has to guess which kind of thing a
   * chip was.
   */
  /**
   * Keyboard focus follows the level the reader opened, and comes back to the
   * level when it closes. Without this the options were reachable only by
   * walking the DOM, and choosing one dropped focus to the sheet.
   */
  protected override updated(changed: Map<string, unknown>): void {
    if (!changed.has("openLevel")) return;
    const root = this.shadowRoot;
    if (root === null) return;
    if (this.openLevel !== undefined) {
      root.querySelector<HTMLButtonElement>(".crumb-option")?.focus();
      return;
    }
    if (changed.get("openLevel") === undefined) return;
    root.querySelector<HTMLButtonElement>(".crumb")?.focus();
  }

  private renderBreadcrumb() {
    const input = {
      machines: this.machines,
      machineId: this.browseMachineId,
      projects: quickSwitcherFilterProjects(this.projects),
      projectId: this.filter.projectId,
      folders: this.workspaces.map((workspace) => ({ id: workspace.id, label: workspace.label, path: workspace.path, projectId: workspace.projectId })),
      folderPath: this.filter.workspacePath,
    };
    const reconciled = reconcileBreadcrumbFilter(input);
    const segments = switcherBreadcrumb({ ...input, ...reconciled });
    if (segments.length === 0) return nothing;
    const open = segments.find((segment) => segment.level === this.openLevel);
    return html`
      <nav class="crumb-nav" aria-label="Context">
        <div class="crumbs">
        ${segments.map((segment, index) => html`
          ${index === 0 ? nothing : html`<span class="crumb-sep">${renderChevronRightIcon()}</span>`}
          <button
            type="button"
            class=${segment.chosen ? "crumb chosen" : "crumb"}
            aria-expanded=${this.openLevel === segment.level ? "true" : "false"}
            aria-haspopup="true"
            aria-controls="crumb-options"
            @click=${() => { this.openLevel = this.openLevel === segment.level ? undefined : segment.level; }}
          >${segment.label}</button>
        `)}
        </div>
      ${open === undefined ? nothing : html`
        <div class="crumb-options" id="crumb-options" role="group" aria-label=${open.level === "machine" ? "Choose a machine" : open.level === "project" ? "Choose a project" : "Choose a folder"}>
          ${open.level === "machine" ? nothing : html`
            <button type="button" aria-pressed=${open.chosen ? "false" : "true"} class="crumb-option" @click=${() => { this.clearLevel(open.level); }}>
              ${open.level === "project" ? "All projects" : "All folders"}
            </button>
          `}
          ${open.options.map((option) => html`
            <button
              type="button"
              aria-pressed=${option.current ? "true" : "false"}
              class=${option.current ? "crumb-option current" : "crumb-option"}
              @click=${() => { this.chooseLevel(open.level, option.id); }}
            >
              <span class="crumb-option-label">${option.label}</span>
              ${option.detail === undefined ? nothing : html`<span class="crumb-option-detail">${option.detail}</span>`}
            </button>
          `)}
        </div>
      `}
      </nav>
    `;
  }

  /** Says when the list is wider than the path; see `switcherScopeNotice`. */
  private renderScopeNotice() {
    const notice = switcherScopeNotice({
      projectId: this.filter.projectId,
      knownFolderCount: this.workspaces.filter((workspace) => workspace.projectId === this.filter.projectId).length,
    });
    return notice === undefined ? nothing : html`<p class="scope-notice" role="status">${notice}</p>`;
  }

  /** The empty state, named rather than asserted; see `switcherEmptyMeaning`. */
  private renderEmptyMeaning(matchCount: number) {
    const meaning = switcherEmptyMeaning({
      loadError: this.loadError,
      loading: this.loading,
      matchCount,
      query: this.query,
      scoped: this.filter.projectId !== undefined || this.filter.workspacePath !== undefined,
    });
    if (meaning.kind === "none") return nothing;
    return html`<p class="empty" role=${meaning.kind === "failed" ? "alert" : "status"}>
      <span>${meaning.message}</span>
      ${meaning.kind === "scope" ? html`<button type="button" class="empty-widen" @click=${() => { this.filter = {}; this.openLevel = undefined; }}>Show every project</button>` : nothing}
    </p>`;
  }

  private clearLevel(level: BreadcrumbLevel): void {
    this.filter = level === "project" ? {} : withoutFolder(this.filter);
    this.openLevel = undefined;
  }

  private chooseLevel(level: BreadcrumbLevel, id: string): void {
    if (level === "machine") this.onSelectMachine?.(id);
    else if (level === "project") this.filter = { projectId: id };
    else this.filter = { ...this.filter, workspacePath: id };
    this.openLevel = undefined;
  }

  private renderCreateRow() {
    const workspaceLabel = this.selectedWorkspace?.label;
    const subtitle = this.browsingElsewhere
      ? "Open a session on this machine first"
      : workspaceLabel === undefined
        ? "Select a workspace first"
        : `In ${workspaceLabel}`;
    return html`
      <button
        class="row create-row"
        ?disabled=${!this.canStartSession}
        title=${this.canStartSession ? "Start a new session" : "Select a workspace to start a session"}
        @click=${() => { this.createSession(); }}
      >
        <span class="row-title">+ New session</span>
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
          @contextmenu=${(event: MouseEvent) => { event.preventDefault(); this.openRowMenu(session.id, event.currentTarget); }}
          @pointerdown=${(event: PointerEvent) => { this.heldSession = session; this.longPress.start(event); }}
          @pointermove=${(event: PointerEvent) => { this.longPress.move(event); }}
          @pointerup=${() => { this.longPress.cancel(); }}
          @pointercancel=${() => { this.longPress.cancel(); }}
        >
          <span class="row-title" dir="auto">${pinned ? html`<span class="pin-mark" title="Pinned" aria-label="Pinned">${renderPinIcon()}</span> ` : nothing}${sessionLabel(session)}</span>
          <span class="row-subtitle">${quickSwitcherSessionSubtitle(session, this.workspaces)}</span>
          ${interrupted ? html`<span class="row-flag interrupted" title="A restart interrupted this run" aria-label="A restart interrupted this run"></span>` : html`<span class="row-state">${renderSessionRowIndicator(sessionRowIndicator(stateKind, unread))}</span>`}
        </button>
        <button
          class="row-menu-toggle"
          title="Session actions"
          aria-label=${`Actions for ${sessionLabel(session)}`}
          aria-haspopup="menu"
          aria-expanded=${this.openMenuSessionId === session.id ? "true" : "false"}
          @click=${(event: MouseEvent) => { this.openRowMenu(session.id, event.target); }}
        >⋯</button>
        ${this.openMenuSessionId === session.id ? this.renderRowMenu(session) : nothing}
      </div>
    `;
  }

  /**
   * The row menu is fixed and viewport-constrained like every other row menu:
   * absolutely positioned under the row, the last row's menu was clipped by
   * the scrolling body, and scrolling to reach it moved the row away.
   */
  private heldSessionButton(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(".row-menu-toggle");
  }

  private openRowMenu(sessionId: string | undefined, target: EventTarget | null): void {
    this.openMenuSessionId = this.openMenuSessionId === sessionId ? undefined : sessionId;
    this.menuStyle = this.openMenuSessionId === undefined ? "" : actionMenuPanelStyle(target, { constrainTo: "viewport" });
  }

  private renderRowMenu(session: SessionInfo) {
    const pinned = this.pinnedSessionIds.has(session.id);
    return html`
      <div class="action-menu-panel row-menu" role="menu" style=${this.menuStyle}>
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
          <button type="submit" title="Save name" aria-label="Save name">${renderCheckIcon()}</button>
          <button type="button" title="Cancel rename" aria-label="Cancel rename" @click=${() => { this.renamingSessionId = undefined; }}>${renderCrossIcon()}</button>
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

  private openSettings(): void {
    this.onClose?.();
    this.onOpenSettings?.();
  }

  private browse(): void {
    this.onBrowse?.();
    this.onClose?.();
  }

  static override styles = [interactiveSurfaceStyles, sessionStateBadgeStyles, css`${unsafeCSS(uiIconStyle)}
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-overlay); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; --qs-menu-size: var(--pi-control-height); }
    @media (pointer: coarse) { :host { --qs-menu-size: var(--pi-control-height-touch, 44px); } }
    modal-surface {
      --modal-surface-place-items: end center;
      --modal-surface-backdrop-padding: 0;
      --modal-surface-width: min(560px, 100vw);
      --modal-surface-max-height: min(88dvh, 760px);
    }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-4); align-items: center; box-sizing: border-box; min-height: var(--pi-panel-header-height); padding: var(--pi-space-2) var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); }
    input { box-sizing: border-box; min-width: 0; height: var(--pi-control-height-comfort); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-bg); color: var(--pi-text); padding: 0 var(--pi-space-5); font: var(--pi-control-font-size, var(--pi-text-base)) var(--pi-font-ui); line-height: inherit; }
    input::-webkit-search-cancel-button { display: none; }
    input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .close { font: inherit; box-sizing: border-box; display: grid; place-items: center; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); padding: 0; line-height: 1; border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-muted); font-size: var(--pi-text-xl); cursor: pointer; }
    @media (pointer: coarse) { .close:active { background: var(--pi-surface-hover); } }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: var(--pi-space-5); overscroll-behavior: contain; }
    h3 { margin: var(--pi-space-7) 0 var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: var(--pi-weight-semibold); text-transform: uppercase; }
    /* Tiles rather than one session per row. A phone showed four wide,
       mostly empty cards at a time, so choosing between a dozen sessions meant
       scrolling a list that wasted half its width on every row. auto-fit keeps
       a single column when there is only room for one. */
    .rows { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--pi-space-3); align-content: start; }
    .row { box-sizing: border-box; font: inherit; position: relative; display: grid; gap: var(--pi-space-1); width: 100%; min-height: var(--pi-row-min-height); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-5) var(--pi-space-6); text-align: left; cursor: pointer; }
    @media (hover: hover) { .row:hover:not(:disabled) { background: var(--pi-surface-hover); } }
    /* The row dims, but the line that says what to do first must stay readable:
       dimming the remedy with the control took it to 2.14:1. */
    .row:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    .row:disabled .row-subtitle { opacity: calc(1 / var(--pi-disabled-opacity)); color: var(--pi-text); }
    /* One clamp at every width: a title that wraps to two lines on a phone and
       one on a desktop makes the same list two different shapes. Two lines are
       always reserved, so a short name and a long one occupy the same box. */
    .row-title-line { display: flex; align-items: center; gap: var(--pi-space-3); min-width: 0; }
    .row-title-line .row-title { min-width: 0; }
    .row-title { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; min-height: calc(2 * 1.3em); font-size: var(--pi-text-md); line-height: 1.3; overflow-wrap: anywhere; }
    .row-subtitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    /* The create tile is a CTA, not a data row: its title and subtitle center
       like the app's empty states instead of leaving a tall left-titled box
       with a 44px void between the two lines. */
    .create-row { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); place-items: center; text-align: center; }
    .create-row .row-title { font-weight: var(--pi-weight-strong); }
    .session-row.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .session-row.unread .row-title { color: var(--pi-text-bright); font-weight: var(--pi-weight-strong); }
    /* The state mark sits under the corner menu button rather than beside it:
       the toggle spans the tile's top-right corner down to 44px on touch, and
       a badge centred on the tile's midline landed inside that box - tapping
       the state opened the menu. */
    .row-flag, .row-state { position: absolute; bottom: var(--pi-space-5); right: calc((var(--qs-menu-size) - var(--pi-dot-md)) / 2 - 1px); }
    .row-state { display: inline-flex; align-items: center; }
    .row-flag { box-sizing: border-box; width: var(--pi-dot-md); height: var(--pi-dot-md); border-radius: 50%; }
    /* Hollow rather than filled: this one marks work that stopped, so it should
       not read as another kind of activity at a glance. */
    .row-flag.interrupted { background: transparent; border: 2px solid var(--pi-warning, var(--pi-accent)); }
    /* The path scrolls sideways rather than wrapping: it keeps one line so it
       never competes with the session list for height. */
    /* The path row and the open level stack; the nav is their column, not a
       row that would set the option list beside the crumbs. */
    .crumb-nav { flex: 0 0 auto; display: flex; flex-direction: column; min-width: 0; }
    .crumbs { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-2); padding: var(--pi-space-3) var(--pi-space-5); border-bottom: 1px solid var(--pi-border-muted); overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
    .crumbs::-webkit-scrollbar { display: none; }
    .crumb { box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text-secondary); cursor: pointer; }
    .crumb.chosen { background: var(--pi-selection-bg); color: var(--pi-text-bright); border-color: var(--pi-accent-border); }
    .crumb:focus-visible, .crumb-option:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    /* The drawn box stays on the bar template; a thumb gets the 44px floor
       through reach, as the message actions do. */
    @media (pointer: coarse) { .crumb { position: relative; } .crumb::after { content: ""; position: absolute; inset: calc((var(--pi-control-height) - var(--pi-control-height-touch, 44px)) / 2) 0; } }
    .scope-notice { margin: 0 var(--pi-space-5) var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .empty-widen { box-sizing: border-box; min-height: var(--pi-control-height-comfort); margin-top: var(--pi-space-3); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; cursor: pointer; }
    .crumb-sep { flex: 0 0 auto; display: inline-grid; place-items: center; color: var(--pi-muted); }
    .crumb-sep .ui-icon { width: 14px; height: 14px; }
    .crumb-options { flex: 0 0 auto; display: flex; flex-direction: column; gap: var(--pi-space-2); padding: var(--pi-space-3) var(--pi-space-5); border-bottom: 1px solid var(--pi-border-muted); max-height: 40vh; overflow-y: auto; }
    .crumb-option { box-sizing: border-box; display: grid; gap: 2px; width: 100%; min-height: var(--pi-control-height-comfort); padding: var(--pi-space-2) var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); text-align: start; cursor: pointer; }
    .crumb-option.current { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .crumb-option-detail { color: var(--pi-muted); font-size: var(--pi-text-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Chips ghost by default and carry their selected state in the tint, not
       in an outline: a row of outlined pills read as a wall of boxes (C4). */
    /* Nested chips read as a second level, not as peers of the projects. */
    /* One box per session. The menu button used to have a column of its own
       beside the tile, so a row of three sessions read as six boxes; it is
       used occasionally, while the name is read every time. */
    /* The grid stretches this wrapper, so the tile inside must fill it or the
       tiles in one row end up different heights - which is exactly what the
       owner kept reporting. */
    .row-wrap { position: relative; display: block; height: 100%; }
    .row-wrap > .row { height: 100%; }
    /* A long press must not race the platform's own text callout. */
    .row-wrap .session-row { padding-right: calc(var(--qs-menu-size) + var(--pi-space-2)); -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
    /* On a narrow phone the menu button's own column left the name about a
       hundred pixels, so two tiles read worse than one. The button moves into
       the tile's corner instead: it is used occasionally, the name is read
       every time. The tile reserves the button's width once, on the row, so
       the title and the subtitle end at the same right edge. */
    .row-menu-toggle { box-sizing: border-box; padding: 0; font: var(--pi-text-xs) var(--pi-font-ui); line-height: inherit; position: absolute; top: 0; right: 0; width: var(--qs-menu-size); min-height: var(--qs-menu-size); border: 1px solid transparent; border-radius: var(--pi-radius-lg); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1; cursor: pointer; }
    .row-menu-toggle:focus-visible { color: var(--pi-text); border-color: var(--pi-accent); }
    @media (hover: hover) { .row-menu-toggle:hover { color: var(--pi-text); border-color: var(--pi-accent); } }
    /* A half-width tile on a small phone shows about nine characters per line,
       fewer than the single-column row it replaced, so phones get narrower
       columns. The title clamp is not part of this breakpoint: it is the same
       two lines everywhere. */
    @media (max-width: 430px) {
      .rows { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
    }
    /* This component does not adopt the shared listStyles, so the shared
       .action-menu-panel positioning does not exist here: the fixed placement
       is declared locally. */
    .row-menu { position: fixed; z-index: var(--pi-layer-popover); box-sizing: border-box; overflow: auto; display: grid; gap: var(--pi-space-1); min-width: 160px; padding: var(--pi-space-2); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); box-shadow: var(--pi-elevation-2); }
    .row-menu button { box-sizing: border-box; min-height: var(--pi-control-height-comfort); border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text); padding: 0 var(--pi-space-5); font: inherit; text-align: left; cursor: pointer; }
    /* Coarse pointers get the comfort floor: every target the quick switcher
       ships measures 44px on touch. Placed after every base declaration it
       raises - a media query carries no extra specificity, so an earlier
       coarse rule loses to a later base rule (the drawer collapse shipped
       exactly that bug once). */
    @media (pointer: coarse) {
      .close { width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); }
      .row-menu-toggle { width: var(--qs-menu-size); min-height: var(--qs-menu-size); }
      .row-menu button { min-height: var(--pi-control-height-touch); }
      input { height: var(--pi-panel-header-control-height); }
    }
    .row-menu button:focus-visible:not(:disabled) { background: var(--pi-selection-bg); }
    @media (hover: hover) { .row-menu button:hover:not(:disabled) { background: var(--pi-selection-bg); } }
    .row-menu button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    .pin-mark { display: inline-flex; align-items: center; }
    .pin-mark svg, .pin-mark .ui-icon { width: 14px; height: 14px; }
    .pin-mark { color: var(--pi-accent); }
    /* "· main" was prose inside a two-line clamp, so the state it carried was
       the first thing a long workspace name cut off. */
    .row-tag { display: inline-block; margin-left: var(--pi-space-2); border-radius: var(--pi-radius-pill); background: var(--pi-selection-bg); color: var(--pi-text-bright); padding: 0 var(--pi-space-2); font-size: var(--pi-text-2xs); line-height: 16px; vertical-align: middle; }
    /* The row keeps its own inset when it enters edit mode: content that shifts
       under the caret is the one thing a rename must not do. */
    .rename-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-5) var(--pi-space-6); }
    .rename-input { box-sizing: border-box; width: 100%; min-height: var(--pi-control-height-comfort); border: 1px solid var(--pi-accent); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding: 0 var(--pi-space-5); font: var(--pi-control-font-size, var(--pi-text-base)) var(--pi-font-ui); line-height: inherit; }
    @media (pointer: coarse) { .rename-input { min-height: var(--pi-control-height-touch); } }
    .rename-actions { display: flex; gap: var(--pi-space-3); }
    .rename-actions button { box-sizing: border-box; font: inherit; width: var(--pi-control-height-comfort); min-height: var(--pi-control-height-comfort); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    @media (pointer: coarse) { .rename-actions button { width: var(--pi-control-height-touch); min-height: var(--pi-control-height-touch); } }
    .empty { margin: var(--pi-space-7) var(--pi-space-2); color: var(--pi-muted); }
    footer { flex: 0 0 auto; box-sizing: border-box; min-height: var(--pi-panel-header-height); padding: var(--pi-space-2) var(--pi-bar-inset) max(var(--pi-space-2), env(safe-area-inset-bottom)); border-top: 1px solid var(--pi-border); display: flex; flex-direction: column; gap: var(--pi-space-2); }
    footer button { box-sizing: border-box; font: inherit; width: 100%; min-height: var(--pi-control-height-touch); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "quick-switcher": QuickSwitcher;
  }
}

/** The same filter with its folder level cleared, kept out of the component so
 *  the exact-optional shape is expressed once. */
function withoutFolder(filter: QuickSwitcherFilter): QuickSwitcherFilter {
  const next: QuickSwitcherFilter = {};
  if (filter.machineId !== undefined) next.machineId = filter.machineId;
  if (filter.projectId !== undefined) next.projectId = filter.projectId;
  return next;
}

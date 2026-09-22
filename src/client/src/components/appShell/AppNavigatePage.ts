import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionInfo } from "../../api";
import { navigateModel, type NavigateChoice, type NavigateInput, type NavigateLevel, type NavigateSection, type NavigateSessionRow, type NavigateSessionState } from "../../navigateModel";
import { switcherBreadcrumb } from "../../switcherBreadcrumb";
import { createStableRowOrder } from "../../stableRowOrder";
import { renderChatIcon, renderChevronRightIcon, renderGearIcon, renderGridIcon, renderMachineIcon, renderPinIcon, renderProjectIcon, uiIconStyle } from "../uiIcons.js";
import { actionMenuStyles, interactiveSurfaceStyles } from "../shared";
import { switcherEmptyMeaning } from "../../switcherEmptyMeaning";
import { sessionStateBadgeStyles } from "../sessionStateBadgeStyles.js";
import { actionMenuPanelStyle } from "../actionMenu";
import { navigateRowActions, type NavigateRowActionId, type NavigateRowKind } from "../../navigateRowActions";
import { sessionLabel } from "../../sessionLabels";

/**
 * The one navigation surface: where you are, what is under it, and what you
 * can open.
 *
 * It replaces four surfaces that each navigated away from the others - the
 * projects sheet, the quick-access menu, the panel accordion - so a reader
 * could arrive somewhere with no way back. Here the path is the only
 * navigation: tapping a higher level widens, tapping a choice narrows, and
 * neither leaves the page. Only opening a session leaves, because that is the
 * thing the page exists to reach.
 */
export type NavigateKind = "sessions" | "machine" | "project";

const STATE_LABEL: Record<NavigateSessionState, string> = {
  waiting: "Waiting for you",
  working: "Working",
  idle: "Idle",
};

/**
 * Work in progress is the shared bouncing dots, not a static green pip: a
 * still dot the owner had to squint at could not be told from the idle one,
 * and the transcript already animates work this way.
 */
function renderNavigateStateMark(state: NavigateSessionState) {
  const label = STATE_LABEL[state];
  if (state === "working") {
    const dots = [0, 1, 2].map((index) => html`<span class="state-dot" style=${`animation-delay:${(index * 0.14).toFixed(2)}s`}></span>`);
    return html`<span class="session-state running" role="img" title=${label} aria-label=${label}><span class="state-dots">${dots}</span></span>`;
  }
  return html`<span class=${`state ${state}`} role="img" title=${label} aria-label=${label}></span>`;
}

@customElement("app-navigate-page")
export class AppNavigatePage extends LitElement {
  @property({ attribute: false }) input?: Omit<NavigateInput, "query">;
  @property({ attribute: false }) onChoose?: (level: NavigateLevel, id: string) => void;
  @property({ attribute: false }) onWiden?: (level: NavigateLevel) => void;
  @property({ attribute: false }) onOpenSession?: (session: SessionInfo, machineId: string) => void;
  @property({ attribute: false }) onCreateSession?: () => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onClose?: () => void;
  /**
   * Settings used to hang off the navigation panel; when that panel was
   * deleted the only way in was a page a phone could not open. Navigation is
   * where you go to reach a place, and settings is a place.
   */
  @property({ attribute: false }) onOpenSettings?: () => void;
  /** What the row menu does; the page names the action, the host performs it. */
  @property({ attribute: false }) onRowAction?: (kind: NavigateRowKind, id: string, action: NavigateRowActionId) => void;
  @property({ attribute: false }) canRenameSession = false;
  @property({ attribute: false }) canCloseProject = false;
  /** Project ids the reader pinned; the host owns the store. */
  @property({ attribute: false }) pinnedProjectIds: ReadonlySet<string> = new Set();
  /** What the host is still reading, so the page says "loading" instead of "none". */
  @property({ attribute: false }) loadingSessions = false;
  @property({ attribute: false }) loadingChoices = false;
  @property({ attribute: false }) loadError: string | undefined = undefined;
  /** Whether a session is open behind this page, which is what a close returns to. */
  @property({ type: Boolean }) closable = false;
  /**
   * Whether there is somewhere to go back to. The desktop rail is the page's
   * permanent home, so its leading key only widens; an overlay and the phone's
   * navigation view both have a session behind them to return to.
   */
  @property({ type: Boolean }) returnable = false;
  @state() private query = "";
  /** Live refreshes may not move a row under a thumb; see `stableRowOrder`. */
  private readonly rowOrder = createStableRowOrder<NavigateSessionRow>((row) => `${row.machineId}:${row.session.id}`);

  override disconnectedCallback(): void {
    this.rowOrder.release();
    super.disconnectedCallback();
  }

  /**
   * Every session on the machine, for the default view. Narrowing to a
   * project is a deliberate step down the path, not the starting point: the
   * list people want on opening is "what am I running", not "what is in the
   * folder I happen to be standing in".
   */
  @property({ attribute: false }) machineSessions: readonly SessionInfo[] = [];

  /** Which kind of thing the page is listing; one page shows one kind. */
  @state() private kind: NavigateKind = "sessions";
  /** The project the reader stepped into on this page, if any. */
  @state() private pathProjectId: string | undefined = undefined;
  @state() private openMenuRowId: string | undefined = undefined;
  @state() private menuStyle = "";

  /** Open the page on one kind; the keyboard shortcuts name a kind, not a panel. */
  showKind(kind: NavigateKind): void {
    this.kind = kind;
  }

  /** Opening lands on the machine's whole list; see `listedInput`. */
  /**
   * The key that opened the page closes it: pressed once it widens to every
   * session on the machine, pressed again - already showing everything -
   * there is nothing left to widen to, so it goes back where it came from.
   */
  private quickAccessPressed(): void {
    if (this.returnable && this.showsEverything()) { this.onClose?.(); return; }
    this.showEverything();
    this.onWiden?.("project");
  }

  private showsEverything(): boolean {
    return this.pathProjectId === undefined && this.kind === "sessions";
  }

  showEverything(): void {
    this.pathProjectId = undefined;
    this.kind = "sessions";
    this.query = "";
  }

  override render() {
    const input = this.input;
    if (input === undefined) return html`<p class="empty" role="status">Reading this machine…</p>`;
    const listed = this.listedInput(input);
    const model = navigateModel({ ...listed, query: this.query });
    const segments = switcherBreadcrumb({
      machines: listed.machines,
      machineId: listed.scope.machineId,
      projects: listed.projects,
      projectId: listed.scope.projectId,
      folders: input.folders,
      folderPath: undefined,
    }).filter((segment) => segment.level !== "folder");
    const showsSessions = this.kind === "sessions";
    const levelChoices = model.sections.flatMap((section) => section.choices).filter((choice) => choice.level === this.kind);
    const choices = this.kind === "project" ? pinnedFirst(levelChoices, this.pinnedProjectIds) : levelChoices;
    return html`
      <section class="navigate">
        <header class="path-bar">
          <button
            type="button"
            class=${this.pathProjectId === undefined && this.kind === "sessions" ? "quick-access current" : "quick-access"}
            aria-pressed=${this.pathProjectId === undefined && this.kind === "sessions" ? "true" : "false"}
            title=${this.returnable && this.showsEverything() ? "Close navigation" : "All sessions on this machine"}
            aria-label=${this.returnable && this.showsEverything() ? "Close navigation" : "All sessions on this machine"}
            @click=${() => { this.quickAccessPressed(); }}
          >${renderGridIcon()}</button>
          <div class="path-row">
            ${segments.map((segment, index) => html`
              ${index === 0 ? nothing : html`<span class="path-sep">${renderChevronRightIcon()}</span>`}
              <button
                type="button"
                class=${segment.chosen ? "path-step chosen" : "path-step"}
                title=${segment.label}
                @click=${() => {
                  if (segment.level === "folder") return;
                  // Tapping any level of the path steps up to it, and every
                  // level above a project lists the machine again.
                  this.pathProjectId = undefined;
                  // The path says where; the list under it is always the
                  // sessions there. Stepping up used to switch the page to
                  // listing projects, which is a different question.
                  this.kind = "sessions";
                  this.onWiden?.(segment.level);
                }}
              >${segment.label}</button>
            `)}
          </div>
          <div class="path-bar-actions">
            ${this.onOpenSettings === undefined ? nothing : html`<button type="button" class="settings" aria-label="Settings" title="Settings" @click=${() => { this.onOpenSettings?.(); }}>${renderGearIcon()}</button>`}
            ${this.closable ? html`<button type="button" class="close" aria-label="Close navigation" @click=${() => { this.onClose?.(); }}>${renderChevronRightIcon()}</button>` : nothing}
          </div>
        </header>
        <nav class="kinds" aria-label="What to list">
          ${this.renderKindTab("sessions", "Sessions", renderChatIcon())}
          ${segments.some((segment) => segment.level === "machine") ? this.renderKindTab("machine", "Machines", renderMachineIcon()) : nothing}
          ${this.renderKindTab("project", "Projects", renderProjectIcon())}
        </nav>
        ${showsSessions ? html`
          <div class="search-row">
            <input
              class="search"
              type="search"
              inputmode="search"
              autocomplete="off"
              spellcheck="false"
              enterkeyhint="search"
              aria-label="Search sessions and tags"
              placeholder="Search sessions, #tags"
              .value=${this.query}
              @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.query = event.target.value; }}
            />
          </div>
        ` : nothing}
        <div class="actions">
          ${showsSessions
            ? html`<button type="button" class="create" @click=${() => { this.onCreateSession?.(); }}>+ New session</button>`
            : this.kind === "project" && this.onAddProject !== undefined
              ? html`<button type="button" class="create" @click=${() => { this.onAddProject?.(); }}>+ Add project</button>`
              : nothing}
        </div>
        <div class="body">
          ${showsSessions
            ? html`
                ${this.orderedSections(model.sections).map((section) => html`
                  <h3 class="section-title">${section.title}</h3>
                  ${section.rows.map((row) => this.renderSession(row))}
                `)}
                ${this.renderSessionsEmptyState(model.matchCount)}
              `
            : html`
                ${choices.map((choice) => this.renderChoice(choice))}
                ${choices.length > 0
                  ? nothing
                  : html`<p class="empty" role="status">${this.loadingChoices ? "Loading…" : this.loadError ?? "Nothing to choose at this level."}</p>`}
              `}
        </div>
      </section>
    `;
  }

  /**
   * The sections with their rows in the sequence this page opened with: a
   * refresh changes what a row says, never where it sits.
   */
  private orderedSections(sections: readonly NavigateSection[]): NavigateSection[] {
    const ordered = this.rowOrder.order(sections.flatMap((section) => section.rows));
    const placeOf = new Map(ordered.map((row, index) => [`${row.machineId}:${row.session.id}`, index]));
    return sections
      .filter((section) => section.rows.length > 0)
      .map((section) => ({ ...section, rows: [...section.rows].sort((left, right) => (placeOf.get(`${left.machineId}:${left.session.id}`) ?? 0) - (placeOf.get(`${right.machineId}:${right.session.id}`) ?? 0)) }));
  }

  /**
   * Absence is not negation: while the host is still reading, an empty list
   * means "not known yet". Saying "No sessions here yet." at that moment is
   * how a tap that did work read as a tap that did nothing.
   */
  private renderSessionsEmptyState(matchCount: number) {
    const meaning = switcherEmptyMeaning({
      loadError: this.loadError,
      loading: this.loadingSessions,
      matchCount,
      query: this.query,
      scoped: this.input?.scope.projectId !== undefined,
    });
    if (meaning.kind === "none") return nothing;
    return html`<p class="empty" role="status">${meaning.message}</p>`;
  }

  /**
   * The path is the only scope control: standing on the machine lists every
   * session it runs, and stepping into a project narrows to that project.
   * There is no separate widen button - the path level above you is it.
   */
  private listedInput(input: Omit<NavigateInput, "query">): Omit<NavigateInput, "query"> {
    if (this.pathProjectId !== undefined) return input;
    return {
      ...input,
      scope: { ...input.scope, projectId: undefined, folderPath: undefined },
      // Pins are cross-machine and arrive already carrying their machine;
      // rebuilding them from this machine's list dropped the ones pinned
      // elsewhere.
      sessions: this.machineSessions,
    };
  }

  private renderKindTab(kind: NavigateKind, label: string, icon: unknown) {
    return html`<button
      type="button"
      class=${this.kind === kind ? "kind current" : "kind"}
      aria-pressed=${this.kind === kind ? "true" : "false"}
      @click=${() => { this.kind = kind; }}
    ><span class="kind-icon" data-kind=${kind}>${icon}</span><span class="kind-label">${label}</span></button>`;
  }

  private renderChoice(choice: NavigateChoice) {
    const icon = choice.level === "machine" ? renderMachineIcon() : renderProjectIcon();
    const kind: NavigateRowKind = choice.level === "machine" ? "machine" : "project";
    const rowId = `${kind}:${choice.id}`;
    return this.renderRowShell(rowId, kind, choice.id, choice.label, html`
      <button
        type="button"
        class=${choice.current ? "row current" : "row"}
        title=${choice.detail ?? choice.label}
        @click=${() => {
          if (choice.level === "project") this.pathProjectId = choice.id;
          this.onChoose?.(choice.level, choice.id);
          this.kind = "sessions";
        }}
      >
        <span class="row-title"><span class="row-icon" data-kind=${choice.level}>${icon}</span>${kind === "project" && this.pinnedProjectIds.has(choice.id) ? html`<span class="pin" title="Pinned" aria-label="Pinned">${renderPinIcon()}</span>` : nothing}<span class="row-name">${choice.label}</span></span>
        ${choice.detail === undefined ? nothing : html`<span class="row-path">${choice.detail}</span>`}
      </button>
    `, {
      hasPath: choice.detail !== undefined,
      closable: kind === "project" && this.canCloseProject,
      pinned: kind === "project" && this.pinnedProjectIds.has(choice.id),
    });
  }

  /**
   * One thing on the left, one control on the right. The row used to carry a
   * second line of path under the name and no way to act on it; the name is
   * what a list is scanned by, and everything you can do to the row lives
   * behind the menu beside it.
   */
  private renderRowShell(
    rowId: string,
    kind: NavigateRowKind,
    id: string,
    label: string,
    row: unknown,
    facts: { pinned?: boolean; hasPath?: boolean; closable?: boolean },
  ) {
    const actions = navigateRowActions(kind, {
      ...facts,
      renamable: kind === "session" && this.canRenameSession,
    });
    const open = this.openMenuRowId === rowId;
    return html`
      <div class=${open ? "row-wrap menu-open" : "row-wrap"}>
        ${row}
        ${actions.length <= 1 ? nothing : html`
          <button
            type="button"
            class="action-menu-toggle"
            title="Actions"
            aria-label=${`Actions for ${label}`}
            aria-haspopup="menu"
            aria-expanded=${open ? "true" : "false"}
            @click=${(event: MouseEvent) => { this.toggleRowMenu(rowId, event.currentTarget); }}
          >⋯</button>
        `}
        ${open ? html`
          <div
            class="menu-scrim"
            @pointerdown=${(event: PointerEvent) => { event.preventDefault(); this.openMenuRowId = undefined; }}
          ></div>
          <div class="action-menu-panel" role="menu" aria-label=${`Actions for ${label}`} style=${this.menuStyle}>
            <p class="action-menu-subject">${label}</p>
            ${actions.map((action) => html`
              <button type="button" role="menuitem" @click=${() => { this.openMenuRowId = undefined; this.onRowAction?.(kind, id, action.id); }}>${action.label}</button>
            `)}
          </div>
        ` : nothing}
      </div>
    `;
  }

  private toggleRowMenu(rowId: string, target: EventTarget | null): void {
    this.openMenuRowId = this.openMenuRowId === rowId ? undefined : rowId;
    this.menuStyle = this.openMenuRowId === undefined ? "" : actionMenuPanelStyle(target, { constrainTo: "viewport" });
  }

  /** The name alone: the owner's call, after a row of hashes and then a line of
   *  state proved to be noise on a list whose job is to be scanned. */
  private renderSession(row: NavigateSessionRow) {
    const label = sessionLabel(row.session);
    return this.renderRowShell(`session:${row.machineId}:${row.session.id}`, "session", row.session.id, label, html`
      <button type="button" class=${row.current ? "row session current" : "row session"} aria-current=${row.current ? "true" : "false"} title=${label} @click=${() => { this.onOpenSession?.(row.session, row.machineId); }}>
        <span class="row-title"><span class="row-icon" data-kind="session">${renderChatIcon()}</span>${row.pinned ? html`<span class="pin" title="Pinned" aria-label="Pinned">${renderPinIcon()}</span>` : nothing}<span class="row-name">${label}</span>${renderNavigateStateMark(row.state)}</span>
        ${row.path === "" ? nothing : html`<span class="row-path">${row.path}</span>`}
      </button>
    `, { pinned: row.pinned });
  }


  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, actionMenuStyles, sessionStateBadgeStyles, css`
    .row .row-title { flex: 1 1 auto; min-width: 0; }
    .row-name { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; min-height: calc(2 * 1.3em); line-height: 1.3; overflow-wrap: anywhere; }
    .row.session { display: grid; align-content: center; gap: var(--pi-space-2); }
    /* Two lines of name, like the quick-access card: a one-line clamp turned
       every session into the same truncated prefix. */
    .row .row-title { display: flex; align-items: flex-start; gap: var(--pi-space-2); white-space: normal; }
    .state { flex: 0 0 auto; margin-left: auto; margin-top: calc(0.65em - var(--pi-dot-sm) / 2); }
    .state { flex: 0 0 auto; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; }
    .state.waiting { background: var(--pi-accent); }
    /* The working mark is the shared badge's three dots; this block keeps
       only the still states. */
    .session-state { flex: 0 0 auto; margin-left: auto; margin-top: calc(0.65em - var(--pi-dot-md) / 2); }
    /* The working mark is three dots in a row, not one dot: the shared badge
       box is a circle the width of a single dot, which cut the third one in
       half on the board. Only the animated mark widens; the still states keep
       the circle. */
    .session-state.running { width: auto; min-width: var(--pi-dot-md); overflow: visible; }
    .state.idle { background: var(--pi-border); }
    /* One box, two things: the name on the left and the menu on the right
       live inside the same bordered row. The menu used to float outside the
       box, which read as a stray glyph beside the list. */
    /* A board of places, not a dense list: the tile is tall enough to read
       two lines without crowding and to be hit with a thumb anywhere on it. */
    .row-wrap { position: relative; display: block; height: 100%; --tile-menu-size: var(--pi-control-height-comfort); }
    @media (pointer: coarse) { .row-wrap { --tile-menu-size: var(--pi-control-height-touch, 44px); } }

    /* The open menu names its subject and the tile it belongs to lights up:
       a floating panel over a two-column board said nothing about which tile
       it was acting on. */
    .row-wrap.menu-open > .row { border-color: var(--pi-accent); }
    /* A menu stays until it is answered or dismissed: a tap anywhere else
       takes it back, which is what a reader expects of a popup. */
    .menu-scrim { position: fixed; inset: 0; z-index: calc(var(--pi-layer-popover) - 1); background: transparent; }
    .action-menu-panel { min-width: 160px; }
    .action-menu-subject { margin: 0; padding: var(--pi-space-3) var(--pi-space-4); border-bottom: 1px solid var(--pi-border); color: var(--pi-muted); font-size: var(--pi-text-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-wrap > .row { height: 100%; }
    .row-wrap .action-menu-toggle { position: absolute; top: 0; right: 0; box-sizing: border-box; display: grid; place-items: center; width: var(--tile-menu-size); min-width: 0; height: var(--tile-menu-size); padding: 0; border: 1px solid transparent; border-radius: var(--pi-radius-lg); background: transparent; color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-ui); }
    .row-wrap .action-menu-toggle:focus-visible { color: var(--pi-text); border-color: var(--pi-accent); }
    @media (hover: hover) { .row-wrap .action-menu-toggle:hover { color: var(--pi-text); border-color: var(--pi-accent); } }

    :host { display: block; min-height: 0; height: 100%; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); user-select: none; -webkit-user-select: none; }
    .navigate { display: flex; flex-direction: column; min-height: 0; height: 100%; }
    .path-bar { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-2); min-height: var(--pi-panel-header-height); padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); }
    /* No sideways scrolling on a phone: the path shares the width and each
       step ellipsises, so the whole scope is readable at a glance (owner). */
    .path-row { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--pi-space-2); overflow: hidden; }
    .path-step { box-sizing: border-box; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-height: var(--pi-control-height); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text-secondary); font: inherit; cursor: pointer; }
    .path-step.chosen { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); color: var(--pi-text-bright); }
    .path-sep { flex: 0 0 auto; display: inline-grid; place-items: center; color: var(--pi-muted); }
    .path-sep .ui-icon, .close .ui-icon { width: 14px; height: 14px; }
    /* One tap back to every session this machine runs; the path alone made the
       reader work out where "everything" lived. */
    .quick-access { box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .quick-access.current { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); color: var(--pi-accent); }
    .quick-access .ui-icon { width: 18px; height: 18px; }
    .path-bar-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-3); }
    .settings { box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .settings .ui-icon { width: 18px; height: 18px; }
    .close { box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .kinds { flex: 0 0 auto; display: flex; gap: var(--pi-space-2); padding: var(--pi-space-3) var(--pi-bar-inset) 0; }
    .kind { box-sizing: border-box; flex: 1 1 0; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: var(--pi-space-2); min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text-secondary); font: inherit; font-size: var(--pi-text-xs); cursor: pointer; }
    .kind.current { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); color: var(--pi-text-bright); }
    .kind-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kind-icon, .row-icon { display: inline-grid; place-items: center; }
    .kind-icon .ui-icon, .row-icon .ui-icon { width: 14px; height: 14px; }
    /* One colour per kind, so a folder is never mistaken for a session. */
    [data-kind="session"] { color: var(--pi-accent); }
    [data-kind="folder"] { color: var(--pi-success); }
    [data-kind="project"] { color: var(--pi-purple); }
    [data-kind="machine"] { color: var(--pi-warning); }
    .row-icon { margin-right: var(--pi-space-3); }
    .row-title { display: inline-flex; align-items: center; }
    .search-row { flex: 0 0 auto; padding: var(--pi-space-3) var(--pi-bar-inset) 0; }
    .search { box-sizing: border-box; width: 100%; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.4 var(--pi-font-ui); }
    .actions { flex: 0 0 auto; display: flex; gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-bar-inset) 0; }
    .create { box-sizing: border-box; flex: 1 1 0; min-height: var(--pi-control-height-comfort); border: 1px solid var(--pi-accent-border); border-radius: var(--pi-radius-md); background: var(--pi-selection-bg); color: var(--pi-text-bright); font: inherit; cursor: pointer; }
    .create.secondary { border-color: var(--pi-border); background: var(--pi-surface); color: var(--pi-text); }
    /* Two entries to a line: the owner reads this list as a board of places,
       and one tall row per screen line wasted half the width. */
    /* The quick-access board's shape, which the owner asked this page to
       follow: cards that fit the width, a two-line title, the place under it
       and the menu in the card's own corner. */
    .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--pi-space-3) var(--pi-bar-inset) var(--pi-space-5); display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); align-content: start; gap: var(--pi-space-3); }
    @media (max-width: 430px) { .body { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); } }
    .section-title, .empty { grid-column: 1 / -1; }
    .row-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .section-title { margin: var(--pi-space-4) 0 var(--pi-space-1); color: var(--pi-muted); font: var(--pi-text-2xs) var(--pi-font-ui); font-weight: var(--pi-weight-strong); letter-spacing: .08em; text-transform: uppercase; }
    .row { box-sizing: border-box; display: grid; gap: var(--pi-space-2); width: 100%; min-height: calc(var(--pi-row-min-height, 48px) + var(--pi-space-6)); padding: var(--pi-space-4) calc(var(--tile-menu-size) + var(--pi-space-2)) var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; text-align: start; cursor: pointer; }
    .row.current { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .row-title { min-width: 0; overflow: hidden; }
    .row-detail { min-width: 0; display: flex; gap: var(--pi-space-3); overflow: hidden; color: var(--pi-muted); font-size: var(--pi-text-2xs); white-space: nowrap; }
    .pin { display: inline-flex; align-items: center; margin-right: var(--pi-space-2); color: var(--pi-accent); }
    .pin .ui-icon { width: 14px; height: 14px; }
    .empty { margin: var(--pi-space-5) 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  `];
}


declare global {
  interface HTMLElementTagNameMap {
    "app-navigate-page": AppNavigatePage;
  }
}

/**
 * A pin means "keep this close", so a pinned project leads the board; the rest
 * keep the order the model gave them.
 */
function pinnedFirst<T extends { id: string }>(choices: readonly T[], pinned: ReadonlySet<string>): T[] {
  return [...choices.filter((choice) => pinned.has(choice.id)), ...choices.filter((choice) => !pinned.has(choice.id))];
}

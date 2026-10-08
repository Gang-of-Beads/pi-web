import { projectRowClass } from "../../projectFolder";
import type { ListTilesPerRow } from "../../../../shared/apiTypes";
import type { NavigateListScope } from "../../goToScope";
import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { SessionInfo } from "../../api";
import { navigateModel, type NavigateChoice, type NavigateInput, type NavigateLevel, type NavigateSection, type NavigateSessionRow, type NavigateSessionState } from "../../navigateModel";
import { switcherBreadcrumb, type BreadcrumbLevel } from "../../switcherBreadcrumb";
import { createHeldRowOrder, TAP_SETTLE_MS } from "../../heldRowOrder";
import { ListMotion } from "../../listMotion";
import type { BreadcrumbSegment } from "../../switcherBreadcrumb";
import { ActivityClock, modifiedMs } from "../../sessionOrder";
import { listFolds } from "../../listFolds";
import { disclosureIconStyle, renderDisclosureIcon } from "../disclosureIcon.js";
import { renderChatIcon, renderCheckIcon, renderChevronRightIcon, renderGearIcon, renderGridIcon, renderMachineIcon, renderPendingRingIcon, renderPinIcon, renderProjectIcon, uiIconStyle } from "../uiIcons.js";
import { actionMenuStyles, interactiveSurfaceStyles } from "../shared";
import { switcherEmptyMeaning } from "../../switcherEmptyMeaning";
import type { BoardAnswer } from "../../sync/sessionBoard";
import { sessionStateBadgeStyles } from "../sessionStateBadgeStyles.js";
import { SESSION_STATE_LABELS } from "../activityBadge";
import { actionMenuPanelStyle, actionMenuPanelStyleAtPointer, contextMenuFromMouse } from "../actionMenu";
import { navigateBulkActions, navigateRowActions, type NavigateBulkActionId, type NavigateBulkGroup, type NavigateRowActionId, type NavigateRowFacts, type NavigateRowKind } from "../../navigateRowActions";
import { NavigateSelection, type NavigateSelectionState } from "../../navigateSelection";
import { isSelecting, type SelectionOutcome } from "../../selectionModel";
import { renderSelectionActions, renderSelectionHeader, selectionBarStyles } from "./navigateSelectionBar";
import { sessionLabel } from "../../sessionLabels";
import { machineSessionKey } from "../../machineKeys";
import type { PendingNavigation } from "../../navigationIntent";
import { isOpeningKey, openingMarkStyles, renderOpeningSpinner, renderOpeningWords } from "../openingMark";

/** What a tap on a session row does. */
type SessionRowTap = "open" | "continue";

/** The New session menu shares the one open-menu slot with the row menus. */
const NEW_SESSION_MENU = "new-session";

/** The New session button in each tap mode: it starts a session or opens its menu, or, while picking, names the mode and leaves it. */
const CREATE_BUTTON: Readonly<Record<SessionRowTap, { label: string; picking: boolean }>> = {
  open: { label: "+ New session", picking: false },
  continue: { label: "✕ Continue from…", picking: true },
};

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

/**
 * Work in progress is the shared bouncing dots, not a static green pip: a
 * still dot the owner had to squint at could not be told from the idle one,
 * and the transcript already animates work this way. Every category wears the
 * switcher's mark and words (B14); an unknown state wears none.
 */
function renderNavigateStateMark(state: NavigateSessionState) {
  if (state === "unknown") return nothing;
  const label = SESSION_STATE_LABELS[state];
  if (state === "working") {
    const dots = [0, 1, 2].map((index) => html`<span class="state-dot" style=${`animation-delay:${(index * 0.14).toFixed(2)}s`}></span>`);
    return html`<span class="session-state running" role="img" title=${label} aria-label=${label}><span class="state-dots">${dots}</span></span>`;
  }
  return html`<span class=${`session-state ${state}`} role="img" title=${label} aria-label=${label}></span>`;
}

/** What one render draws, worked out before it so the rows can be measured where they stand (`ListMotion`). */
interface NavigateView {
  readonly listed: Omit<NavigateInput, "query">;
  readonly model: ReturnType<typeof navigateModel>;
  readonly segments: readonly BreadcrumbSegment[];
  readonly sections: readonly NavigateSection[];
  readonly choices: readonly NavigateChoice[];
  /** The rows the list draws, in order: what `ListMotion` compares between renders. */
  readonly rowKeys: readonly string[];
}

/**
 * What the reader sets on this page that makes the list another list. Lit
 * records which of them an update changed; any of them is a new scope, which
 * applies at once.
 */
const SCOPE_PROPERTIES = ["kind", "query", "pathProjectId", "foldRevision", "tilesPerRow"] as const;

function sessionRowKey(row: NavigateSessionRow): string {
  return `session:${row.machineId}:${row.session.id}`;
}

function choiceRowKey(choice: NavigateChoice): string {
  return `${choice.level}:${choice.id}`;
}

/** What a selectable row carries into the selection: its id, its group, and the facts its bulk actions read. */
interface SelectableRow {
  readonly id: string;
  readonly group: NavigateBulkGroup;
  readonly facts: NavigateRowFacts;
}

/** The group a Select key starts, per kind of list; machines have no bulk actions (bulk-selection.md). */
const SELECT_KEY_GROUP: Readonly<Record<NavigateKind, NavigateBulkGroup | undefined>> = {
  sessions: "live",
  project: "projects",
  machine: undefined,
};

@customElement("app-navigate-page")
export class AppNavigatePage extends LitElement {
  @property({ attribute: false }) input?: Omit<NavigateInput, "query">;
  @property({ attribute: false }) onChoose?: (level: NavigateLevel, id: string) => void;
  @property({ attribute: false }) onWiden?: (level: NavigateLevel) => void;
  @property({ attribute: false }) onOpenSession?: (session: SessionInfo, machineId: string) => void;
  /** The session the reader tapped and is waiting for; its row answers the tap (D8). */
  @property({ attribute: false }) opening: PendingNavigation | undefined = undefined;
  @property({ attribute: false }) onCreateSession?: () => void;
  /** Continue a session in a new one; absent where that cannot be offered. */
  @property({ attribute: false }) onContinueFrom?: (session: SessionInfo, machineId: string) => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onClose?: () => void;
  /**
   * Opens the Go to sheet; the host passes it on the phone, where Navigate is a page with no app
   * bar. It shows in every scope, with or without a chosen project: Go to also holds Settings and
   * Actions, so it is how the phone reaches them (owner, 2026-10-04).
   */
  /** Opens Go to, told what this page lists so Go to offers that scope's pages (go-to-scopes.md). */
  @property({ attribute: false }) onOpenGoTo?: (scope: NavigateListScope) => void;
  /**
   * The Settings key, for the desktop overlay, where nothing else on the page reaches Settings.
   * The phone host leaves it out: its Settings is a line in Go to, so the header is the path and
   * the Go to key, the same shape as the chat's header (owner, 2026-10-04: the path was cut to
   * "Lo…" behind four keys).
   */
  @property({ attribute: false }) onOpenSettings?: () => void;
  /** What the row menu does; the page names the action, the host performs it. */
  @property({ attribute: false }) onRowAction?: (kind: NavigateRowKind, id: string, action: NavigateRowActionId) => void;
  @property({ attribute: false }) canRenameSession = false;
  /** Whether the host can archive, restore and delete sessions of the machine this page lists. */
  @property({ attribute: false }) canArchiveSessions = false;
  @property({ attribute: false }) canCloseProject = false;
  /** Project ids the reader pinned; the host owns the store. */
  @property({ attribute: false }) pinnedProjectIds: ReadonlySet<string> = new Set();
  /** How much of the machine-wide board has answered; emptiness is claimed only for a complete one. */
  @property({ attribute: false }) boardAnswer: BoardAnswer = "none";
  @property({ attribute: false }) loadingChoices = false;
  /**
   * Whether there is somewhere to go back to. The desktop rail is the page's
   * permanent home, so its leading key only widens; an overlay and the phone's
   * navigation view both have a session behind them to return to.
   */
  @property({ type: Boolean }) returnable = false;
  /** The host is carrying out a change the reader asked for from this list; its result applies without motion. */
  @property({ attribute: false }) readerChanging = false;
  /** Runs a bulk action on the selected rows; a cancelled confirmation answers "cancelled". Absent, the selection offers no actions. */
  @property({ attribute: false }) onBulkAction?: (group: NavigateBulkGroup, action: NavigateBulkActionId, ids: readonly string[]) => Promise<SelectionOutcome>;
  /** Told when selecting starts, with the way out the back gesture takes, and when it ends. */
  @property({ attribute: false }) onSelectingChange?: (exit: (() => void) | undefined) => void;
  /** Selecting many rows (state diagram D9); the page draws what it says. */
  private readonly selection = new NavigateSelection((next, previous) => { this.selectionChanged(next, previous); });
  @state() private query = "";
  /** What a tap on a session row does: open it, or continue it in a new session after New session's "Continue from…". */
  @state() private rowTap: SessionRowTap = "open";
  /** Rows re-sort live, but never under a finger; see `heldRowOrder`. */
  private readonly rowOrder = createHeldRowOrder<NavigateSessionRow>((row) => `${row.machineId}:${row.session.id}`);
  /** Holds a working session's place while it runs; see `ActivityClock`. */
  private readonly activityClock = new ActivityClock();
  private readonly folds = listFolds("navigate");
  private holdRecheck: ReturnType<typeof setTimeout> | undefined;
  /** Server changes to the rows slide into place; see `ListMotion`. */
  private readonly motion = new ListMotion();
  private view: NavigateView | undefined;
  /** The machine the list showed last render; another one is a new scope. */
  private shownMachineId: string | undefined;
  /** Until when a change to the rows counts as the reader's: the moment after any press or key in the app. */
  private readerQuietUntil = 0;
  private readonly noteReaderInput = (): void => {
    this.readerQuietUntil = Date.now() + TAP_SETTLE_MS;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.noteReaderInput, { capture: true, passive: true });
    document.addEventListener("keydown", this.noteReaderInput, { capture: true, passive: true });
  }

  override disconnectedCallback(): void {
    this.exitSelection();
    document.removeEventListener("pointerdown", this.noteReaderInput, { capture: true });
    document.removeEventListener("keydown", this.noteReaderInput, { capture: true });
    this.rowOrder.release();
    if (this.holdRecheck !== undefined) clearTimeout(this.holdRecheck);
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (this.readerChanging || changed.get("readerChanging") === true) this.noteReaderInput();
    this.view = this.computeView();
    if (this.view === undefined) return;
    const machineId = this.view.listed.scope.machineId;
    const scopeChanged = SCOPE_PROPERTIES.some((name) => changed.has(name)) || machineId !== this.shownMachineId;
    if (changed.has("kind") || changed.has("pathProjectId") || machineId !== this.shownMachineId) this.exitSelection();
    else this.selection.dispatch({ type: "rows", ids: new Set(this.selectableRows().map((row) => row.id)) });
    this.shownMachineId = machineId;
    this.motion.prepare(this.listBody(), this.view.rowKeys, { scopeChanged, readerActive: Date.now() < this.readerQuietUntil });
  }

  protected override updated(): void {
    this.motion.play(this.listBody());
  }

  private listBody(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(".body");
  }

  private computeView(): NavigateView | undefined {
    const input = this.input;
    if (input === undefined) return undefined;
    const listed = this.listedInput(input);
    const model = navigateModel({ ...listed, query: this.query, activityAt: (row, rank) => this.activityClock.timeOf(`${row.machineId}:${row.session.id}`, rank, modifiedMs(row.session.modified)) });
    const segments = switcherBreadcrumb({
      machines: listed.machines,
      machineId: listed.scope.machineId,
      projects: listed.projects,
      projectId: listed.scope.projectId,
      folders: input.folders,
      folderPath: undefined,
    }).filter((segment) => segment.level !== "folder");
    if (this.kind === "sessions") {
      const sections = this.orderedSections(model.sections);
      return { listed, model, segments, sections, choices: [], rowKeys: sections.flatMap((section) => section.rows.map(sessionRowKey)) };
    }
    const levelChoices = model.sections.flatMap((section) => section.choices).filter((choice) => choice.level === this.kind);
    const choices = this.kind === "project" ? pinnedFirst(levelChoices, this.pinnedProjectIds) : levelChoices;
    return { listed, model, segments, sections: [], choices, rowKeys: choices.map(choiceRowKey) };
  }

  /**
   * Every session on the machine, for the default view. Narrowing to a
   * project is a deliberate step down the path, not the starting point: the
   * list people want on opening is "what am I running", not "what is in the
   * folder I happen to be standing in".
   */
  @property({ attribute: false }) machineSessions: readonly SessionInfo[] = [];
  /** Tiles per row the reader chose for this layout (listTiles.ts); undefined keeps the width rule. */
  @property({ attribute: false }) tilesPerRow: ListTilesPerRow | undefined;

  /** Which kind of thing the page is listing; one page shows one kind. */
  @state() private kind: NavigateKind = "sessions";
  /** The project the reader stepped into on this page, if any. */
  @state() private pathProjectId: string | undefined = undefined;
  /** Bumped when the reader folds or unfolds a section, so the page draws the stored choice. */
  @state() private foldRevision = 0;
  @state() private openMenuRowId: string | undefined = undefined;
  @state() private menuStyle = "";

  /** Open the page on one kind; the keyboard shortcuts name a kind, not a panel. */
  showKind(kind: NavigateKind): void {
    this.kind = kind;
  }

  /**
   * The project the scope switch names when the list shows the whole machine: the one the reader
   * last stepped into on this page, else the project of the session behind it.
   */
  @state() private lastProjectId: string | undefined = undefined;

  /**
   * The grid key is a two-place toggle (owner, 2026-10-04): from a page it opens Navigate, and on
   * Navigate it returns to that page. With nowhere to return to it is absent: the "you are here"
   * mark it used to draw did nothing and cost the path its width (B46; owner, 2026-10-04).
   * Widening the list is the scope switch's job, not this key's.
   */
  private renderQuickAccess() {
    if (this.returnable) {
      return html`<button
        type="button"
        class="quick-access current"
        aria-pressed="true"
        title="Back"
        aria-label="Back to where you were"
        @click=${() => { this.onClose?.(); }}
      >${renderGridIcon()}</button>`;
    }
    return nothing;
  }

  /**
   * `<project> | All projects` (owner, 2026-10-04): one tap narrows the list to a project or
   * widens it to the machine. The path stays the place indicator; it is no longer the only way out
   * of a project.
   */
  private renderScopeSwitch(projects: readonly { id: string; name: string }[], sessionProjectId: string | undefined) {
    const projectId = this.pathProjectId ?? this.lastProjectId ?? sessionProjectId;
    const project = projectId === undefined ? undefined : projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) return nothing;
    const narrowed = this.pathProjectId !== undefined;
    return html`<div class="scope-switch" role="group" aria-label="Which sessions to list">
      <button type="button" class=${narrowed ? "scope current" : "scope"} aria-pressed=${narrowed ? "true" : "false"} title=${project.name} @click=${() => { this.narrowTo(project.id); }}>${project.name}</button>
      <button type="button" class=${narrowed ? "scope" : "scope current"} aria-pressed=${narrowed ? "false" : "true"} @click=${() => { this.widenToMachine(); }}>All projects</button>
    </div>`;
  }

  private narrowTo(projectId: string): void {
    if (this.pathProjectId === projectId) return;
    this.pathProjectId = projectId;
    this.lastProjectId = projectId;
    this.onChoose?.("project", projectId);
  }

  /** Only a project the reader stepped into is widened through the app: the machine-wide list needs no selection change. */
  private widenToMachine(): void {
    if (this.pathProjectId === undefined) return;
    this.pathProjectId = undefined;
    this.onWiden?.("project");
  }

  /**
   * A path level steps the page up to it, and every level above a project lists the machine
   * again; the list under the path is always the sessions there. Like the grid key, a project
   * level widens through the app only from a project the reader stepped into: on the
   * machine-wide page the tap changed nothing visible and dropped the session behind the page.
   */
  private pathStepPressed(level: BreadcrumbLevel): void {
    if (level === "folder") return;
    const steppedIn = this.pathProjectId !== undefined;
    this.pathProjectId = undefined;
    this.kind = "sessions";
    if (level !== "project" || steppedIn) this.onWiden?.(level);
  }

  showEverything(): void {
    this.pathProjectId = undefined;
    this.kind = "sessions";
    this.query = "";
  }

  private tapSessionRow(row: NavigateSessionRow): void {
    const tap = this.rowTap;
    this.rowTap = "open";
    ROW_TAPS[tap](this, row);
  }

  override render() {
    const view = this.view;
    const input = this.input;
    if (view === undefined || input === undefined) return html`<slot name="app-row"></slot><p class="empty" role="status">Reading this machine…</p>`;
    const { listed, model, segments, choices } = view;
    const showsSessions = this.kind === "sessions";
    return html`
      <section class=${isSelecting(this.selection.state) ? "navigate selecting" : "navigate"} @pointerdown=${this.pressGuard} @click=${this.holdReleaseGuard}>
        <div class="head-stack">
          <div class="list-head" ?inert=${isSelecting(this.selection.state)}>${this.renderBrowseHeader(segments, listed, input.scope.projectId, showsSessions)}</div>
          ${isSelecting(this.selection.state) ? this.renderSelection(this.selection.state) : nothing}
        </div>
        <div
          class=${this.tilesPerRow === undefined ? "body" : `body tiles-${String(this.tilesPerRow)}`}
          @pointerdown=${() => { this.rowOrder.hold(); }}
          @pointerup=${() => { this.letGoOfRows(); }}
          @pointercancel=${() => { this.letGoOfRows(); }}
        >
          ${showsSessions
            ? html`
                ${repeat(view.sections, (section) => section.id, (section) => this.renderSessionSection(section))}
                ${this.renderSessionsEmptyState(model.matchCount)}
              `
            : html`
                ${repeat(choices, choiceRowKey, (choice) => this.renderChoice(choice))}
                ${choices.length > 0 || this.loadingChoices
                  ? nothing
                  : html`<p class="empty" role="status">Nothing to choose at this level.</p>`}
              `}
        </div>
      </section>
    `;
  }


  /** The page's own header while browsing: the path, the kinds, the scope switch, and the list's search and create keys. */
  private renderBrowseHeader(segments: readonly BreadcrumbSegment[], listed: Omit<NavigateInput, "query">, sessionProjectId: string | undefined, showsSessions: boolean) {
    return html`
        <header class="path-bar">
          ${this.renderQuickAccess()}
          <div class="path-row">
            ${segments.map((segment, index) => html`
              ${index === 0 ? nothing : html`<span class="path-sep">${renderChevronRightIcon()}</span>`}
              <button
                type="button"
                class=${segment.chosen ? "path-step chosen" : "path-step"}
                title=${segment.label}
                @click=${() => { this.pathStepPressed(segment.level); }}
              >${segment.label}</button>
            `)}
          </div>
          <div class="path-bar-actions">
            ${this.onOpenSettings === undefined ? nothing : html`<button type="button" class="settings" aria-label="Settings" title="Settings" @click=${() => { this.onOpenSettings?.(); }}>${renderGearIcon()}</button>`}
            ${this.onOpenGoTo === undefined ? nothing : html`<button type="button" class="settings menu-key" aria-label="Go to a view" title="Go to a view" aria-haspopup="dialog" @click=${() => { this.onOpenGoTo?.(this.pathProjectId === undefined ? { kind: "machine" } : { kind: "project", projectId: this.pathProjectId }); }}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"></path></svg></button>`}
          </div>
        </header>
        <slot name="app-row"></slot>
        <nav class="kinds" aria-label="What to list">
          ${segments.some((segment) => segment.level === "machine") ? this.renderKindTab("machine", "Machines", renderMachineIcon()) : nothing}
          ${this.renderKindTab("project", "Projects", renderProjectIcon())}
          ${this.renderKindTab("sessions", "Sessions", renderChatIcon())}
        </nav>
        ${showsSessions ? this.renderScopeSwitch(listed.projects, sessionProjectId) : nothing}
        ${this.renderListHeader(showsSessions)}
    `;
  }

  private renderListHeader(showsSessions: boolean) {
    return html`
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
            ? this.renderCreateSession()
            : this.kind === "project" && this.onAddProject !== undefined
              ? html`<button type="button" class="create" @click=${() => { this.onAddProject?.(); }}>+ Add project</button>`
              : nothing}
          ${this.renderSelectKey()}
        </div>
    `;
  }

  /**
   * A quiet way into selecting for a mouse, which has no long press (owner, 2026-09-30); the
   * phone's hold is the gesture there, so the key stays off coarse pointers.
   */
  private renderSelectKey() {
    const group = SELECT_KEY_GROUP[this.kind];
    if (group === undefined || this.onBulkAction === undefined) return nothing;
    return html`<button type="button" class="select-key" @click=${() => { this.selection.dispatch({ type: "start", group }); }}>Select</button>`;
  }

  /**
   * Selecting lays its keys over the browsing header instead of replacing it (owner, 2026-10-09):
   * the header keeps its height under a translucent scrim, so no row moves when the page enters
   * or leaves selecting, and the row under the finger that held it is still under the finger.
   */
  private renderSelection(state: Exclude<NavigateSelectionState, { phase: "browsing" }>) {
    const chosen = this.selectableRows().filter((row) => row.group === state.group && state.ids.has(row.id));
    const bar = {
      state,
      actions: this.onBulkAction === undefined ? [] : navigateBulkActions(state.group, chosen),
      visibleIds: this.visibleSelectableIds(state.group),
      onExit: () => { this.exitSelection(); },
      onSelectAll: (ids: readonly string[]) => { this.selection.dispatch({ type: "select-all", ids }); },
      onChoose: (action: NavigateBulkActionId, ids: readonly string[]) => { void this.runBulkAction(state.group, action, ids); },
    };
    return html`
      <div class="selection-overlay">
        ${renderSelectionHeader(bar)}
        ${renderSelectionActions(bar)}
      </div>
    `;
  }

  private async runBulkAction(group: NavigateBulkGroup, action: NavigateBulkActionId, ids: readonly string[]): Promise<void> {
    const run = this.onBulkAction;
    if (run === undefined) return;
    this.selection.dispatch({ type: "choose", action });
    const outcome = await run(group, action, ids).catch((): SelectionOutcome => "cancelled");
    this.selection.dispatch({ type: "settled", outcome });
  }

  /** Leave selecting, from the way-out key, Escape, the back gesture, or a change of list. */
  exitSelection(): void {
    this.selection.dispatch({ type: "exit" });
  }

  private selectionChanged(next: NavigateSelectionState, previous: NavigateSelectionState): void {
    this.requestUpdate();
    if (isSelecting(next) === isSelecting(previous)) return;
    if (isSelecting(next)) {
      this.openMenuRowId = undefined;
      document.addEventListener("keydown", this.escapeSelection, { capture: true });
      this.onSelectingChange?.(() => { this.exitSelection(); });
      return;
    }
    document.removeEventListener("keydown", this.escapeSelection, { capture: true });
    this.onSelectingChange?.(undefined);
  }

  private readonly pressGuard = { handleEvent: (): void => { this.selection.pressStarted(); }, capture: true };

  private readonly holdReleaseGuard = { handleEvent: (event: MouseEvent): void => { this.selection.swallowHoldRelease(event); }, capture: true };

  private readonly escapeSelection = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.exitSelection();
  };

  /**
   * The rows a selection may hold, in list order. A session pinned on another machine stands in
   * this list but is acted on there, so it is not selectable here; neither is an archived one
   * where this host cannot change archives.
   */
  private selectableRows(): SelectableRow[] {
    const view = this.view;
    if (view === undefined) return [];
    if (this.kind !== "sessions") {
      return view.choices.flatMap((choice): SelectableRow[] => choice.level === "project"
        ? [{ id: choice.id, group: "projects", facts: { pinned: this.pinnedProjectIds.has(choice.id), closable: this.canCloseProject } }]
        : []);
    }
    return view.sections.flatMap((section) => section.rows.flatMap((row): SelectableRow[] => {
      const group = this.sessionGroup(row);
      return group === undefined ? [] : [{ id: row.session.id, group, facts: this.sessionFacts(row) }];
    }));
  }

  /** Select all takes what the reader can see: rows of folded sections stay as they are. */
  private visibleSelectableIds(group: NavigateBulkGroup): string[] {
    const view = this.view;
    if (view === undefined) return [];
    if (this.kind !== "sessions") return this.selectableRows().filter((row) => row.group === group).map((row) => row.id);
    return view.sections
      .filter((section) => !this.folds.isFolded(section.id, section.foldedByDefault === true))
      .flatMap((section) => section.rows.filter((row) => this.sessionGroup(row) === group).map((row) => row.session.id));
  }

  private sessionGroup(row: NavigateSessionRow): NavigateBulkGroup | undefined {
    if (row.machineId !== this.view?.listed.scope.machineId) return undefined;
    if (row.session.archived !== true) return "live";
    return this.canArchiveSessions ? "archived" : undefined;
  }

  private sessionFacts(row: NavigateSessionRow): NavigateRowFacts {
    return { pinned: row.pins.global, archived: row.session.archived === true, archivable: this.canArchiveSessions && row.session.persisted !== false, unread: this.input?.unreadSessionIds?.has(row.session.id) === true };
  }

  /** While selecting, a row of the selected group leads with its mark instead of its icon. */
  private rowIcon(group: NavigateBulkGroup | undefined, id: string, icon: unknown) {
    const selected = this.rowSelected(group, id);
    if (selected === undefined) return icon;
    return selected ? renderCheckIcon() : renderPendingRingIcon();
  }

  /** Whether a row is selected; undefined while the list is not selecting that row's group. */
  private rowSelected(group: NavigateBulkGroup | undefined, id: string): boolean | undefined {
    const state = this.selection.state;
    if (!isSelecting(state) || state.group !== group) return undefined;
    return state.ids.has(id);
  }

  /**
   * The sections with their rows in the sequence this page opened with: a
   * refresh changes what a row says, never where it sits.
   */
  private orderedSections(sections: readonly NavigateSection[]): NavigateSection[] {
    const ordered = this.rowOrder.order(sections.flatMap((section) => section.rows), Date.now());
    const placeOf = new Map(ordered.map((row, index) => [`${row.machineId}:${row.session.id}`, index]));
    return sections
      .filter((section) => section.id !== "choices" && (section.rows.length > 0 || section.emptyText !== undefined))
      .map((section) => ({ ...section, rows: [...section.rows].sort((left, right) => (placeOf.get(`${left.machineId}:${left.session.id}`) ?? 0) - (placeOf.get(`${right.machineId}:${right.session.id}`) ?? 0)) }));
  }

  /**
   * Absence is not negation: while the host is still reading, an empty list
   * means "not known yet". Saying "No sessions here yet." at that moment is
   * how a tap that did work read as a tap that did nothing.
   */
  private renderSessionsEmptyState(matchCount: number) {
    const meaning = switcherEmptyMeaning({
      answer: this.boardAnswer,
      matchCount,
      query: this.query,
      scoped: this.pathProjectId !== undefined,
    });
    if (meaning.kind === "none" || meaning.kind === "unknown") return nothing;
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
    const kind: NavigateRowKind = choice.level;
    const rowId = choiceRowKey(choice);
    const group: NavigateBulkGroup | undefined = choice.level === "project" ? "projects" : undefined;
    const selected = this.rowSelected(group, choice.id);
    return this.renderRowShell(rowId, kind, choice.id, choice.label, html`
      <button
        type="button"
        class=${`row${choice.current ? " current" : ""}${projectRowClass(choice)}`}
        title=${choice.detail ?? choice.label}
        aria-pressed=${selected === undefined ? nothing : String(selected)}
        @pointerdown=${(event: PointerEvent) => { this.selection.pointerDown(group, choice.id, event); }}
        @pointermove=${(event: PointerEvent) => { this.selection.pointerMove(event); }}
        @pointerup=${() => { this.selection.pointerEnd(); }}
        @pointercancel=${() => { this.selection.pointerEnd(); }}
        @click=${(event: MouseEvent) => {
          if (this.selection.click(group, choice.id, event) === "selection") return;
          if (choice.level === "project") { this.pathProjectId = choice.id; this.lastProjectId = choice.id; }
          this.onChoose?.(choice.level, choice.id);
          this.kind = "sessions";
        }}
      >
        <span class="row-title"><span class="row-icon" data-kind=${choice.level}>${this.rowIcon(group, choice.id, icon)}</span>${kind === "project" && this.pinnedProjectIds.has(choice.id) ? html`<span class="pin" title="Pinned" aria-label="Pinned">${renderPinIcon()}</span>` : nothing}<span class="row-name">${choice.label}</span></span>
        ${choice.detail === undefined ? nothing : html`<span class="row-path">${choice.detail}</span>`}
      </button>
    `, {
      hasPath: choice.detail !== undefined,
      closable: kind === "project" && this.canCloseProject,
      pinned: kind === "project" && this.pinnedProjectIds.has(choice.id),
    }, group, selected);
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
    facts: { pinned?: boolean; projectPinned?: boolean | undefined; hasPath?: boolean; closable?: boolean; archived?: boolean; archivable?: boolean },
    group: NavigateBulkGroup | undefined,
    selected: boolean | undefined,
  ) {
    const actions = navigateRowActions(kind, {
      ...facts,
      renamable: kind === "session" && this.canRenameSession,
    });
    const open = this.openMenuRowId === rowId;
    const menu = actions.length > 1 && !isSelecting(this.selection.state);
    return html`
      <div class=${`row-wrap${open ? " menu-open" : ""}${selected === true ? " selected" : ""}`} data-motion-key=${rowId} @contextmenu=${(event: MouseEvent) => { this.rowContextMenu(rowId, menu, group, id, event); }}>
        ${row}
        ${!menu ? nothing : html`
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
            @click=${() => { this.openMenuRowId = undefined; }}
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

  /**
   * New session, and inside it "Continue from…" (owner 2026-10-08: no extra button, no hint line). The
   * menu offers an empty session or picking one to continue; while picking, the button itself says so
   * and a tap on it leaves. A machine that cannot continue sessions gets the plain button.
   */
  private renderCreateSession() {
    const button = CREATE_BUTTON[this.rowTap];
    const menu = this.onContinueFrom !== undefined && this.rowTap === "open";
    return html`
      <button
        type="button"
        class="create"
        aria-pressed=${button.picking ? "true" : nothing}
        aria-haspopup=${menu ? "menu" : nothing}
        aria-expanded=${menu ? (this.openMenuRowId === NEW_SESSION_MENU ? "true" : "false") : nothing}
        @click=${(event: MouseEvent) => { CREATE_TAPS[this.rowTap](this, event.currentTarget); }}
      >${button.label}</button>
      ${this.openMenuRowId === NEW_SESSION_MENU ? html`
        <div class="menu-scrim" @click=${() => { this.openMenuRowId = undefined; }}></div>
        <div class="action-menu-panel" role="menu" aria-label="New session" style=${this.menuStyle}>
          <button type="button" role="menuitem" @click=${() => { this.openMenuRowId = undefined; this.onCreateSession?.(); }}>Empty session</button>
          <button type="button" role="menuitem" title="Start a new session that carries an existing session's whole history" @click=${() => { this.openMenuRowId = undefined; this.rowTap = "continue"; }}>Continue from…</button>
        </div>
      ` : nothing}
    `;
  }

  /** New session's tap: start one at once where nothing can be continued, otherwise open its menu. */
  tapNewSession(target: EventTarget | null): void {
    if (this.onContinueFrom === undefined) {
      this.onCreateSession?.();
      return;
    }
    this.toggleRowMenu(NEW_SESSION_MENU, target);
  }

  /** Leave picking without continuing anything. */
  stopPicking(): void {
    this.rowTap = "open";
  }

  /**
   * A right-click opens the row's menu where the pointer is (R14). A touch long press fires the
   * same event on Android, and there the hold is selection's: the browser's own menu must not
   * open over it.
   */
  private rowContextMenu(rowId: string, menu: boolean, group: NavigateBulkGroup | undefined, id: string, event: MouseEvent): void {
    if (!contextMenuFromMouse(event)) {
      event.preventDefault();
      this.selection.touchContextMenu(group, id, event);
      return;
    }
    if (!menu) return;
    event.preventDefault();
    this.openMenuRowId = rowId;
    this.menuStyle = actionMenuPanelStyleAtPointer(event);
  }

  private toggleRowMenu(rowId: string, target: EventTarget | null): void {
    this.openMenuRowId = this.openMenuRowId === rowId ? undefined : rowId;
    this.menuStyle = this.openMenuRowId === undefined ? "" : actionMenuPanelStyle(target, { constrainTo: "viewport" });
  }

  /** The name alone: the owner's call, after a row of hashes and then a line of
   *  state proved to be noise on a list whose job is to be scanned. */
  private renderSession(row: NavigateSessionRow) {
    const label = sessionLabel(row.session);
    const key = machineSessionKey(row.machineId, row.session.id);
    const opening = isOpeningKey(this.opening, key);
    const group = this.sessionGroup(row);
    const id = row.session.id;
    const selected = this.rowSelected(group, id);
    return this.renderRowShell(sessionRowKey(row), "session", id, label, html`
      <button
        type="button"
        class=${`row session${row.current ? " current" : ""}${opening ? " opening" : ""}`}
        aria-current=${row.current ? "true" : "false"}
        aria-busy=${opening ? "true" : "false"}
        aria-pressed=${selected === undefined ? nothing : String(selected)}
        title=${label}
        @pointerdown=${(event: PointerEvent) => { this.selection.pointerDown(group, id, event); }}
        @pointermove=${(event: PointerEvent) => { this.selection.pointerMove(event); }}
        @pointerup=${() => { this.selection.pointerEnd(); }}
        @pointercancel=${() => { this.selection.pointerEnd(); }}
        @click=${(event: MouseEvent) => { if (this.selection.click(group, id, event) === "row") this.tapSessionRow(row); }}
      >
        <span class="row-title"><span class="row-icon" data-kind="session">${this.rowIcon(group, id, renderChatIcon())}</span>${row.pinned ? html`<span class="pin" title="Pinned" aria-label="Pinned">${renderPinIcon()}</span>` : nothing}<span class="row-name">${label}</span>${opening ? renderOpeningSpinner() : renderNavigateStateMark(row.state)}</span>
        ${this.opening?.key === key && this.opening.phase !== "going" ? html`<span class="row-path">${renderOpeningWords(this.opening, key)}</span>` : row.path === "" ? nothing : html`<span class="row-path">${row.path}</span>`}
      </button>
    `, { pinned: row.pins.global, projectPinned: row.pins.project, archived: row.session.archived === true, archivable: this.canArchiveSessions && row.session.persisted !== false }, group, selected);
  }

  /**
   * The Archived group: one key that says how many there are and opens the rows. Collapsed
   * by default, because the list is scanned for what the reader works in.
   */
  /**
   * One foldable section (owner, 2026-10-04): its title, folded or open as the reader last left it
   * in this list, and its rows. A folded section, and one folded by default (Archived), says its
   * count, so a folded list still answers "how many"; one that is open and empty says so instead of
   * vanishing.
   */
  private renderSessionSection(section: NavigateSection) {
    const foldedByDefault = section.foldedByDefault === true;
    const folded = this.folds.isFolded(section.id, foldedByDefault);
    const title = foldedByDefault || folded ? `${section.title} (${String(section.rows.length)})` : section.title;
    return html`
      <button
        type="button"
        class="section-toggle section-title"
        data-motion-key=${`section:${section.id}`}
        aria-expanded=${folded ? "false" : "true"}
        @click=${() => { this.folds.toggle(section.id, foldedByDefault); this.foldRevision += 1; }}
      ><span class="section-fold" aria-hidden="true">${renderDisclosureIcon(folded)}</span>${title}</button>
      ${folded ? nothing : section.rows.length === 0 && section.emptyText !== undefined
        ? html`<p class="empty section-empty" role="status" data-motion-key=${`empty:${section.id}`}>${section.emptyText}</p>`
        : repeat(section.rows, sessionRowKey, (row) => this.renderSession(row))}
    `;
  }

  /** The finger lifted: the order still holds for a moment, then takes the live one. */
  private letGoOfRows(): void {
    const holdMs = this.rowOrder.letGo(Date.now());
    if (this.holdRecheck !== undefined) clearTimeout(this.holdRecheck);
    this.holdRecheck = setTimeout(() => { this.holdRecheck = undefined; this.requestUpdate(); }, holdMs);
  }


  static override styles = [css`${unsafeCSS(uiIconStyle)}`, css`${unsafeCSS(disclosureIconStyle)}`, interactiveSurfaceStyles, actionMenuStyles, sessionStateBadgeStyles, openingMarkStyles, selectionBarStyles, css`
    .row.session.opening { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .row .row-title { flex: 1 1 auto; min-width: 0; }
    .row-name { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; min-height: calc(2 * 1.3em); line-height: 1.3; overflow-wrap: anywhere; }
    .row.session { display: grid; align-content: center; gap: var(--pi-space-2); }
    /* Two lines of name, like the quick-access card: a one-line clamp turned
       every session into the same truncated prefix. */
    .row .row-title { display: flex; align-items: flex-start; gap: var(--pi-space-2); white-space: normal; }
    .session-state { flex: 0 0 auto; margin-left: auto; margin-top: calc(0.65em - var(--pi-dot-md) / 2); }
    /* The working mark is three dots in a row, not one dot: the shared badge
       box is a circle the width of a single dot, which cut the third one in
       half on the board. Only the animated mark widens; the still states keep
       the circle. */
    .session-state.running { width: auto; min-width: var(--pi-dot-md); overflow: visible; }
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
    .row-wrap.selected > .row { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .head-stack { position: relative; flex: 0 0 auto; }
    .list-head { display: flex; flex-direction: column; }
    .selection-overlay { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; background: var(--pi-bg-overlay); }
    .selection-overlay .selection-header { background: var(--pi-bg); }
    /* A hold is the row's own gesture: iOS must not start a callout or a text selection under it, which cancels the press. */
    .row-wrap > .row { -webkit-touch-callout: none; }
    .select-key { box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-muted); font: inherit; cursor: pointer; }
    @media (pointer: coarse) { .select-key { display: none; } }
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
    ::slotted([slot="app-row"]) { flex: 0 0 auto; }
    .path-bar { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-2); min-height: var(--pi-panel-header-height); padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); }
    /* No sideways scrolling on a phone: the path shares the width and each
       step ellipsises, so the whole scope is readable at a glance (owner). */
    .path-row { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--pi-space-2); overflow: hidden; }
    .path-step { box-sizing: border-box; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-height: var(--pi-control-height); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text-secondary); font: inherit; cursor: pointer; }
    .path-step.chosen { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); color: var(--pi-text-bright); }
    .path-sep { flex: 0 0 auto; display: inline-grid; place-items: center; color: var(--pi-muted); }
    .path-sep .ui-icon { width: 14px; height: 14px; }
    /* One tap back to every session this machine runs; the path alone made the
       reader work out where "everything" lived. */
    .quick-access { box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .quick-access.current { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); color: var(--pi-accent); }
    .quick-access .ui-icon { width: 18px; height: 18px; }
    .settings.menu-key svg { width: 18px; height: 18px; }
    .scope-switch { flex: 0 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0; margin: var(--pi-space-3) var(--pi-bar-inset) 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); overflow: hidden; }
    .scope { box-sizing: border-box; min-height: var(--pi-control-height-comfort); min-width: 0; padding: 0 var(--pi-space-4); border: 0; background: var(--pi-surface); color: var(--pi-muted); font: inherit; font-size: var(--pi-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .scope + .scope { border-left: 1px solid var(--pi-border); }
    .scope.current { background: var(--pi-selection-bg); color: var(--pi-accent); }
    .scope:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: calc(-1 * var(--pi-focus-ring-width)); }
    .path-bar-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-3); }
    .settings { box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .settings .ui-icon { width: 18px; height: 18px; }
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
    .create[aria-pressed="true"] { border-color: var(--pi-accent); }
    /* Two entries to a line: the owner reads this list as a board of places,
       and one tall row per screen line wasted half the width. */
    /* The quick-access board's shape, which the owner asked this page to
       follow: cards that fit the width, a two-line title, the place under it
       and the menu in the card's own corner. */
    .body { position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--pi-space-3) var(--pi-bar-inset) var(--pi-space-5); display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); align-content: start; gap: var(--pi-space-3); }
    @media (max-width: 430px) { .body { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); } }
    /* A chosen count replaces the width rule (listTiles.ts, owner 2026-10-06). */
    .body.tiles-1 { grid-template-columns: minmax(0, 1fr); }
    .body.tiles-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .section-title, .empty { grid-column: 1 / -1; }
    .row-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .row.folder-missing .row-name, .row.folder-missing .row-icon { color: var(--pi-muted); }
    .section-title { margin: var(--pi-space-5) 0 0; color: var(--pi-muted); font: var(--pi-text-2xs) var(--pi-font-ui); font-weight: var(--pi-weight-strong); letter-spacing: .08em; text-transform: uppercase; }
    /* A section title stands close to its own rows (owner, 2026-10-09: "the Pinned / Active
       margins are too tall"). The 44px coarse-pointer target no longer sets the box's height; a
       hit area reaches up over the margin and the grid gap above and down over the gap below,
       up to the neighbouring tiles but never onto them. */
    .section-toggle { position: relative; justify-self: start; display: inline-flex; align-items: center; gap: var(--pi-space-2); box-sizing: border-box; padding: var(--pi-space-3) var(--pi-space-2); border: 1px solid transparent; border-radius: var(--pi-radius-md); background: transparent; cursor: pointer; text-align: start; }
    .section-toggle::after { content: ""; position: absolute; inset: calc(-1 * var(--pi-space-7)) 0 calc(-1 * var(--pi-space-3)); }
    .section-toggle:focus-visible { border-color: var(--pi-accent); }
    .section-fold { display: inline-grid; place-items: center; width: 12px; height: 12px; }
    .section-empty { margin: 0 0 var(--pi-space-2); }
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

/** Each tap mode's action on the New session button. */
const CREATE_TAPS: Readonly<Record<SessionRowTap, (page: AppNavigatePage, target: EventTarget | null) => void>> = {
  open: (page, target) => { page.tapNewSession(target); },
  continue: (page) => { page.stopPicking(); },
};

/** Each tap mode's action on the tapped row. */
const ROW_TAPS: Readonly<Record<SessionRowTap, (page: AppNavigatePage, row: NavigateSessionRow) => void>> = {
  open: (page, row) => { page.onOpenSession?.(row.session, row.machineId); },
  continue: (page, row) => { page.onContinueFrom?.(row.session, row.machineId); },
};

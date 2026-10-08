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
import { renderChatIcon, renderChevronRightIcon, renderGearIcon, renderGridIcon, renderMachineIcon, renderPinIcon, renderProjectIcon, uiIconStyle } from "../uiIcons.js";
import { actionMenuStyles, interactiveSurfaceStyles } from "../shared";
import { switcherEmptyMeaning } from "../../switcherEmptyMeaning";
import type { BoardAnswer } from "../../sync/sessionBoard";
import { sessionStateBadgeStyles } from "../sessionStateBadgeStyles.js";
import { SESSION_STATE_LABELS } from "../activityBadge";
import { actionMenuPanelStyle } from "../actionMenu";
import { navigateRowActions, type NavigateRowActionId, type NavigateRowKind } from "../../navigateRowActions";
import { sessionLabel } from "../../sessionLabels";
import { machineSessionKey } from "../../machineKeys";
import type { PendingNavigation } from "../../navigationIntent";
import { isOpeningKey, openingMarkStyles, renderOpeningSpinner, renderOpeningWords } from "../openingMark";

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

@customElement("app-navigate-page")
export class AppNavigatePage extends LitElement {
  @property({ attribute: false }) input?: Omit<NavigateInput, "query">;
  @property({ attribute: false }) onChoose?: (level: NavigateLevel, id: string) => void;
  @property({ attribute: false }) onWiden?: (level: NavigateLevel) => void;
  @property({ attribute: false }) onOpenSession?: (session: SessionInfo, machineId: string) => void;
  /** The session the reader tapped and is waiting for; its row answers the tap (D8). */
  @property({ attribute: false }) opening: PendingNavigation | undefined = undefined;
  @property({ attribute: false }) onCreateSession?: () => void;
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
  @state() private query = "";
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

  override render() {
    const view = this.view;
    const input = this.input;
    if (view === undefined || input === undefined) return html`<p class="empty" role="status">Reading this machine…</p>`;
    const { listed, model, segments, choices } = view;
    const showsSessions = this.kind === "sessions";
    return html`
      <section class="navigate">
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
        <nav class="kinds" aria-label="What to list">
          ${segments.some((segment) => segment.level === "machine") ? this.renderKindTab("machine", "Machines", renderMachineIcon()) : nothing}
          ${this.renderKindTab("project", "Projects", renderProjectIcon())}
          ${this.renderKindTab("sessions", "Sessions", renderChatIcon())}
        </nav>
        ${showsSessions ? this.renderScopeSwitch(listed.projects, input.scope.projectId) : nothing}
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
    return this.renderRowShell(rowId, kind, choice.id, choice.label, html`
      <button
        type="button"
        class=${choice.current ? "row current" : "row"}
        title=${choice.detail ?? choice.label}
        @click=${() => {
          if (choice.level === "project") { this.pathProjectId = choice.id; this.lastProjectId = choice.id; }
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
    facts: { pinned?: boolean; projectPinned?: boolean | undefined; hasPath?: boolean; closable?: boolean; archived?: boolean; archivable?: boolean },
  ) {
    const actions = navigateRowActions(kind, {
      ...facts,
      renamable: kind === "session" && this.canRenameSession,
    });
    const open = this.openMenuRowId === rowId;
    return html`
      <div class=${open ? "row-wrap menu-open" : "row-wrap"} data-motion-key=${rowId}>
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
    return this.renderRowShell(sessionRowKey(row), "session", row.session.id, label, html`
      <button type="button" class=${`row session${row.current ? " current" : ""}${opening ? " opening" : ""}`} aria-current=${row.current ? "true" : "false"} aria-busy=${opening ? "true" : "false"} title=${label} @click=${() => { this.onOpenSession?.(row.session, row.machineId); }}>
        <span class="row-title"><span class="row-icon" data-kind="session">${renderChatIcon()}</span>${row.pinned ? html`<span class="pin" title="Pinned" aria-label="Pinned">${renderPinIcon()}</span>` : nothing}<span class="row-name">${label}</span>${opening ? renderOpeningSpinner() : renderNavigateStateMark(row.state)}</span>
        ${this.opening?.key === key && this.opening.phase !== "going" ? html`<span class="row-path">${renderOpeningWords(this.opening, key)}</span>` : row.path === "" ? nothing : html`<span class="row-path">${row.path}</span>`}
      </button>
    `, { pinned: row.pins.global, projectPinned: row.pins.project, archived: row.session.archived === true, archivable: this.canArchiveSessions && row.session.persisted !== false });
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


  static override styles = [css`${unsafeCSS(uiIconStyle)}`, css`${unsafeCSS(disclosureIconStyle)}`, interactiveSurfaceStyles, actionMenuStyles, sessionStateBadgeStyles, openingMarkStyles, css`
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
    .create.secondary { border-color: var(--pi-border); background: var(--pi-surface); color: var(--pi-text); }
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
    .section-title { margin: var(--pi-space-4) 0 var(--pi-space-1); color: var(--pi-muted); font: var(--pi-text-2xs) var(--pi-font-ui); font-weight: var(--pi-weight-strong); letter-spacing: .08em; text-transform: uppercase; }
    .section-toggle { justify-self: start; display: inline-flex; align-items: center; gap: var(--pi-space-2); box-sizing: border-box; min-height: var(--pi-control-height); padding: 0 var(--pi-space-2); border: 1px solid transparent; border-radius: var(--pi-radius-md); background: transparent; cursor: pointer; text-align: start; }
    .section-toggle:focus-visible { border-color: var(--pi-accent); }
    .section-fold { display: inline-grid; place-items: center; width: 12px; height: 12px; }
    .section-empty { margin: 0 0 var(--pi-space-2); }
    @media (pointer: coarse) { .section-toggle { min-height: var(--pi-control-height-touch, 44px); } }
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

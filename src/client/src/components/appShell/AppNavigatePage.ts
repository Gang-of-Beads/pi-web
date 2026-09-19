import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionInfo } from "../../api";
import { navigateModel, type NavigateChoice, type NavigateInput, type NavigateLevel, type NavigateSection, type NavigateSessionRow, type NavigateSessionState } from "../../navigateModel";
import { switcherBreadcrumb } from "../../switcherBreadcrumb";
import { createStableRowOrder } from "../../stableRowOrder";
import { renderChatIcon, renderChevronRightIcon, renderMachineIcon, renderProjectIcon, uiIconStyle } from "../uiIcons.js";
import { actionMenuStyles, interactiveSurfaceStyles } from "../shared";
import { switcherEmptyMeaning } from "../../switcherEmptyMeaning";
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

@customElement("app-navigate-page")
export class AppNavigatePage extends LitElement {
  @property({ attribute: false }) input?: Omit<NavigateInput, "query">;
  @property({ attribute: false }) onChoose?: (level: NavigateLevel, id: string) => void;
  @property({ attribute: false }) onWiden?: (level: NavigateLevel) => void;
  @property({ attribute: false }) onOpenSession?: (session: SessionInfo, machineId: string) => void;
  @property({ attribute: false }) onCreateSession?: () => void;
  @property({ attribute: false }) onAddProject?: () => void;
  @property({ attribute: false }) onClose?: () => void;
  /** What the row menu does; the page names the action, the host performs it. */
  @property({ attribute: false }) onRowAction?: (kind: NavigateRowKind, id: string, action: NavigateRowActionId) => void;
  @property({ attribute: false }) canRenameSession = false;
  @property({ attribute: false }) canCloseProject = false;
  /** What the host is still reading, so the page says "loading" instead of "none". */
  @property({ attribute: false }) loadingSessions = false;
  @property({ attribute: false }) loadingChoices = false;
  @property({ attribute: false }) loadError: string | undefined = undefined;
  /** Whether a session is open behind this page, which is what a close returns to. */
  @property({ type: Boolean }) closable = false;
  @state() private query = "";
  /** Live refreshes may not move a row under a thumb; see `stableRowOrder`. */
  private readonly rowOrder = createStableRowOrder<NavigateSessionRow>((row) => `${row.machineId}:${row.session.id}`);

  override disconnectedCallback(): void {
    this.rowOrder.release();
    super.disconnectedCallback();
  }

  /** Which kind of thing the page is listing; one page shows one kind. */
  @state() private kind: NavigateKind = "sessions";
  @state() private openMenuRowId: string | undefined = undefined;
  @state() private menuStyle = "";

  /** Open the page on one kind; the keyboard shortcuts name a kind, not a panel. */
  showKind(kind: NavigateKind): void {
    this.kind = kind;
  }

  override render() {
    const input = this.input;
    if (input === undefined) return html`<p class="empty" role="status">Reading this machine…</p>`;
    const model = navigateModel({ ...input, query: this.query });
    const segments = switcherBreadcrumb({
      machines: input.machines,
      machineId: input.scope.machineId,
      projects: input.projects,
      projectId: input.scope.projectId,
      folders: input.folders,
      folderPath: undefined,
    }).filter((segment) => segment.level !== "folder");
    const showsSessions = this.kind === "sessions";
    const choices = model.sections.flatMap((section) => section.choices).filter((choice) => choice.level === this.kind);
    return html`
      <section class="navigate">
        <header class="path-bar">
          <div class="path-row">
            ${segments.map((segment, index) => html`
              ${index === 0 ? nothing : html`<span class="path-sep">${renderChevronRightIcon()}</span>`}
              <button
                type="button"
                class=${segment.chosen ? "path-step chosen" : "path-step"}
                title=${segment.label}
                @click=${() => { if (segment.level === "folder") return; this.kind = segment.level; this.onWiden?.(segment.level); }}
              >${segment.label}</button>
            `)}
          </div>
          ${this.closable ? html`<button type="button" class="close" aria-label="Close navigation" @click=${() => { this.onClose?.(); }}>${renderChevronRightIcon()}</button>` : nothing}
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
        @click=${() => { this.onChoose?.(choice.level, choice.id); this.kind = "sessions"; }}
      >
        <span class="row-title"><span class="row-icon" data-kind=${choice.level}>${icon}</span>${choice.label}</span>
      </button>
    `, { hasPath: choice.detail !== undefined, closable: kind === "project" && this.canCloseProject });
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
      <div class="row-wrap">
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
          <div class="action-menu-panel" role="menu" style=${this.menuStyle}>
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
        <span class="row-title"><span class="row-icon" data-kind="session">${renderChatIcon()}</span>${row.pinned ? html`<span class="pin" aria-label="Pinned">•</span>` : nothing}<span class="row-name">${label}</span></span>
        <span class=${`state ${row.state}`} title=${STATE_LABEL[row.state]} aria-label=${STATE_LABEL[row.state]}></span>
      </button>
    `, { pinned: row.pinned });
  }


  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, actionMenuStyles, css`
    .row .row-title { flex: 1 1 auto; min-width: 0; }
    .row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row.session { display: flex; align-items: center; gap: var(--pi-space-3); }
    .state { flex: 0 0 auto; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; }
    .state.waiting { background: var(--pi-accent); }
    .state.working { background: var(--pi-success); }
    .state.idle { background: var(--pi-border); }
    /* One box, two things: the name on the left and the menu on the right
       live inside the same bordered row. The menu used to float outside the
       box, which read as a stray glyph beside the list. */
    .row-wrap { position: relative; box-sizing: border-box; display: flex; align-items: stretch; min-height: var(--pi-row-min-height, 48px); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); overflow: hidden; }
    .row-wrap:has(.row.current) { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .row-wrap .row { flex: 1 1 auto; min-width: 0; border: 0; border-radius: 0; background: transparent; }
    .row-wrap .action-menu-toggle { flex: 0 0 auto; border: 0; border-left: 1px solid var(--pi-border-muted); border-radius: 0; background: transparent; }

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
    .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--pi-space-3) var(--pi-bar-inset) var(--pi-space-5); display: flex; flex-direction: column; gap: var(--pi-space-2); }
    .section-title { margin: var(--pi-space-4) 0 var(--pi-space-1); color: var(--pi-muted); font: var(--pi-text-2xs) var(--pi-font-ui); font-weight: var(--pi-weight-strong); letter-spacing: .08em; text-transform: uppercase; }
    .row { box-sizing: border-box; display: grid; gap: 2px; width: 100%; min-height: var(--pi-row-min-height, 48px); padding: var(--pi-space-2) var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; text-align: start; cursor: pointer; }
    .row.current { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-detail { min-width: 0; display: flex; gap: var(--pi-space-3); overflow: hidden; color: var(--pi-muted); font-size: var(--pi-text-2xs); white-space: nowrap; }
    .pin { margin-right: var(--pi-space-2); color: var(--pi-accent); }
    .empty { margin: var(--pi-space-5) 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  `];
}


declare global {
  interface HTMLElementTagNameMap {
    "app-navigate-page": AppNavigatePage;
  }
}

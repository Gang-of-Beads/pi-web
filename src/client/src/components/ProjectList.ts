import { RowMenuGestures } from "./rowMenuGestures";
import { LitElement, css, html, type PropertyValues, nothing} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { filterProjects, shouldShowProjectSearch } from "../projectSearch";
import type { Project } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { actionMenuPanelStyle } from "./actionMenu";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles, interactiveSurfaceStyles } from "./shared";

@customElement("project-list")
export class ProjectList extends LitElement implements KeyboardNavigableSection {
  @property({ attribute: false }) projects: Project[] = [];
  /**
   * Whether the projects reaching this list have been loaded, and how the
   * latest load ended. `failed` is sticky: it says the latest refresh did not
   * complete, and it stays until a successful reload — a failure the banner
   * has retired must not read as "no projects".
   */
  @property({ attribute: false }) projectsLoad: "unloaded" | "loading" | "loaded" | "failed" = "unloaded";
  /** Ask the host to re-run the projects listing; wired to the Retry control. */
  @property({ attribute: false }) onRetryLoad?: () => void;
  @state() private searchQuery = "";
  /**
   * The panel hides sections with the `hidden` attribute rather than removing
   * them, so this element — and with it any query left in the search field —
   * survives a section switch. Watching the property lets the list retire
   * that query when it is hidden: reopening the section is a new task, and a
   * leftover filter silently hiding rows from it reads as projects vanishing.
   */
  @property({ type: Boolean, reflect: true })
  override hidden = false;

  @property({ attribute: false }) selected?: Project;
  /** Status tree of the machine these projects belong to; absent means no indicators. */
  @property({ attribute: false }) statusSnapshot: MachineStatusSnapshot | undefined;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  /** Render rows as a responsive tile grid instead of full-width rows. */
  @property({ type: Boolean }) tiles = false;
  /** Opens the add-project dialog; omitted where a create control would not belong. */
  @property({ attribute: false }) onAdd?: () => void;
  @property({ attribute: false }) onSelect?: (project: Project) => void;
  @property({ attribute: false }) onClose?: (project: Project) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  @state() private openMenuProjectId: string | undefined;
  private readonly gestures = new RowMenuGestures((id, anchor) => { this.openMenu(id, anchor); });
  @state() private menuStyle = "";
  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenuProjectId = undefined;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("projects") && this.openMenuProjectId !== undefined && !this.projects.some((project) => project.id === this.openMenuProjectId)) this.openMenuProjectId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuProjectId = undefined;
    if (changed.has("hidden") && this.hidden && this.searchQuery !== "") this.searchQuery = "";
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  override render() {
    const visible = filterProjects(this.projects, this.searchQuery);
    return html`
      <section>
        <h2>${this.renderHeading()}${this.renderAdd()}</h2>
        ${this.collapsed ? null : html`
          ${this.renderSearch()}
          <div class="list-body ${this.tiles ? "tiles" : ""}">
            ${visible.length === 0 && this.searchQuery.trim() !== ""
              ? html`<div class="search-empty" role="status">No projects match “${this.searchQuery.trim()}”.</div>`
              : null}
            ${visible.map((project) => html`
              <div
                class=${`action-row ${this.selected?.id === project.id ? "selected" : ""}`}
                title=${project.path}
                @keydown=${(event: KeyboardEvent) => { this.handleProjectKeydown(event, project); }}
              >
                <!-- The row's primary region is a real button: it is the thing
                     being activated, and the guidelines rule out a div with a
                     click handler. The row itself keeps no click or tabindex,
                     so the actions button beside it stays a sibling rather than
                     nesting inside another interactive element. -->
                <button
                  type="button"
                  class="action-main"
                  aria-current=${this.selected?.id === project.id ? "true" : nothing}
                  @click=${() => { if (!this.gestures.consumeSuppressedClick()) this.onSelect?.(project); }}
                  @contextmenu=${(event: MouseEvent) => { this.gestures.contextMenu(project.id, event); }}
                  @pointerdown=${(event: PointerEvent) => { this.gestures.pointerDown(project.id, event); }}
                  @pointermove=${(event: PointerEvent) => { this.gestures.pointerMove(event); }}
                  @pointerup=${() => { this.gestures.cancel(); }}
                  @pointercancel=${() => { this.gestures.cancel(); }}
                >
                  <span class="workspace-primary"><span class="workspace-primary-label">${project.name}</span></span><small>${project.path}</small>
                  ${this.renderActivity(project)}
                </button>
                <div class="action-menu">
                  <button class="action-menu-toggle" title="Project actions" aria-label=${`Actions for ${project.name}`} @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(project.id, event.currentTarget); }}>⋯</button>
                  ${this.openMenuProjectId === project.id ? html`
                    <div class="action-menu-panel" style=${this.menuStyle}>
                      <button title="Close project" @click=${() => { this.close(project); }}>Close</button>
                    </div>
                  ` : null}
                </div>
              </div>
            `)}
            ${this.renderFilterCount(visible.length)}
            ${this.renderListStatus()}
          </div>
        `}
      </section>
    `;
  }

  /**
   * A query that hides rows says so. The leftover query was the one producer
   * that could hide exactly one project while the others rendered — the list
   * looked complete and one entry was silently gone.
   */
  private renderFilterCount(visibleCount: number) {
    if (this.searchQuery.trim() === "" || visibleCount >= this.projects.length) return null;
    return html`<div class="filter-count" role="status">${String(visibleCount)} of ${String(this.projects.length)} projects shown</div>`;
  }

  /**
   * What the latest load did, under the rows. Rows are the last known truth
   * and render regardless; the empty claim may only follow a completed
   * listing that returned zero, and a failure names itself and offers Retry —
   * it must not look like an empty machine.
   */
  private renderListStatus() {
    if (this.projectsLoad === "failed") {
      return html`
        <div class="load-failed" role="alert">
          <span>Could not load projects.</span>
          <button class="load-retry" @click=${() => { this.onRetryLoad?.(); }}>Retry</button>
        </div>
      `;
    }
    if (this.searchQuery.trim() !== "") return null;
    if (this.projectsLoad === "loaded") {
      // A workspace list with no projects rendered nothing at all, reading as
      // a rendering bug rather than a state.
      return this.projects.length === 0 ? html`<div class="list-empty" role="status">No projects yet. Add one to start working here.</div>` : null;
    }
    return html`<div class="list-loading" role="status">Loading projects…</div>`;
  }

  private handleProjectKeydown(event: KeyboardEvent, project: Project): void {
    handleSelectableRowKeyboard(event, {
      activate: () => this.onSelect?.(project),
      previousSection: this.onFocusPreviousSection === undefined ? undefined : () => { void this.onFocusPreviousSection?.(); },
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  /**
   * The search field, shown once the list is long enough to be a nuisance to
   * scan and while a query is active so it can always be cleared.
   */
  private renderSearch() {
    if (!shouldShowProjectSearch(this.projects.length, this.searchQuery)) return null;
    const hasQuery = this.searchQuery !== "";
    return html`
      <div class="list-search">
        <input
          class="list-search-input"
          type="search"
          inputmode="search"
          autocomplete="off"
          spellcheck="false"
          enterkeyhint="search"
          aria-label="Search projects"
          placeholder="Search projects"
          .value=${this.searchQuery}
          @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.searchQuery = event.target.value; }}
          @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); this.searchQuery = ""; } }}
        >
        ${hasQuery ? html`<button class="list-search-clear" title="Clear search" aria-label="Clear search" @click=${() => { this.searchQuery = ""; }}>×</button>` : null}
      </div>
    `;
  }

  /**
   * The create control lives in this heading rather than in a row of its own.
   *
   * A separate bar above the list cost a fifth of a phone screen before any
   * content, and hiding it whenever a session could be started took the only
   * route to adding a project with it - on a machine you have just switched to,
   * which is exactly when you want to add one. The heading is already on
   * screen and already a flex row with a free trailing edge.
   */
  private renderAdd() {
    if (this.onAdd === undefined) return null;
    // Labelled, not a bare glyph: a lone "+" in a heading is the control
    // people ask for by saying it is missing.
    return html`<button class="section-add" title="Add project" aria-label="Add project" @click=${(event: Event) => { event.stopPropagation(); this.onAdd?.(); }}><span aria-hidden="true">+</span><span class="section-add-label">Add project</span></button>`;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>Projects</span>`;
    const selectedSummary = this.selected?.name ?? "No project selected";
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} Projects</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.projects.length}</small></button>`;
  }

  private renderActivity(project: Project) {
    const flags = this.statusSnapshot?.projects[project.id];
    const kind = statusActivityKind(flags);
    const unreadLabel = hasStatusUnread(flags) ? "Unread sessions in this project" : undefined;
    return renderActionActivityIndicator(kind, kind === "terminal" ? "Project terminal active" : "Project active", unreadLabel);
  }

  /** Open (never toggle): a hold or right-click always means "show me the menu". */
  private openMenu(projectId: string, target: EventTarget | null) {
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuProjectId = projectId;
  }

  private toggleMenu(projectId: string, target: EventTarget | null) {
    if (this.openMenuProjectId === projectId) {
      this.openMenuProjectId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuProjectId = projectId;
  }

  private close(project: Project) {
    this.openMenuProjectId = undefined;
    if (confirm(`Close ${project.name}?\n\nThis only removes it from PI WEB; it will not change the project folder.`)) this.onClose?.(project);
  }

  static override styles = [interactiveSurfaceStyles, listStyles, css`
    .list-empty, .list-loading { padding: var(--pi-space-6) var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .filter-count { padding: var(--pi-space-3) var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .load-failed { display: flex; align-items: center; gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-space-2); color: var(--pi-danger); font-size: var(--pi-text-sm); }
    .load-retry { min-height: 28px; padding: 0 var(--pi-space-4); font-size: var(--pi-text-xs); }
  `];
}

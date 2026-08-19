import { LitElement, html, type PropertyValues, nothing} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { filterProjects, shouldShowProjectSearch } from "../projectSearch";
import type { Project } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { actionMenuPanelStyle } from "./actionMenu";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";

@customElement("project-list")
export class ProjectList extends LitElement implements KeyboardNavigableSection {
  @property({ attribute: false }) projects: Project[] = [];
  @state() private searchQuery = "";
  @property({ attribute: false }) selected?: Project;
  /** Status tree of the machine these projects belong to; absent means no indicators. */
  @property({ attribute: false }) statusSnapshot: MachineStatusSnapshot | undefined;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  /** Render rows as a responsive tile grid instead of full-width rows. */
  @property({ type: Boolean }) tiles = false;
  @property({ attribute: false }) onSelect?: (project: Project) => void;
  @property({ attribute: false }) onClose?: (project: Project) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  @state() private openMenuProjectId: string | undefined;
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
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  override render() {
    const visible = filterProjects(this.projects, this.searchQuery);
    return html`
      <section>
        <h2>${this.renderHeading()}</h2>
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
                  @click=${() => { this.onSelect?.(project); }}
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
          </div>
        `}
      </section>
    `;
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

  static override styles = listStyles;
}

import { RowMenuGestures } from "./rowMenuGestures";
import { filterWorkspaces, shouldShowContextSearch } from "./contextSearch";
import { LitElement, css, html, type PropertyValues, type TemplateResult, nothing} from "lit";import { property, state } from "lit/decorators.js";
import type { Workspace, WorkspaceLabelItem, NavStatusSnapshot } from "@gang-of-beads/pi-web/plugin-api";
import { writeClipboardText } from "./clipboard";
import { actionMenuPanelStyle } from "./actionMenu";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { renderHostCloseIcon, renderHostDisclosureIcon, adoptWorkspacesHostStyles } from "./hostUi";
import { renderWorkspaceLabelInlineItems } from "./workspaceLabel";
import { TrustToggles, menuDomId, trustToggleStyles, type TrustActions } from "./trustToggle";

/** Removal availability comes from the owner snapshot, never Git fields. */
function canDeleteWorkspace(workspace: Workspace): boolean {
  return workspace.removal !== undefined && !workspace.isMain;
}

export class WorkspaceList extends LitElement implements KeyboardNavigableSection {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptWorkspacesHostStyles(root);
    return root;
  }

  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property({ attribute: false }) workspacesLoad: "unloaded" | "loading" | "loaded" | "failed" = "unloaded";
  @property({ attribute: false }) selected?: Workspace;
  /**
   * The panel hides sections with the `hidden` attribute rather than removing
   * them, so this element — and with it any query left in the search field —
   * survives a section switch. Watching the property lets the list retire
   * that query when it is hidden: reopening the section is a new task, and a
   * leftover filter silently hiding rows from it reads as workspaces vanishing.
   */
  @property({ type: Boolean, reflect: true })
  override hidden = false;
  /** Host-provided trust reads and writes; absent means the menu omits trust. */
  @property({ attribute: false }) workspaceTrust?: TrustActions;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  /** Render rows as a responsive tile grid instead of full-width rows. */
  @property({ type: Boolean }) tiles = false;
  /** What the reader has typed to narrow a long list of worktrees. */
  @state() private searchQuery = "";
  @property({ attribute: false }) workspaceLabelItems: (workspace: Workspace) => WorkspaceLabelItem[] = () => [];
  /** Status tree of the machine these workspaces belong to; absent means no indicators. */
  @property({ attribute: false }) statusSnapshot: NavStatusSnapshot | undefined;
  @property({ attribute: false }) deletingWorkspaceIds: string[] = [];
  @property({ attribute: false }) onSelect?: (workspace: Workspace) => void;
  @property({ attribute: false }) onDelete?: (workspace: Workspace) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  @state() private openMenuWorkspaceId: string | undefined;
  private readonly gestures = new RowMenuGestures((id, anchor) => { this.openMenu(id, anchor); });
  @state() private menuStyle = "";
  @state() private copiedDetailKey: string | undefined;
  private readonly trust = new TrustToggles(this, () => this.workspaceTrust);

  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenuWorkspaceId = undefined;
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
    if (changed.has("workspaces") && this.openMenuWorkspaceId !== undefined && !this.workspaces.some((workspace) => workspace.id === this.openMenuWorkspaceId)) this.openMenuWorkspaceId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuWorkspaceId = undefined;
    if (changed.has("hidden") && this.hidden && this.searchQuery !== "") this.searchQuery = "";
    if (this.shouldRevealSelectedRow(changed)) this.scrollSelectedIntoView();
  }

  /**
   * Positive reveal triggers only: topology refreshes replace `workspaces`
   * with a new array for the same selection and must never re-scroll. Reveal
   * the selected row only when the selection moves to a different row (first
   * render with a selection included) or when the section expands.
   */
  private shouldRevealSelectedRow(changed: PropertyValues<this>): boolean {
    if (this.collapsed) return false;
    if (changed.has("collapsed")) return true;
    return changed.has("selected") && changed.get("selected")?.id !== this.selected?.id;
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  /**
   * The search field, shown once the list is long enough to be a nuisance to
   * scan and while a query is active so it can always be cleared.
   *
   * A project with dozens of worktrees is the case this exists for: branch
   * names differ in the middle, so scrolling past them reads every one.
   */
  private renderSearch() {
    if (!shouldShowContextSearch(this.workspaces.length, this.searchQuery)) return null;
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
          aria-label="Search workspaces"
          placeholder="Search workspaces"
          .value=${this.searchQuery}
          @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.searchQuery = event.target.value; }}
          @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); this.searchQuery = ""; } }}
        >
        ${hasQuery ? html`<button class="list-search-clear" title="Clear search" aria-label="Clear search" @click=${() => { this.searchQuery = ""; }}>${renderHostCloseIcon()}</button>` : null}
      </div>
    `;
  }

  override render() {
    return html`
      <section>
        <h2>${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          ${this.renderSearch()}
          <div class="list-body ${this.tiles ? "tiles" : ""}">
            ${this.renderWorkspaceRows()}
          </div>
        `}
      </section>
    `;
  }

  private renderWorkspaceRows(): TemplateResult | TemplateResult[] {
    const matching = filterWorkspaces(this.workspaces, this.searchQuery);
    if (matching.length > 0) {
      return matching.map((workspace) => {
        const label = workspacePrimaryLabel(workspace);
        const items = this.workspaceLabelItems(workspace);
        return html`
          <div
            class=${`action-row workspace-row ${this.selected?.id === workspace.id ? "selected" : ""}`}
            title=${label}
            @keydown=${(event: KeyboardEvent) => { this.handleWorkspaceKeydown(event, workspace); }}
          >
            ${workspace.cwdMissing === true
              ? html`<div class="action-main cwd-missing-row" title=${workspace.path}>${this.renderWorkspaceMain(label, items, workspace)}</div>`
              : html`<button
              type="button"
              class="action-main"
              aria-current=${this.selected?.id === workspace.id ? "true" : nothing}
              @click=${() => { if (!this.gestures.consumeSuppressedClick()) this.onSelect?.(workspace); }}
              @contextmenu=${(event: MouseEvent) => { this.gestures.contextMenu(workspace.id, event); }}
              @pointerdown=${(event: PointerEvent) => { this.gestures.pointerDown(workspace.id, event); }}
              @pointermove=${(event: PointerEvent) => { this.gestures.pointerMove(event); }}
              @pointerup=${() => { this.gestures.cancel(); }}
              @pointercancel=${() => { this.gestures.cancel(); }}
            >
              ${this.renderWorkspaceMain(label, items, workspace)}
            </button>`}
            ${this.renderWorkspaceMenu(label, items, workspace)}
          </div>
        `;
      });
    }
    if (this.searchQuery.trim() !== "") {
      return html`<div class="empty-claim" role="status">No workspaces match “${this.searchQuery.trim()}”.</div>`;
    }
    if (this.workspacesLoad !== "loaded") return html``;
    return html`<div class="empty-claim" role="status">No workspaces here yet.</div>`;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>Workspaces</span>`;
    const selectedSummary = this.selected === undefined ? "No workspace selected" : `${this.selected.label}${this.selected.isMain ? " · main" : ""} · ${this.selected.path}`;
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${renderHostDisclosureIcon(this.collapsed)} Workspaces</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.workspaces.length}</small></button>`;
  }

  private renderActivity(workspace: Workspace): TemplateResult | undefined {
    const flags = this.statusSnapshot?.workspaces[workspace.id];
    const kind = statusActivityKind(flags);
    const unreadLabel = hasStatusUnread(flags) ? "Unread sessions in this workspace" : undefined;
    return renderActionActivityIndicator(kind, kind === "terminal" ? "Workspace terminal active" : "Workspace active", unreadLabel);
  }

  private renderWorkspaceMain(label: string, items: WorkspaceLabelItem[], workspace: Workspace): TemplateResult {
    return html`
      <span class="workspace-primary">
        <span class="workspace-primary-label">${label}</span>
        ${workspace.cwdMissing === true ? html`<span class="workspace-status">folder gone</span>` : null}
        ${this.isDeleting(workspace) ? html`<span class="workspace-status">Deleting…</span>` : null}
      </span>
      ${items.length === 0 ? null : html`
        <small class="workspace-secondary">
          <span class="workspace-label">${renderWorkspaceLabelInlineItems(items)}</span>
        </small>
      `}
      ${this.renderActivity(workspace)}
    `;
  }

  private renderWorkspaceMenu(label: string, items: WorkspaceLabelItem[], workspace: Workspace): TemplateResult {
    const open = this.openMenuWorkspaceId === workspace.id;
    const menuId = workspaceMenuId(workspace.id);
    return html`
      <div class="action-menu">
        <button
          class="action-menu-toggle"
          title="Workspace actions and details"
          aria-label=${`Actions and details for ${label}`}
          aria-expanded=${String(open)}
          aria-controls=${menuId}
          @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(workspace.id, event.currentTarget); }}
        >⋯</button>
        ${open ? html`
          <div class="action-menu-panel workspace-menu-panel" id=${menuId} style=${this.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            ${this.renderWorkspaceActions(workspace)}
            ${this.renderWorkspaceDetails(label, items, workspace)}
          </div>
        ` : null}
      </div>
    `;
  }

  private renderWorkspaceActions(workspace: Workspace): TemplateResult {
    const deleting = this.isDeleting(workspace);
    const actionLabel = workspace.removal?.actionLabel ?? "Remove workspace";
    return html`
      <div class="workspace-menu-actions">
        ${this.trust.render(workspace.id, `${workspaceMenuId(workspace.id)}-trusted`)}
        ${canDeleteWorkspace(workspace) ? html`
          <button class="danger" title=${deleting ? "Workspace removal in progress" : actionLabel} ?disabled=${deleting} @click=${() => { this.delete(workspace); }}>${deleting ? "Removing…" : actionLabel}</button>
        ` : null}
      </div>
    `;
  }

  private renderWorkspaceDetails(label: string, items: WorkspaceLabelItem[], workspace: Workspace): TemplateResult {
    return html`
      <dl class="workspace-menu-details">
        <div class="workspace-detail-row">
          <dt>Workspace</dt>
          <dd>${label}${this.renderDetailCopyButton(`${workspace.id}:label`, workspace.label, "Copy workspace label")}</dd>
        </div>
        <div class="workspace-detail-row">
          <dt>Path</dt>
          <dd title=${workspace.path}>${workspace.path}${this.renderDetailCopyButton(`${workspace.id}:path`, workspace.path, "Copy path")}</dd>
        </div>
        ${items.length === 0 ? null : html`
          <div class="workspace-detail-row">
            <dt>Details</dt>
            <dd><span class="workspace-label">${renderWorkspaceLabelInlineItems(items)}</span></dd>
          </div>
        `}
      </dl>
    `;
  }

  private renderDetailCopyButton(key: string, value: string, action: string): TemplateResult {
    const copied = this.copiedDetailKey === key;
    const label = copied ? "Copied" : action;
    return html`
      <button type="button" class="detail-copy" title=${label} aria-label=${label} @click=${() => { void this.copyDetail(key, value); }}>
        <span aria-hidden="true">${copied
          ? html`<svg class="row-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"></path></svg>`
          : html`<svg class="row-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path></svg>`}</span>
      </button>
    `;
  }

  private async copyDetail(key: string, value: string): Promise<void> {
    const copied = await writeClipboardText(value);
    if (!copied) return;
    this.copiedDetailKey = key;
    window.setTimeout(() => {
      if (this.copiedDetailKey === key) this.copiedDetailKey = undefined;
    }, 1200);
  }

  private delete(workspace: Workspace): void {
    if (this.isDeleting(workspace)) return;
    this.openMenuWorkspaceId = undefined;
    this.onDelete?.(workspace);
  }

  private isDeleting(workspace: Workspace): boolean {
    return this.deletingWorkspaceIds.includes(workspace.id);
  }

  /** Open (never toggle): a hold or right-click always means "show me the menu". */
  private openMenu(workspaceId: string, target: EventTarget | null) {
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuWorkspaceId = workspaceId;
    void this.trust.load(workspaceId);
  }

  private toggleMenu(workspaceId: string, target: EventTarget | null): void {
    if (this.openMenuWorkspaceId === workspaceId) {
      this.openMenuWorkspaceId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuWorkspaceId = workspaceId;
    void this.trust.load(workspaceId);
  }

  private handleWorkspaceKeydown(event: KeyboardEvent, workspace: Workspace): void {
    if (event.key === "Escape" && this.openMenuWorkspaceId === workspace.id) {
      event.preventDefault();
      event.stopPropagation();
      this.openMenuWorkspaceId = undefined;
      return;
    }
    handleSelectableRowKeyboard(event, {
      activate: () => this.onSelect?.(workspace),
      previousSection: this.onFocusPreviousSection === undefined ? undefined : () => { void this.onFocusPreviousSection?.(); },
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  private scrollSelectedIntoView(): void {
    this.renderRoot.querySelector<HTMLElement>(".action-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  static override styles = [css`
    /* The copy/path marks are viewBox-only svgs; without a size they resolve
     * to the 300x150 default object and paint stray strokes across the menu
     * (the owner's 'empty bordered boxes' screenshot). */
    .row-mark { width: 12px; height: 12px; }
    .empty-claim { padding: var(--pi-space-6) var(--pi-space-2); color: var(--pi-muted); }
  `, trustToggleStyles];
}

function workspacePrimaryLabel(workspace: Workspace): string {
  return `${workspace.label}${workspace.isMain ? " · main" : ""}`;
}

function workspaceMenuId(workspaceId: string): string {
  return menuDomId("workspace-menu", workspaceId);
}

if (customElements.get("workspace-list") === undefined) customElements.define("workspace-list", WorkspaceList);

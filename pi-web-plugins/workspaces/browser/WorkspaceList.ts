import { RowMenuGestures } from "./rowMenuGestures";
import { filterWorkspaces, shouldShowContextSearch } from "./contextSearch";
import { LitElement, css, html, type PropertyValues, type TemplateResult, nothing} from "lit";import { customElement, property, state } from "lit/decorators.js";
import type { Workspace, WorkspaceLabelItem, NavStatusSnapshot } from "@gang-of-beads/pi-web/plugin-api";
import { writeClipboardText } from "./clipboard";
import { actionMenuPanelStyle } from "./actionMenu";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { renderHostDisclosureIcon, adoptWorkspacesHostStyles } from "./hostUi";
import { renderWorkspaceLabelInlineItems } from "./workspaceLabel";
import { describeError } from "./errors";

interface WorkspaceTrustState {
  loading?: boolean;
  saving?: boolean;
  trusted?: boolean;
  error?: string;
}

/** Host-provided trust reads and writes for the listed workspaces. */
export interface WorkspaceTrustActions {
  get(workspaceId: string): Promise<{ trusted: boolean }>;
  set(workspaceId: string, trusted: boolean): Promise<{ trusted: boolean }>;
}

/** Removal availability comes from the owner snapshot, never Git fields. */
function canDeleteWorkspace(workspace: Workspace): boolean {
  return workspace.removal !== undefined && !workspace.isMain;
}

@customElement("workspace-list")
export class WorkspaceList extends LitElement implements KeyboardNavigableSection {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptWorkspacesHostStyles(root);
    return root;
  }

  @property({ attribute: false }) workspaces: Workspace[] = [];
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
  @property({ attribute: false }) workspaceTrust?: WorkspaceTrustActions;
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
  @state() private trustByWorkspaceId: Record<string, WorkspaceTrustState> = {};

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
        ${hasQuery ? html`<button class="list-search-clear" title="Clear search" aria-label="Clear search" @click=${() => { this.searchQuery = ""; }}>×</button>` : null}
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
            <button
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
            </button>
            ${this.renderWorkspaceMenu(label, items, workspace)}
          </div>
        `;
      });
    }
    if (this.searchQuery.trim() !== "") {
      return html`<div class="empty-claim" role="status">No workspaces match “${this.searchQuery.trim()}”.</div>`;
    }
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
        ${this.renderTrustToggle(workspace)}
        ${canDeleteWorkspace(workspace) ? html`
          <button class="danger" title=${deleting ? "Workspace removal in progress" : actionLabel} ?disabled=${deleting} @click=${() => { this.delete(workspace); }}>${deleting ? "Removing…" : actionLabel}</button>
        ` : null}
      </div>
    `;
  }

  private renderTrustToggle(workspace: Workspace): TemplateResult {
    const trust = this.trustByWorkspaceId[workspace.id];
    const busy = trust?.loading === true || trust?.saving === true;
    const inputId = `${workspaceMenuId(workspace.id)}-trusted`;
    return html`
      <div class="workspace-menu-trust">
        <div class="workspace-menu-trust-row">
          <label for=${inputId}>
            <input
              id=${inputId}
              type="checkbox"
              .checked=${trust?.trusted === true}
              ?disabled=${busy || trust?.trusted === undefined}
              @change=${(event: Event) => { if (event.target instanceof HTMLInputElement) void this.setTrust(workspace, event.target.checked); }}
            />
            <span>Trusted${busy ? "…" : ""}</span>
          </label>
          <a class="workspace-trust-link" href="https://pi.dev/docs/latest/security" target="_blank" rel="noreferrer">Learn about project trust</a>
        </div>
        ${trust?.error === undefined ? null : html`<small class="workspace-trust-error">${trust.error}</small>`}
      </div>
    `;
  }

  /** Fields worth carrying across a loading/saving transition, minus any prior error. */
  private trustBase(state: WorkspaceTrustState | undefined): WorkspaceTrustState {
    return {
      ...(state?.trusted === undefined ? {} : { trusted: state.trusted }),
    };
  }

  private setTrustState(workspaceId: string, state: WorkspaceTrustState): void {
    this.trustByWorkspaceId = { ...this.trustByWorkspaceId, [workspaceId]: state };
  }

  private async loadTrust(workspace: Workspace): Promise<void> {
    const existing = this.trustByWorkspaceId[workspace.id];
    if (existing?.loading === true || existing?.saving === true) return;
    this.setTrustState(workspace.id, { ...this.trustBase(existing), loading: true });
    try {
      if (this.workspaceTrust === undefined) throw new Error("Trust is not available here");
      const result = await this.workspaceTrust.get(workspace.id);
      this.setTrustState(workspace.id, { trusted: result.trusted });
    } catch (error) {
      this.setTrustState(workspace.id, { error: describeError(error) });
    }
  }

  private async setTrust(workspace: Workspace, trusted: boolean): Promise<void> {
    const existing = this.trustByWorkspaceId[workspace.id];
    this.setTrustState(workspace.id, { ...this.trustBase(existing), saving: true });
    try {
      if (this.workspaceTrust === undefined) throw new Error("Trust is not available here");
      const result = await this.workspaceTrust.set(workspace.id, trusted);
      this.setTrustState(workspace.id, { trusted: result.trusted });
    } catch (error) {
      // Keep the prior checkbox value (revert the optimistic flip) and surface why.
      this.setTrustState(workspace.id, { ...this.trustBase(existing), error: describeError(error) });
    }
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
        <span aria-hidden="true">${copied ? "✓" : "⧉"}</span>
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
  }

  private toggleMenu(workspaceId: string, target: EventTarget | null): void {
    if (this.openMenuWorkspaceId === workspaceId) {
      this.openMenuWorkspaceId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuWorkspaceId = workspaceId;
    const workspace = this.workspaces.find((candidate) => candidate.id === workspaceId);
    if (workspace !== undefined) void this.loadTrust(workspace);
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
    .empty-claim { padding: var(--pi-space-6) var(--pi-space-2); color: var(--pi-muted); }
    .workspace-menu-trust { display: flex; flex-direction: column; gap: var(--pi-space-2); padding: var(--pi-space-2) var(--pi-space-1); }
    .workspace-menu-trust-row { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); }
    .workspace-menu-trust label { display: flex; align-items: center; gap: var(--pi-space-3); cursor: pointer; }
    .workspace-menu-trust input { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0; accent-color: var(--pi-accent); cursor: pointer; }
    .workspace-trust-link { display: inline-flex; align-items: center; min-height: var(--pi-control-height); color: var(--pi-accent); font-size: var(--pi-text-xs); text-align: right; white-space: nowrap; }
    .workspace-trust-error { color: var(--pi-danger, #c0392b); line-height: 1.3; }
  `];
}

function workspacePrimaryLabel(workspace: Workspace): string {
  return `${workspace.label}${workspace.isMain ? " · main" : ""}`;
}

function workspaceMenuId(workspaceId: string): string {
  return `workspace-menu-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

import { RowMenuGestures } from "./rowMenuGestures";
import { filterMachines, shouldShowContextSearch } from "./contextSearch";
import { LitElement, css, html, type PropertyValues, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { NavMachineSnapshot } from "@gang-of-beads/pi-web/plugin-api";
import { actionMenuPanelStyle } from "./actionMenu";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { renderHostCloseIcon, renderHostDisclosureIcon, adoptMachinesHostStyles } from "./hostUi";

/**
 * The machine fleet as a row list. Every machine the host feeds in is a plain
 * snapshot with its health folded into `status`, so the list never calls a PI
 * WEB API and never spells a URL; the row menu offers exactly the actions the
 * section context says the host provides.
 */
@customElement("machine-list")
export class MachineList extends LitElement implements KeyboardNavigableSection {
  @property({ attribute: false }) machines: NavMachineSnapshot[] = [];
  /** What the reader has typed to narrow a long fleet. */
  @state() private searchQuery = "";
  @property({ attribute: false }) selectedMachineId?: string;
  @property({ attribute: false }) machineFlags: Readonly<Record<string, NavStatusFlagsShape>> = {};
  /** Hidden sections retire their query: reopening is a new task, and a
     leftover filter silently hiding rows reads as machines vanishing. The
     same rule ProjectList and WorkspaceList already run. */
  @property({ type: Boolean, reflect: true })
  override hidden = false;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) onSelect?: (machineId: string) => void;
  @property({ attribute: false }) onRemove?: (machineId: string) => void | Promise<void>;
  /** Rename any machine, local included: the local one is a display alias. */
  @property({ attribute: false }) onRename?: (machineId: string, name: string) => void | Promise<void>;
  /** Re-check one machine's health; previously palette-only. */
  @property({ attribute: false }) onRefresh?: (machineId: string) => void | Promise<void>;
  /** Open a remote machine's own PI WEB; previously palette-only. */
  @property({ attribute: false }) onOpen?: (machineId: string) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  /** Add a machine from the list itself, not only from Settings. */
  @property({ attribute: false }) onAdd?: () => void;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  @state() private openMenuMachineId: string | undefined;
  private readonly gestures = new RowMenuGestures((id, anchor) => { this.openMenu(id, anchor); });
  @state() private menuStyle = "";

  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenuMachineId = undefined;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptMachinesHostStyles(root);
    return root;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("machines") && this.openMenuMachineId !== undefined && !this.machines.some((machine) => machine.id === this.openMenuMachineId)) this.openMenuMachineId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuMachineId = undefined;
    if (changed.has("hidden") && this.hidden && this.searchQuery !== "") this.searchQuery = "";
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  private machineById(machineId: string): NavMachineSnapshot | undefined {
    return this.machines.find((machine) => machine.id === machineId);
  }

  /** Shown once the fleet is long enough to scan, and while a query is active. */
  private renderSearch() {
    if (!shouldShowContextSearch(this.machines.length, this.searchQuery)) return null;
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
          aria-label="Search machines"
          placeholder="Search machines"
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
        <h2>${this.renderHeading()}${this.renderAdd()}</h2>
        ${this.collapsed ? null : html`
          ${this.renderSearch()}
          <div class="list-body">
            ${filterMachines(this.machines, this.searchQuery).map((machine) => this.renderMachine(machine))}
          </div>
        `}
      </section>
    `;
  }

  private renderMachine(machine: NavMachineSnapshot) {
    const status = machine.status;
    const statusLabel = machineStatusLabel(status);
    // The local machine used to have no menu at all, so its rename lived only
    // in a settings panel nobody found. Any machine with at least one action
    // gets the same menu affordance.
    const hasActions = machineRowActions(machine, { remove: this.onRemove !== undefined, rename: this.onRename !== undefined, refresh: this.onRefresh !== undefined, open: this.onOpen !== undefined }).length > 0;
    return html`
      <div
        class=${`action-row machine-row ${this.selectedMachineId === machine.id ? "selected" : ""} ${hasActions ? "" : "no-actions"}`}
        title=${machine.baseUrl ?? machine.name}
        @keydown=${(event: KeyboardEvent) => { this.handleMachineKeydown(event, machine); }}
      >
        <button
          type="button"
          class="action-main"
          aria-current=${this.selectedMachineId === machine.id ? "true" : nothing}
          @click=${() => { if (!this.gestures.consumeSuppressedClick()) this.onSelect?.(machine.id); }}
          @contextmenu=${(event: MouseEvent) => { this.gestures.contextMenu(machine.id, event); }}
          @pointerdown=${(event: PointerEvent) => { this.gestures.pointerDown(machine.id, event); }}
          @pointermove=${(event: PointerEvent) => { this.gestures.pointerMove(event); }}
          @pointerup=${() => { this.gestures.cancel(); }}
          @pointercancel=${() => { this.gestures.cancel(); }}
        >
          <span class="action-name machine-primary"><span class="machine-primary-label">${machine.name}</span></span><small>${machine.kind === "local" ? "Local Pi Web" : machine.baseUrl ?? "Remote Pi Web"}</small><span class=${`machine-status ${status}`}>${statusLabel}</span>
          ${this.renderActivity(machine)}
        </button>
        ${hasActions ? this.renderMachineMenu(machine) : null}
      </div>
    `;
  }

  private renderActivity(machine: NavMachineSnapshot) {
    const flags = this.machineFlags[machine.id];
    // Unread survives offline: an offline machine keeps its last-known unread
    // state (stale-but-present still counts), so only the work dot is gated.
    const kind = machine.status === "offline" || machine.status === "error" ? undefined : statusActivityKind(flags);
    const unreadLabel = hasStatusUnread(flags) ? "Unread sessions on this machine" : undefined;
    return renderActionActivityIndicator(kind, kind === "terminal" ? "Machine terminal active" : "Machine active", unreadLabel);
  }

  private renderMachineMenu(machine: NavMachineSnapshot) {
    const open = this.openMenuMachineId === machine.id;
    const menuId = machineMenuId(machine.id);
    return html`
      <div class="action-menu">
        <button
          class="action-menu-toggle"
          title="Machine actions"
          aria-label=${`Actions for ${machine.name}`}
          aria-expanded=${String(open)}
          aria-controls=${menuId}
          @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(machine.id, event.currentTarget); }}
        >⋯</button>
        ${open ? html`
          <div class="action-menu-panel machine-menu-panel" id=${menuId} style=${this.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            ${this.onRefresh === undefined ? null : html`<button title=${`Check ${machine.name} again`} @click=${() => { this.openMenuMachineId = undefined; void this.onRefresh?.(machine.id); }}>Check again</button>`}
            ${this.onRename === undefined ? null : html`<button title=${machine.kind === "local" ? "Rename this device (display name only)" : `Rename ${machine.name}`} @click=${() => { this.promptRename(machine); }}>Rename…</button>`}
            ${this.onOpen === undefined || machine.kind !== "remote" ? null : html`<button title=${`Open ${machine.name} in a new tab`} @click=${() => { this.openMenuMachineId = undefined; this.onOpen?.(machine.id); }}>Open PI WEB</button>`}
            ${canRemoveMachine(machine) && this.onRemove !== undefined ? html`<button class="danger" title=${`Remove ${machine.name}`} @click=${() => { this.removeMachine(machine); }}>Remove</button>` : null}
          </div>
        ` : null}
      </div>
    `;
  }

  /**
   * The create control lives in the heading, like the projects list.
   *
   * On a phone a heading that is only a word is hidden (the context row
   * already names the step), so a bare "Machines" heading disappeared and took
   * the only non-Settings route to adding a machine with it.
   */
  private renderAdd() {
    if (this.onAdd === undefined) return null;
    return html`<button class="section-add" title="Add machine" aria-label="Add machine" @click=${(event: Event) => { event.stopPropagation(); this.onAdd?.(); }}><span class="section-add-glyph" aria-hidden="true">+</span><span class="section-add-label">Add machine</span></button>`;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>Machines</span>`;
    const selected = this.selectedMachineId === undefined ? undefined : this.machineById(this.selectedMachineId);
    const selectedSummary = selected?.name ?? "No machine selected";
    const selectedTitle = selected?.baseUrl ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${renderHostDisclosureIcon(this.collapsed)} Machines</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.machines.length}</small></button>`;
  }

  /** Open (never toggle): a hold or right-click always means "show me the menu". */
  private openMenu(machineId: string, target: EventTarget | null): void {
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuMachineId = machineId;
  }

  private toggleMenu(machineId: string, target: EventTarget | null): void {
    if (this.openMenuMachineId === machineId) {
      this.openMenuMachineId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuMachineId = machineId;
  }

  /**
   * Seeded with the current name so a rename edits rather than retypes, and
   * Cancel or an unchanged answer cannot clear a name by accident (mirrors the
   * session list's rename).
   */
  private promptRename(machine: NavMachineSnapshot): void {
    this.openMenuMachineId = undefined;
    const next = prompt(machine.kind === "local" ? "Name for this device:" : `Name for ${machine.name}:`, machine.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === machine.name) return;
    void this.onRename?.(machine.id, trimmed);
  }

  private removeMachine(machine: NavMachineSnapshot): void {
    this.openMenuMachineId = undefined;
    void this.onRemove?.(machine.id);
  }

  private handleMachineKeydown(event: KeyboardEvent, machine: NavMachineSnapshot): void {
    if (event.key === "Escape" && this.openMenuMachineId === machine.id) {
      event.preventDefault();
      event.stopPropagation();
      this.openMenuMachineId = undefined;
      return;
    }
    handleSelectableRowKeyboard(event, {
      activate: () => this.onSelect?.(machine.id),
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  static override styles = css`
    :host { display: block; min-width: 0; }
    .machine-row { border-radius: var(--pi-radius-lg); }
    .machine-row.no-actions .action-main { border-radius: var(--pi-radius-lg); }
    /* The same mark-plus-word the session rows use: a state a person acts on is not
       prose welded to an address, and offline must not read like online. */
    .machine-status { flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .machine-status::before { content: ""; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: currentColor; }
    .machine-status.online { color: var(--pi-success); }
    .machine-status.offline, .machine-status.error { color: var(--pi-danger); }
    .machine-row .action-main { min-height: var(--pi-row-min-height); align-content: center; }
    /* white-space completes the ellipsis trio its workspace sibling has; without it the adopted -webkit-box clamp wraps long names mid-word. */
    .machine-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .machine-menu-panel button.danger { color: var(--pi-danger); }
    .machine-menu-panel button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
    @media (hover: hover) { .machine-menu-panel button.danger:hover { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); } }
  `;
}

/** The machine-level flag map the host folds into the section context. */
type NavStatusFlagsShape = Readonly<Record<string, boolean>>;

export function canRemoveMachine(machine: Pick<NavMachineSnapshot, "kind">): boolean {
  return machine.kind === "remote";
}

/**
 * Which row-menu actions a machine actually offers, so the menu button appears
 * exactly when there is something behind it.
 */
export function machineRowActions(machine: Pick<NavMachineSnapshot, "kind">, available: { remove: boolean; rename: boolean; refresh: boolean; open: boolean }): string[] {
  const actions: string[] = [];
  if (available.refresh) actions.push("refresh");
  if (available.rename) actions.push("rename");
  if (available.open && machine.kind === "remote") actions.push("open");
  if (available.remove && canRemoveMachine(machine)) actions.push("remove");
  return actions;
}

export function machineStatusLabel(status: NavMachineSnapshot["status"]): string {
  return status === "online" ? "online" : status === "offline" ? "offline" : status === "error" ? "error" : "unknown";
}

function machineMenuId(machineId: string): string {
  return `machine-menu-${machineId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

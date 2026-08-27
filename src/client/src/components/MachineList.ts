import { RowMenuGestures } from "./rowMenuGestures";
import { filterMachines, shouldShowContextSearch } from "../contextSearch";
import { LitElement, css, html, type PropertyValues, nothing} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Machine, MachineHealth } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { actionMenuPanelStyle } from "./actionMenu";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";

@customElement("machine-list")
export class MachineList extends LitElement implements KeyboardNavigableSection {
  @property({ attribute: false }) machines: Machine[] = [];
  /** What the reader has typed to narrow a long fleet. */
  @state() private searchQuery = "";
  @property({ attribute: false }) selected?: Machine;
  @property({ attribute: false }) statuses: Record<string, MachineHealth> = {};
  /** Per-machine status trees, keyed by machine id; a machine without one shows no indicator. */
  @property({ attribute: false }) statusSnapshots: Record<string, MachineStatusSnapshot> = {};
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) onSelect?: (machine: Machine) => void;
  @property({ attribute: false }) onRemove?: (machine: Machine) => void | Promise<void>;
  /** Rename any machine, local included: the local one is a display alias. */
  @property({ attribute: false }) onRename?: (machine: Machine, name: string) => void | Promise<void>;
  /** Re-check one machine's health; previously palette-only. */
  @property({ attribute: false }) onRefresh?: (machine: Machine) => void | Promise<void>;
  /** Open a remote machine's own PI WEB; previously palette-only. */
  @property({ attribute: false }) onOpen?: (machine: Machine) => void;
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

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("machines") && this.openMenuMachineId !== undefined && !this.machines.some((machine) => machine.id === this.openMenuMachineId)) this.openMenuMachineId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuMachineId = undefined;
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
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
        ${hasQuery ? html`<button class="list-search-clear" title="Clear search" aria-label="Clear search" @click=${() => { this.searchQuery = ""; }}>×</button>` : null}
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

  private renderMachine(machine: Machine) {
    const status = this.statuses[machine.id]?.status ?? machine.status ?? "unknown";
    const statusLabel = status === "online" ? "online" : status === "offline" ? "offline" : status === "error" ? "error" : "unknown";
    // The local machine used to have no menu at all, so its rename lived only
    // in a settings panel nobody found. Any machine with at least one action
    // gets the same menu affordance.
    const hasActions = machineRowActions(machine, { remove: this.onRemove !== undefined, rename: this.onRename !== undefined, refresh: this.onRefresh !== undefined, open: this.onOpen !== undefined }).length > 0;
    return html`
      <div
        class=${`action-row machine-row ${this.selected?.id === machine.id ? "selected" : ""} ${hasActions ? "" : "no-actions"}`}
        title=${machine.baseUrl ?? machine.name}
        @keydown=${(event: KeyboardEvent) => { this.handleMachineKeydown(event, machine); }}
      >
        <button
          type="button"
          class="action-main"
          aria-current=${this.selected?.id === machine.id ? "true" : nothing}
          @click=${() => { if (!this.gestures.consumeSuppressedClick()) this.onSelect?.(machine); }}
          @contextmenu=${(event: MouseEvent) => { this.gestures.contextMenu(machine.id, event); }}
          @pointerdown=${(event: PointerEvent) => { this.gestures.pointerDown(machine.id, event); }}
          @pointermove=${(event: PointerEvent) => { this.gestures.pointerMove(event); }}
          @pointerup=${() => { this.gestures.cancel(); }}
          @pointercancel=${() => { this.gestures.cancel(); }}
        >
          <span class="action-name machine-primary"><span class="machine-primary-label">${machine.name}</span></span><small>${machine.kind === "local" ? "Local Pi Web" : machine.baseUrl ?? "Remote Pi Web"} · ${statusLabel}</small>
          ${this.renderActivity(machine)}
        </button>
        ${hasActions ? this.renderMachineMenu(machine) : null}
      </div>
    `;
  }

  private renderActivity(machine: Machine) {
    const flags = this.statusSnapshots[machine.id]?.machine;
    const status = this.statuses[machine.id]?.status ?? machine.status;
    // Unread survives offline: an offline machine keeps its last-known unread
    // state (stale-but-present still counts), so only the work dot is gated.
    const kind = status === "offline" || status === "error" ? undefined : statusActivityKind(flags);
    const unreadLabel = hasStatusUnread(flags) ? "Unread sessions on this machine" : undefined;
    return renderActionActivityIndicator(kind, kind === "terminal" ? "Machine terminal active" : "Machine active", unreadLabel);
  }

  private renderMachineMenu(machine: Machine) {
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
            ${this.onRefresh === undefined ? null : html`<button title=${`Check ${machine.name} again`} @click=${() => { this.openMenuMachineId = undefined; void this.onRefresh?.(machine); }}>Check again</button>`}
            ${this.onRename === undefined ? null : html`<button title=${machine.kind === "local" ? "Rename this device (display name only)" : `Rename ${machine.name}`} @click=${() => { this.promptRename(machine); }}>Rename…</button>`}
            ${this.onOpen === undefined || machine.kind !== "remote" ? null : html`<button title=${`Open ${machine.name} in a new tab`} @click=${() => { this.openMenuMachineId = undefined; this.onOpen?.(machine); }}>Open PI WEB</button>`}
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
    return html`<button class="section-add" title="Add machine" aria-label="Add machine" @click=${(event: Event) => { event.stopPropagation(); this.onAdd?.(); }}><span aria-hidden="true">+</span><span class="section-add-label">Add machine</span></button>`;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>Machines</span>`;
    const selectedSummary = this.selected?.name ?? "No machine selected";
    const selectedTitle = this.selected?.baseUrl ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} Machines</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.machines.length}</small></button>`;
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
  private promptRename(machine: Machine): void {
    this.openMenuMachineId = undefined;
    const next = prompt(machine.kind === "local" ? "Name for this device:" : `Name for ${machine.name}:`, machine.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === machine.name) return;
    void this.onRename?.(machine, trimmed);
  }

  private removeMachine(machine: Machine): void {
    this.openMenuMachineId = undefined;
    void this.onRemove?.(machine);
  }

  private handleMachineKeydown(event: KeyboardEvent, machine: Machine): void {
    if (event.key === "Escape" && this.openMenuMachineId === machine.id) {
      event.preventDefault();
      event.stopPropagation();
      this.openMenuMachineId = undefined;
      return;
    }
    handleSelectableRowKeyboard(event, {
      activate: () => this.onSelect?.(machine),
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  static override styles = [
    listStyles,
    css`
      .machine-row { border-radius: var(--pi-radius-lg); }
      .machine-row.no-actions .action-main { border-radius: var(--pi-radius-lg); }
      .machine-row .action-main { min-height: 58px; align-content: center; }
      .machine-primary { display: flex; align-items: baseline; gap: var(--pi-space-3); }
      .machine-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .machine-menu-panel button.danger { color: var(--pi-danger); }
      .machine-menu-panel button.danger:hover, .machine-menu-panel button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
    `,
  ];
}

export function canRemoveMachine(machine: Machine): boolean {
  return machine.kind === "remote";
}

/**
 * Which row-menu actions a machine actually offers, so the menu button appears
 * exactly when there is something behind it.
 */
export function machineRowActions(machine: Machine, available: { remove: boolean; rename: boolean; refresh: boolean; open: boolean }): string[] {
  const actions: string[] = [];
  if (available.refresh) actions.push("refresh");
  if (available.rename) actions.push("rename");
  if (available.open && machine.kind === "remote") actions.push("open");
  if (available.remove && canRemoveMachine(machine)) actions.push("remove");
  return actions;
}

function machineMenuId(machineId: string): string {
  return `machine-menu-${machineId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

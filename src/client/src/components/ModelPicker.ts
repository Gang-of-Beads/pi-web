import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CommandOption, SessionModelCatalogEntry } from "../api";
import { keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import { matchesAllQueryWords, normalizeSearchQuery } from "../searchMatching";
import "./ModalSurface";
import { scrollWhenSelected } from "./scrollWhenSelected";
import { interactiveSurfaceStyles } from "./shared";

/**
 * Scope the model dialog lists: `enabled` is the session's pickable model list
 * (pi's enabled-models scope); `all` is the session machine's full catalog
 * with per-model membership controls.
 */
export type ModelPickerMode = "enabled" | "all";

/** Filtered All-mode catalog view. Catalog order (enabled first) is preserved. */
export interface ModelCatalogView {
  rows: SessionModelCatalogEntry[];
  /** Group headers only help the unfiltered list; while searching, one flat list is clearer. */
  showGroupHeaders: boolean;
}

/** The wire value identifying one model row: `${provider}/${id}`. */
export function modelCatalogEntryValue(entry: Pick<SessionModelCatalogEntry, "provider" | "id">): string {
  return `${entry.provider}/${entry.id}`;
}

/** Case-insensitive word filter over the Enabled-mode options (CommandPicker semantics). */
export function filterModelOptions(options: readonly CommandOption[], query: string): CommandOption[] {
  const normalized = normalizeSearchQuery(query);
  if (normalized === "") return [...options];
  return options.filter((option) => matchesAllQueryWords(`${option.label} ${option.description ?? ""} ${option.value}`, normalized));
}

/** Case-insensitive word filter over the All-mode catalog, mirroring pi's model search text (id, provider, name). */
export function modelCatalogView(catalog: readonly SessionModelCatalogEntry[], query: string): ModelCatalogView {
  const normalized = normalizeSearchQuery(query);
  const rows = normalized === ""
    ? [...catalog]
    : catalog.filter((entry) => matchesAllQueryWords(`${entry.provider} ${entry.id} ${entry.name ?? ""}`, normalized));
  const showGroupHeaders = normalized === "" && rows.some((entry) => entry.enabled) && rows.some((entry) => !entry.enabled);
  return { rows, showGroupHeaders };
}

interface ModelPickerRow {
  value: string;
  entry?: SessionModelCatalogEntry | undefined;
}

/**
 * The session model selection dialog. Enabled mode keeps the classic
 * searchable pick list; All models mode lists the machine's full catalog with
 * per-model checkboxes editing pi's enabled-models scope (shared with the pi
 * TUI). Scope is selection UX only, never an authorization boundary.
 */
@customElement("model-picker")
export class ModelPicker extends LitElement {
  @property() override title = "Select model";
  /** Enabled-mode rows: the session's pickable models, pre-labeled by the host. */
  @property({ attribute: false }) options: CommandOption[] = [];
  /** All-mode rows: the machine's catalog, already grouped enabled-first by the server. */
  @property({ attribute: false }) catalog: SessionModelCatalogEntry[] = [];
  @property({ attribute: false }) selectedValue?: string;
  @property({ attribute: false }) onPick?: (value: string) => void;
  @property({ attribute: false }) onCancel?: () => void;
  /**
   * Requests a change to one model's membership in pi's enabled-models scope.
   * Resolves once the host has applied the fresh catalog (or reported the
   * failure); the checkbox is controlled, so it tracks the catalog, not clicks.
   */
  @property({ attribute: false }) onToggleEnabled?: (provider: string, modelId: string, enabled: boolean) => unknown;

  @state() private mode: ModelPickerMode = "enabled";
  @state() private selectedIndex = 0;
  @state() private query = "";
  @state() private pendingToggles: ReadonlySet<string> = new Set();

  override render() {
    const rows = this.visibleRows();
    return html`
      <modal-surface
        .onClose=${() => this.onCancel?.()}
        .initialFocus=${"input.search"}
        .label=${this.title}
        @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}
      >
        <header>
          <strong>${this.title}</strong>
          <button aria-label="Close" @click=${() => this.onCancel?.()}>×</button>
        </header>
        <div class="scope-toggle" role="group" aria-label="Model scope">
          ${this.renderScopeToggleButton("enabled", "Enabled")}
          ${this.renderScopeToggleButton("all", "All models")}
        </div>
        <input class="search" placeholder="Search" .value=${this.query} @input=${(event: Event) => { this.handleSearchInput(event); }}>
        <div class="options" tabindex="0">
          ${this.mode === "all" ? this.renderCatalogList() : this.renderEnabledList()}
          ${rows.length === 0 ? html`<div class="empty">No matching options</div>` : null}
        </div>
      </modal-surface>
    `;
  }

  override firstUpdated() {
    this.anchorSelectionToSelectedValue();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("catalog") || this.mode !== "all") return;
    // A toggle regroups the catalog (enabled first): keep the selection on the
    // same row rather than on the same numeric index.
    const previousCatalog = changed.get("catalog");
    if (previousCatalog === undefined) return;
    const previousRows = modelCatalogView(previousCatalog, this.query).rows;
    const anchored = previousRows[this.selectedIndex];
    const rows = modelCatalogView(this.catalog, this.query).rows;
    const anchoredValue = anchored === undefined ? undefined : modelCatalogEntryValue(anchored);
    const nextIndex = anchoredValue === undefined ? -1 : rows.findIndex((entry) => modelCatalogEntryValue(entry) === anchoredValue);
    this.selectedIndex = nextIndex >= 0 ? nextIndex : Math.min(this.selectedIndex, Math.max(rows.length - 1, 0));
  }

  private renderScopeToggleButton(mode: ModelPickerMode, label: string): TemplateResult {
    return html`<button aria-pressed=${this.mode === mode ? "true" : "false"} @click=${() => { this.selectMode(mode); }}>${label}</button>`;
  }

  private renderEnabledList(): TemplateResult[] {
    return filterModelOptions(this.options, this.query).map((option, index) => html`
      <button
        class=${index === this.selectedIndex ? "selected" : ""}
        aria-current=${index === this.selectedIndex ? "true" : nothing}
        ${scrollWhenSelected(index === this.selectedIndex, option.value)}
        @focus=${() => { this.selectedIndex = index; }}
        @click=${() => this.onPick?.(option.value)}
      >
        <span>${option.label}</span>
        ${option.description !== undefined && option.description !== "" ? html`<small>${option.description}</small>` : null}
      </button>
    `);
  }

  private renderCatalogList(): TemplateResult[] {
    const view = modelCatalogView(this.catalog, this.query);
    const rendered: TemplateResult[] = [];
    let lastGroup: boolean | undefined;
    view.rows.forEach((entry, index) => {
      if (view.showGroupHeaders && entry.enabled !== lastGroup) {
        rendered.push(html`<div class="group-header">${entry.enabled ? "Enabled" : "Other models"}</div>`);
      }
      lastGroup = entry.enabled;
      rendered.push(this.renderCatalogRow(entry, index));
    });
    return rendered;
  }

  private renderCatalogRow(entry: SessionModelCatalogEntry, index: number): TemplateResult {
    const value = modelCatalogEntryValue(entry);
    const selected = index === this.selectedIndex;
    const pending = this.pendingToggles.has(value);
    return html`
      <div class="catalog-row ${selected ? "selected" : ""}" ${scrollWhenSelected(selected, value)}>
        <input
          type="checkbox"
          .checked=${entry.enabled}
          ?disabled=${pending}
          aria-label=${`${entry.enabled ? "Disable" : "Enable"} ${value}`}
          @click=${(event: MouseEvent) => { this.handleEnableToggleClick(entry, event); }}
        />
        <button
          class="pick"
          aria-current=${selected ? "true" : nothing}
          @focus=${() => { this.selectedIndex = index; }}
          @click=${() => this.onPick?.(value)}
        >
          <span>${entry.id}${value === this.selectedValue ? " ✓ current" : ""}</span>
          <small>${entry.provider}</small>
        </button>
      </div>
    `;
  }

  private visibleRows(): ModelPickerRow[] {
    if (this.mode === "all") {
      return modelCatalogView(this.catalog, this.query).rows.map((entry) => ({ value: modelCatalogEntryValue(entry), entry }));
    }
    return filterModelOptions(this.options, this.query).map((option) => ({ value: option.value }));
  }

  private anchorSelectionToSelectedValue(): void {
    if (this.selectedValue === undefined) {
      this.selectedIndex = 0;
      return;
    }
    const index = this.visibleRows().findIndex((row) => row.value === this.selectedValue);
    this.selectedIndex = index >= 0 ? index : 0;
  }

  private selectMode(mode: ModelPickerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.anchorSelectionToSelectedValue();
  }

  private handleSearchInput(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.query = event.target.value;
      this.selectedIndex = 0;
    }
  }

  // Escape and backdrop presses are owned by the modal surface (routed to
  // `onCancel`). Search and list-container keys retain the broadened option
  // navigation idiom, while focused native buttons keep their own semantics.
  private handleKeyDown(event: KeyboardEvent) {
    if (keyboardEventOriginatesFromNativeActivationControl(event)) return;
    const rows = this.visibleRows();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length > 0) this.selectedIndex = (this.selectedIndex + 1) % rows.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length > 0) this.selectedIndex = (this.selectedIndex - 1 + rows.length) % rows.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[this.selectedIndex];
      if (row !== undefined) this.onPick?.(row.value);
    } else if (event.key === " " && this.mode === "all") {
      // Space toggles the selected row only when it did not land on an input:
      // a focused checkbox toggles through its own click and the search input
      // inserts the character.
      if (event.composedPath().some((target) => target instanceof HTMLInputElement)) return;
      const row = rows[this.selectedIndex];
      if (row?.entry === undefined) return;
      event.preventDefault();
      this.requestEnabledToggle(row.entry);
    }
  }

  private handleEnableToggleClick(entry: SessionModelCatalogEntry, event: MouseEvent): void {
    // The checkbox is controlled: cancel the native flip so the rendered state
    // keeps reflecting the catalog until the host applies the fresh one.
    event.preventDefault();
    if (event.currentTarget instanceof HTMLInputElement) event.currentTarget.checked = entry.enabled;
    this.requestEnabledToggle(entry);
  }

  private requestEnabledToggle(entry: SessionModelCatalogEntry): void {
    const value = modelCatalogEntryValue(entry);
    if (this.pendingToggles.has(value)) return;
    const pending = new Set(this.pendingToggles);
    pending.add(value);
    this.pendingToggles = pending;
    void this.settleEnabledToggle(value, entry);
  }

  private async settleEnabledToggle(value: string, entry: SessionModelCatalogEntry): Promise<void> {
    try {
      await this.onToggleEnabled?.(entry.provider, entry.id, !entry.enabled);
    } catch (error: unknown) {
      // Hosts report toggle failures through the app error state; a throwing
      // callback is a wiring bug, so it stays observable here too.
      console.warn(`Failed to toggle model ${value}`, error);
    } finally {
      const settled = new Set(this.pendingToggles);
      settled.delete(value);
      this.pendingToggles = settled;
    }
  }

  /** Opened from inside a dialog, a picker is a child of it and must paint
   *  above it: the layer tokens rank kinds of surface, so a popover opened
   *  over a dialog dimmed the backdrop and then rendered underneath it. */
  @property({ type: Boolean, reflect: true }) aboveDialog = false;

  static override styles = [interactiveSurfaceStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-popover); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui, system-ui, sans-serif); }
    :host([abovedialog]) { z-index: calc(var(--pi-layer-dialog) + 1); }
    modal-surface { --modal-surface-width: min(720px, calc(100vw - 40px)); --modal-surface-max-height: min(640px, calc(100vh - 40px)); }
    header { display: flex; align-items: center; justify-content: space-between; padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
    .scope-toggle { display: flex; gap: var(--pi-space-2); margin: var(--pi-space-5) var(--pi-space-6) 0; padding: var(--pi-space-2); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); }
    .scope-toggle button { box-sizing: border-box; flex: 1; min-height: var(--pi-control-height-comfort); font: inherit; padding: var(--pi-space-3) var(--pi-space-5); border-radius: var(--pi-radius-xs); color: var(--pi-muted); }
    .scope-toggle button[aria-pressed="true"] { background: var(--pi-selection-bg); color: var(--pi-text); }
    .options { min-height: 0; overflow: auto; outline: none; }
    .options:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    button { font: inherit; border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }
    header button { font: inherit; display: grid; place-items: center; box-sizing: border-box; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); padding: 0; font-size: var(--pi-text-xl); line-height: 1; color: var(--pi-muted); }
    input.search { box-sizing: border-box; height: var(--pi-control-height-comfort); margin: var(--pi-space-5) var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); padding: var(--pi-space-4) var(--pi-space-5); outline: none; }
    input.search:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    input.search:focus { border-color: var(--pi-accent); }
    /* Coarse pointers get the comfort floor across the popover chrome: the
       close button, scope chips, search field, and catalog checkboxes are all
       touch targets on a phone. Declared after every base rule it raises. */
    @media (pointer: coarse) {
      .options > button, .catalog-row .pick { min-height: var(--pi-control-height-touch); }
      header button { width: var(--pi-control-height-touch, 44px); height: var(--pi-control-height-touch, 44px); }
      .scope-toggle button { min-height: var(--pi-control-height-touch, 44px); }
      input.search { min-height: var(--pi-control-height-touch, 44px); }
      input[type="checkbox"] { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); accent-color: var(--pi-accent); }
    }
    .options > button { display: block; width: 100%; font: var(--pi-text-sm)/1.25 var(--pi-font-ui); padding: var(--pi-space-5) var(--pi-space-6); border-bottom: 1px solid var(--pi-border-muted); text-align: left; }
    .options > button.selected { background: var(--pi-selection-bg); border-color: var(--pi-accent); }
    .options > button.selected small, .catalog-row.selected small { color: var(--pi-text-secondary, var(--pi-text)); }
    @media (hover: hover) { .options > button:hover { background: var(--pi-surface-hover); } }
    .catalog-row { display: flex; align-items: center; border-bottom: 1px solid var(--pi-border-muted); }
    .catalog-row.selected { background: var(--pi-selection-bg); border-color: var(--pi-accent); }
    @media (hover: hover) { .catalog-row:hover { background: var(--pi-surface-hover); } }
    .catalog-row input[type="checkbox"] { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0 0 0 var(--pi-space-6); accent-color: var(--pi-accent); }
    .catalog-row .pick { font: var(--pi-text-sm)/1.25 var(--pi-font-ui); flex: 1; min-width: 0; display: block; padding: var(--pi-space-5) var(--pi-space-6); text-align: left; }
    .group-header { padding: var(--pi-space-4) var(--pi-space-6) var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-xs); text-transform: uppercase; letter-spacing: 0.04em; }
    small { display: block; margin-top: var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .empty { padding: var(--pi-space-9); color: var(--pi-muted); text-align: center; }
  `];
}

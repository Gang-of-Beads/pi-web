import { LitElement, css, html, nothing, type PropertyValues, unsafeCSS } from "lit";
import { renderCrossIcon, uiIconStyle } from "./uiIcons.js";
import { customElement, property, state } from "lit/decorators.js";
import type { AppAction } from "../actions";
import { formatShortcut } from "../keyboardShortcuts";
import { keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import { matchesAllQueryWords, normalizeSearchQuery } from "../searchMatching";
import "./ModalSurface";
import { scrollWhenSelected } from "./scrollWhenSelected";
import { interactiveSurfaceStyles } from "./shared";

@customElement("action-palette")
export class ActionPalette extends LitElement {
  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) onRun?: (action: AppAction) => void;
  @property({ attribute: false }) onCancel?: () => void;
  @state() private queryText = "";
  @state() private selectedIndex = 0;

  override render() {
    const actions = this.filteredActions();
    return html`
      <modal-surface
        .onClose=${() => this.onCancel?.()}
        .initialFocus=${"input"}
        .label=${"Action palette"}
        @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}
      >
        <header>
          <input
            .value=${this.queryText}
            placeholder="Search actions…"
            @input=${(event: Event) => {
              if (event.target instanceof HTMLInputElement) {
                this.queryText = event.target.value;
                this.selectedIndex = 0;
              }
            }}
          >
          <button title="Close" aria-label="Close" @click=${() => this.onCancel?.()}>${renderCrossIcon()}</button>
        </header>
        <div class="options">
          ${actions.length === 0 ? html`<div class="empty">No actions found.</div>` : actions.map((action, index) => html`
            <button
              class=${`${index === this.selectedIndex ? "selected" : ""} ${action.enabled === false ? "disabled" : ""}`}
              ?disabled=${action.enabled === false}
              title=${action.disabledReason ?? action.title}
              aria-current=${index === this.selectedIndex ? "true" : nothing}
              ${scrollWhenSelected(index === this.selectedIndex, action.id)}
              @focus=${() => { this.selectedIndex = index; }}
              @click=${() => { this.run(action); }}
            >
              <span class="main">
                <strong>${action.title}</strong>
                ${action.description !== undefined && action.description !== "" ? html`<small>${action.description}</small>` : null}
                ${action.enabled === false && action.disabledReason !== undefined ? html`<small class="disabled-reason">${action.disabledReason}</small>` : null}
              </span>
              ${action.shortcut !== undefined ? html`<kbd>${formatShortcut(action.shortcut)}</kbd>` : null}
              ${action.group !== undefined && action.group !== "" ? html`<small class="group">${action.group}</small>` : null}
            </button>
          `)}
        </div>
      </modal-surface>
    `;
  }

  protected override updated(changed: PropertyValues) {
    if (!changed.has("actions") && !changed.has("queryText")) return;
    const maxIndex = Math.max(0, this.filteredActions().length - 1);
    if (this.selectedIndex > maxIndex) this.selectedIndex = maxIndex;
  }

  private filteredActions(): AppAction[] {
    return filterActionPaletteActions(this.actions, this.queryText);
  }

  // Escape and backdrop presses are owned by the modal surface (routed to
  // `onCancel`). Search-input keys retain the action-list navigation idiom,
  // while focused native buttons keep their own semantics.
  private handleKeyDown(event: KeyboardEvent) {
    if (keyboardEventOriginatesFromNativeActivationControl(event)) return;
    const actions = this.filteredActions();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (actions.length > 0) this.selectedIndex = (this.selectedIndex + 1) % actions.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (actions.length > 0) this.selectedIndex = (this.selectedIndex - 1 + actions.length) % actions.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = actions[this.selectedIndex];
      if (action !== undefined) this.run(action);
    }
  }

  private run(action: AppAction) {
    if (action.enabled === false) return;
    this.onRun?.(action);
  }

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-overlay); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui, system-ui, sans-serif); line-height: inherit; }
    modal-surface { --palette-top: min(12dvh, 90px); --palette-bottom: max(20px, env(safe-area-inset-bottom)); --modal-surface-place-items: start center; --modal-surface-backdrop-padding: var(--palette-top) var(--pi-space-8) var(--palette-bottom); --modal-surface-max-height: min(640px, calc(100dvh - var(--palette-top) - var(--palette-bottom))); }
    header { display: grid; grid-template-columns: 1fr auto; gap: var(--pi-space-4); padding: var(--pi-space-5); border-bottom: 1px solid var(--pi-border); }
    input { min-width: 0; border: 0; outline: none; background: transparent; color: var(--pi-text); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); line-height: inherit; padding: var(--pi-space-4); }
    /* The border is removed for the flush look, so focus needs its own ring. */
    input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); border-radius: var(--pi-radius-sm); }
    input::placeholder { color: var(--pi-dim); }
    button { font: inherit; border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }
    @media (pointer: coarse) { button:active { background: var(--pi-surface-hover); } }
    header button { box-sizing: border-box; display: grid; place-items: center; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); line-height: 1; color: var(--pi-muted); font-size: var(--pi-text-xl); padding: var(--pi-space-1) var(--pi-space-4); }
    @media (pointer: coarse) { header button { width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); } }
    .options { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .options button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-2) var(--pi-space-6); box-sizing: border-box; width: 100%; padding: var(--pi-space-5) var(--pi-space-6); border-bottom: 1px solid var(--pi-border-muted); text-align: left; 
    .options button small { font-size: var(--pi-text-2xs); }
    .options button.selected { background: var(--pi-selection-bg); }
    @media (hover: hover) { .options button:hover:not(:disabled) { background: var(--pi-selection-bg); } }
    .options button:disabled { cursor: not-allowed; opacity: var(--pi-disabled-opacity); }
    .options button.disabled.selected { background: color-mix(in srgb, var(--pi-selection-bg) 55%, transparent); }
    .main { min-width: 0; }
    strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    small { display: block; color: var(--pi-muted); font-size: var(--pi-text-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .disabled-reason { color: var(--pi-warning); }
    .group { grid-column: 1 / -1; font-size: var(--pi-text-xs); }
    kbd { align-self: center; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-muted); padding: var(--pi-space-1) var(--pi-space-3); font: var(--pi-text-xs) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: inherit; white-space: nowrap; }
    .empty { padding: var(--pi-space-9); color: var(--pi-muted); text-align: center; }
    /* A shortcut badge is an affordance for a keyboard. On a touch screen it
       is a label for a key nobody can press, and the column it holds open was
       measured at 101px - width the title was being truncated to give up. */
    @media (pointer: coarse) {
      kbd { display: none; }
      .options button { grid-template-columns: minmax(0, 1fr); }
    }
  `];
}

/**
 * The action that opens this palette, which the palette does not list.
 *
 * It stays registered because it owns the shortcut that opens the palette from
 * everywhere else; it is only the offer to open the surface already on screen
 * that is worth nothing. Matched on the unqualified tail so the plugin
 * namespace a host prefixes (`core:`) does not decide whether it is hidden.
 */
const OPEN_PALETTE_ACTION_ID = "actions.show";

function opensThisPalette(action: AppAction): boolean {
  return action.id === OPEN_PALETTE_ACTION_ID || action.id.endsWith(`:${OPEN_PALETTE_ACTION_ID}`);
}

export function filterActionPaletteActions(actions: readonly AppAction[], queryText: string): AppAction[] {
  const query = normalizeSearchQuery(queryText);
  return actions
    .filter((action) => !opensThisPalette(action))
    .filter((action) => action.enabled !== false || action.disabledReason !== undefined)
    .filter((action) => {
      if (query === "") return true;
      const haystack = [action.title, action.description ?? "", action.disabledReason ?? "", action.group ?? "", action.shortcut ?? ""].join(" ");
      return matchesAllQueryWords(haystack, query);
    });
}
